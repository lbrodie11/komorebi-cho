import { describe, it, expect } from 'vitest';
import { Rng, stream } from '../src/core/rng';
import { WorldClock, hourInRange } from '../src/core/clock';
import { pointInPolygon, mixHex } from '../src/core/math';
import { skyAt, sunDirection } from '../src/render/sky';

describe('Rng', () => {
  it('is deterministic per seed and per stream label', () => {
    const a = new Rng(42),
      b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(stream('trees').next()).toBe(stream('trees').next());
    expect(stream('trees').next()).not.toBe(stream('benches').next());
  });
  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      const n = r.int(3, 5);
      expect(n >= 3 && n <= 5).toBe(true);
    }
  });
});

describe('WorldClock', () => {
  it('ticks minutes and wraps hours', () => {
    const c = new WorldClock(23.5);
    c.tick(60); // 60 real s = 60 game minutes
    expect(c.hour).toBeCloseTo(0.5, 5);
    expect(c.day).toBe(1);
  });
  it('jumps forward only', () => {
    const c = new WorldClock(20);
    c.jumpTo(6);
    expect(c.hour).toBeCloseTo(6, 5);
    expect(c.day).toBe(1);
  });
  it('handles ranges across midnight', () => {
    expect(hourInRange(23, 22, 6)).toBe(true);
    expect(hourInRange(3, 22, 6)).toBe(true);
    expect(hourInRange(12, 22, 6)).toBe(false);
  });
});

describe('geometry helpers', () => {
  it('pointInPolygon', () => {
    const sq: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    expect(pointInPolygon(1, 1, sq)).toBe(true);
    expect(pointInPolygon(3, 1, sq)).toBe(false);
  });
  it('mixHex endpoints', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});

describe('sky', () => {
  it('is continuous across the day (no jumps in sun intensity)', () => {
    let prev = skyAt(0, 0, 'spring').sunI;
    for (let h = 0.05; h < 24; h += 0.05) {
      const s = skyAt(h, 0, 'spring').sunI;
      expect(Math.abs(s - prev)).toBeLessThan(0.08);
      prev = s;
    }
  });
  it('turns lamps on at night and off at noon', () => {
    expect(skyAt(22, 0, 'summer').lamp).toBeGreaterThan(0.9);
    expect(skyAt(12, 0, 'summer').lamp).toBeLessThan(0.05);
  });
  it('rain dims the sun', () => {
    expect(skyAt(12, 1, 'spring').sunI).toBeLessThan(skyAt(12, 0, 'spring').sunI);
  });
  it('sun is above the horizon by day', () => {
    expect(sunDirection(12)[1]).toBeGreaterThan(30);
  });
});
