/**
 * Utility scoring (prompt 08): response curves, Dave Mark's compensation for many considerations,
 * and a hysteresis margin so two near-equal options don't flip-flop. Pure: no three.js, no DOM.
 */

/** Response curves: map an input in 0..1 to a consideration in 0..1. */
export const curve = {
  /** An S-curve: little below `mid`, then quickly a lot (an urgent need). */
  logistic: (x: number, k = 10, mid = 0.5): number => 1 / (1 + Math.exp(-k * (clamp01(x) - mid))),
  /** Rises slowly, then faster (thirst: a dry throat gets worse). */
  quadratic: (x: number): number => clamp01(x) ** 2,
  /** All or nothing past a threshold. */
  step: (x: number, t: number): number => (x >= t ? 1 : 0),
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * weight × Π considerations, with Dave Mark's compensation factor: each consideration is lifted
 * toward 1 by (1 - 1/n) of its shortfall, so an option with many considerations isn't punished
 * just for having more of them (0.9 × 0.9 × 0.9 would otherwise sink it below a one-factor 0.75).
 */
export function score(weight: number, considerations: readonly number[]): number {
  const n = considerations.length;
  if (n === 0) return weight;
  const mod = 1 - 1 / n;
  let s = weight;
  for (const c0 of considerations) {
    const c = clamp01(c0);
    s *= c + (1 - c) * mod * c;
  }
  return s;
}

/** How much better (×) a rival must be to replace what someone chose last time among the same kind. */
export const HYSTERESIS = 1.15;

export interface Scored {
  score: number;
  /** What it is (an object id, 'wander'...), and what kind (several options can share one). */
  key: string;
  kind: string;
}

/**
 * Pick the best option. `noise(kind)` gives a little personality: drawn once per kind of activity, so
 * the mood varies what someone does (bench or stroll) without making them dither between two benches.
 * `last` maps a kind to the key chosen last time for it, which keeps its place unless a rival of the
 * same kind beats it by HYSTERESIS: no flip-flopping between near-equal options.
 */
export function pick<T extends Scored>(options: readonly T[], noise: (kind: string) => number, last: ReadonlyMap<string, string>): T | null {
  const mood = new Map<string, number>();
  let best: T | null = null,
    bestScore = -Infinity;
  for (const o of options) {
    let m = mood.get(o.kind);
    if (m === undefined) mood.set(o.kind, (m = noise(o.kind)));
    let s = o.score * m;
    if (last.get(o.kind) === o.key) s *= HYSTERESIS;
    if (s > bestScore) [best, bestScore] = [o, s];
  }
  return best;
}
