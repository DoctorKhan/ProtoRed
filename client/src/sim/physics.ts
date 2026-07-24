import RAPIER from "@dimforge/rapier3d-compat";
import { ARENA_HALF, OBSTACLES, PLATFORMS, RAMPS, Ramp } from "../../../shared/protocol";
import { clampPlayable } from "../../../shared/arena";
import { rotateYawVector } from "../../../shared/mathutil";

export interface CarControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, positive = left
  handbrake?: boolean;
  jump?: boolean;
}

export const HOVER_HEIGHT = 1.2;
const JUMP_VELOCITY = 8.2;
const AIR_GRAVITY = 30;
const DROP_GRAVITY = 52;
/** Forward drive while airborne — keeps jumps as arcs, not sustained flight. */
const AIR_THROTTLE_FACTOR = 0.42;
const AIR_STEER_FACTOR = 0.58;
const AIR_LATERAL_GRIP = 0.32;
const AIR_DRAG = 1.4;
const LANDING_SNAP_GRAVITY = 18;
const MASS = 120;
const ENGINE_FORCE = 14000;
const LAUNCH_BOOST_FORCE = 10000;
const LAUNCH_BOOST_END_SPEED = 14;
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
const MAX_BODY_Y = 18;

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
        RAPIER.ColliderDesc.cuboid(hx, 9, hz).setTranslation(x, 9, z),
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
    return y <= target + 0.15 && Math.abs(vy) < 0.8;
  }

  private isAirborne(body: RAPIER.RigidBody): boolean {
    return !this.isGrounded(body);
  }

  /** Keep cars inside the playable volume and recover from falls. */
  enforceBounds(body: RAPIER.RigidBody) {
    const t = body.translation();
    const v = body.linvel();
    const { x, z } = clampPlayable(t.x, t.z);
    if (x !== t.x || z !== t.z) {
      body.setTranslation({ x, y: t.y, z }, true);
      body.setLinvel({ x: v.x * 0.25, y: v.y, z: v.z * 0.25 }, true);
    }

    const pos = body.translation();
    const vel = body.linvel();
    const targetY = this.targetHoverY(body);
    let y = pos.y;

    if (y < targetY - 2.5) {
      y = targetY;
      body.setLinvel({ x: vel.x * 0.35, y: 0, z: vel.z * 0.35 }, true);
    } else if (y > MAX_BODY_Y) {
      y = MAX_BODY_Y;
      body.setLinvel({ x: vel.x, y: Math.min(0, vel.y), z: vel.z }, true);
    }

    if (y !== pos.y) body.setTranslation({ x: pos.x, y, z: pos.z }, true);
  }

  /** Small pop to escape minor geometry snags. */
  unstick(body: RAPIER.RigidBody) {
    const v = body.linvel();
    body.setLinvel({ x: v.x * 0.2, y: 4.5, z: v.z * 0.2 }, true);
    body.applyTorqueImpulse({ x: 0, y: (Math.random() - 0.5) * 40, z: 0 }, true);
  }

  step(dt: number) {
    const substeps = 6;
    const h = Math.min(dt / substeps, 1 / 60);
    this.world.timestep = h;
    for (let i = 0; i < substeps; i++) this.world.step();
    for (const body of this.carBodies) this.enforceBounds(body);
  }

  updateHover(body: RAPIER.RigidBody, diving = false) {
    const y = body.translation().y;
    const vy = body.linvel().y;
    const targetY = this.targetHoverY(body);
    const airborne = this.isAirborne(body);

    if (airborne) {
      let gravity = diving ? DROP_GRAVITY : AIR_GRAVITY;
      // Pull down harder when descending near the hover deck so landings feel crisp.
      if (vy < 0 && y < targetY + 2.2) {
        gravity += LANDING_SNAP_GRAVITY * (1 - Math.max(0, y - targetY) / 2.2);
      }
      body.addForce({ x: 0, y: -MASS * gravity, z: 0 }, true);
    } else {
      const dy = targetY - y;
      const lift = dy * 52 + Math.abs(dy) * 30;
      body.addForce({ x: 0, y: Math.max(0, lift), z: 0 }, true);
      // Bleed vertical bounce when settling onto the deck.
      if (Math.abs(dy) < 0.08 && Math.abs(vy) < 1.2) {
        body.setLinvel({ x: body.linvel().x, y: vy * 0.72, z: body.linvel().z }, true);
      }
    }

    const ang = body.rotation();
    const pitch = Math.atan2(2 * (ang.w * ang.x - ang.z * ang.y), 1 - 2 * (ang.x * ang.x + ang.y * ang.y));
    const rollT = 2 * (ang.w * ang.y + ang.x * ang.z);
    const roll = Math.atan2(rollT, 1 - 2 * (ang.y * ang.y + ang.z * ang.z));
    body.applyTorqueImpulse({ x: -pitch * 90, y: 0, z: -roll * 90 }, true);
  }

  drive(
    body: RAPIER.RigidBody,
    input: { throttle: number; brake: number; steer: number; handbrake?: boolean },
    maxSpeed = MAX_SPEED,
    dt = 1 / 60,
  ) {
    body.resetForces(true);

    const targetY = this.targetHoverY(body);
    const diving = input.brake > 0 && body.translation().y > targetY + 0.12;
    const airborne = this.isAirborne(body);
    this.updateHover(body, diving);
    const rot = body.rotation();
    const fwd = rotateYawVector(rot, { x: 0, z: -1 });
    const right = rotateYawVector(rot, { x: 1, z: 0 });
    const v = body.linvel();
    const speed = v.x * fwd.x + v.z * fwd.z;
    const mag = Math.hypot(v.x, v.z);

    if (airborne) {
      const drag = Math.exp(-AIR_DRAG * dt);
      body.setLinvel({ x: v.x * drag, y: v.y, z: v.z * drag }, true);
    }

    const throttleCurve = Math.pow(input.throttle, FORWARD_ACCEL_CURVE);
    let force = 0;
    if (throttleCurve > 0 && speed < maxSpeed) {
      // Extra low-speed torque makes the board leap off the line, then fades out
      // before mid-speed so upgrades and the existing top-speed balance stay intact.
      const launchFactor = 1 - Math.min(1, Math.max(0, speed) / LAUNCH_BOOST_END_SPEED);
      force += throttleCurve * (ENGINE_FORCE + LAUNCH_BOOST_FORCE * launchFactor);
    }
    if (airborne) force *= AIR_THROTTLE_FACTOR;
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
    const highSpeedScale = 1 - 0.2 * Math.max(0, (Math.abs(speed) - 8) / (maxSpeed - 8));
    const reverse = speed < -0.5 ? -1 : 1;
    const steerScale = airborne ? AIR_STEER_FACTOR : 1;
    const targetYaw = input.steer * MAX_TURN_RATE * steerEffect * highSpeedScale * reverse * steerScale;
    const currentYaw = body.angvel().y;
    // Snap into a turn quickly from launch, then retain the smoother response at speed.
    const lowSpeedT = Math.min(1, Math.abs(speed) / 18);
    const turnInResponse = 0.68 + (0.35 - 0.68) * lowSpeedT;
    // Releasing the stick should settle the board instead of carrying rotational inertia.
    const yawDampingResponse = 0.86 + (0.62 - 0.86) * lowSpeedT;
    const yawResponse = Math.abs(input.steer) < 0.04 ? yawDampingResponse : turnInResponse;
    const yawRate = currentYaw + (targetYaw - currentYaw) * yawResponse;
    body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);

    const latSpeed = v.x * right.x + v.z * right.z;
    const gripBase = airborne ? AIR_LATERAL_GRIP : BASE_LATERAL_GRIP;
    const grip = input.handbrake ? gripBase * 0.45 : gripBase;
    const lateralBrake = Math.max(0, (mag - 4) / 24);
    const impulse = -latSpeed * MASS * (grip + lateralBrake);
    body.applyImpulse({ x: right.x * impulse, y: 0, z: right.z * impulse }, true);
  }

  /** Hard snap onto the dock mark and kill horizontal motion. */
  snapToBayCenter(body: RAPIER.RigidBody, cx: number, cz: number) {
    const t = body.translation();
    const v = body.linvel();
    body.setTranslation({ x: cx, y: t.y, z: cz }, true);
    body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Lift off the START pad and arc west onto the elevated circuit deck. */
  launchFromStartPlatform(body: RAPIER.RigidBody) {
    const t = body.translation();
    body.setTranslation({ x: t.x, y: Math.max(t.y, HOVER_HEIGHT + 0.15), z: t.z }, true);
    body.setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, true);
    body.setLinvel({ x: -8, y: 22, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Pull toward bay center; slides onto dock mark then snaps. */
  pullToBayCenter(
    body: RAPIER.RigidBody,
    cx: number,
    cz: number,
    slideDist: number,
    dt: number,
  ): boolean {
    const t = body.translation();
    let v = body.linvel();
    const dx = cx - t.x;
    const dz = cz - t.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.hypot(v.x, v.z);

    if (dist < 0.12) {
      this.snapToBayCenter(body, cx, cz);
      return true;
    }

    const nx = dx / dist;
    const nz = dz / dist;

    if (dist <= slideDist) {
      const urgency = 1 + (slideDist - dist) / slideDist;
      const slideRate = Math.min(1, dt * (10 + urgency * 14));
      const newX = t.x + dx * slideRate;
      const newZ = t.z + dz * slideRate;
      body.setTranslation({ x: newX, y: t.y, z: newZ }, true);
      body.setLinvel({ x: v.x * (1 - slideRate), y: v.y, z: v.z * (1 - slideRate) }, true);

      const distAfter = Math.hypot(cx - newX, cz - newZ);
      if (distAfter < 0.35 || distAfter < 0.12) {
        this.snapToBayCenter(body, cx, cz);
        return true;
      }
      return false;
    }

    // Slow entry at pad edge — start sliding even before the inner radius.
    if (speed < 5) {
      const edgeSlide = Math.min(1, dt * 5);
      body.setTranslation({ x: t.x + dx * edgeSlide, y: t.y, z: t.z + dz * edgeSlide }, true);
      body.setLinvel({ x: v.x * 0.7, y: v.y, z: v.z * 0.7 }, true);
      return false;
    }

    let toward = v.x * nx + v.z * nz;
    let perpX = v.x - toward * nx;
    let perpZ = v.z - toward * nz;

    const pull = Math.min(180, 50 + dist * 60) * dt;
    body.applyImpulse({ x: nx * pull, y: 0, z: nz * pull }, true);
    v = body.linvel();
    toward = v.x * nx + v.z * nz;
    perpX = v.x - toward * nx;
    perpZ = v.z - toward * nz;

    if (toward < 0) {
      body.setLinvel({ x: v.x - nx * toward * 0.9, y: v.y, z: v.z - nz * toward * 0.9 }, true);
      v = body.linvel();
      toward = v.x * nx + v.z * nz;
      perpX = v.x - toward * nx;
      perpZ = v.z - toward * nz;
    }
    const glide = Math.max(toward, Math.min(10, 4 + dist * 0.4));
    body.setLinvel(
      { x: nx * glide + perpX * 0.85, y: v.y, z: nz * glide + perpZ * 0.85 },
      true,
    );
    return false;
  }

  dampHorizontal(body: RAPIER.RigidBody, retain: number) {
    const v = body.linvel();
    body.setLinvel({ x: v.x * retain, y: v.y, z: v.z * retain }, true);
  }

  applyKnockback(body: RAPIER.RigidBody, nx: number, nz: number, strength: number) {
    const mag = Math.hypot(nx, nz) || 1;
    body.applyImpulse(
      { x: (nx / mag) * strength, y: strength * 0.08, z: (nz / mag) * strength },
      true,
    );
  }

  /** Pop the board off the deck; returns true when a jump was started. */
  tryJump(body: RAPIER.RigidBody): boolean {
    const y = body.translation().y;
    const vy = body.linvel().y;
    const targetY = this.targetHoverY(body);
    if (y > targetY + 0.12 || Math.abs(vy) > 0.45) return false;
    const v = body.linvel();
    const horiz = Math.hypot(v.x, v.z);
    // Carry a bit of ground speed into the hop; idle jumps stay short.
    const jumpVy = JUMP_VELOCITY + Math.min(2.2, horiz * 0.08);
    body.setLinvel({ x: v.x, y: jumpVy, z: v.z }, true);
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
