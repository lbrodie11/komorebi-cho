import { smoothstep } from '../core/math';

/**
 * Causal weathering, baked per vertex. Stains come from the geometry around them:
 * grime pools where walls meet the ground and under eaves, streaks hang below
 * eave lines, window sills and AC units. The values live in the geometry
 * (local space), so moving a building moves its stains.
 *
 * This module is the pure maths. `Kit` gathers the meshes; the shader patch in
 * render/materials.ts turns the attributes into colour.
 */

/** Something that drips: a window sill, an AC unit's drain line. World space. */
export interface DripSource {
  x: number;
  y: number;
  z: number;
  /** Horizontal half-width of the stain. */
  r: number;
  /** How far down the streak runs, metres. */
  len: number;
}

export interface WeatherInput {
  /** World-space positions and unit normals, xyz interleaved. */
  pos: ArrayLike<number>;
  nrm: ArrayLike<number>;
  /** Bottom and top of the mesh in world y. */
  baseY: number;
  topY: number;
  drips: readonly DripSource[];
}

export interface WeatherAttrs {
  /** 1 = open; lower where the wall meets the ground, under eaves, on soffits. */
  ao: Float32Array;
  /** 0..1, how much a face looks at the sky (dust, moss, wet sheen collect there). */
  upFacing: Float32Array;
  /** 0..1, where rain streaks run on vertical faces. */
  dripMask: Float32Array;
}

/** Faces flatter than this (|n.y| below it) count as walls. */
const WALL = 0.35;

export function weatherAttributes(inp: WeatherInput): WeatherAttrs {
  const n = inp.pos.length / 3;
  const ao = new Float32Array(n);
  const upFacing = new Float32Array(n);
  const dripMask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = inp.pos[i * 3]!,
      y = inp.pos[i * 3 + 1]!,
      z = inp.pos[i * 3 + 2]!;
    const ny = inp.nrm[i * 3 + 1]!;
    upFacing[i] = Math.max(0, ny);
    const wall = Math.abs(ny) < WALL;

    let a = 1;
    if (wall) {
      // contact shadow where the wall meets what it stands on
      a *= 0.55 + 0.45 * smoothstep(0, 0.9, y - inp.baseY);
      // the strip under the eave/parapet sees less sky
      a *= 0.78 + 0.22 * smoothstep(0, 0.7, inp.topY - y);
    } else if (ny < 0) {
      a = 0.7; // soffits and undersides
    }
    ao[i] = a;

    if (wall) {
      // water sheets off the top edge and runs down, fading as it goes
      let d = Math.exp(-(inp.topY - y) / 1.6) * 0.8;
      for (const s of inp.drips) {
        const below = s.y - y;
        if (below < 0 || below > s.len) continue;
        const h = Math.hypot(x - s.x, z - s.z);
        if (h > s.r + 0.35) continue;
        const across = 1 - smoothstep(s.r * 0.5, s.r + 0.35, h);
        d = Math.max(d, across * (1 - below / s.len));
      }
      dripMask[i] = Math.min(1, d);
    }
  }
  return { ao, upFacing, dripMask };
}
