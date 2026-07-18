import RAPIER from "@dimforge/rapier3d-compat";
import { ARENA_HALF, OBSTACLES, PLATFORMS, RAMPS, Ramp } from "../../../shared/protocol";
import { rotateYawVector } from "../../../shared/mathutil";

export interface CarControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, positive = left
  handbrake?: boolean;
  jump?: boolean;
}

export const HOVER_HEIGHT = 1.2;
const JUMP_VELOCITY = 9;
const AIR_GRAVITY = 22;
const DROP_GRAVITY = 38;
const MASS = 120;
const ENGINE_FORCE = 14000;
const BRAKE_FORCE = 18000;
const MAX_SPEED = 34;
const MAX_REVERSE = 11;
const MAX_TURN_RATE = 2.6;
const BASE_LATERAL_GRIP = 0.8;
const FORWARD_ACCEL_CURVE = 0.72;
const BRAKE_BIAS = 0.4;
const CAR_HALF_H = 0.38;
const CAR_FOOTPRINT_X = 1.15;
const CAR_FOOTPRINT_Z = 2.15;
const RAMP_THICKNESS = 0.65;
const PLATFORM_THICKNESS = 0.8;

function onPlatform(x: number, z: number, w: number, d: number, px: number, pz: number) {
  return x >= px - w / 2 && x <= px + w / 2 && z >= pz - d / 2 && z <= pz + d / 2;
}

function rampHeightAt(r: Ramp, x: number, z: number): number | null {
  const cos = Math.cos(r.heading);
  const sin = Math.sin(r.heading);
  const lx = (x - r.x) * cos + (z - r.z) * sin;
  const lz = -(x - r.x) * sin + (z - r.z) * cos;
  if (Math.abs(lz) > r.width / 2 || Math.abs(lx) > r.length / 2) return null;
  const t = (lx + r.length / 2) / r.length;
  return r.yLow + (r.yHigh - r.yLow) * t;
}

function rampRotation(heading: number, pitch: number): RAPIER.Rotation {
  const hy = heading / 2;
  const px = pitch / 2;
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cp = Math.cos(px);
  const sp = Math.sin(px);
  // q = qYaw * qPitch (Y then X)
  return {
    x: sy * cp,
    y: cy * cp,
    z: -sy * sp,
    w: cy * cp,
  };
}

export class Physics {
  world: RAPIER.World;
  private carBodies = new Set<RAPIER.RigidBody>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA_HALF, 0.5, ARENA_HALF)
        .setTranslation(0, -0.5, 0)
        .setFriction(0.35)
        .setRestitution(0.05),
    );

    const wall = (x: number, z: number, hx: number, hz: number) =>
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 2, hz).setTranslation(x, 2, z),
      );
    wall(0, -ARENA_HALF - 1, ARENA_HALF + 2, 1);
    wall(0, ARENA_HALF + 1, ARENA_HALF + 2, 1);
    wall(-ARENA_HALF - 1, 0, 1, ARENA_HALF + 2);
    wall(ARENA_HALF + 1, 0, 1, ARENA_HALF + 2);

    for (const o of OBSTACLES) {
      const collH = Math.max(o.h, 3.6);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(o.w / 2, collH / 2, o.d / 2)
          .setTranslation(o.x, collH / 2, o.z)
          .setFriction(0.65)
          .setRestitution(0.08),
      );
    }

    for (const p of PLATFORMS) {
      const cy = p.y - PLATFORM_THICKNESS / 2;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.w / 2, PLATFORM_THICKNESS / 2, p.d / 2)
          .setTranslation(p.x, cy, p.z)
          .setFriction(0.55)
          .setRestitution(0.04),
      );
    }

    for (const r of RAMPS) {
      const pitch = Math.atan2(r.yHigh - r.yLow, r.length);
      const centerY = (r.yLow + r.yHigh) / 2;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(r.width / 2, RAMP_THICKNESS / 2, r.length / 2)
          .setTranslation(r.x, centerY, r.z)
          .setRotation(rampRotation(r.heading, pitch))
          .setFriction(0.62)
          .setRestitution(0.03),
      );
    }
  }

  spawn(x: number, z: number, heading: number): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, HOVER_HEIGHT, z)
      .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) })
      .setLinearDamping(0.18)
      .setAngularDamping(8)
      .setGravityScale(0)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.05, CAR_HALF_H, 2.05)
        .setDensity(MASS)
        .setFriction(0.45)
        .setRestitution(0.05),
      body,
    );
    this.carBodies.add(body);
    return body;
  }

  /** Highest supporting surface under the board (ground, deck, ramp, or another car). */
  getSurfaceY(body: RAPIER.RigidBody): number {
    const pos = body.translation();
    let best = 0;
    const reach = pos.y + 0.4;

    for (const p of PLATFORMS) {
      if (!onPlatform(pos.x, pos.z, p.w, p.d, p.x, p.z)) continue;
      if (p.y <= reach) best = Math.max(best, p.y);
    }
    for (const r of RAMPS) {
      const h = rampHeightAt(r, pos.x, pos.z);
      if (h !== null && h <= reach) best = Math.max(best, h);
    }

    for (const other of this.carBodies) {
      if (other.handle === body.handle) continue;
      const ot = other.translation();
      const dx = pos.x - ot.x;
      const dz = pos.z - ot.z;
      if (Math.abs(dx) > CAR_FOOTPRINT_X || Math.abs(dz) > CAR_FOOTPRINT_Z) continue;
      const roof = ot.y + CAR_HALF_H;
      if (pos.y >= roof - 1.2 && pos.y <= roof + 6) best = Math.max(best, roof);
    }

    return best;
  }

  targetHoverY(body: RAPIER.RigidBody): number {
    return this.getSurfaceY(body) + HOVER_HEIGHT;
  }

  isGrounded(body: RAPIER.RigidBody): boolean {
    const y = body.translation().y;
    const vy = body.linvel().y;
    const target = this.targetHoverY(body);
    return y <= target + 0.14 && Math.abs(vy) < 0.75;
  }

  step(dt: number) {
    const substeps = 3;
    const h = Math.min(dt / substeps, 1 / 60);
    this.world.timestep = h;
    for (let i = 0; i < substeps; i++) this.world.step();
  }

  updateHover(body: RAPIER.RigidBody, diving = false) {
    const y = body.translation().y;
    const vy = body.linvel().y;
    const targetY = this.targetHoverY(body);
    const airborne = y > targetY + 0.1 || vy > 0.75;

    if (airborne) {
      const gravity = diving ? DROP_GRAVITY : AIR_GRAVITY;
      body.addForce({ x: 0, y: -MASS * gravity, z: 0 }, true);
    } else {
      const dy = targetY - y;
      const lift = dy * 220 + Math.abs(dy) * 80;
      body.addForce({ x: 0, y: Math.max(0, lift), z: 0 }, true);
    }

    const ang = body.rotation();
    const pitch = Math.atan2(2 * (ang.w * ang.x - ang.z * ang.y), 1 - 2 * (ang.x * ang.x + ang.y * ang.y));
    const rollT = 2 * (ang.w * ang.y + ang.x * ang.z);
    const roll = Math.atan2(rollT, 1 - 2 * (ang.y * ang.y + ang.z * ang.z));
    body.applyTorqueImpulse({ x: -pitch * 90, y: 0, z: -roll * 90 }, true);
  }

  drive(body: RAPIER.RigidBody, input: { throttle: number; brake: number; steer: number; handbrake?: boolean }) {
    body.resetForces(true);

    const targetY = this.targetHoverY(body);
    const diving = input.brake > 0 && body.translation().y > targetY + 0.12;
    this.updateHover(body, diving);
    const rot = body.rotation();
    const fwd = rotateYawVector(rot, { x: 0, z: -1 });
    const right = rotateYawVector(rot, { x: 1, z: 0 });
    const v = body.linvel();
    const speed = v.x * fwd.x + v.z * fwd.z;
    const mag = Math.hypot(v.x, v.z);

    const throttleCurve = Math.pow(input.throttle, FORWARD_ACCEL_CURVE);
    let force = 0;
    if (throttleCurve > 0 && speed < MAX_SPEED) force += throttleCurve * ENGINE_FORCE;
    if (input.brake > 0) {
      if (speed > 0.5) force -= input.brake * BRAKE_FORCE * BRAKE_BIAS;
      else if (speed > -MAX_REVERSE) force -= input.brake * ENGINE_FORCE * 0.45;
    }
    if (input.handbrake) {
      if (speed > 0.5) force -= BRAKE_FORCE * 0.55;
      else if (speed < -0.5) force += BRAKE_FORCE * 0.25;
    }
    body.addForce({ x: fwd.x * force, y: 0, z: fwd.z * force }, true);

    const steerEffect = 0.45 + 0.55 * Math.min(1, Math.max(0, Math.abs(speed) / 18));
    const highSpeedScale = 1 - 0.2 * Math.max(0, (Math.abs(speed) - 8) / (MAX_SPEED - 8));
    const reverse = speed < -0.5 ? -1 : 1;
    const targetYaw = input.steer * MAX_TURN_RATE * steerEffect * highSpeedScale * reverse;
    const currentYaw = body.angvel().y;
    const yawRate = currentYaw + (targetYaw - currentYaw) * 0.35;
    body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);

    const latSpeed = v.x * right.x + v.z * right.z;
    const grip = input.handbrake ? BASE_LATERAL_GRIP * 0.45 : BASE_LATERAL_GRIP;
    const lateralBrake = Math.max(0, (mag - 4) / 24);
    const impulse = -latSpeed * MASS * (grip + lateralBrake);
    body.applyImpulse({ x: right.x * impulse, y: 0, z: right.z * impulse }, true);
  }

  /** Pop the board off the deck; returns true when a jump was started. */
  tryJump(body: RAPIER.RigidBody): boolean {
    const y = body.translation().y;
    const vy = body.linvel().y;
    const targetY = this.targetHoverY(body);
    if (y > targetY + 0.15 || Math.abs(vy) > 0.55) return false;
    const v = body.linvel();
    body.setLinvel({ x: v.x, y: JUMP_VELOCITY, z: v.z }, true);
    return true;
  }
}

export interface PhysicsConfig {
  styleId?: string;
}

export async function createPhysics(_cfg?: PhysicsConfig): Promise<Physics> {
  await RAPIER.init();
  return new Physics();
}
