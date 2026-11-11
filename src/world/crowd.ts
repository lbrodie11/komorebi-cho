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

/**
 * Group placed lights into at most `max` clusters, so every placed lantern or vending machine
 * glows even when there are more of them than pooled point lights (a constant light count
 * keeps three.js from recompiling shaders). Greedy agglomerative: repeatedly merge the two
 * closest clusters, where lights of different `tag` (colour) count as `tagGap` metres further
 * apart. Pure and deterministic: the same points in the same order give the same clusters.
 * Returns member indices per cluster, in first-member order.
 */
export function clusterLights(points: readonly { x: number; z: number; tag?: string }[], max: number, tagGap = 6): number[][] {
  const clusters = points.map((p, i) => ({ members: [i], x: p.x, z: p.z, tag: p.tag }));
  while (clusters.length > max && clusters.length > 1) {
    let bi = 0,
      bj = 1,
      bd = Infinity;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i]!,
          b = clusters[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z) + (a.tag === b.tag ? 0 : tagGap);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    const a = clusters[bi]!,
      b = clusters.splice(bj, 1)[0]!;
    const n = a.members.length + b.members.length;
    a.x = (a.x * a.members.length + b.x * b.members.length) / n;
    a.z = (a.z * a.members.length + b.z * b.members.length) / n;
    a.members.push(...b.members);
  }
  return clusters.map((c) => c.members);
}
