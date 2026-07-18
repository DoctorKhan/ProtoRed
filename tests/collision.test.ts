import { describe, it, expect } from "vitest";
import { createPhysics } from "../client/src/sim/physics";

describe("physics collision", () => {
  it("stops at center obstacle when driving forward", async () => {
    const physics = await createPhysics();
    const body = physics.spawn(0, 20, 0);
    for (let i = 0; i < 900; i++) {
      physics.drive(body, { throttle: 1, brake: 0, steer: 0 });
      physics.step(1 / 60);
    }
    const t = body.translation();
    expect(t.z).toBeGreaterThan(4);
    expect(t.z).toBeLessThan(8.5);
    expect(Math.abs(t.x)).toBeLessThan(2);
  });

  it("cannot drive through corner obstacle", async () => {
    const physics = await createPhysics();
    const body = physics.spawn(-18, -18, Math.atan2(-10, -10));
    for (let i = 0; i < 1200; i++) {
      physics.drive(body, { throttle: 1, brake: 0, steer: 0 });
      physics.step(1 / 60);
    }
    const t = body.translation();
    const distToObs = Math.hypot(t.x - -30, t.z - -30);
    expect(distToObs).toBeGreaterThan(4);
  });

  it("cannot jump over a low obstacle into its volume", async () => {
    const physics = await createPhysics();
    const body = physics.spawn(-30, -12, Math.PI / 2);
    physics.tryJump(body);
    for (let i = 0; i < 240; i++) {
      physics.drive(body, { throttle: 1, brake: 0, steer: 0 });
      physics.step(1 / 60);
    }
    const t = body.translation();
    const insideCornerObs =
      Math.abs(t.x - -30) < 3.5 && Math.abs(t.z - -30) < 8 && t.y < 3.2;
    expect(insideCornerObs).toBe(false);
  });

  it("tryJump lifts the board off the deck", async () => {
    const physics = await createPhysics();
    const body = physics.spawn(0, 0, 0);
    expect(physics.tryJump(body)).toBe(true);
    expect(body.linvel().y).toBeGreaterThan(8);
  });

  it("hovers at elevated platform height", async () => {
    const physics = await createPhysics();
    const body = physics.spawn(-42, -42, 0);
    body.setTranslation({ x: -42, y: 6.2, z: -42 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 180; i++) {
      physics.drive(body, { throttle: 0, brake: 0, steer: 0 });
      physics.step(1 / 60);
    }
    const t = body.translation();
    expect(t.y).toBeGreaterThan(5.8);
    expect(t.y).toBeLessThan(6.6);
    expect(physics.getSurfaceY(body)).toBe(5);
  });

  it("detects another car roof as a supporting surface", async () => {
    const physics = await createPhysics();
    const lower = physics.spawn(0, 0, 0);
    const upper = physics.spawn(0, 0, 0);
    lower.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    upper.setTranslation({ x: 0, y: 3.2, z: 0 }, true);
    expect(physics.getSurfaceY(upper)).toBeCloseTo(1.58, 1);
  });

  it("settles onto another car when dropped from above", async () => {
    const physics = await createPhysics();
    const lower = physics.spawn(20, 20, 0);
    const upper = physics.spawn(20, 20, 0);
    lower.setTranslation({ x: 20, y: 1.2, z: 20 }, true);
    lower.setLinvel({ x: 0, y: 0, z: 0 }, true);
    upper.setTranslation({ x: 20, y: 4.5, z: 20 }, true);
    upper.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 360; i++) {
      physics.drive(upper, { throttle: 0, brake: 0, steer: 0 });
      physics.drive(lower, { throttle: 0, brake: 0, steer: 0 });
      physics.step(1 / 60);
    }
    const ut = upper.translation();
    const lt = lower.translation();
    expect(ut.y).toBeGreaterThan(lt.y + 0.35);
    expect(physics.getSurfaceY(upper)).toBeGreaterThan(1.4);
  });
});
