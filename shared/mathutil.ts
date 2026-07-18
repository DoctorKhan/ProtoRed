// Pure math helpers, shared by the browser simulation and the unit tests. No
// runtime dependencies, so they can be tested in isolation.

export interface QuatL {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Yaw angle (rotation about +Y) from a quaternion. */
export function yawFromQuat(q: QuatL): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

/** Rotate a horizontal vector (x,z) by the full quaternion; returns the horizontal result. */
export function rotateYawVector(q: QuatL, v: { x: number; z: number }): { x: number; z: number } {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * v.x + qy * v.z;
  const iy = qz * v.x - qx * v.z;
  const iz = qw * v.z - qy * v.x;
  const iw = -qx * v.x - qz * v.z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

export interface SteerResult {
  steer: number; // -1..1, positive = turn left
  dist: number;
  angle: number; // signed heading error, radians (positive = target is to the left)
}

/**
 * Steering solver: given a car at `pos` facing `yaw`, how to steer toward `target`.
 * Car forward is -Z. Positive steer / positive angle = left turn (see docs/IMPLEMENTATION.md).
 */
export function steerToward(
  pos: { x: number; z: number },
  yaw: number,
  target: { x: number; z: number },
): SteerResult {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const tx = dist ? dx / dist : 0;
  const tz = dist ? dz / dist : 0;
  const dot = fx * tx + fz * tz;
  const cross = fz * tx - fx * tz; // > 0 => target is to the left
  const angle = Math.atan2(cross, dot);
  const steer = Math.max(-1, Math.min(1, angle * 1.6));
  return { steer, dist, angle };
}
