/**
 * Music theory for the score (prompt 11), pure and unit-tested: chords and their tones, voice
 * leading that moves as little as it can, a chord-aware check for melody notes (chord tone, passing
 * tone, or in the section's mode: no fixed melody scale), and per-instrument groove templates with
 * bounded, seeded humanisation. No Web Audio here.
 */
import type { Rng } from '../core/rng';

export type Quality = 'maj7' | 'maj9' | 'm7' | 'm9' | '9' | '7sus' | '13sus' | '6/9' | 'm6' | 'sus2' | 'add9';

/** Every tone a chord owns (semitones above its root): what melody notes may rest on. */
export const CHORD_TONES: Record<Quality, readonly number[]> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  '9': [0, 4, 7, 10, 14],
  '7sus': [0, 5, 7, 10],
  '13sus': [0, 5, 7, 10, 14, 21],
  '6/9': [0, 4, 7, 9, 14],
  m6: [0, 3, 7, 9],
  sus2: [0, 2, 7],
  add9: [0, 4, 7, 14],
};

/** What the comping hand plays: rootless where the bass has the root, a few colour tones. */
export const VOICINGS: Record<Quality, readonly number[]> = {
  maj7: [4, 7, 11],
  maj9: [4, 7, 11, 14],
  m7: [3, 7, 10],
  m9: [3, 7, 10, 14],
  '9': [4, 10, 14],
  '7sus': [5, 7, 10],
  '13sus': [5, 10, 14, 21],
  '6/9': [4, 9, 14],
  m6: [3, 7, 9],
  sus2: [2, 7, 12],
  add9: [4, 7, 14],
};

export interface ChordStep {
  /** Semitones above the key root. */
  degree: number;
  q: Quality;
}

/** Modes, as scales above the key root. */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;
export type Mode = keyof typeof MODES;

const pc = (n: number): number => ((n % 12) + 12) % 12;

/** Pitch classes of a chord in a key. */
export function chordPcs(keyRoot: number, step: ChordStep): number[] {
  return CHORD_TONES[step.q].map((iv) => pc(keyRoot + step.degree + iv));
}

/** A note's place over a chord: a chord tone, in the section's mode, or outside both. */
export function noteRole(midi: number, keyRoot: number, step: ChordStep, mode: Mode): 'chord' | 'mode' | 'outside' {
  if (chordPcs(keyRoot, step).includes(pc(midi))) return 'chord';
  if ((MODES[mode] as readonly number[]).includes(pc(midi - keyRoot))) return 'mode';
  return 'outside';
}

/**
 * Is a melody note right where it falls? On a strong beat (beats 1 and 3) it must be a chord tone;
 * elsewhere a chord tone, or a passing tone in the mode that steps (≤ 2 semitones) between its
 * neighbours. (The melody check for every theme and variation is a unit test.)
 */
export function noteFits(midi: number, prev: number | null, next: number | null, strong: boolean, keyRoot: number, step: ChordStep, mode: Mode): boolean {
  const role = noteRole(midi, keyRoot, step, mode);
  if (role === 'chord') return true;
  if (strong || role === 'outside') return false;
  const stepwise = (a: number | null) => a === null || Math.abs(a - midi) <= 2;
  return stepwise(prev) && stepwise(next);
}

/** Nearest chord tone to `target` (for fitting a transposed variation back to the harmony). */
export function nearestChordTone(target: number, keyRoot: number, step: ChordStep): number {
  const pcs = chordPcs(keyRoot, step);
  for (let d = 0; d <= 6; d++) for (const s of d ? [target - d, target + d] : [target]) if (pcs.includes(pc(s))) return s;
  return target;
}

/**
 * Voice a chord near the previous voicing, moving as little as it can (the classic smooth piano
 * left hand). Each voicing tone may sit in any octave within [lo, hi]; the arrangement whose sorted
 * notes move least from the previous one wins, and no voice ever moves more than an octave.
 */
export function voiceLead(prev: readonly number[] | null, keyRoot: number, step: ChordStep, lo = 50, hi = 72): number[] {
  const root = keyRoot + step.degree;
  const options = VOICINGS[step.q].map((iv) => {
    const out: number[] = [];
    for (let n = root + iv - 36; n <= hi; n += 12) if (n >= lo) out.push(n);
    return out;
  });
  const centre = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  let best: number[] = [];
  let bestCost = Infinity;
  const pick = (i: number, acc: number[]) => {
    if (i === options.length) {
      const v = [...acc].sort((a, b) => a - b);
      if (v[v.length - 1]! - v[0]! > 14) return; // a hand's span
      let cost = 0;
      if (prev && prev.length) {
        const p = [...prev].sort((a, b) => a - b);
        for (let k = 0; k < v.length; k++) {
          const m = Math.abs(v[k]! - p[Math.min(k, p.length - 1)]!);
          if (m > 12) return;
          cost += m;
        }
      } else cost = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - centre);
      if (cost < bestCost) [best, bestCost] = [v, cost];
      return;
    }
    for (const n of options[i]!) pick(i + 1, [...acc, n]);
  };
  pick(0, []);
  return best.length ? best : options.map((o) => o[0]!).sort((a, b) => a - b);
}

/** The bass note for a chord: its root, in the low register. */
export function bassNote(keyRoot: number, step: ChordStep, lo = 34, hi = 46): number {
  let b = keyRoot + step.degree;
  while (b > hi) b -= 12;
  while (b < lo) b += 12;
  return b;
}

/** Instruments with a feel of their own (groove templates). */
export type Voice = 'kick' | 'snare' | 'rim' | 'hat' | 'brush' | 'keys' | 'melody' | 'bass' | 'pluck';

/**
 * Groove templates: where each instrument sits against the grid (ms; + is late) and how much it may
 * wander, plus its velocity range. Kick near the grid, snare and rim laid back 10–25 ms, hats lightly
 * varied. Humanisation is seeded and bounded by these numbers (a unit test holds them).
 */
export const GROOVE: Record<Voice, { late: number; jitter: number; vel: readonly [number, number] }> = {
  kick: { late: 0, jitter: 4, vel: [0.75, 0.9] },
  snare: { late: 17, jitter: 7, vel: [0.55, 0.75] },
  rim: { late: 15, jitter: 6, vel: [0.4, 0.6] },
  hat: { late: 4, jitter: 9, vel: [0.25, 0.55] },
  brush: { late: 12, jitter: 10, vel: [0.3, 0.55] },
  keys: { late: 6, jitter: 8, vel: [0.35, 0.55] },
  melody: { late: 8, jitter: 10, vel: [0.4, 0.7] },
  bass: { late: 3, jitter: 5, vel: [0.6, 0.8] },
  pluck: { late: 10, jitter: 12, vel: [0.3, 0.6] },
};

/** A phrase's shape: velocity rises to its middle and falls at the end (0..1 across the phrase). */
export function phraseCurve(pos: number): number {
  const x = Math.min(1, Math.max(0, pos));
  return 0.85 + 0.15 * Math.sin(Math.PI * x);
}

/** Humanise one hit: a timing offset (s) and velocity, seeded, within the instrument's template. */
export function humanise(rng: Rng, voice: Voice, phrasePos: number): { offset: number; vel: number } {
  const g = GROOVE[voice];
  const offset = (g.late + rng.range(-g.jitter, g.jitter)) / 1000;
  const vel = rng.range(g.vel[0], g.vel[1]) * phraseCurve(phrasePos);
  return { offset, vel };
}
