import { describe, it, expect } from 'vitest';
import { pixelScale, canvasLayout, presentOffset, PIXEL_PRESETS, RENDER_H_MIN, RENDER_H_MAX, SMOOTH_H, usesPalette } from '../src/render/pixelscale';

describe('pixelScale', () => {
  it('keeps the render height in band for every preset on every common screen', () => {
    // device heights: phones, laptops at DPR 1/1.25/2, 1080p, 1440p, 4K
    for (const h of [600, 720, 768, 800, 900, 1000, 1080, 1200, 1440, 1600, 1800, 2160]) {
      for (const p of PIXEL_PRESETS.filter(usesPalette)) {
        const rh = Math.floor(h / pixelScale(h, p));
        expect(rh, `${h}px ${p}`).toBeGreaterThanOrEqual(RENDER_H_MIN);
        expect(rh, `${h}px ${p}`).toBeLessThanOrEqual(RENDER_H_MAX);
      }
    }
  });

  it('orders presets: fine never chunkier than classic, classic never chunkier than chunky', () => {
    for (let h = 220; h <= 4000; h += 7) {
      expect(pixelScale(h, 'fine')).toBeLessThanOrEqual(pixelScale(h, 'classic'));
      expect(pixelScale(h, 'classic')).toBeLessThanOrEqual(pixelScale(h, 'chunky'));
    }
  });

  it('distinguishes presets when the band allows', () => {
    // 1800 device px: scales 6 (300), 7 (257) and 8 (225) all fit
    expect([pixelScale(1800, 'fine'), pixelScale(1800, 'classic'), pixelScale(1800, 'chunky')]).toEqual([6, 7, 8]);
  });

  it('gives Smooth a fixed ~2× row count that fills the container, at any DPR', () => {
    for (const h of [720, 1080, 1200, 1440, 1600, 2160]) {
      const l = canvasLayout(Math.round(h * 1.6), h, 2, 'smooth');
      expect(l.rh, `${h}px`).toBe(SMOOTH_H);
      expect(l.rh, `${h}px`).toBeGreaterThanOrEqual(1.8 * Math.floor(h / pixelScale(h, 'classic')));
      expect(l.cssH * 2).toBe(h); // fills the container exactly: no border
      expect(l.rw / l.rh).toBeCloseTo(1.6, 2);
    }
    // small screens never upscale below 1 device pixel per render pixel
    expect(canvasLayout(800, 400, 1, 'smooth').rh).toBe(400);
    expect(usesPalette('smooth')).toBe(false);
    expect(usesPalette('classic')).toBe(true);
  });

  it('falls back to the nearest scale on screens too short for the band', () => {
    expect(pixelScale(150, 'classic')).toBe(1);
    expect(pixelScale(350, 'classic')).toBe(1); // 350 or 175: 350 is nearer to 255
  });
});

describe('canvasLayout', () => {
  it('upscales by an exact integer in device pixels and centres the remainder', () => {
    const l = canvasLayout(2561, 1601, 2, 'classic');
    expect(Number.isInteger(l.scale)).toBe(true);
    expect(l.cssW * 2).toBe(l.rw * l.scale);
    expect(l.cssH * 2).toBe(l.rh * l.scale);
    expect(l.cssLeft * 2).toBe(Math.floor((2561 - l.rw * l.scale) / 2));
    expect(l.rh).toBeGreaterThanOrEqual(RENDER_H_MIN);
    expect(l.rh).toBeLessThanOrEqual(RENDER_H_MAX);
  });

  it('handles fractional DPR without fractional device pixels', () => {
    const dpr = 1.25;
    const l = canvasLayout(1600, 1000, dpr, 'fine');
    expect(Math.round(l.cssW * dpr)).toBe(l.rw * l.scale);
    expect(Math.abs(l.cssW * dpr - l.rw * l.scale)).toBeLessThan(1e-9);
  });
});

describe('overscan and sub-pixel presentation', () => {
  it('adds the margin round the view without moving or rescaling the visible part', () => {
    for (const p of PIXEL_PRESETS) {
      const a = canvasLayout(2880, 1800, 2, p);
      const b = canvasLayout(2880, 1800, 2, p, 1);
      expect([b.rw, b.rh], p).toEqual([a.rw, a.rh]);
      expect([b.bw, b.bh], p).toEqual([a.rw + 2, a.rh + 2]);
      // the visible view's top-left device pixel is where it was without the margin
      expect((b.cssLeft * 2 + b.sx) / 2, p).toBeCloseTo(a.cssLeft, 9);
      expect((b.cssTop * 2 + b.sy) / 2, p).toBeCloseTo(a.cssTop, 9);
      expect(b.cssW / b.bw, p).toBeCloseTo(a.cssW / a.rw, 9);
      expect(b.viewCssH, p).toBeCloseTo(a.cssH, 9);
    }
  });

  it('keeps the palette looks on whole device pixels, margin and offset included', () => {
    for (const dpr of [1, 1.25, 2]) {
      const l = canvasLayout(Math.round(1440 * dpr), Math.round(900 * dpr), dpr, 'classic', 1);
      for (const v of [l.cssLeft, l.cssTop, l.cssW, l.cssH]) expect(Math.abs(v * dpr - Math.round(v * dpr))).toBeLessThan(1e-9);
      for (let s = -0.5; s <= 0.5; s += 0.01) {
        const o = presentOffset({ x: s, y: -s }, l, dpr);
        expect(Math.abs(o.x * dpr - Math.round(o.x * dpr))).toBeLessThan(1e-9);
        expect(Math.abs(o.x * dpr)).toBeLessThanOrEqual(l.sx); // never more than the one-pixel margin
      }
    }
  });

  it('rounds the offset to the nearest device pixel, with no shift (and no -0) at rest', () => {
    const l = canvasLayout(2880, 1800, 2, 'smooth', 1); // ~3.33 device px per render px
    expect(presentOffset({ x: 0, y: -0 }, l, 2)).toEqual({ x: 0, y: 0 });
    expect(Object.is(presentOffset({ x: -0.01, y: -0.01 }, l, 2).x, -0)).toBe(false);
    expect(presentOffset({ x: 0.3, y: -0.3 }, l, 2)).toEqual({ x: 0.5, y: -0.5 }); // 1 device px = 0.5 CSS px
  });
});
