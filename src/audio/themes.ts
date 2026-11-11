/**
 * The score as data (prompt 11): a few authored pieces, each an 8-bar progression and an 8-bar
 * melody written note by note, not random steps. Every piece opens with the same Komorebi-chō motif
 * (a falling sol–mi–re, then back up to mi; in minor where the piece is minor), so the town has one
 * tune you come to know. Each melody has written variations (an altered note, a displaced rhythm, a
 * sequence up a step), re-fitted to the harmony so every note stays a chord tone on the strong beats
 * and a passing or mode tone elsewhere (a unit test checks every one).
 */
import { MODES, nearestChordTone, noteRole, type ChordStep, type Mode } from './theory';

export interface ThemeNote {
  /** Bar 0–7, and the eighth within it (0–7: 0 and 4 are the strong beats). */
  bar: number;
  at: number;
  /** Length in eighths. */
  len: number;
  /** Semitones above the key root. */
  n: number;
}

export type PieceId = 'morning' | 'afternoon' | 'lastTrain' | 'rainMidnight';

export interface Piece {
  id: PieceId;
  bpm: number;
  /** MIDI note of the key root. */
  key: number;
  mode: Mode;
  /** One chord a bar, 8 bars. */
  chords: readonly ChordStep[];
  melody: readonly ThemeNote[];
  /** The melody's instrument, the comping hand's, and the drums (none: just keys and bass). */
  lead: 'rhodes' | 'piano' | 'pluck';
  comp: 'rhodes' | 'piano';
  drums: 'brush' | 'boom' | null;
  /** How many 8-bar passes make the piece before a rest (the shape is fixed: theme, variation, ...). */
  passes: number;
}

const N = (bar: number, at: number, len: number, n: number): ThemeNote => ({ bar, at, len, n });

/** The town's motif in bar 0 (major: 5-3-2-3; minor: 5-♭3-2-♭3), an octave up. */
const motif = (minor = false): ThemeNote[] => [N(0, 0, 3, 19), N(0, 3, 1, minor ? 15 : 16), N(0, 4, 2, 14), N(0, 6, 2, minor ? 15 : 16)];

export const PIECES: Record<PieceId, Piece> = {
  /** The first theme, written to stand on its own: nostalgic, unhurried. */
  lastTrain: {
    id: 'lastTrain',
    bpm: 70,
    key: 61, // D♭
    mode: 'ionian',
    chords: [
      { degree: 0, q: 'maj9' },
      { degree: 9, q: 'm9' },
      { degree: 5, q: 'maj7' },
      { degree: 7, q: '13sus' },
      { degree: 4, q: 'm7' },
      { degree: 9, q: 'm9' },
      { degree: 5, q: 'm6' }, // the borrowed minor iv: the ache
      { degree: 7, q: '9' },
    ],
    melody: [
      ...motif(),
      N(1, 0, 4, 21),
      N(1, 4, 2, 19),
      N(1, 6, 2, 16),
      N(2, 0, 3, 17),
      N(2, 3, 1, 16),
      N(2, 4, 4, 12),
      N(3, 0, 2, 12),
      N(3, 2, 1, 14),
      N(3, 3, 1, 16),
      N(3, 4, 4, 19),
      N(4, 0, 3, 19),
      N(4, 3, 1, 16),
      N(4, 4, 2, 14),
      N(4, 6, 2, 11),
      N(5, 0, 3, 12),
      N(5, 3, 1, 14),
      N(5, 4, 4, 16),
      N(6, 0, 2, 17),
      N(6, 2, 2, 20),
      N(6, 4, 4, 17),
      N(7, 0, 2, 19),
      N(7, 2, 1, 17),
      N(7, 3, 1, 16),
      N(7, 4, 4, 14),
    ],
    lead: 'piano',
    comp: 'rhodes',
    drums: 'brush',
    passes: 4,
  },
  morning: {
    id: 'morning',
    bpm: 68,
    key: 62, // D
    mode: 'ionian',
    chords: [
      { degree: 0, q: 'maj9' },
      { degree: 5, q: 'maj9' },
      { degree: 9, q: 'm9' },
      { degree: 7, q: '7sus' },
      { degree: 0, q: '6/9' },
      { degree: 4, q: 'm7' },
      { degree: 2, q: 'm9' },
      { degree: 7, q: '9' },
    ],
    melody: [
      ...motif(),
      N(1, 0, 4, 21),
      N(1, 4, 4, 19),
      N(2, 0, 2, 16),
      N(2, 2, 2, 19),
      N(2, 4, 3, 21),
      N(2, 7, 1, 23),
      N(3, 0, 4, 24),
      N(3, 4, 4, 19),
      N(4, 0, 3, 21),
      N(4, 3, 1, 19),
      N(4, 4, 4, 16),
      N(5, 0, 2, 14),
      N(5, 2, 2, 16),
      N(5, 4, 4, 19),
      N(6, 0, 3, 17),
      N(6, 3, 1, 16),
      N(6, 4, 4, 14),
      N(7, 0, 4, 11),
      N(7, 4, 4, 14),
    ],
    lead: 'rhodes',
    comp: 'rhodes',
    drums: 'brush',
    passes: 3,
  },
  /** The most hip-hop of the set: boom-bap, muted plucked fragments. */
  afternoon: {
    id: 'afternoon',
    bpm: 76,
    key: 65, // F
    mode: 'ionian',
    chords: [
      { degree: 2, q: 'm9' },
      { degree: 7, q: '9' },
      { degree: 0, q: 'maj9' },
      { degree: 9, q: 'm7' },
      { degree: 2, q: 'm9' },
      { degree: 7, q: '9' },
      { degree: 4, q: 'm7' },
      { degree: 9, q: 'm9' },
    ],
    melody: [
      // the motif, over the ii chord: the same falling shape, a step higher
      N(0, 0, 3, 21),
      N(0, 3, 1, 17),
      N(0, 4, 2, 16),
      N(0, 6, 2, 17),
      N(1, 0, 2, 14),
      N(1, 2, 2, 11),
      N(1, 4, 4, 21),
      N(2, 0, 3, 19),
      N(2, 3, 1, 16),
      N(2, 4, 2, 14),
      N(2, 6, 2, 12),
      N(3, 0, 4, 16),
      N(3, 4, 4, 12),
      N(4, 0, 2, 17),
      N(4, 2, 2, 21),
      N(4, 4, 3, 24),
      N(4, 7, 1, 21),
      N(5, 0, 4, 19),
      N(5, 4, 4, 17),
      N(6, 0, 3, 16),
      N(6, 3, 1, 14),
      N(6, 4, 4, 11),
      N(7, 0, 2, 12),
      N(7, 2, 2, 14),
      N(7, 4, 4, 16),
    ],
    lead: 'pluck',
    comp: 'rhodes',
    drums: 'boom',
    passes: 4,
  },
  /** Sparse piano, long silences, no drums. */
  rainMidnight: {
    id: 'rainMidnight',
    bpm: 62,
    key: 56, // A♭
    mode: 'aeolian',
    chords: [
      { degree: 0, q: 'm9' },
      { degree: 8, q: 'maj7' },
      { degree: 5, q: 'm9' },
      { degree: 7, q: 'm7' },
      { degree: 0, q: 'm9' },
      { degree: 3, q: 'maj9' },
      { degree: 8, q: 'maj7' },
      { degree: 10, q: '7sus' },
    ],
    melody: [
      ...motif(true),
      N(1, 0, 6, 12),
      N(2, 0, 4, 17),
      N(2, 4, 4, 15),
      N(3, 0, 8, 14),
      N(4, 2, 2, 19),
      N(4, 4, 4, 22),
      N(5, 0, 4, 19),
      N(5, 4, 4, 17),
      N(6, 0, 8, 15),
      N(7, 0, 4, 17),
      N(7, 4, 4, 15),
    ],
    lead: 'piano',
    comp: 'piano',
    drums: null,
    passes: 2,
  },
};

export type VariationId = 'theme' | 'altered' | 'displaced' | 'sequence';

/**
 * Fit a line back to the harmony: strong beats onto chord tones, other notes into the mode, and a
 * non-chord tone that doesn't step between its neighbours (no longer a passing tone) onto a chord tone.
 */
export function fitLine(p: Piece, notes: readonly ThemeNote[]): ThemeNote[] {
  const first = fitTones(p, notes);
  return first.map((x, i) => {
    const step = p.chords[x.bar]!;
    if (x.at === 0 || x.at === 4 || noteRole(p.key + x.n, p.key, step, p.mode) === 'chord') return x;
    const near = (o: ThemeNote | undefined) => !o || Math.abs(o.n - x.n) <= 2;
    return near(first[i - 1]) && near(first[i + 1]) ? x : { ...x, n: nearestChordTone(p.key + x.n, p.key, step) - p.key };
  });
}

function fitTones(p: Piece, notes: readonly ThemeNote[]): ThemeNote[] {
  const scale = MODES[p.mode] as readonly number[];
  return notes.map((x) => {
    const step = p.chords[x.bar]!;
    if (x.at === 0 || x.at === 4) return { ...x, n: nearestChordTone(p.key + x.n, p.key, step) - p.key };
    if (noteRole(p.key + x.n, p.key, step, p.mode) === 'outside') {
      for (let d = 1; d <= 2; d++)
        for (const s of [x.n - d, x.n + d])
          if (scale.includes(((s % 12) + 12) % 12) || noteRole(p.key + s, p.key, step, p.mode) === 'chord') return { ...x, n: s };
    }
    return x;
  });
}

/**
 * The melody as written, or a variation of it: one note altered near the end, the opening rhythm
 * displaced by an eighth, or the first two bars sequenced up a step. Each is re-fitted to the chords.
 */
export function variation(p: Piece, v: VariationId): ThemeNote[] {
  const m = p.melody;
  switch (v) {
    case 'theme':
      return [...m];
    case 'altered':
      // bar 6 reaches a chord tone higher
      return fitLine(
        p,
        m.map((x) => (x.bar === 6 && (x.at === 0 || x.at === 4) ? { ...x, n: x.n + 3 } : x)),
      );
    case 'displaced':
      // the opening comes an eighth late (a held breath), keeping within its bar
      return fitLine(
        p,
        m.flatMap((x) => {
          if (x.bar !== 0) return [x];
          const at = x.at + 1;
          if (at > 7) return [];
          return [{ ...x, at, len: Math.max(1, Math.min(x.len, 8 - at)) }];
        }),
      );
    case 'sequence': {
      // bars 0–1 a step higher in the mode
      const scale = MODES[p.mode] as readonly number[];
      const up = (n: number) => {
        for (let d = 1; d <= 2; d++) if (scale.includes((((n + d) % 12) + 12) % 12)) return n + d;
        return n + 2;
      };
      return fitLine(
        p,
        m.map((x) => (x.bar <= 1 ? { ...x, n: up(x.n) } : x)),
      );
    }
  }
}

/** The order variations come in across a piece's passes. */
export const PASS_ORDER: readonly VariationId[] = ['theme', 'sequence', 'displaced', 'theme', 'altered'];
