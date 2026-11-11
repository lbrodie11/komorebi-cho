import { hexToSrgb } from '../core/math';

/**
 * Perceptual weights for palette matching. Must equal the `vec3(.3, .59, .11)`
 * in the post shader, or the LUT and reference-loop paths disagree.
 */
export const LUMA_WEIGHTS: readonly [number, number, number] = [0.3, 0.59, 0.11];

/**
 * Cell edges along each axis. The composite can hand the snap colours outside
 * [0, 1]: dither pushes near-black below 0, glow and stars push lit pixels past
 * 1. A cell clamped at the cube's face can miss the true winner for those, so
 * the axis covers [LO, HI]: A fine cells up to 1.0 (where the palette lives),
 * then B coarse ones above it, where every answer is one of the brightest entries.
 */
export const LUT_AXIS = { lo: -1 / 16, hi: 2.5, a: 32, b: 8 } as const;
export const LUT_SIZE = LUT_AXIS.a + LUT_AXIS.b;

/** Lower edge of cell `i` (i = n gives the top edge). */
export function lutEdge(i: number): number {
  const { lo, hi, a, b } = LUT_AXIS;
  return i <= a ? lo + (i * (1 - lo)) / a : 1 + ((i - a) * (hi - 1)) / b;
}

/** Cell index of a channel value; mirrors `lutCell()` in the post shader. */
export function lutCell(v: number): number {
  const { lo, hi, a, b } = LUT_AXIS;
  const i = v < 1 ? Math.floor(((v - lo) / (1 - lo)) * a) : a + Math.floor(((v - 1) / (hi - 1)) * b);
  return Math.min(a + b - 1, Math.max(0, i));
}

/** Candidate slots per LUT cell (one RGBA8 texel). */
export const LUT_SLOTS = 4;

type Rgb = readonly [number, number, number];

const dist = (p: Rgb, r: number, g: number, b: number): number => {
  const dr = r - p[0],
    dg = g - p[1],
    db = b - p[2];
  return dr * dr * LUMA_WEIGHTS[0] + dg * dg * LUMA_WEIGHTS[1] + db * db * LUMA_WEIGHTS[2];
};

/** Index of the palette entry nearest to sRGB (r,g,b) under the weighted squared distance. Ties go to the earlier entry. */
export function nearestIndex(pal: readonly Rgb[], r: number, g: number, b: number): number {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < pal.length; i++) {
    const q = dist(pal[i]!, r, g, b);
    if (q < best) {
      best = q;
      bi = i;
    }
  }
  return bi;
}

export interface PaletteLut {
  /** Cells per axis. */
  n: number;
  /**
   * n³ RGBA8 texels; each holds up to 4 palette *indices* that can be nearest
   * somewhere in that cell (unused slots repeat slot 0). Layout matches three's
   * `Data3DTexture`: x = red (fastest), then green, then blue (slowest).
   */
  data: Uint8Array;
  /** Cells where more than 4 colours compete; the 4 closest to the cell centre are kept. */
  overflow: number;
}

/**
 * Bake the candidate LUT. A plain nearest-colour LUT is wrong wherever a cell
 * straddles a boundary between two palette colours, and ordered dithering
 * parks pixels right on those boundaries (that is what it is for), so a plain
 * 64³ table disagreed with the reference loop on ~5% of frame pixels.
 *
 * Instead each cell lists every colour that wins at any of its 8 corners or its
 * centre; the shader then picks the nearest of those few using the exact
 * colour. Palette regions are large next to a ~1/30 cell, so corners + centre
 * see every colour that touches the cell. Cells are boxes in colour space even
 * where the axis is uneven, which is all this argument needs.
 */
export function bakePaletteLut(palette: readonly string[]): PaletteLut {
  if (palette.length > 255) throw new Error('palette index must fit in a byte');
  const pal = palette.map(hexToSrgb);
  const n = LUT_SIZE;
  const m = n + 1;
  const edge = Array.from({ length: m }, (_, i) => lutEdge(i));
  // nearest colour at every lattice corner, shared by the 8 cells around it
  const corner = new Uint8Array(m * m * m);
  for (let z = 0; z < m; z++)
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) corner[(z * m + y) * m + x] = nearestIndex(pal, edge[x]!, edge[y]!, edge[z]!);

  const data = new Uint8Array(n * n * n * 4);
  const cand: number[] = [];
  let overflow = 0;
  let o = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cr = (edge[x]! + edge[x + 1]!) / 2,
          cg = (edge[y]! + edge[y + 1]!) / 2,
          cb = (edge[z]! + edge[z + 1]!) / 2;
        cand.length = 0;
        cand.push(nearestIndex(pal, cr, cg, cb));
        for (let k = 0; k < 8; k++) {
          const i = corner[((z + (k >> 2)) * m + (y + ((k >> 1) & 1))) * m + (x + (k & 1))]!;
          if (!cand.includes(i)) cand.push(i);
        }
        if (cand.length > LUT_SLOTS) {
          overflow++;
          cand.sort((a, b) => dist(pal[a]!, cr, cg, cb) - dist(pal[b]!, cr, cg, cb));
        }
        for (let s = 0; s < LUT_SLOTS; s++) data[o++] = cand[s < cand.length ? s : 0]!;
      }
    }
  }
  return { n, data, overflow };
}

/** What the shader does with one LUT texel: nearest of the cell's candidates to the exact colour. */
export function resolveLut(lut: PaletteLut, pal: readonly Rgb[], r: number, g: number, b: number): number {
  const o = ((lutCell(b) * lut.n + lutCell(g)) * lut.n + lutCell(r)) * 4;
  let best = Infinity;
  let bi = 0;
  for (let s = 0; s < LUT_SLOTS; s++) {
    const i = lut.data[o + s]!;
    const q = dist(pal[i]!, r, g, b);
    if (q < best) {
      best = q;
      bi = i;
    }
  }
  return bi;
}
