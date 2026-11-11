import { G } from '../layout';
import type { Part, ShopHouseSpec } from './types';

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
