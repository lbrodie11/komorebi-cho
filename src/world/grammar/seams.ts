import { hashString, Rng } from '../../core/rng';
import { G } from '../layout';
import type { Footprint, Part, Seam, SeamKind } from './types';

/**
 * Seam grammar: what fills the gap between two neighbouring buildings, from its width and the
 * buildings' uses, the way real shitamachi backstreets fill them:
 *   under 0.6 m          utility gap: downpipes, an AC condenser
 *   0.6 to 1.1 m         service passage: crates, a drain
 *   1.1 to 2.0 m         yokocho candidate: a lantern string, stools
 *   both serving food    a shared awning over the yokocho
 *   backs facing         laundry poles and a privacy screen
 * Each seam's choices come from a seed of the two neighbours' ids alone, so an edit anywhere
 * else never changes it, and re-planning one building re-plans only its two seams.
 */
export const UTILITY_MAX = 0.6;
export const SERVICE_MAX = 1.1;
export const YOKOCHO_MAX = 2.0;

/** Gap between two footprints along the street (z) or across (x), whichever separates them; negative if they overlap. */
function gapBetween(a: Footprint, b: Footprint): { gap: number; axis: 'x' | 'z' } {
  const gz = Math.max(b.z0 - a.z1, a.z0 - b.z1);
  const gx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  return gz >= gx ? { gap: gz, axis: 'z' } : { gap: gx, axis: 'x' };
}

/** Do the two buildings turn their backs to the gap between them? */
function backsFacing(a: Footprint, b: Footprint, axis: 'x' | 'z'): boolean {
  const lo = axis === 'x' ? (a.x0 < b.x0 ? a : b) : a.z0 < b.z0 ? a : b;
  const hi = lo === a ? b : a;
  return axis === 'x' ? lo.front === 'x0' && hi.front === 'x1' : lo.front === 'z0' && hi.front === 'z1';
}

export function classifyGap(a: Footprint, b: Footprint): Seam {
  const [p, q] = a.id < b.id ? [a, b] : [b, a]; // the seam is the same whichever way round it is asked
  const { gap, axis } = gapBetween(p, q);
  let kind: SeamKind;
  if (gap < 0 || gap >= YOKOCHO_MAX) kind = 'none';
  else if (backsFacing(p, q, axis) && gap >= UTILITY_MAX) kind = 'laundry';
  else if (gap < UTILITY_MAX) kind = 'utility';
  else if (gap < SERVICE_MAX) kind = 'service';
  else kind = p.use === 'food' && q.use === 'food' ? 'awning' : 'yokocho';
  // seed = hash(both parcels, and their revisions once rebuilt): a rebuilt neighbour gets a fresh seam,
  // an edit anywhere else never changes it. Revision 0 leaves the original seeds as they were.
  const rev = (f: Footprint) => (f.revision ? `#${f.revision}` : '');
  return { a: p.id, b: q.id, kind, gap, seed: hashString(`${p.id}${rev(p)}|${q.id}${rev(q)}`) };
}

/**
 * Props for a seam between two buildings side by side along the street (z), fronting +x at
 * `frontX`. Keyed by (seam seed, rule), so the same seam always gets the same props.
 */
export function planSeam(seam: Seam, a: Footprint, b: Footprint, frontX: number): Part[] {
  if (seam.kind === 'none') return [];
  const rng = new Rng(seam.seed ^ hashString(seam.kind));
  const z0 = Math.min(a.z1, b.z1),
    z1 = Math.max(a.z0, b.z0);
  const z = (z0 + z1) / 2;
  const top = Math.min(a.height, b.height);
  const parts: Part[] = [];
  switch (seam.kind) {
    case 'utility': {
      // a downpipe at the front corner; a condenser further back if there is room for one
      const r = Math.min(0.06, seam.gap * 0.3);
      parts.push({ op: 'cyl', rt: r, rb: r, h: top - 0.1, mat: { solid: '#686d78' }, x: frontX - 0.15, y: G + (top - 0.1) / 2, z });
      if (seam.gap >= 0.35) parts.push({ op: 'ac', x: frontX - 1.2 - rng.range(0, 1.5), y: G + 0.45, z, ry: 0 });
      break;
    }
    case 'service': {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++)
        parts.push({
          op: 'box',
          w: 0.4,
          h: 0.3,
          d: 0.4,
          mat: { solid: rng.pick(['#9a2b22', '#2f4a72', '#3c6838']) },
          x: frontX - 0.6 - i * 0.5,
          y: G + 0.15 + (i % 2) * 0.3,
          z,
        });
      parts.push({ op: 'box', w: 2.4, h: 0.04, d: 0.2, mat: { solid: '#3f3a58' }, x: frontX - 1.4, y: G + 0.02, z }); // the drain
      break;
    }
    case 'yokocho':
    case 'awning': {
      // paving, a string of lanterns across the alley, a couple of stools
      parts.push({ op: 'box', w: 3, h: 0.04, d: seam.gap - 0.1, mat: { tex: 'paving', color: '#8a8f99', rx: 1, ry: 1 }, x: frontX - 1.5, y: G + 0.02, z });
      for (let i = 0; i < 3; i++)
        parts.push({ op: 'cyl', rt: 0.12, rb: 0.12, h: 0.3, mat: { named: 'lantern' }, x: frontX - 0.4 - i * 0.9, y: G + top - 0.9, z });
      const stools = rng.int(1, 2);
      for (let i = 0; i < stools; i++)
        parts.push({ op: 'cyl', rt: 0.15, rb: 0.15, h: 0.45, mat: { solid: '#8a5634' }, x: frontX - 0.8 - i * 0.7, y: G + 0.22, z });
      if (seam.kind === 'awning')
        parts.push({ op: 'box', w: 2.2, h: 0.08, d: seam.gap + 0.3, mat: { solid: '#9a2b22' }, x: frontX - 1.1, y: G + top - 0.4, z });
      break;
    }
    case 'laundry': {
      parts.push({ op: 'cyl', rt: 0.025, rb: 0.025, h: seam.gap, mat: { solid: '#adb2b8' }, x: frontX - 1, y: G + 2.2, z });
      parts.push({ op: 'plane', w: seam.gap * 0.9, h: 1.6, mat: { solid: '#8a5634' }, x: frontX - 2.2, y: G + 0.8, z, ry: Math.PI / 2 });
      break;
    }
  }
  return parts;
}
