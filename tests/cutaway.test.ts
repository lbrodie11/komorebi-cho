import { describe, expect, it } from 'vitest';
import { CUTAWAYS, PIPES } from '../src/world/nature';
import { layoutSign, SIGN_TEXEL } from '../src/render/glyphs';

/** The plinth's utility cutaways: FIBER, GAS and WATER each sit under their pipe, inside the panel. */
describe('the cutaway labels', () => {
  it('keeps every label inside its panel, and no two side by side overlap', () => {
    for (const c of CUTAWAYS) {
      const span = c.u1 - c.u0;
      const boxes = PIPES.map((p) => {
        const w = layoutSign(p.label).w * SIGN_TEXEL;
        return { text: p.label.text, lo: p.u - w / 2, hi: p.u + w / 2 };
      });
      for (const b of boxes) {
        expect(b.lo, `${b.text} starts inside`).toBeGreaterThanOrEqual(0.1);
        expect(b.hi, `${b.text} ends inside`).toBeLessThanOrEqual(span - 0.1);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.lo, `${boxes[i]!.text} clears ${boxes[i - 1]!.text}`).toBeGreaterThan(boxes[i - 1]!.hi + 0.05);
    }
  });
});

describe('dawn and dusk', () => {
  it('are opposites, not twins: dawn cool and pale with the lamps nearly out, sunset warm with them coming on', async () => {
    const { skyAt } = await import('../src/render/sky');
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    };
    const warmth = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) - (n & 255)) / 255; // red minus blue
    };
    const dawn = skyAt(5.6, 0, 'summer'),
      dusk = skyAt(18.4, 0, 'summer');
    expect(warmth(dawn.sun)).toBeLessThan(warmth(dusk.sun) - 0.3);
    expect(warmth(dawn.hemiGround)).toBeLessThan(warmth(dusk.hemiGround));
    expect(lum(dawn.bottom)).toBeGreaterThan(lum(dusk.bottom) + 0.05);
    expect(dawn.lamp).toBeLessThan(dusk.lamp - 0.2);
  });
});
