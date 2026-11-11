import * as THREE from 'three';
import type { Rect } from '../core/math';
import type { Spill } from './lighting';

/**
 * Light pools: where a streetlamp or a shop window's light lands on the ground (layer 4 of
 * the lighting model in lighting.ts). Authored decals, not shadowed lights. A dozen extra
 * shadow-casting lights would multiply the shadow pass; these cost one small draw each.
 *
 * Each pool is a flat quad a few centimetres above the ground with a falloff map. It adds
 * light (colour only: CustomBlending leaves destination alpha untouched, so the scene's
 * water and sign tags survive). It is depth-tested, so walls, benches and residents in
 * front of it hide it, and it never writes depth.
 */

type Shape = 'round' | 'spill';

const SIZE = 64;

function falloffTexture(shape: Shape): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const u = ((i + 0.5) / SIZE) * 2 - 1;
      const v = (j + 0.5) / SIZE;
      let f: number;
      if (shape === 'round') {
        const r = Math.min(1, Math.hypot(u, v * 2 - 1));
        f = Math.pow(1 - r * r * (3 - 2 * r), 1.4);
      } else {
        // v = 1 at the wall, 0 at the far edge: bright at the glass, widening and fading outward
        const out = 1 - v;
        const half = 0.62 + 0.38 * out;
        const side = 1 - Math.min(1, Math.max(0, (Math.abs(u) - half * 0.7) / (half * 0.3)));
        f = Math.pow(1 - out, 1.5) * side;
      }
      const b = Math.round(f * 255);
      data.set([b, b, b, 255], (j * SIZE + i) * 4);
    }
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  // an intensity map, not a colour: never colour-converted
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A flat quad between x0..x1 / z0..z1 at height y, with matching UVs (v = 1 at z0). */
function flatQuad(x0: number, x1: number, z0: number, z1: number, y: number, u0: number, u1: number, v0: number, v1: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u1, v0, u0, v0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** The quad for a round pool, clipped to `clip` with matching UVs. */
function roundQuad(x: number, z: number, y: number, r: number, rz: number, clip: Rect): THREE.BufferGeometry {
  const x0 = Math.max(clip.x0, x - r),
    x1 = Math.min(clip.x1, x + r),
    z0 = Math.max(clip.z0, z - rz),
    z1 = Math.min(clip.z1, z + rz);
  const u = (px: number) => (px - (x - r)) / (2 * r);
  const v = (pz: number) => 1 - (pz - (z - rz)) / (2 * rz);
  return flatQuad(x0, x1, z0, z1, y, u(x0), u(x1), v(z0), v(z1));
}

interface Pool {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  color: THREE.Color;
  peak: number;
}

export class LightPools {
  readonly group = new THREE.Group();
  private readonly pools: Pool[] = [];
  private readonly maps: Record<Shape, THREE.DataTexture> = { round: falloffTexture('round'), spill: falloffTexture('spill') };

  private make(geo: THREE.BufferGeometry, shape: Shape, color: string, peak: number): number {
    const mat = new THREE.MeshBasicMaterial({
      map: this.maps[shape],
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.pools.push({ mesh, mat, color: new THREE.Color(color), peak });
    return this.pools.length - 1;
  }

  /** A round pool of radius r centred at (x, z), clipped to `clip` so it never hangs off the plinth. */
  addRound(x: number, z: number, y: number, r: number, color: string, peak: number, clip: Rect, stretchZ = 1): number {
    return this.make(roundQuad(x, z, y, r, r * stretchZ, clip), 'round', color, peak);
  }

  /**
   * A round pool that can move: for the pooled lights that player-placed lanterns and vending
   * machines borrow. Hidden until `place`d.
   */
  addMovable(color: string, peak: number): number {
    return this.make(new THREE.BufferGeometry(), 'round', color, peak);
  }

  /** Put movable pool `i` at (x, z), clipped to `clip`, tinted `color`. Rebuilds its quad (placement is rare). */
  place(i: number, x: number, z: number, y: number, r: number, color: THREE.Color, clip: Rect): void {
    const p = this.pools[i]!;
    p.mesh.geometry.dispose();
    p.mesh.geometry = roundQuad(x, z, y, r, r, clip);
    p.color.copy(color);
  }

  /** A window spill: a footprint opening outward from the glass (see windowSpill). */
  addSpill(s: Spill, y: number, color: string, peak: number): number {
    const g = flatQuad(-s.width / 2, s.width / 2, -s.depth / 2, s.depth / 2, 0, 0, 1, 1, 0);
    // local -z (v = 1) is the wall side; turn so local +z points along the window's outward normal
    g.rotateY(s.ry);
    g.translate(s.x, y, s.z);
    return this.make(g, 'spill', color, peak);
  }

  /** Brightness of pool `i`, 0..1 of its peak. */
  set(i: number, level: number): void {
    const p = this.pools[i]!;
    const k = p.peak * Math.max(0, level);
    p.mat.color.setRGB(p.color.r * k, p.color.g * k, p.color.b * k);
    p.mesh.visible = k > 0.002;
  }

  get count(): number {
    return this.pools.length;
  }
}
