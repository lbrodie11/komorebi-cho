import { describe, expect, it } from 'vitest';
import { encodeWav, integratedLoudness, truePeak } from '../src/audio/loudness';
import { monoLevel, place } from '../src/audio/spatial';
import { EventBudget, scapeLevels } from '../src/audio/soundscape';

const RATE = 48000;
const sine = (f: number, amp: number, seconds: number) => {
  const x = new Float32Array(RATE * seconds);
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / RATE);
  return x;
};

describe('loudness (prompt 11)', () => {
  it('measures a 1 kHz tone where BS.1770 says it should be', () => {
    // a 1 kHz sine at −20 dBFS peak in both channels reads about −20 LUFS (the K-weighting is ~0 dB at 1 kHz)
    const s = sine(1000, Math.pow(10, -20 / 20), 5);
    const l = integratedLoudness([s, s], RATE);
    expect(l).toBeGreaterThan(-20.7);
    expect(l).toBeLessThan(-19.3);
    // 10 dB quieter reads 10 LU lower; silence is gated out
    expect(integratedLoudness([sine(1000, Math.pow(10, -30 / 20), 5), sine(1000, Math.pow(10, -30 / 20), 5)], RATE)).toBeCloseTo(l - 10, 1);
    expect(integratedLoudness([new Float32Array(RATE), new Float32Array(RATE)], RATE)).toBe(-Infinity);
  });

  it('finds the true peak between samples, and writes a WAV', () => {
    const s = sine(997, 0.5, 1);
    expect(truePeak([s])).toBeCloseTo(-6.02, 1);
    const wav = encodeWav([s, s], RATE);
    expect(wav.byteLength).toBe(44 + s.length * 4);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF');
  });
});

describe('the soundscape (prompt 11)', () => {
  it('places sources from the camera’s focus: left on screen is left, far is quieter and duller', () => {
    const l = { x: 0, z: 0, yaw: 0, zoom: 1 };
    expect(place(l, 5, 0).pan).toBeGreaterThan(0); // screen right at yaw 0 is +x
    expect(place(l, -5, 0).pan).toBeLessThan(0);
    expect(place(l, 0, 0).gain).toBeCloseTo(1);
    expect(place(l, 20, 0).gain).toBeLessThan(place(l, 5, 0).gain);
    expect(place(l, 20, 0).cutoff).toBeLessThan(place(l, 2, 0).cutoff);
    // turning the camera turns the sound
    expect(place({ ...l, yaw: Math.PI }, 5, 0).pan).toBeLessThan(0);
    // and nothing vanishes in mono
    for (const p of [-1, -0.5, 0, 0.5, 1]) expect(monoLevel(p)).toBeGreaterThanOrEqual(1);
  });

  it('lets the rain stop first while drips go on as long as the street is wet, and leaves no layer behind in winter', () => {
    const wetAfter = scapeLevels({ hour: 15, rain: 0, wet: 0.7, season: 'spring' });
    expect(wetAfter.rainfall).toBe(0);
    expect(wetAfter.drips).toBeGreaterThan(1);
    const dry = scapeLevels({ hour: 15, rain: 0, wet: 0, season: 'spring' });
    expect(dry.drips).toBe(0);
    const snow = scapeLevels({ hour: 15, rain: 0.8, wet: 0.8, season: 'winter' });
    expect(snow.roofs + snow.leaves + snow.drips + snow.wetGround + snow.cicadas).toBe(0);
    const summerDay = scapeLevels({ hour: 13, rain: 0, wet: 0, season: 'summer' });
    expect(summerDay.cicadas).toBeGreaterThan(0);
    expect(scapeLevels({ hour: 13, rain: 0, wet: 0, season: 'autumn' }).cicadas).toBe(0);
  });

  it('caps the neighbourhood’s sounds per minute by density, important ones first', () => {
    const count = (d: 'quiet' | 'balanced' | 'lively', importance: number) => {
      const b = new EventBudget(d);
      let n = 0;
      for (let t = 0; t < 60; t += 0.5) if (b.allow(t, importance)) n++;
      return n;
    };
    expect(count('quiet', 0.3)).toBeLessThan(count('balanced', 0.3));
    expect(count('balanced', 0.3)).toBeLessThan(count('lively', 0.3));
    expect(count('balanced', 0.3)).toBeLessThanOrEqual(9 + 3);
    expect(count('balanced', 0.9)).toBeGreaterThanOrEqual(count('balanced', 0.3));
  });

  it('keeps a token back from footsteps, so a street of walkers never silences a cup or a creak', () => {
    const b = new EventBudget('balanced');
    let cups = 0,
      steps = 0;
    for (let t = 0; t < 60; t += 0.25) {
      // four walkers a second, and a cup every five seconds
      if (b.allow(t, 0.2)) steps++;
      if (t % 5 === 0 && b.allow(t + 0.01, 0.5)) cups++;
    }
    expect(steps).toBeGreaterThan(0);
    expect(cups).toBeGreaterThanOrEqual(8); // of 12: the walkers can't take the last token
  });
});
