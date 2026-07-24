import { describe, it, expect } from "vitest";
import {
  REDBUCKS_START,
  HULL_START,
  isInRepairBay,
  isDocked,
  zonesAt,
  repairGuide,
  repairGuideHint,
  pitRepairRate,
  tickHull,
  trySpend,
  parseRedBucksAmount,
  maxSpeedBonus,
  nextUpgrade,
  ARENA_ZONES,
} from "../shared/economy";

describe("economy", () => {
  it("starts players with a fixed RedBucks balance", () => {
    expect(REDBUCKS_START).toBeGreaterThan(0);
  });

  it("detects Repair Bay proximity", () => {
    expect(isInRepairBay(0, 48)).toBe(true);
    expect(isInRepairBay(0, 0)).toBe(false);
  });

  it("lists overlapping zones at a position", () => {
    expect(zonesAt(44, 0).some((z) => z.kind === "damage")).toBe(true);
    expect(zonesAt(0, -48).some((z) => z.label === "Pit Terminal")).toBe(true);
  });

  it("detects docked terminal proximity", () => {
    expect(isDocked(0, 48, 3)).toBe(true);
    expect(isDocked(0, 48, 10)).toBe(false);
  });

  it("damage zones chip hull over time", () => {
    const damage = ARENA_ZONES.find((z) => z.id === "damage-east")!;
    const after = tickHull({
      hull: HULL_START,
      speed: 20,
      dt: 1,
      zones: [damage],
      collisionHit: false,
    });
    expect(after).toBeLessThan(HULL_START);
  });

  it("repairGuide points to nearest pad when hull is hurt", () => {
    const guide = repairGuide(0, 0, 80, []);
    expect(guide).not.toBeNull();
    expect(guide!.label).toBe("VIP Terminal");
    expect(guide!.distanceM).toBeGreaterThan(40);
    expect(repairGuideHint(guide!)).toContain("E");
    expect(repairGuide(0, 48, 80, zonesAt(0, 48))).toBeNull();
  });

  it("pit stops repair hull when nearly stopped", () => {
    const pit = ARENA_ZONES.find((z) => z.id === "repair-south")!;
    const after = tickHull({
      hull: 40,
      speed: 2,
      dt: 2,
      zones: [pit],
      collisionHit: false,
    });
    expect(after).toBeGreaterThan(40);
  });

  it("pit repair tapers off at high speed but works when coasting", () => {
    const pit = ARENA_ZONES.find((z) => z.id === "repair-south")!;
    expect(pitRepairRate(pit, 0)).toBe(14);
    expect(pitRepairRate(pit, 14)).toBe(0);
    const mid = tickHull({
      hull: 50,
      speed: 7,
      dt: 3,
      zones: [pit],
      collisionHit: false,
    });
    expect(mid).toBeGreaterThan(50);
  });

  it("pit repair does nothing above max pit speed", () => {
    const pit = ARENA_ZONES.find((z) => z.id === "repair-south")!;
    const after = tickHull({
      hull: 50,
      speed: 20,
      dt: 2,
      zones: [pit],
      collisionHit: false,
    });
    expect(after).toBe(50);
  });

  it("trySpend deducts only when affordable", () => {
    expect(trySpend(100, 60)).toEqual({ ok: true, balance: 40 });
    expect(trySpend(50, 60)).toEqual({ ok: false, balance: 50 });
  });

  it("parseRedBucksAmount reads transfer copy", () => {
    expect(parseRedBucksAmount("send 100 RedBucks")).toBe(100);
    expect(parseRedBucksAmount("@Gizmo wire 50 rb")).toBe(50);
    expect(parseRedBucksAmount("transfer all")).toBe(500);
  });

  it("upgrade tiers increase max speed bonus", () => {
    expect(maxSpeedBonus(0)).toBe(0);
    expect(maxSpeedBonus(1)).toBeGreaterThan(0);
    expect(maxSpeedBonus(2)).toBeGreaterThan(maxSpeedBonus(1));
  });

  it("nextUpgrade returns the next tier only", () => {
    expect(nextUpgrade(0)?.tier).toBe(1);
    expect(nextUpgrade(2)).toBeNull();
  });
});
