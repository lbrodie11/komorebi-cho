import { describe, it, expect } from 'vitest';
import { pixelScale, canvasLayout, PIXEL_PRESETS, RENDER_H_MIN, RENDER_H_MAX } from '../src/render/pixelscale';

describe('pixelScale', () => {
  it('keeps the render height in band for every preset on every common screen', () => {
    // device heights: phones, laptops at DPR 1/1.25/2, 1080p, 1440p, 4K
    for (const h of [600, 720, 768, 800, 900, 1000, 1080, 1200, 1440, 1600, 1800, 2160]) {
      for (const p of PIXEL_PRESETS) {
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
