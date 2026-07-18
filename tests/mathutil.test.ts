import { describe, it, expect } from "vitest";
import { yawFromQuat, rotateYawVector, steerToward } from "../shared/mathutil";

// Quaternion for a rotation of `angle` radians about +Y.
function quatY(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

describe("yawFromQuat", () => {
  it("returns 0 for identity", () => {
    expect(yawFromQuat({ x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(0, 6);
  });

  it("recovers the yaw of a pure-Y rotation", () => {
    expect(yawFromQuat(quatY(1.2))).toBeCloseTo(1.2, 6);
    expect(yawFromQuat(quatY(-0.7))).toBeCloseTo(-0.7, 6);
  });
});

describe("rotateYawVector", () => {
  it("leaves a vector unchanged under identity", () => {
    const r = rotateYawVector({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, z: -1 });
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(-1, 6);
  });

  it("rotates the forward vector (-Z) by 90° about +Y to point -X", () => {
    // +90° yaw turns forward (-Z) toward -X in this right-handed frame.
    const r = rotateYawVector(quatY(Math.PI / 2), { x: 0, z: -1 });
    expect(r.x).toBeCloseTo(-1, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });
});

describe("steerToward", () => {
  const origin = { x: 0, z: 0 };

  it("steers ~straight when the target is dead ahead", () => {
    // facing -Z (yaw 0), target straight ahead
    const s = steerToward(origin, 0, { x: 0, z: -10 });
    expect(Math.abs(s.steer)).toBeLessThan(0.05);
    expect(s.dist).toBeCloseTo(10, 6);
  });

  it("steers left (positive) when the target is to the car's left", () => {
    // facing -Z, target at -X is to the left → positive steer/angle
    const s = steerToward(origin, 0, { x: -10, z: 0 });
    expect(s.steer).toBeGreaterThan(0);
    expect(s.angle).toBeGreaterThan(0);
  });

  it("steers right (negative) when the target is to the car's right", () => {
    const s = steerToward(origin, 0, { x: 10, z: 0 });
    expect(s.steer).toBeLessThan(0);
    expect(s.angle).toBeLessThan(0);
  });

  it("clamps steer to [-1, 1] for a target directly behind", () => {
    const s = steerToward(origin, 0, { x: 0.001, z: 10 });
    expect(s.steer).toBeGreaterThanOrEqual(-1);
    expect(s.steer).toBeLessThanOrEqual(1);
  });
});
