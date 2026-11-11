/**
 * Pixel scale presets. The canvas is always an *integer* upscale of the render
 * target in device pixels, so every art pixel is an identical square on screen.
 * Each preset picks the integer scale whose render height lands in its band
 * closest to its target: Fine aims tall (more, smaller pixels), Chunky aims
 * short. Smooth renders a fixed SMOOTH_H rows at a fractional scale instead.
 *
 * Integer scales are coarse: on some screen heights only one scale fits the
 * band, and then all three presets coincide. That is the price of square pixels.
 */
export type PixelPreset = 'fine' | 'classic' | 'chunky' | 'smooth';
/** In Settings order: Smooth, the default, first. */
export const PIXEL_PRESETS: readonly PixelPreset[] = ['smooth', 'fine', 'classic', 'chunky'];
/** The palette presets' render-height band. */
export const RENDER_H_MIN = 220;
export const RENDER_H_MAX = 300;
/**
 * Smooth is a different look, not just a smaller pixel: full-colour shading at a fixed
 * SMOOTH_H rows (about twice Classic, like voxel dioramas rendered for video), enlarged by a
 * fractional, filtered scale. It isn't strict pixel art, so it doesn't need whole-number
 * scaling, and a fixed row count keeps its cost the same on every screen (a 720-px screen
 * would otherwise render all 1280×720 pixels and miss 60 fps).
 */
export const SMOOTH_H = 540;
const BAND: Record<Exclude<PixelPreset, 'smooth'>, { target: number; min: number; max: number }> = {
  fine: { target: 300, min: RENDER_H_MIN, max: RENDER_H_MAX },
  classic: { target: 255, min: RENDER_H_MIN, max: RENDER_H_MAX },
  chunky: { target: 220, min: RENDER_H_MIN, max: RENDER_H_MAX },
};

/** What new players see: Smooth (chosen 2026-11-10). The palette looks stay one click away in Settings. */
export const DEFAULT_PIXEL: PixelPreset = 'smooth';

/** Does this preset snap to the palette (the pixel-art looks), or shade in full colour (Smooth)? */
export const usesPalette = (p: PixelPreset): boolean => p !== 'smooth';

/** Device pixels per render pixel: an integer for the palette presets, fractional for Smooth. */
export function pixelScale(deviceH: number, preset: PixelPreset): number {
  if (preset === 'smooth') return Math.max(1, deviceH / SMOOTH_H);
  const { target, min, max } = BAND[preset];
  const lo = Math.max(1, Math.ceil(deviceH / max));
  const hi = Math.floor(deviceH / min);
  let best = Math.max(1, Math.round(deviceH / target));
  if (lo <= hi) {
    best = lo;
    for (let s = lo; s <= hi; s++) if (Math.abs(deviceH / s - target) < Math.abs(deviceH / best - target)) best = s;
  }
  return best;
}

export interface CanvasLayout {
  /** Device pixels per render pixel (an integer, except for Smooth). */
  scale: number;
  /** Device pixels per render pixel along each axis (both `scale`, except for Smooth, which fills the box exactly). */
  sx: number;
  sy: number;
  /** The visible render size. */
  rw: number;
  rh: number;
  /** Overscan: render pixels drawn beyond each edge of the visible view. */
  margin: number;
  /** Render-target (drawing buffer) size: the visible size plus the margin on every side. */
  bw: number;
  bh: number;
  /** CSS box for the whole canvas, margin included: exactly bw×sx by bh×sy device pixels, the visible part centred. */
  cssW: number;
  cssH: number;
  cssLeft: number;
  cssTop: number;
  /** CSS height of the visible view (without the margin). */
  viewCssH: number;
}

/**
 * Lay the canvas out inside a container of `deviceW`×`deviceH` device pixels.
 * DPR is explicit: the renderer works in render pixels (pixel ratio 1), and
 * CSS sizes are device sizes divided by `dpr`, so the browser's scale-up is an
 * exact integer. The leftover (< scale device px per axis) is split as a border.
 *
 * `margin` render pixels of overscan go round the visible view, past the container's edges (it
 * clips them). The camera's sub-pixel offset shifts the canvas by up to half a render pixel, and
 * the margin is what shows at the edge instead of a gap.
 */
export function canvasLayout(deviceW: number, deviceH: number, dpr: number, preset: PixelPreset, margin = 0): CanvasLayout {
  const scale = pixelScale(deviceH, preset);
  let rw: number, rh: number, sx: number, sy: number, left: number, top: number;
  if (preset === 'smooth') {
    // fill the container exactly; the render target keeps its aspect at SMOOTH_H rows (fewer on tiny screens)
    rh = Math.max(1, Math.round(deviceH / scale));
    rw = Math.max(1, Math.round((deviceW * rh) / deviceH));
    sx = deviceW / rw;
    sy = deviceH / rh;
    left = top = 0;
  } else {
    rw = Math.max(1, Math.floor(deviceW / scale));
    rh = Math.max(1, Math.floor(deviceH / scale));
    sx = sy = scale;
    left = Math.floor((deviceW - rw * scale) / 2);
    top = Math.floor((deviceH - rh * scale) / 2);
  }
  const bw = rw + 2 * margin,
    bh = rh + 2 * margin;
  return {
    scale,
    sx,
    sy,
    rw,
    rh,
    margin,
    bw,
    bh,
    cssW: (bw * sx) / dpr,
    cssH: (bh * sy) / dpr,
    cssLeft: (left - margin * sx) / dpr,
    cssTop: (top - margin * sy) / dpr,
    viewCssH: (rh * sy) / dpr,
  };
}

/**
 * The CSS translation (x right, y down) that presents a texel-snapped frame where the unsnapped
 * camera would have put it: the camera's sub-pixel error in render pixels, scaled to device pixels
 * and rounded to whole ones, so every art pixel keeps landing on the device-pixel grid (identical
 * squares in the palette looks) while the image as a whole moves in device-pixel steps.
 */
export function presentOffset(sub: { x: number; y: number }, l: Pick<CanvasLayout, 'sx' | 'sy'>, dpr: number): { x: number; y: number } {
  // + 0 turns -0 into 0, so an unchanged offset compares equal and the style isn't rewritten
  return { x: Math.round(sub.x * l.sx) / dpr + 0, y: Math.round(sub.y * l.sy) / dpr + 0 };
}
