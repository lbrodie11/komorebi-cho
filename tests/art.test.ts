import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { KANA, PICTOS, layoutSign } from '../src/render/glyphs';
import { DOORS, DOORSTEP_POTS, GROUND, OBSTACLES, SIGNS } from '../src/world/layout';
import { PALETTE } from '../src/render/palette';
import { weatherAttributes, type DripSource } from '../src/world/weathering';
import { CANOPIES, pickCanopy } from '../src/world/weather';
import { skyAt } from '../src/render/sky';
import { hexToSrgb } from '../src/core/math';
import { NavGrid } from '../src/sim/grid';
import { groundHeight, isWalkableSurface } from '../src/world/terrain';
import { installHeadlessDom } from './helpers/headless';

const luma = (hex: string) => {
  const [r, g, b] = hexToSrgb(hex);
  return 0.3 * r + 0.59 * g + 0.11 * b;
};

describe('glyph atlas', () => {
  it('draws every kana on a 5-row grid (6 wide only with dakuten marks)', () => {
    for (const [ch, rows] of Object.entries(KANA)) {
      expect(rows.length, ch).toBe(5);
      const w = rows[0]!.length;
      expect([5, 6], ch).toContain(w);
      for (const r of rows) expect(r.length, ch).toBe(w);
    }
  });

  it('draws every pictogram on 7×7', () => {
    for (const [k, rows] of Object.entries(PICTOS)) {
      expect(rows.length, k).toBe(7);
      for (const r of rows) expect(r.length, k).toBe(7);
    }
  });

  it('lays out every sign in the layout, in palette colours only', () => {
    for (const [k, spec] of Object.entries(SIGNS)) {
      const b = layoutSign(spec);
      expect(b.cells.length, k).toBe(b.w * b.h);
      expect(
        b.cells.some((c) => c === 1),
        `${k} has ink`,
      ).toBe(true);
      for (const c of [spec.ink, spec.bg, 'border' in spec ? spec.border : spec.bg]) expect(PALETTE, `${k} ${c}`).toContain(c);
    }
  });

  it('sizes horizontal and vertical text from glyph widths, gaps, pad and frame', () => {
    const h = layoutSign({ text: 'コモ', ink: '#16141f', bg: '#f6efe0' });
    expect([h.w, h.h]).toEqual([5 + 1 + 5 + 2, 5 + 2]);
    const v = layoutSign({ text: 'コモ', vertical: true, ink: '#16141f', bg: '#f6efe0', border: '#45291b', pad: 0 });
    expect([v.w, v.h]).toEqual([5 + 2, 5 + 1 + 5 + 2]);
  });

  it('turns the long-vowel mark upright in vertical writing', () => {
    const v = layoutSign({ text: 'ー', vertical: true, ink: '#16141f', bg: '#f6efe0', pad: 0 });
    // a single centred column of ink
    for (let y = 0; y < 5; y++) expect(Array.from(v.cells.slice(y * 5, y * 5 + 5))).toEqual([0, 0, 1, 0, 0]);
  });

  it('centres short kana beside a tall pictogram', () => {
    const b = layoutSign({ picto: 'bread', text: 'ン', ink: '#16141f', bg: '#f6efe0', pad: 0 });
    expect(b.h).toBe(7);
    const glyphRows = [...Array(7).keys()].filter((y) => Array.from(b.cells.slice(y * b.w + 8, y * b.w + b.w)).some((c) => c === 1));
    expect(Math.min(...glyphRows)).toBe(1);
    expect(Math.max(...glyphRows)).toBe(5);
  });

  it('refuses text it has no glyph for, instead of shipping a blank sign', () => {
    expect(() => layoutSign({ text: 'A', ink: '#16141f', bg: '#f6efe0' })).toThrow(/no glyph/);
  });
});

describe('weathering attributes', () => {
  // one wall facing +z, 0..4 m tall, sampled up its centre line and 1 m to the side
  const verts: [number, number, number, number][] = [];
  for (const x of [0, 1]) for (let y = 0; y <= 4; y += 0.5) verts.push([x, y, 0, 0]);
  const pos = verts.flatMap(([x, y, z]) => [x, y, z]);
  const nrm = verts.flatMap(() => [0, 0, 1]);
  const at = (a: Float32Array, x: number, y: number) => a[verts.findIndex(([vx, vy]) => vx === x && vy === y)]!;
  const sill: DripSource = { x: 0, y: 3, z: 0.05, r: 0.4, len: 2 };
  const w = weatherAttributes({ pos, nrm, baseY: 0, topY: 4, drips: [sill] });

  it('darkens where the wall meets the ground and under the eave', () => {
    expect(at(w.ao, 1, 0)).toBeLessThan(at(w.ao, 1, 2));
    expect(at(w.ao, 1, 4)).toBeLessThan(at(w.ao, 1, 2));
    expect(at(w.ao, 1, 2)).toBeCloseTo(1, 5);
  });

  it('runs streaks below a drip source and only below it', () => {
    expect(at(w.dripMask, 0, 2)).toBeGreaterThan(at(w.dripMask, 1, 2) + 0.2);
    // above the sill only the faint top-edge sheet applies, the same as beside it
    expect(at(w.dripMask, 0, 3.5)).toBeCloseTo(at(w.dripMask, 1, 3.5), 5);
    // the streak fades as it runs down
    expect(at(w.dripMask, 0, 2.5)).toBeGreaterThan(at(w.dripMask, 0, 1.5));
  });

  it('treats roofs, ledges and soffits differently from walls', () => {
    const up = weatherAttributes({ pos: [0, 4, 0, 0, 3, 0], nrm: [0, 1, 0, 0, -1, 0], baseY: 0, topY: 4, drips: [sill] });
    expect(up.upFacing[0]).toBe(1);
    expect(up.dripMask[0]).toBe(0);
    expect(up.ao[0]).toBe(1);
    expect(up.ao[1]).toBeLessThan(1); // soffit
    expect(up.upFacing[1]).toBe(0);
  });

  it('is stored in the geometry, so a moved building keeps its stains', () => {
    // same wall shifted 5 m: identical attributes when the drip source moves with it
    const shifted = weatherAttributes({
      pos: verts.flatMap(([x, y, z]) => [x + 5, y, z]),
      nrm,
      baseY: 0,
      topY: 4,
      drips: [{ ...sill, x: sill.x + 5 }],
    });
    expect(Array.from(shifted.dripMask)).toEqual(Array.from(w.dripMask));
    expect(Array.from(shifted.ao)).toEqual(Array.from(w.ao));
  });
});

describe('falling leaves', () => {
  it('pick canopies of the right kind, weighted by canopy area', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
      const c = pickCanopy((i + 0.5) / 1000, ['sakura']);
      expect(c.kind).toBe('sakura');
      counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
    }
    const sak = CANOPIES.filter((c) => c.kind === 'sakura');
    const total = sak.reduce((s, c) => s + c.r * c.r, 0);
    for (const c of sak) expect(counts.get(c.r)! / 1000).toBeCloseTo((c.r * c.r) / total, 2);
  });

  describe('in the world', () => {
    beforeAll(() => installHeadlessDom());

    it('start inside tree canopies in autumn, never in open sky', async () => {
      const { Materials } = await import('../src/render/materials');
      const { Weather } = await import('../src/world/weather');
      const w = new Weather(new THREE.Group(), new Materials(), 0);
      w.update(1 / 60, 0, 0, 12, 'autumn');
      const geo = (w as unknown as { airGeo: THREE.BufferGeometry }).airGeo;
      const a = geo.attributes.position!.array as Float32Array;
      const n = geo.drawRange.count;
      expect(n).toBeGreaterThan(0);
      const trees = CANOPIES.filter((c) => c.kind !== 'evergreen');
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
        const under = trees.some((c) => Math.abs(x - c.x) <= c.r + 0.1 && Math.abs(z - c.z) <= c.r + 0.1 && y <= c.y + c.r);
        expect(under, `leaf ${i} at ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`).toBe(true);
      }
    });
  });
});

describe('weathered materials', () => {
  beforeAll(() => installHeadlessDom());

  it('follow their base through season changes (winter roofs snow over)', async () => {
    const { Materials } = await import('../src/render/materials');
    const m = new Materials();
    const twin = m.weathered(m.roof);
    expect(m.weathered(m.roof)).toBe(twin);
    m.applySeason('winter');
    expect(twin.color.getHexString()).toBe(m.roof.color.getHexString());
    m.applySeason('summer');
    expect(twin.color.getHexString()).toBe(m.roof.color.getHexString());
  });
});

describe('quiet props', () => {
  it('keep every door reachable: pots stand beside doors, not in them', () => {
    const grid = new NavGrid(
      { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
      { walkable: isWalkableSurface, height: groundHeight },
      OBSTACLES,
    );
    for (const d of Object.values(DOORS)) {
      expect(grid.findPath(-4, 2, d.x, d.z), d.id).not.toBeNull();
      for (const [x, z] of DOORSTEP_POTS) expect(Math.hypot(x - d.x, z - d.z), `${d.id} pot`).toBeGreaterThan(0.5);
    }
  });
});

describe('lighting keys', () => {
  it('never take the sky to black: nothing darker than the palette floor', () => {
    const floor = Math.min(...PALETTE.map(luma));
    expect(floor).toBeGreaterThanOrEqual(luma('#16141f') - 1e-9);
    for (let h = 0; h < 24; h += 0.25)
      for (const rain of [0, 1]) {
        const s = skyAt(h, rain, 'spring');
        expect(luma(s.top), `${h}:00 rain ${rain}`).toBeGreaterThanOrEqual(floor - 1e-9);
      }
  });

  it('golden hour is warm and blue hour is cool, so warm windows carry blue hour', () => {
    const gold = skyAt(17.5, 0, 'spring');
    const blue = skyAt(19.25, 0, 'spring');
    const warmth = (hex: string) => hexToSrgb(hex)[0] - hexToSrgb(hex)[2];
    expect(warmth(gold.sun)).toBeGreaterThan(0.3);
    expect(warmth(blue.hemiSky)).toBeLessThan(0);
    expect(warmth(blue.bottom)).toBeLessThan(0);
    expect(blue.lamp).toBe(1);
    expect(gold.lamp).toBeLessThan(0.3);
  });

  it('a snowy morning is brighter and paler than a clear winter one', () => {
    const snow = skyAt(7.5, 1, 'winter');
    const rainy = skyAt(7.5, 1, 'spring');
    expect(luma(snow.hemiGround)).toBeGreaterThan(luma(rainy.hemiGround));
    expect(snow.hemiI).toBeGreaterThan(rainy.hemiI);
  });

  it('a rainy evening turns the street lamps on early', () => {
    expect(skyAt(17.5, 1, 'autumn').lamp).toBeGreaterThan(skyAt(17.5, 0, 'autumn').lamp + 0.4);
  });
});
