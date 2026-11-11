/**
 * Utility wires (prompt 05 task 4): poles are joined by a minimum spanning tree (no span longer
 * than MAX_SPAN), and every building's drop socket hangs from its nearest pole. Pure and
 * deterministic: the same poles and sockets always give the same wires, so moving a pole re-solves
 * the network without anyone hand-placing a span. Ugly-but-plausible is the goal, like real
 * Tokyo backstreets.
 */
export type Vec2 = readonly [number, number];

/** Longest span between two poles, metres. */
export const MAX_SPAN = 30;

/** Pole-to-pole spans as index pairs (i < j), sorted by (i, j). Kruskal over Euclidean distance. */
export function poleSpans(poles: readonly Vec2[], maxSpan = MAX_SPAN): [number, number][] {
  const edges: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < poles.length; i++)
    for (let j = i + 1; j < poles.length; j++) {
      const d = Math.hypot(poles[i]![0] - poles[j]![0], poles[i]![1] - poles[j]![1]);
      if (d <= maxSpan) edges.push({ i, j, d });
    }
  // ties broken by index, so equal lengths never reorder between runs
  edges.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const parent = poles.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const out: [number, number][] = [];
  for (const e of edges) {
    const a = root(e.i),
      b = root(e.j);
    if (a === b) continue;
    parent[a] = b;
    out.push([e.i, e.j]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The pole each drop socket hangs from: the nearest within MAX_SPAN, or -1 if none is in reach. */
export function dropPoles(sockets: readonly Vec2[], poles: readonly Vec2[], maxSpan = MAX_SPAN): number[] {
  return sockets.map(([x, z]) => {
    let best = -1,
      bd = maxSpan;
    poles.forEach(([px, pz], i) => {
      const d = Math.hypot(px - x, pz - z);
      if (d < bd - 1e-9) {
        bd = d;
        best = i;
      }
    });
    return best;
  });
}

export type Vec3 = readonly [number, number, number];

/** Plan box and roof height of a building a wire must clear (see footprints.ts). */
export interface Obstacle {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

/** A drop wire's sag, as a fraction of its length (matches Kit.wire's catenary). */
export const DROP_SAG = 0.05;
/** How far above a roof an anchor bracket holds the wire. */
export const ANCHOR_CLEAR = 0.4;

/**
 * Route a drop from a pole to a building's socket. If the sagging wire would pass through a roof
 * on the way, it is held up by an auxiliary anchor on that roof's edge (a bracket on a short post),
 * and the wire continues from there. The building being fed is never an obstacle (its socket is on
 * its own wall). Returns the points the wire passes through: [pole, (anchor), socket].
 */
export function routeDrop(from: Vec3, to: Vec3, obstacles: readonly Obstacle[], sag = DROP_SAG): Vec3[] {
  const fed = (o: Obstacle) => to[0] >= o.x0 - 0.35 && to[0] <= o.x1 + 0.35 && to[2] >= o.z0 - 0.35 && to[2] <= o.z1 + 0.35;
  const others = obstacles.filter((o) => !fed(o));
  const L = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  for (let i = 1; i < 50; i++) {
    const t = i / 50;
    const x = from[0] + (to[0] - from[0]) * t,
      z = from[2] + (to[2] - from[2]) * t;
    const y = from[1] + (to[1] - from[1]) * t - 4 * sag * L * t * (1 - t);
    const hit = others.find((o) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && y < o.top + 0.1);
    if (hit) return [from, [x, Math.max(hit.top + ANCHOR_CLEAR, y), z], to];
  }
  return [from, to];
}
