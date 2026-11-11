import { G } from '../../layout';
import type { Part, ShopHouseSpec, ShopAttachment } from '../types';

/**
 * Shop-house archetype: semantic facade zones, top to bottom of the plan:
 * foundation → shopfront (bays: window, sill, shutter) → upper windows → roof → attachments
 * (noren, awning) → signage. Changing the frontage re-evaluates the rules: the bay count, window
 * spacing, awning length and sign position follow it. Nothing is ever scaled.
 *
 * The part order matches the original hand-written code exactly: Kit draws window jitter from a
 * seeded stream, so the same order gives the same town.
 */

/** One shopfront bay per this many metres of frontage (rounded, at least one). 4 m → 1 bay, 6 m → 2. */
export const BAY_M = 3.6;
/** One upper window per this many metres of frontage on a two-storey shop (at least two). */
export const UPPER_WINDOW_M = 1.6;
/** Shops taller than this have an upper floor with windows. */
export const UPPER_FLOOR_H = 4.4;

export const bayCount = (frontage: number): number => Math.max(1, Math.round(frontage / BAY_M));
export const upperWindowCount = (frontage: number): number => Math.max(2, Math.round(frontage / UPPER_WINDOW_M));

export function planShopHouse(s: ShopHouseSpec): Part[] {
  const d = s.z1 - s.z0; // frontage
  const cz = (s.z0 + s.z1) / 2;
  const cx = s.frontX - s.depth / 2;
  const fx = s.frontX;
  const ry = Math.PI / 2; // facing +x
  const bays = bayCount(d);
  const bw = d / bays;
  const bayZ = (i: number) => s.z0 + bw * (i + 0.5);

  const body: Part[] = [{ op: 'box', w: s.depth, h: s.height, d, mat: s.wall, x: cx, y: G + s.height / 2, z: cz }];
  if (s.roof === 'gable') body.push({ op: 'gableZ', w: d + 0.4, d: s.depth + 0.6, h: 1.4, mat: { named: 'roof' }, x: cx, y: G + s.height, z: cz });
  else if (s.roof === 'shed')
    body.push({ op: 'shed', x0: fx - s.depth, x1: fx, z0: s.z0, z1: s.z1, y: G + s.height, rise: 1, hi: 'x0', wall: s.wall, roof: { named: 'roof' } });
  else {
    body.push({ op: 'box', w: s.depth + 0.1, h: 0.3, d: d + 0.1, mat: { named: 'dark' }, x: cx, y: G + s.height + 0.15, z: cz });
    if (s.tank) body.push({ op: 'cyl', rt: 0.45, rb: 0.45, h: 0.8, mat: { solid: '#86aed4', rough: 0.5 }, x: cx - 1.5, y: G + s.height + 0.7, z: cz });
  }
  for (let i = 0; i < bays; i++) {
    body.push({ op: 'win', x: fx + 0.04, y: G + 1.15, z: bayZ(i), ry, w: bw * 0.72, h: 1.6, kind: 'shop', hours: s.hours });
    body.push({ op: 'box', w: 0.3, h: 0.25, d: bw * 0.78, mat: { solid: '#686d78' }, x: fx + 0.05, y: G + 2.08, z: bayZ(i) });
  }
  if (s.height > UPPER_FLOOR_H) {
    const n = upperWindowCount(d);
    for (let i = 0; i < n; i++) body.push({ op: 'win', x: fx + 0.04, y: G + 3.8, z: s.z0 + (d * (i + 0.5)) / n, ry, w: 0.9, h: 1, kind: 'home' });
  }

  const parts: Part[] = [{ op: 'scope', age: s.age, parts: body }];
  for (let i = 0; i < bays; i++) parts.push({ op: 'shutter', x: fx + 0.04, y: G + 1.15, z: bayZ(i), ry, w: bw * 0.74, h: 1.62, hours: s.hours });
  if (s.noren) {
    parts.push({ op: 'plane', w: d * 0.55, h: 0.9, mat: { solid: s.noren }, x: fx + 0.08, y: G + 1.85, z: cz, ry });
    if (s.crest) parts.push({ op: 'sign', sign: s.crest, x: fx + 0.09, y: G + 1.85, z: cz, ry });
  }
  if (s.awning) parts.push({ op: 'box', w: 1.1, h: 0.14, d: d * 0.9, mat: s.awning, x: fx + 0.55, y: G + 2.55, z: cz, rz: -0.38 });
  if (s.sign) parts.push({ op: 'sign', sign: s.sign.spec, x: fx + 0.08, y: G + s.sign.y, z: cz, ry });
  return parts;
}

/** The ground footprint of a shop-house, for seam rules. */
export const shopFootprint = (s: ShopHouseSpec) => ({
  id: s.id,
  use: s.use,
  x0: s.frontX - s.depth,
  x1: s.frontX,
  z0: s.z0,
  z1: s.z1,
  height: s.height,
  front: 'x1' as const,
});

/**
 * A shop-house's street-side attachments (the "attachments" facade zone), placed from its
 * frontage: the ramen shop's lanterns and back-lit sign, an AC unit, the bakery's bread rack, the
 * florist's buckets, the bookshop's 100-yen cart. Planned after all shop bodies, in street order.
 */
export function planAttachments(s: ShopHouseSpec): Part[] {
  const fx = s.frontX;
  const cz = (s.z0 + s.z1) / 2;
  const parts: Part[] = [];
  for (const a of s.attachments ?? []) parts.push(...attachment(a, s, fx, cz));
  return parts;
}

function attachment(a: ShopAttachment, s: ShopHouseSpec, fx: number, cz: number): Part[] {
  switch (a.kind) {
    case 'lanternSign':
      return [
        { op: 'lantern', x: fx + 0.3, y: G + 2.3, z: s.z0 + 0.4 },
        { op: 'lantern', x: fx + 0.3, y: G + 2.3, z: s.z1 - 0.4 },
        { op: 'box', w: 0.12, h: 3.25, d: 1, mat: { lamp: '#d0402a', glow: '#9a2b22', intensity: 0.6, accent: true }, x: fx + 0.14, y: G + 3.6, z: cz },
        { op: 'sign', sign: a.sign, x: fx + 0.21, y: G + 3.6, z: cz, ry: Math.PI / 2, glow: 0.6 },
      ];
    case 'ac':
      return [{ op: 'scope', age: a.age, parts: [{ op: 'ac', x: fx + 0.14, y: G + a.y, z: cz + a.dz, ry: Math.PI / 2 }] }];
    case 'breadRack': {
      const parts: Part[] = [{ op: 'box', w: 0.5, h: 0.8, d: 1.2, mat: { solid: '#8a5634' }, x: fx + 0.55, y: G + 0.4, z: cz + 0.9 }];
      for (let i = 0; i < 6; i++) parts.push({ op: 'blob', x: fx + 0.55, y: G + 0.88, z: cz + 0.45 + i * 0.18, r: 0.09, mat: { solid: '#d4a774' } });
      return parts;
    }
    case 'flowerBuckets': {
      const flowers = ['#f4c7cf', '#ffd37a', '#d0402a', '#f6efe0', '#6a5a9a', '#ff6b3d'];
      const parts: Part[] = [
        { op: 'box', w: 0.9, h: 0.5, d: 2.2, mat: { solid: '#8a5634' }, x: fx + 0.5, y: G + 0.25, z: cz },
        { op: 'box', w: 0.6, h: 0.4, d: 2, mat: { solid: '#653d27' }, x: fx + 0.35, y: G + 0.7, z: cz },
      ];
      for (let i = 0; i < 22; i++)
        parts.push({
          op: 'gem',
          r: 0.14,
          mat: { std: flowers[i % flowers.length]!, flat: true },
          x: fx + 0.75 - (i % 2) * 0.35,
          y: G + 0.62 + (i % 2) * 0.42,
          z: cz - 0.9 + (i % 11) * 0.18,
        });
      return parts;
    }
    case 'bookCart': {
      const colours = ['#9a2b22', '#2f4a72', '#e8dcc2', '#3c6838'];
      const parts: Part[] = [{ op: 'box', w: 0.5, h: 0.7, d: 1.4, mat: { solid: '#45291b' }, x: fx + 0.5, y: G + 0.35, z: cz }];
      for (let i = 0; i < 7; i++)
        parts.push({ op: 'box', w: 0.3, h: 0.32, d: 0.16, mat: { solid: colours[i % 4]! }, x: fx + 0.5, y: G + 0.86, z: cz - 0.55 + i * 0.18 });
      return parts;
    }
  }
}
