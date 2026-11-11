/** Pure music theory helpers (unit-tested, no Web Audio). */

export type Quality = 'maj7' | 'maj9' | 'm7' | 'm9' | '9' | '13sus' | '6/9' | 'm6';

export const VOICINGS: Record<Quality, number[]> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  '9': [0, 4, 10, 14],
  '13sus': [0, 5, 10, 14, 21],
  '6/9': [0, 4, 9, 14],
  m6: [0, 3, 7, 9],
};

export interface ChordStep {
  degree: number; // semitones above the key root
  q: Quality;
}

/** Progressions chosen for warmth. "E" borrows the minor iv: the nostalgic one. */
export const PROGRESSIONS: Record<string, ChordStep[]> = {
  A: [
    { degree: 0, q: 'maj9' },
    { degree: 9, q: 'm9' },
    { degree: 2, q: 'm9' },
    { degree: 7, q: '13sus' },
  ],
  B: [
    { degree: 5, q: 'maj9' },
    { degree: 4, q: 'm7' },
    { degree: 9, q: 'm9' },
    { degree: 0, q: 'maj9' },
  ],
  C: [
    { degree: 2, q: 'm9' },
    { degree: 7, q: '9' },
    { degree: 4, q: 'm7' },
    { degree: 9, q: 'm9' },
  ],
  D: [
    { degree: 9, q: 'm9' },
    { degree: 5, q: 'maj9' },
    { degree: 0, q: 'maj9' },
    { degree: 7, q: '6/9' },
  ],
  E: [
    { degree: 5, q: 'maj7' },
    { degree: 5, q: 'm6' },
    { degree: 4, q: 'm7' },
    { degree: 9, q: 'm7' },
  ],
};

/** Major pentatonic + the 7th: melodic notes that sit well over every chord above. */
export const MELODY_SCALE = [0, 2, 4, 7, 9, 11];

/** Chord tones as MIDI notes, rootless, voice-led to sit near `centre`. */
export function voiceChord(keyRoot: number, step: ChordStep, centre: number): number[] {
  const root = keyRoot + step.degree;
  const ivs = VOICINGS[step.q].slice(1);
  return ivs
    .map((iv) => {
      let n = root + iv;
      while (n < centre - 6) n += 12;
      while (n > centre + 6) n -= 12;
      return n;
    })
    .sort((a, b) => a - b);
}

/** Nearest note to `target` within the melody scale of the key, between lo and hi. */
export function snapToScale(target: number, keyRoot: number, lo: number, hi: number): number {
  let best = lo;
  let bd = Infinity;
  for (let n = lo; n <= hi; n++) {
    const pc = (((n - keyRoot) % 12) + 12) % 12;
    if (!MELODY_SCALE.includes(pc)) continue;
    const d = Math.abs(n - target);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Key root (MIDI) for a moment of the day: the music drifts with the light. */
export function keyForHour(hour: number, rain: number): number {
  if (rain > 0.5) return 56; // Ab
  if (hour >= 5 && hour < 9) return 62; // D, morning
  if (hour >= 9 && hour < 16) return 65; // F
  if (hour >= 16 && hour < 19.5) return 63; // Eb, golden hour
  return 61; // Db, night
}
