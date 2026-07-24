import { describe, expect, it } from "vitest";
import {
  ARENA_HAZARDS,
  checkHazardStrike,
  hazardAngle,
  hazardArmSegments,
} from "../shared/hazards";
import { tickHull } from "../shared/economy";

describe("arena hazards", () => {
  it("spinner angle advances with time", () => {
    const spinner = ARENA_HAZARDS.find((h) => h.id === "center-cross")!;
    expect(hazardAngle(spinner, 0)).toBeCloseTo(0);
    expect(hazardAngle(spinner, 1)).toBeCloseTo(1.35);
  });

  it("pendulum angle oscillates", () => {
    const gate = ARENA_HAZARDS.find((h) => h.id === "north-gate")!;
    const a0 = hazardAngle(gate, 0);
    const a1 = hazardAngle(gate, gate.pendulumPeriod! / 4);
    expect(Math.abs(a1 - a0)).toBeGreaterThan(0.3);
  });

  it("cross spinner produces two arms", () => {
    const segs = hazardArmSegments(ARENA_HAZARDS[0], 0);
    expect(segs).toHaveLength(2);
  });

  it("strikes when car overlaps an arm at ground height", () => {
    const cooldowns: Record<string, number> = {};
    const t = 0;
    const seg = hazardArmSegments(ARENA_HAZARDS[0], t)[0];
    const midX = (seg.ax + seg.bx) / 2;
    const midZ = (seg.az + seg.bz) / 2;
    const hit = checkHazardStrike(t, midX, 1.5, midZ, cooldowns);
    expect(hit).not.toBeNull();
    expect(hit!.damage).toBeGreaterThan(0);
  });

  it("misses when car is too high (platform safety)", () => {
    const cooldowns: Record<string, number> = {};
    const hit = checkHazardStrike(0, 0, 12, 8, cooldowns);
    expect(hit).toBeNull();
  });

  it("respects per-hazard cooldown", () => {
    const cooldowns: Record<string, number> = {};
    const t = 0;
    const seg = hazardArmSegments(ARENA_HAZARDS[0], t)[0];
    const midX = (seg.ax + seg.bx) / 2;
    const midZ = (seg.az + seg.bz) / 2;
    expect(checkHazardStrike(t, midX, 1.5, midZ, cooldowns)).not.toBeNull();
    expect(checkHazardStrike(t + 0.1, midX, 1.5, midZ, cooldowns)).toBeNull();
  });

  it("tickHull applies hazard strike damage", () => {
    const after = tickHull({
      hull: 80,
      speed: 10,
      dt: 1 / 60,
      zones: [],
      collisionHit: false,
      hazardStrike: 16,
    });
    expect(after).toBe(64);
  });
});
