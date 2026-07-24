// Rotating arena hazards — pure math, DOM-free (game + tests + renderer angles).

export type HazardKind = "spinner" | "pendulum";

export interface ArenaHazard {
  id: string;
  kind: HazardKind;
  x: number;
  z: number;
  armLength: number;
  armHalfWidth: number;
  /** Only strike when car center Y is in [yLow, yHigh]. */
  yLow: number;
  yHigh: number;
  phase: number;
  /** Spinner: constant rad/s. Pendulum: ignored. */
  angularSpeed?: number;
  /** Pendulum peak angle (rad). Spinner: ignored. */
  pendulumAmplitude?: number;
  /** Pendulum swing period (seconds). */
  pendulumPeriod?: number;
  /** Number of arms (2 = cross). Default 1. */
  armCount?: number;
  hullDamage: number;
  knockback: number;
}

export const HAZARD_HIT_RADIUS = 1.45;
export const HAZARD_COOLDOWN_S = 0.65;

export const ARENA_HAZARDS: ArenaHazard[] = [
  {
    id: "center-cross",
    kind: "spinner",
    x: 0,
    z: 0,
    armLength: 17,
    armHalfWidth: 1.05,
    yLow: 0.4,
    yHigh: 4.2,
    phase: 0,
    angularSpeed: 1.35,
    armCount: 2,
    hullDamage: 16,
    knockback: 4200,
  },
  {
    id: "east-sweeper",
    kind: "spinner",
    x: 26,
    z: 0,
    armLength: 12,
    armHalfWidth: 0.85,
    yLow: 0.4,
    yHigh: 4,
    phase: 0.8,
    angularSpeed: -1.05,
    hullDamage: 14,
    knockback: 3600,
  },
  {
    id: "west-sweeper",
    kind: "spinner",
    x: -26,
    z: 0,
    armLength: 12,
    armHalfWidth: 0.85,
    yLow: 0.4,
    yHigh: 4,
    phase: 2.1,
    angularSpeed: 1.05,
    hullDamage: 14,
    knockback: 3600,
  },
  {
    id: "north-gate",
    kind: "pendulum",
    x: 0,
    z: 34,
    armLength: 14,
    armHalfWidth: 0.9,
    yLow: 0.4,
    yHigh: 4.5,
    phase: 0,
    pendulumAmplitude: 0.95,
    pendulumPeriod: 4.2,
    hullDamage: 18,
    knockback: 4800,
  },
  {
    id: "south-gate",
    kind: "pendulum",
    x: 0,
    z: -34,
    armLength: 14,
    armHalfWidth: 0.9,
    yLow: 0.4,
    yHigh: 4.5,
    phase: Math.PI,
    pendulumAmplitude: 0.95,
    pendulumPeriod: 4.2,
    hullDamage: 18,
    knockback: 4800,
  },
  {
    id: "ring-spinner",
    kind: "spinner",
    x: 0,
    z: -36,
    armLength: 9,
    armHalfWidth: 0.75,
    yLow: 9.2,
    yHigh: 12.8,
    phase: 1.4,
    angularSpeed: 1.6,
    armCount: 2,
    hullDamage: 12,
    knockback: 3200,
  },
];

export interface HazardArmSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface HazardStrike {
  hazardId: string;
  damage: number;
  knockX: number;
  knockZ: number;
  knockback: number;
}

/** Primary arm angle for hazard h at sim time t (radians). */
export function hazardAngle(h: ArenaHazard, t: number): number {
  if (h.kind === "pendulum") {
    const amp = h.pendulumAmplitude ?? 0.8;
    const period = h.pendulumPeriod ?? 4;
    return h.phase + amp * Math.sin((2 * Math.PI * t) / period);
  }
  return h.phase + (h.angularSpeed ?? 1) * t;
}

export function hazardArmSegments(h: ArenaHazard, t: number): HazardArmSegment[] {
  const base = hazardAngle(h, t);
  const count = h.armCount ?? 1;
  const segs: HazardArmSegment[] = [];
  for (let i = 0; i < count; i++) {
    const ang = base + (i * Math.PI) / Math.max(1, count === 2 ? 2 : count);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const len = h.armLength;
    segs.push({
      ax: h.x,
      az: h.z,
      bx: h.x + cos * len,
      bz: h.z + sin * len,
    });
  }
  return segs;
}

function distPointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  let u = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  u = Math.max(0, Math.min(1, u));
  const cx = ax + u * dx;
  const cz = az + u * dz;
  return Math.hypot(px - cx, pz - cz);
}

function segmentHit(
  px: number,
  pz: number,
  seg: HazardArmSegment,
  halfWidth: number,
  hitRadius: number,
): boolean {
  const dist = distPointToSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
  return dist <= halfWidth + hitRadius;
}

/** Nearest strike normal (from arm toward car) for knockback. */
function knockDirection(
  px: number,
  pz: number,
  seg: HazardArmSegment,
): { x: number; z: number } {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const lenSq = dx * dx + dz * dz;
  let u = lenSq > 1e-6 ? ((px - seg.ax) * dx + (pz - seg.az) * dz) / lenSq : 0;
  u = Math.max(0, Math.min(1, u));
  const cx = seg.ax + u * dx;
  const cz = seg.az + u * dz;
  let nx = px - cx;
  let nz = pz - cz;
  const mag = Math.hypot(nx, nz);
  if (mag < 0.05) {
    const tx = seg.bx - seg.ax;
    const tz = seg.bz - seg.az;
    const tm = Math.hypot(tx, tz) || 1;
    nx = -tz / tm;
    nz = tx / tm;
  } else {
    nx /= mag;
    nz /= mag;
  }
  return { x: nx, z: nz };
}

/**
 * Returns a strike if the car overlaps a hazard arm and cooldown allows it.
 * `cooldowns` maps hazard id → sim time when hit is allowed again (mutated on hit).
 */
export function checkHazardStrike(
  t: number,
  px: number,
  py: number,
  pz: number,
  cooldowns: Record<string, number>,
  hazards: ArenaHazard[] = ARENA_HAZARDS,
  hitRadius = HAZARD_HIT_RADIUS,
): HazardStrike | null {
  if (py < 0 || py > 18) return null;
  for (const h of hazards) {
    if (py < h.yLow || py > h.yHigh) continue;
    const readyAt = cooldowns[h.id] ?? 0;
    if (t < readyAt) continue;
    const segs = hazardArmSegments(h, t);
    for (const seg of segs) {
      if (!segmentHit(px, pz, seg, h.armHalfWidth, hitRadius)) continue;
      cooldowns[h.id] = t + HAZARD_COOLDOWN_S;
      const dir = knockDirection(px, pz, seg);
      // Blend tangential push from arm spin for spinners.
      if (h.kind === "spinner") {
        const ang = hazardAngle(h, t);
        const tangent = { x: -Math.sin(ang), z: Math.cos(ang) };
        const sign = (h.angularSpeed ?? 1) >= 0 ? 1 : -1;
        dir.x = dir.x * 0.55 + tangent.x * 0.45 * sign;
        dir.z = dir.z * 0.55 + tangent.z * 0.45 * sign;
        const m = Math.hypot(dir.x, dir.z) || 1;
        dir.x /= m;
        dir.z /= m;
      }
      return {
        hazardId: h.id,
        damage: h.hullDamage,
        knockX: dir.x,
        knockZ: dir.z,
        knockback: h.knockback,
      };
    }
  }
  return null;
}
