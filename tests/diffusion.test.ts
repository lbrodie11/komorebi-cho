import { describe, it, expect } from 'vitest';
import { DIFFUSION_MAX, MAX_OUTPUT_PIXELS, diffusionOutputSize, diffusionParams, type DiffusionParams } from '../src/render/diffusion';
import { parseLaunchParams } from '../src/core/params';
import { diffusionLabel } from '../src/ui/hud';

const KEYS: (keyof DiffusionParams)[] = ['glowAmt', 'resolve', 'edge'];

describe('diffusionParams', () => {
  it('is all zero at 0%', () => {
    const p = diffusionParams(0, 4);
    for (const k of KEYS) expect(p[k], k).toBe(0);
  });

  it('never decreases, and never jumps more than 0.01 per 0.001 step of the setting', () => {
    let prev = diffusionParams(0, 4);
    for (let i = 1; i <= 200; i++) {
      const p = diffusionParams(i * 0.001, 4);
      for (const k of KEYS) {
        expect(p[k], `${k} at ${i / 10}%`).toBeGreaterThanOrEqual(prev[k]);
        expect(p[k] - prev[k], `${k} at ${i / 10}%`).toBeLessThanOrEqual(0.01);
      }
      prev = p;
    }
  });

  it('matches the documented curve', () => {
    // percent → [glowAmt, resolve, edge] at an 8× enlargement
    const table: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [0.5, 0.0057, 0.0049, 0.0057],
      [1, 0.0151, 0.0128, 0.0151],
      [5, 0.1436, 0.122, 0.1436],
      [10, 0.3789, 0.3221, 0.3789],
      [15, 0.6685, 0.5682, 0.6685],
      [20, 1, 0.85, 1],
    ];
    for (const [pct, glowAmt, resolve, edge] of table) {
      const p = diffusionParams(pct / 100, 8);
      expect(p.glowAmt, `${pct}%`).toBeCloseTo(glowAmt, 3);
      expect(p.resolve, `${pct}%`).toBeCloseTo(resolve, 3);
      expect(p.edge, `${pct}%`).toBeCloseTo(edge, 3);
    }
  });

  it('keeps blocks crisp on small enlargements', () => {
    expect(diffusionParams(DIFFUSION_MAX, 1).edge).toBe(0.5);
    expect(diffusionParams(DIFFUSION_MAX, 3).edge).toBe(1);
  });

  it('clamps out-of-range strengths', () => {
    expect(diffusionParams(-1, 4)).toEqual(diffusionParams(0, 4));
    expect(diffusionParams(1, 4)).toEqual(diffusionParams(DIFFUSION_MAX, 4));
  });
});

describe('output size budget', () => {
  it('renders at min(DPR, 2) of the CSS box', () => {
    expect(diffusionOutputSize(1280, 720, 1)).toEqual({ w: 1280, h: 720 });
    expect(diffusionOutputSize(1280, 720, 2)).toEqual({ w: 2560, h: 1440 });
    expect(diffusionOutputSize(1280, 720, 3)).toEqual({ w: 2560, h: 1440 });
  });

  it('never exceeds 3.7 MP, keeping the aspect', () => {
    for (const [w, h, dpr] of [
      [1920, 1080, 2],
      [2560, 1440, 2],
      [3440, 1440, 1.5],
    ] as const) {
      const o = diffusionOutputSize(w, h, dpr);
      expect(o.w * o.h).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS);
      expect(o.w / o.h).toBeCloseTo(w / h, 2);
    }
  });
});

describe('Film Diffusion UI and URL', () => {
  it('labels the slider "Off" at 0, otherwise in percent', () => {
    expect(diffusionLabel(0)).toBe('Off');
    expect(diffusionLabel(0.5)).toBe('0.5%');
    expect(diffusionLabel(5)).toBe('5%');
    expect(diffusionLabel(20)).toBe('20%');
  });

  it('reads ?diffusion as a percent, clamped; absent means "use the setting"', () => {
    expect(parseLaunchParams('').diffusion).toBeNull();
    expect(parseLaunchParams('?diffusion=10').diffusion).toBeCloseTo(0.1);
    expect(parseLaunchParams('?diffusion=50').diffusion).toBe(DIFFUSION_MAX);
    expect(parseLaunchParams('?diffusion=-3').diffusion).toBe(0);
    expect(parseLaunchParams('?diffusion=x').diffusion).toBeNull();
  });

  it('reads ?pixel as a look override; unknown values mean "use the setting"', () => {
    expect(parseLaunchParams('').pixel).toBeNull();
    expect(parseLaunchParams('?pixel=classic').pixel).toBe('classic');
    expect(parseLaunchParams('?pixel=smooth').pixel).toBe('smooth');
    expect(parseLaunchParams('?pixel=blurry').pixel).toBeNull();
  });
});
