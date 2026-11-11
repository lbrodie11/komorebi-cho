import { describe, it, expect } from 'vitest';
import { MELODY_SCALE, PROGRESSIONS, keyForHour, snapToScale, voiceChord } from '../src/audio/theory';

describe('music theory', () => {
  it('snaps melodies into the key', () => {
    for (let n = 66; n <= 86; n++) {
      const s = snapToScale(n, 65, 66, 86);
      expect(MELODY_SCALE).toContain((((s - 65) % 12) + 12) % 12);
      expect(Math.abs(s - n)).toBeLessThanOrEqual(2);
    }
  });
  it('voices chords near the centre', () => {
    for (const prog of Object.values(PROGRESSIONS))
      for (const step of prog) for (const n of voiceChord(65, step, 58)) expect(Math.abs(n - 58)).toBeLessThanOrEqual(6);
  });
  it('drifts key with the day', () => {
    expect(keyForHour(7, 0)).not.toBe(keyForHour(22, 0));
    expect(keyForHour(12, 1)).toBe(56);
  });
});
