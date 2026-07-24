import { describe, it, expect } from "vitest";
import {
  clampPlayable,
  isBlockedSpawn,
  pickSpawnPoint,
  pickHumanSpawnPoint,
  PLAYABLE_HALF,
  isInStartPlatform,
  START_PADDOCK,
} from "../shared/arena";
import { startPadAt } from "../shared/economy";

describe("arena helpers", () => {
  it("flags spawns inside obstacles", () => {
    expect(isBlockedSpawn(0, 0)).toBe(true);
    expect(isBlockedSpawn(-30, -30)).toBe(true);
    expect(isBlockedSpawn(20, 20)).toBe(false);
  });

  it("clamps to playable half", () => {
    const p = clampPlayable(80, -80);
    expect(p.x).toBe(PLAYABLE_HALF);
    expect(p.z).toBe(-PLAYABLE_HALF);
  });

  it("returns spawns outside obstacles", () => {
    const a = pickSpawnPoint([]);
    const b = pickSpawnPoint([{ x: a.x, z: a.z }]);
    expect(isBlockedSpawn(a.x, a.z, 1)).toBe(false);
    expect(isBlockedSpawn(b.x, b.z, 1)).toBe(false);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(6);
  });

  it("spawns the human on the east start lift", () => {
    const spawn = pickHumanSpawnPoint();
    expect(spawn.x).toBe(START_PADDOCK.spawnX);
    expect(spawn.z).toBe(START_PADDOCK.spawnZ);
    expect(isInStartPlatform(spawn.x, spawn.z)).toBe(true);
    expect(startPadAt(spawn.x, spawn.z)?.kind).toBe("start");
    expect(isBlockedSpawn(spawn.x, spawn.z, 1.5)).toBe(false);
  });

  it("limits start capture to the visible lift ring", () => {
    expect(isInStartPlatform(START_PADDOCK.spawnX + 5.5, START_PADDOCK.spawnZ)).toBe(true);
    expect(isInStartPlatform(START_PADDOCK.spawnX + 7, START_PADDOCK.spawnZ)).toBe(false);
  });
});
