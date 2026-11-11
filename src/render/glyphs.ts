/**
 * Signage glyph atlas: hand-drawn 5×5 kana and 7×7 pictograms. No font files.
 * Signs are painted into canvas textures at native size: one texel is
 * `SIGN_TEXEL` metres, about one render pixel at the default zoom, so letters
 * land on the pixel grid instead of being resampled into mush.
 *
 * Dakuten / handakuten glyphs are 6 wide: the marks sit in the extra column,
 * drawn as a diagonal pair so they read as ゛ rather than as part of the stroke.
 * Text is painted in palette colours only (see tests/glyphs.test.ts).
 */

/** World size of one sign texel (≈ one render pixel at 1× zoom). */
export const SIGN_TEXEL = 0.125;

export const KANA: Readonly<Record<string, readonly string[]>> = {
  コ: ['#####', '....#', '....#', '....#', '#####'],
  モ: ['#####', '..#..', '#####', '..#..', '..###'],
  レ: ['#....', '#....', '#...#', '#..#.', '###..'],
  ヒ: ['#....', '#..#.', '###..', '#....', '.####'],
  ビ: ['#...#.', '#..#.#', '###...', '#.....', '.####.'],
  ト: ['.#...', '.#...', '.###.', '.#...', '.#...'],
  リ: ['#..#.', '#..#.', '#..#.', '...#.', '..#..'],
  ラ: ['.###.', '.....', '#####', '....#', '..##.'],
  ー: ['.....', '.....', '#####', '.....', '.....'],
  // the long-vowel mark turns upright in vertical writing
  '｜': ['..#..', '..#..', '..#..', '..#..', '..#..'],
  メ: ['....#', '.#.#.', '..#..', '.#.#.', '#....'],
  ン: ['#....', '.#..#', '....#', '...#.', '###..'],
  ハ: ['.#.#.', '.#..#', '#...#', '#...#', '.....'],
  パ: ['.#.#.#', '.#..#.', '#...#.', '#...#.', '......'],
  ナ: ['..#..', '#####', '..#..', '..#..', '.#...'],
  ホ: ['..#..', '#####', '..#..', '#.#.#', '..#..'],
  チ: ['.###.', '..#..', '#####', '..#..', '.#...'],
  ョ: ['.....', '.###.', '..##.', '.###.', '.....'],
  ウ: ['..#..', '#####', '#...#', '...#.', '..#..'],
  カ: ['.#...', '#####', '.#..#', '.#..#', '#..#.'],
  ガ: ['.#..#.', '####.#', '.#.#..', '.#.#..', '#..#..'],
  ス: ['#####', '...#.', '..#..', '.#.#.', '#...#'],
  ズ: ['####.#', '...##.', '..#...', '.#.#..', '#...#.'],
  ミ: ['###..', '...##', '###..', '...##', '####.'],
  ゆ: ['#.#..', '#.###', '###.#', '#.##.', '.#...'],
};

export type PictoKind = 'ramen' | 'coffee' | 'flower' | 'book' | 'bath' | 'bread';

export const PICTOS: Readonly<Record<PictoKind, readonly string[]>> = {
  // a bowl with steam
  ramen: ['.#.#.#.', '#.#.#..', '.......', '#######', '#######', '.#####.', '..###..'],
  // cup, handle and saucer
  coffee: ['..#.#..', '.#.#...', '.......', '######.', '#####.#', '######.', '.####..'],
  // tulip with leaves
  flower: ['.#.#.#.', '.#####.', '.#####.', '..###..', '...#...', '##.#.##', '..###..'],
  // open book
  book: ['.##.##.', '#..#..#', '#..#..#', '#..#..#', '#..#..#', '.##.##.', '...#...'],
  // the hot-spring mark: three wisps over a basin
  bath: ['.#.#.#.', '#.#.#..', '.#.#.#.', '.......', '#.....#', '#.....#', '.#####.'],
  // a scored loaf
  bread: ['.......', '..###..', '.##.##.', '##.#.##', '#######', '#######', '.......'],
};

export interface SignSpec {
  /** Kana from `KANA`; anything else is a layout error (thrown, so a typo can't ship a blank sign). */
  text?: string;
  picto?: PictoKind;
  vertical?: boolean;
  ink: string;
  bg: string;
  /** 1-texel frame colour; omitted = no frame. */
  border?: string;
  /** Empty texels between the frame and the content. */
  pad?: number;
}

/** 0 background, 1 ink, 2 border. Row-major, row 0 at the top. */
export interface SignBitmap {
  w: number;
  h: number;
  cells: Uint8Array;
}

function glyphRows(ch: string, vertical: boolean): readonly string[] {
  const g = KANA[vertical && ch === 'ー' ? '｜' : ch];
  if (!g) throw new Error(`no glyph for "${ch}"`);
  return g;
}

/** Lay a sign out into cells. Pure: no canvas, so it is unit-testable. */
export function layoutSign(spec: SignSpec): SignBitmap {
  const vertical = spec.vertical ?? false;
  const items: (readonly string[])[] = [];
  if (spec.picto) items.push(PICTOS[spec.picto]);
  for (const ch of spec.text ?? '') items.push(glyphRows(ch, vertical));
  if (!items.length) throw new Error('empty sign');

  const gap = 1;
  const iw = (g: readonly string[]) => g[0]!.length;
  const ih = (g: readonly string[]) => g.length;
  let cw: number, ch: number;
  if (vertical) {
    cw = Math.max(...items.map(iw));
    ch = items.reduce((a, g) => a + ih(g), 0) + gap * (items.length - 1);
  } else {
    cw = items.reduce((a, g) => a + iw(g), 0) + gap * (items.length - 1);
    ch = Math.max(...items.map(ih));
  }
  const frame = spec.border ? 1 : 0;
  const pad = spec.pad ?? 1;
  const m = frame + pad;
  const w = cw + 2 * m;
  const h = ch + 2 * m;
  const cells = new Uint8Array(w * h);
  if (frame) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) cells[y * w + x] = 2;

  let cx = m,
    cy = m;
  for (const g of items) {
    // centre each item across the line (short kana beside a tall pictogram)
    const ox = vertical ? cx + Math.floor((cw - iw(g)) / 2) : cx;
    const oy = vertical ? cy : cy + Math.floor((ch - ih(g)) / 2);
    g.forEach((row, y) => [...row].forEach((v, x) => v === '#' && (cells[(oy + y) * w + ox + x] = 1)));
    if (vertical) cy += ih(g) + gap;
    else cx += iw(g) + gap;
  }
  return { w, h, cells };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Paint a sign bitmap into a canvas (1 cell = 1 canvas pixel). */
export function paintSign(spec: SignSpec): { canvas: HTMLCanvasElement; w: number; h: number } {
  const b = layoutSign(spec);
  const c = document.createElement('canvas');
  c.width = b.w;
  c.height = b.h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const img = ctx.createImageData(b.w, b.h);
  const cols = [rgb(spec.bg), rgb(spec.ink), rgb(spec.border ?? spec.bg)];
  for (let i = 0; i < b.cells.length; i++) {
    const k = cols[b.cells[i]!]!;
    img.data[i * 4] = k[0];
    img.data[i * 4 + 1] = k[1];
    img.data[i * 4 + 2] = k[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, w: b.w, h: b.h };
}
