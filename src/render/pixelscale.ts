/**
 * Pixel scale presets. The canvas is always an *integer* upscale of the render
 * target in device pixels, so every art pixel is an identical square on screen.
 * Each preset picks the integer scale whose render height lands in
 * [RENDER_H_MIN, RENDER_H_MAX] closest to its target: Fine aims tall (more,
 * smaller pixels), Chunky aims short.
 *
 * Integer scales are coarse: on some screen heights only one scale fits the
 * band, and then all three presets coincide. That is the price of square pixels.
 */
export type PixelPreset = 'fine' | 'classic' | 'chunky';
export const PIXEL_PRESETS: readonly PixelPreset[] = ['fine', 'classic', 'chunky'];
export const RENDER_H_MIN = 220;
export const RENDER_H_MAX = 300;
const TARGET: Record<PixelPreset, number> = { fine: 300, classic: 255, chunky: 220 };

/** Integer device pixels per render pixel. */
export function pixelScale(deviceH: number, preset: PixelPreset): number {
  const target = TARGET[preset];
  const lo = Math.max(1, Math.ceil(deviceH / RENDER_H_MAX));
  const hi = Math.floor(deviceH / RENDER_H_MIN);
  let best = Math.max(1, Math.round(deviceH / target));
  if (lo <= hi) {
    best = lo;
    for (let s = lo; s <= hi; s++) if (Math.abs(deviceH / s - target) < Math.abs(deviceH / best - target)) best = s;
  }
  return best;
}

export interface CanvasLayout {
  /** Device pixels per render pixel. */
  scale: number;
  /** Render-target size. */
  rw: number;
  rh: number;
  /** CSS box for the canvas: exactly rw×scale by rh×scale device pixels, centred. */
  cssW: number;
  cssH: number;
  cssLeft: number;
  cssTop: number;
}

/**
 * Lay the canvas out inside a container of `deviceW`×`deviceH` device pixels.
 * DPR is explicit: the renderer works in render pixels (pixel ratio 1), and
 * CSS sizes are device sizes divided by `dpr`, so the browser's scale-up is an
 * exact integer. The leftover (< scale device px per axis) is split as a border.
 */
export function canvasLayout(deviceW: number, deviceH: number, dpr: number, preset: PixelPreset): CanvasLayout {
  const scale = pixelScale(deviceH, preset);
  const rw = Math.max(1, Math.floor(deviceW / scale));
  const rh = Math.max(1, Math.floor(deviceH / scale));
  return {
    scale,
    rw,
    rh,
    cssW: (rw * scale) / dpr,
    cssH: (rh * scale) / dpr,
    cssLeft: Math.floor((deviceW - rw * scale) / 2) / dpr,
    cssTop: Math.floor((deviceH - rh * scale) / 2) / dpr,
  };
}
