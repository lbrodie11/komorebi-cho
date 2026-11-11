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
