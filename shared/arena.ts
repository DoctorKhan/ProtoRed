// Playable-area helpers — spawn validation and XZ clamping. DOM-free for tests.

import { ARENA_HALF, OBSTACLES, PLATFORMS, RAMPS } from "./protocol";
import { ARENA_ZONES } from "./economy";
import { ARENA_HAZARDS } from "./hazards";

/** Inset from the outer wall colliders where cars should stay. */
export const PLAYABLE_INSET = 8;
export const PLAYABLE_HALF = ARENA_HALF - PLAYABLE_INSET;

const DEFAULT_BLOCK_MARGIN = 2.8;
// A randomly selected spawn needs room for both the vehicle and its chase camera.
const SPAWN_MARGIN = 6;
const SPAWN_MIN_R = 18;
const SPAWN_MAX_R = PLAYABLE_HALF - 6;

function insideRect(
  x: number,
  z: number,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  margin: number,
) {
  return Math.abs(x - cx) <= hw + margin && Math.abs(z - cz) <= hd + margin;
}

function insideOrientedRect(
  x: number,
  z: number,
  cx: number,
  cz: number,
  halfWidth: number,
  halfLength: number,
  heading: number,
  margin: number,
) {
  const dx = x - cx;
  const dz = z - cz;
  const cos = Math.cos(-heading);
  const sin = Math.sin(-heading);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.abs(localX) <= halfWidth + margin && Math.abs(localZ) <= halfLength + margin;
}

/** True when a ground-level spawn would overlap a static obstacle volume. */
export function isBlockedSpawn(x: number, z: number, margin = DEFAULT_BLOCK_MARGIN): boolean {
  if (Math.abs(x) > PLAYABLE_HALF - margin || Math.abs(z) > PLAYABLE_HALF - margin) return true;
  for (const zone of ARENA_ZONES) {
    if (zone.kind === "start") continue;
    if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + Math.min(margin, 3)) return true;
  }
  for (const o of OBSTACLES) {
    if (insideRect(x, z, o.x, o.z, o.w / 2, o.d / 2, margin)) return true;
  }
  // Cars spawn at ground level, so an elevated deck would put the camera underneath it.
  for (const p of PLATFORMS) {
    if (insideRect(x, z, p.x, p.z, p.w / 2, p.d / 2, Math.min(margin, 2.5))) return true;
  }
  for (const r of RAMPS) {
    if (insideOrientedRect(x, z, r.x, r.z, r.width / 2, r.length / 2, r.heading, Math.min(margin, 2.5))) {
      return true;
    }
  }
  for (const hazard of ARENA_HAZARDS) {
    if (Math.hypot(x - hazard.x, z - hazard.z) < hazard.armLength + Math.min(margin, 3)) return true;
  }
  return false;
}

export function clampPlayable(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, x)),
    z: Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, z)),
  };
}

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

/** East-side lift that raises the player onto the circuit. */
export const START_PADDOCK = {
  spawnX: 45,
  spawnZ: 13,
  spawnHeading: Math.PI / 2,
  platformRadius: 6,
} as const;

/** Fixed human spawn on the start lift, facing into the circuit. */
export function pickHumanSpawnPoint(): SpawnPoint {
  return {
    x: START_PADDOCK.spawnX,
    z: START_PADDOCK.spawnZ,
    heading: START_PADDOCK.spawnHeading,
  };
}

/** Magnetic footprint of the visible START lift. */
export function isInStartPlatform(x: number, z: number): boolean {
  return Math.hypot(x - START_PADDOCK.spawnX, z - START_PADDOCK.spawnZ) <= START_PADDOCK.platformRadius;
}

/** Pick an open ground spawn away from obstacles and other drivers. */
export function pickSpawnPoint(existing: { x: number; z: number }[] = []): SpawnPoint {
  for (let attempt = 0; attempt < 48; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN_R + Math.random() * (SPAWN_MAX_R - SPAWN_MIN_R);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (isBlockedSpawn(x, z, SPAWN_MARGIN)) continue;
    const crowded = existing.some((p) => Math.hypot(p.x - x, p.z - z) < 9);
    if (crowded) continue;
    // Face roughly toward the arena center, keeping the chase camera on the open outer side.
    return { x, z, heading: Math.PI / 2 - angle + (Math.random() - 0.5) * 0.35 };
  }
  // Deterministic fallback lanes (midpoints between corner obstacles).
  const fallbacks: SpawnPoint[] = [
    { x: 0, z: SPAWN_MAX_R, heading: Math.PI },
    { x: 0, z: -SPAWN_MAX_R, heading: 0 },
    { x: SPAWN_MAX_R, z: 0, heading: -Math.PI / 2 },
    { x: -SPAWN_MAX_R, z: 0, heading: Math.PI / 2 },
    { x: 16, z: 16, heading: -Math.PI * 0.75 },
    { x: -16, z: 16, heading: -Math.PI * 0.25 },
  ];
  for (const spot of fallbacks) {
    if (isBlockedSpawn(spot.x, spot.z, 1.5)) continue;
    const crowded = existing.some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < 9);
    if (!crowded) return spot;
  }
  return { x: 0, z: SPAWN_MAX_R, heading: Math.PI };
}
