import { layoutSign, SIGN_TEXEL } from '../../render/glyphs';
import type { ShopHouseSpec } from './types';

/**
 * What a shop-house needs to know about its neighbours: the priority layers of prompt 05.
 * Structure > circulation > roof/eaves > awnings > signage > wires > props: a lower layer yields.
 *   - Eaves stop EAVE_CLEAR short of a neighbour's wall instead of running into it.
 *   - A shop board that would overlap a neighbour's board slides along its own frontage; if
 *     there is no room, it drops to an A-frame board on the pavement.
 *   - Setback (Building Standards Act 42-2): a rebuilt shop facing a lane under 4 m wide steps
 *     back so its front is 2 m from the lane's centre line, which gives real shitamachi their
 *     staggered frontages. Unrebuilt shops keep their old line.
 * Pure: the same street always gives the same context, and a shop's context depends only on its
 * immediate neighbours, so an edit re-plans at most the edited shop and its two neighbours.
 */
export const EAVE = 0.2;
export const EAVE_CLEAR = 0.02;
export const LANE_MIN = 4;

export interface ShopContext {
  /** Eave overhang on the z0 and z1 sides (gable roofs). */
  eaveBefore: number;
  eaveAfter: number;
  /** The shop's front line after any setback. */
  frontX: number;
  /** Where the shop board goes: on the facade at z, or down on an A-frame. */
  sign: { z: number; aframe: boolean } | null;
}

/** How far a shop steps back from its recorded front line. */
export const setback = (s: ShopHouseSpec): number => (s.rebuilt && s.lane !== undefined && s.lane < LANE_MIN ? (LANE_MIN - s.lane) / 2 : 0);

/** A shop board's footprint on the facade (z span, y span), metres. */
function signBox(s: ShopHouseSpec, z: number) {
  const b = layoutSign(s.sign!.spec);
  const w = b.w * SIGN_TEXEL,
    h = b.h * SIGN_TEXEL;
  return { z0: z - w / 2, z1: z + w / 2, y0: s.sign!.y - h / 2, y1: s.sign!.y + h / 2, w };
}
const overlaps = (a: { z0: number; z1: number; y0: number; y1: number }, b: typeof a) => a.z0 < b.z1 && b.z0 < a.z1 && a.y0 < b.y1 && b.y0 < a.y1;

export function streetContext(specs: readonly ShopHouseSpec[]): Map<string, ShopContext> {
  const row = [...specs].sort((a, b) => a.z0 - b.z0 || (a.id < b.id ? -1 : 1));
  const out = new Map<string, ShopContext>();
  const placed: { z0: number; z1: number; y0: number; y1: number }[] = [];
  row.forEach((s, i) => {
    const prev = row[i - 1],
      next = row[i + 1];
    const gapBefore = prev ? s.z0 - prev.z1 : Infinity;
    const gapAfter = next ? next.z0 - s.z1 : Infinity;
    const trim = (gap: number) => Math.min(EAVE, Math.max(0, gap - EAVE_CLEAR));
    let sign: ShopContext['sign'] = null;
    if (s.sign) {
      const cz = (s.z0 + s.z1) / 2;
      let box = signBox(s, cz);
      const clash = () => placed.some((p) => overlaps(p, box));
      if (clash()) {
        // slide to the nearest spot that clears the boards it hits: along its own frontage, and up to
        // 0.3 m past it into the gap (never closer than 2 cm to the neighbour's wall)
        const over = (gap: number) => Math.min(0.3, Math.max(0, gap - EAVE_CLEAR));
        const lo = s.z0 - over(gapBefore) + box.w / 2,
          hi = s.z1 + over(gapAfter) - box.w / 2;
        const hits = placed.filter((p) => overlaps(p, box));
        const tries = hits
          .flatMap((p) => [p.z1 + EAVE_CLEAR + box.w / 2, p.z0 - EAVE_CLEAR - box.w / 2])
          .filter((z) => z >= lo - 1e-9 && z <= hi + 1e-9)
          .sort((a, b) => Math.abs(a - cz) - Math.abs(b - cz));
        const fit = tries.find((z) => ((box = signBox(s, z)), !clash()));
        sign = fit !== undefined ? { z: fit, aframe: false } : { z: cz, aframe: true };
        if (sign.aframe) box = { z0: 0, z1: 0, y0: 0, y1: 0, w: 0 }; // on the pavement, out of the facade's way
      } else sign = { z: cz, aframe: false };
      if (!sign.aframe) placed.push(box);
    }
    out.set(s.id, { eaveBefore: trim(gapBefore), eaveAfter: trim(gapAfter), frontX: s.frontX - setback(s), sign });
  });
  return out;
}
