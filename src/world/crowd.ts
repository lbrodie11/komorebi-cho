/**
 * Brightness share for clustered player lights. Twenty lanterns in one spot
 * should read as "a warm glow", not "a floodlight": each light is divided by
 * the square root of how crowded its neighbourhood is, so n co-located lights
 * sum to √n of one light instead of n. An isolated light is untouched.
 *
 * Pure and deterministic (depends only on positions), so it is the same after
 * a save/load and independent of placement order.
 */
export const CROWD_RADIUS = 3;

export function crowdFactors(points: readonly { x: number; z: number }[], radius = CROWD_RADIUS): number[] {
  return points.map((p) => {
    let w = 0;
    for (const q of points) {
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < radius) w += (1 - d / radius) ** 2;
    }
    return 1 / Math.sqrt(Math.max(1, w));
  });
}
