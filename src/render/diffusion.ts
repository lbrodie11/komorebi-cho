/**
 * Film Diffusion: restrained lens diffusion over the pixel art (setting 0–20%).
 * This module is the pure part: the slider → shader-parameter curve, the output
 * size budget and save-value sanitising. The passes live in post.ts.
 */

/** The slider's top end. 20% is the most atmospheric look that still reads as pixel art. */
export const DIFFUSION_MAX = 0.2;
/** Where new players start: takes the edge off. */
export const DEFAULT_DIFFUSION = 0.05;
/** Saves written before the setting existed. Pre-release: flip to 0 at launch, so updating players keep their look. */
export const LEGACY_DIFFUSION_DEFAULT = 0.05;
/** The active path renders the canvas at device resolution, capped at this many pixels (2560×1440). */
export const MAX_OUTPUT_PIXELS = 2560 * 1440;

/**
 * Bright-pass threshold and knee, in exposed linear HDR. Fixed, not on the slider.
 * Measured on the scene target (seed 1, spring, 1280×720):
 * - noon, clear: frame p99 0.61, p99.9 1.08. The brightest sunlit surfaces are the
 *   kissaten's cream awning stripes, a white parasol and sakura tops at about 1.16;
 *   only 4 pixels exceed 1.5 (max 1.8).
 * - night: lit windows, lamp heads and the vending faces run 2.0–24; frame p99.9 4.0.
 * The knee opens at T − K = 1.2, just above the sunlit cream, so daylight stays clean.
 */
export const GLOW_THRESHOLD = 1.6;
export const GLOW_KNEE = 0.4;

export interface DiffusionParams {
  /** Strength of the soft glow added in linear light. */
  glowAmt: number;
  /** Blend between a pixel and its dither-blended neighbourhood (0..1). */
  resolve: number;
  /** Width of the anti-aliased step between enlarged game pixels, in device pixels. */
  edge: number;
}

/**
 * Slider value `s` (0..DIFFUSION_MAX) to shader parameters. Every value is 0 at s = 0,
 * continuous and non-decreasing. `devPxPerGamePx` is the enlargement: on small
 * enlargements the edge softening shrinks so blocks stay crisp.
 */
export function diffusionParams(s: number, devPxPerGamePx: number): DiffusionParams {
  const t = Math.min(1, Math.max(0, s / DIFFUSION_MAX));
  const g = Math.pow(t, 1.4); // gentle at the low end
  return {
    glowAmt: 1.0 * g,
    resolve: 0.85 * g, // 5% ≈ .12, 10% ≈ .32, 20% = .85
    edge: Math.min(1, g) * Math.min(1, devPxPerGamePx / 2),
  };
}

/**
 * Canvas size for the active path: the canvas's CSS box at min(devicePixelRatio, 2),
 * scaled down uniformly to fit MAX_OUTPUT_PIXELS.
 */
export function diffusionOutputSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const r = Math.min(Math.max(dpr, 0.5), 2);
  let w = cssW * r,
    h = cssH * r;
  const k = Math.sqrt(MAX_OUTPUT_PIXELS / (w * h));
  if (k < 1) {
    w *= k;
    h *= k;
  }
  return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
}

/** A stored setting back to a safe value: non-numbers and non-finite values fall back, the rest clamp. */
export function sanitizeDiffusion(v: unknown, fallback = LEGACY_DIFFUSION_DEFAULT): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(DIFFUSION_MAX, Math.max(0, v));
}
