import { describe, it, expect } from 'vitest';
import { bakePaletteLut, nearestIndex, resolveLut, lutCell, lutEdge, LUT_AXIS, LUT_SLOTS, LUT_SIZE } from '../src/render/lut';
import { PALETTE } from '../src/render/palette';
import { hexToSrgb } from '../src/core/math';

const pal = PALETTE.map(hexToSrgb);
const lut = bakePaletteLut(PALETTE);

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe('palette LUT', () => {
  it('maps every palette colour to itself', () => {
    PALETTE.forEach((_, i) => {
      const [r, g, b] = pal[i]!;
      expect(nearestIndex(pal, r, g, b)).toBe(i);
      expect(resolveLut(lut, pal, r, g, b)).toBe(i);
    });
  });

  it('stores only valid palette indices, 4 per cell, red fastest', () => {
    expect(lut.data.length).toBe(LUT_SIZE ** 3 * LUT_SLOTS);
    // one assertion, not one per byte (millions of expect calls took 7-10 s on a loaded machine)
    let max = 0;
    for (const v of lut.data) if (v > max) max = v;
    expect(max).toBeLessThan(PALETTE.length);
    const n = LUT_SIZE;
    const at = (x: number, y: number, z: number) => lut.data[((z * n + y) * n + x) * 4];
    const mid = (i: number) => (lutEdge(i) + lutEdge(i + 1)) / 2;
    // slot 0 is the nearest colour to the cell centre
    for (const [x, y, z] of [
      [0, 0, 0],
      [n - 1, 0, 0],
      [0, n - 1, 0],
      [0, 0, n - 1],
      [3, 5, 6],
    ] as const) {
      expect(at(x, y, z)).toBe(nearestIndex(pal, mid(x), mid(y), mid(z)));
    }
  });

  it('rarely needs more than 4 candidates (only where 5+ palette regions meet)', () => {
    // a handful of cells out of ~47k for this palette; the accuracy tests below cover what that costs
    expect(lut.overflow / LUT_SIZE ** 3).toBeLessThan(0.001);
  });

  it('matches the exact nearest colour everywhere in the cube', () => {
    seed = 1;
    let miss = 0;
    const N = 20000;
    for (let k = 0; k < N; k++) {
      const r = rnd(),
        g = rnd(),
        b = rnd();
      if (resolveLut(lut, pal, r, g, b) !== nearestIndex(pal, r, g, b)) miss++;
    }
    // uniform samples are the worst case; a plain nearest-colour 64³ LUT misses ~3% here
    expect(miss / N).toBeLessThan(0.0005);
  });

  it('matches near palette boundaries, where dithering puts pixels', () => {
    seed = 7;
    let miss = 0;
    const N = 20000;
    for (let k = 0; k < N; k++) {
      // midpoint of two random palette colours, nudged: lands on or next to their boundary
      const a = pal[Math.floor(rnd() * pal.length)]!;
      const b = pal[Math.floor(rnd() * pal.length)]!;
      const j = () => (rnd() - 0.5) * 0.02;
      const c = [0, 1, 2].map((i) => Math.min(1, Math.max(0, (a[i]! + b[i]!) / 2 + j()))) as [number, number, number];
      if (resolveLut(lut, pal, ...c) !== nearestIndex(pal, ...c)) miss++;
    }
    expect(miss / N).toBeLessThan(0.002);
  });

  it('covers the out-of-range colours the composite produces (dither below 0, glow above 1)', () => {
    seed = 11;
    let miss = 0;
    const N = 20000;
    const { lo, hi } = LUT_AXIS;
    for (let k = 0; k < N; k++) {
      const c = [0, 1, 2].map(() => lo + rnd() * (hi - lo)) as [number, number, number];
      if (resolveLut(lut, pal, ...c) !== nearestIndex(pal, ...c)) miss++;
    }
    expect(miss / N).toBeLessThan(0.001);
  });

  it('has contiguous cells: every edge maps back to its own cell', () => {
    for (let i = 0; i < LUT_SIZE; i++) {
      expect(lutCell(lutEdge(i) + 1e-9)).toBe(i);
      expect(lutCell((lutEdge(i) + lutEdge(i + 1)) / 2)).toBe(i);
    }
    expect(lutCell(-5)).toBe(0);
    expect(lutCell(99)).toBe(LUT_SIZE - 1);
  });
});
