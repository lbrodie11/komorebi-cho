import { describe, expect, it } from 'vitest';
import { FAVOURITE_DAYS, HALF_LIFE, MAX_FAMILIARITY, NOVELTY_HALF_LIFE, PlaceMemory } from '../src/sim/places';

const DAY = 1440;

describe('place memory (prompt 08)', () => {
  it('fades with a two-day half-life', () => {
    const p = new PlaceMemory();
    p.used('a', 0, 0, 0);
    expect(p.familiarity('a', 0)).toBeCloseTo(1);
    expect(p.familiarity('a', HALF_LIFE)).toBeCloseTo(0.5);
    expect(p.familiarity('a', 2 * HALF_LIFE)).toBeCloseTo(0.25);
  });

  it('counts days, not visits: three sits today are one day of habit', () => {
    const p = new PlaceMemory();
    expect(p.used('a', 0, 0, 600)).toBe('first');
    expect(p.used('a', 0, 0, 700)).toBe('visit');
    expect(p.used('a', 0, 0, 800)).toBe('visit');
    expect(p.familiarity('a', 800)).toBeLessThan(1.3);
    expect(p.used('a', 0, 0, DAY + 600)).toBe('again'); // back another day
    expect(p.used('a', 0, 0, 2 * DAY + 600)).toBe('visit');
    for (let d = 3; d < 40; d++) p.used('a', 0, 0, d * DAY + 600);
    expect(p.familiarity('a', 39 * DAY + 600)).toBeLessThanOrEqual(MAX_FAMILIARITY);
  });

  it('makes a favourite only of a habit, and keeps it against a near-equal rival', () => {
    const p = new PlaceMemory();
    for (let d = 0; d < FAVOURITE_DAYS - 1; d++) p.used('a', 0, 0, d * DAY);
    expect(p.favourite(['a'], 2 * DAY)).toBeNull(); // two days isn't a habit yet
    p.used('a', 0, 0, 2 * DAY);
    expect(p.favourite(['a'], 2 * DAY)).toBe('a');
    // a rival as familiar, within the margin: the favourite stays
    for (let d = 0; d < 3; d++) p.used('b', 0, 0, d * DAY + 1);
    expect(p.favourite(['a', 'b'], 2 * DAY + 1, 'a')).toBe('a');
    expect(p.favourite(['a', 'b'], 2 * DAY + 1, 'b')).toBe('b');
    // a clearly better one (well past the margin) takes over
    for (let d = 3; d < 7; d++) p.used('b', 0, 0, d * DAY);
    expect(p.favourite(['a', 'b'], 7 * DAY, 'a')).toBe('b');
  });

  it('starts a haunt as a settled habit, and lets new things stay new for days', () => {
    const p = new PlaceMemory();
    p.haunt('pond', 1, 2, 0);
    expect(p.favourite(['pond'], 0)).toBe('pond');
    expect(p.where('pond')).toEqual({ x: 1, z: 2 });
    p.noticed('new', 0, 0, 0);
    expect(p.novelty('new', 0)).toBe(1);
    expect(p.novelty('new', NOVELTY_HALF_LIFE)).toBeCloseTo(0.5);
    expect(p.novelty('never', 0)).toBe(0);
  });

  it('survives a save, and skips anything malformed in it', () => {
    const p = new PlaceMemory();
    p.used('a', 1, 2, 100);
    p.used('a', 1, 2, DAY + 100);
    const back = PlaceMemory.from(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.familiarity('a', 2 * DAY)).toBeCloseTo(p.familiarity('a', 2 * DAY));
    expect(back.used('a', 1, 2, 2 * DAY + 100)).toBe('visit'); // its days came back too
    const bad = PlaceMemory.from({ x: { f: 'no' }, y: null, z: { f: -1, at: 0, x: 0, z: 0, seen: 0 }, ok: { f: 99, at: 0, x: 0, z: 0, seen: 0, days: 5 } });
    expect(bad.ids).toEqual(['ok']);
    expect(bad.familiarity('ok', 0)).toBe(MAX_FAMILIARITY);
    expect(PlaceMemory.from('junk').ids).toEqual([]);
  });
});
