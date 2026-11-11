import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Materials } from '../render/materials';

/**
 * Birds (2026-11 pixel-art review): a tiny rig per bird (body, head, beak, tail, two wings) so a
 * bird reads as a bird at 8–12 render pixels, instead of a box that stretches.
 *
 * - Wings move in a few held frames, stepped "on twos" (12 fps) like hand-drawn pixel animation,
 *   not a smooth sine: up, level, down, level. Crows mix in long glides.
 * - Perched birds peck (the head dips) and turn in small steps; they never spin.
 * - Sparrows hop with both feet together on a short arc; pigeons walk-hop; crows circle.
 * Colours come from the palette (the pixel looks snap to it anyway; Smooth shows them as written).
 */
export type Species = 'pigeon' | 'crow' | 'sparrow';

interface Look {
  /** Body width, height, length (m). */
  body: readonly [number, number, number];
  head: number;
  colors: { body: string; wing: string; head: string; beak: string; tail: string; cheek?: string };
}

const LOOKS: Record<Species, Look> = {
  pigeon: { body: [0.18, 0.15, 0.28], head: 0.11, colors: { body: '#8a8f99', wing: '#686d78', head: '#4b4f5a', beak: '#e8dcc2', tail: '#4b4f5a' } },
  crow: { body: [0.2, 0.16, 0.36], head: 0.13, colors: { body: '#16141f', wing: '#211e30', head: '#16141f', beak: '#2e2a42', tail: '#16141f' } },
  // a tree sparrow: brown crown and back, a pale cheek with a dark spot, buff underneath
  sparrow: {
    body: [0.1, 0.09, 0.15],
    head: 0.08,
    colors: { body: '#d4a774', wing: '#8a5634', head: '#653d27', beak: '#2a1912', tail: '#653d27', cheek: '#f6efe0' },
  },
};

/** The held wing frames (rotation about the body's long axis, + is up). */
export type WingFrame = 'folded' | 'up' | 'level' | 'down';
const WING_ANGLE: Record<WingFrame, number> = { folded: 0, up: 1.05, level: 0.15, down: -0.55 };
/** Frames per second of the flap: on twos. */
export const FLAP_FPS = 12;
const BEAT: readonly WingFrame[] = ['up', 'level', 'down', 'level'];

/**
 * The wing frame `t` seconds into a flight: a 4-frame beat at FLAP_FPS, held between steps. Crows
 * beat twice, then glide (wings level) for six frames. Pure, so the stepping is tested.
 */
export function flapFrame(species: Species, t: number): WingFrame {
  const f = Math.floor(Math.max(0, t) * FLAP_FPS);
  if (species === 'crow') {
    const k = f % 14;
    return k < 8 ? BEAT[k % 4]! : 'level';
  }
  return BEAT[f % 4]!;
}

/** Height of a hop at phase u (0..1): a parabola peaking at `h`. */
export const hopHeight = (u: number, h: number): number => 4 * h * Math.max(0, Math.min(1, u)) * (1 - Math.max(0, Math.min(1, u)));

/** One material for every bird (colours ride on the vertices): four draw calls a bird, all sharing it. */
const shared = new WeakMap<Materials, THREE.Material>();
function birdMaterial(m: Materials): THREE.Material {
  let mat = shared.get(m);
  if (!mat) shared.set(m, (mat = m.std('#ffffff', 0.9, { vertexColors: true })));
  return mat;
}

export class BirdRig {
  readonly root = new THREE.Group();
  private readonly wings: [THREE.Object3D, THREE.Object3D];
  private readonly head = new THREE.Group();
  frame: WingFrame = 'folded';

  constructor(
    readonly species: Species,
    m: Materials,
  ) {
    const L = LOOKS[species];
    const [w, h, l] = L.body;
    const mat = birdMaterial(m);
    // a coloured box, moved into place in the geometry itself, so parts that never move apart merge
    const part = (sx: number, sy: number, sz: number, color: string, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      if (rx) g.rotateX(rx);
      g.translate(x, y, z);
      const c = new THREE.Color(color);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    // body and tail: one mesh
    const body = new THREE.Mesh(
      mergeGeometries([part(w, h, l, L.colors.body, 0, h / 2 + 0.03, 0), part(w * 0.6, h * 0.25, l * 0.45, L.colors.tail, 0, h * 0.75, -l * 0.62, -0.35)]),
      mat,
    );
    // the head (skull, beak, cheek: one mesh) pivots where it meets the body, so a peck dips it forward
    this.head.position.set(0, h * 0.9, l * 0.36);
    const hd = L.head;
    const headParts = [part(hd, hd, hd, L.colors.head, 0, hd * 0.5, hd * 0.25), part(hd * 0.3, hd * 0.25, hd * 0.45, L.colors.beak, 0, hd * 0.4, hd * 0.85)];
    if (L.colors.cheek) headParts.push(part(hd * 1.04, hd * 0.4, hd * 0.4, L.colors.cheek, 0, hd * 0.35, hd * 0.3));
    this.head.add(new THREE.Mesh(mergeGeometries(headParts), mat));
    // wings hinge at the shoulder, along the body's sides
    const wing = (side: -1 | 1) => {
      const pivot = new THREE.Group();
      pivot.position.set((side * w) / 2, h * 0.85, 0);
      pivot.add(new THREE.Mesh(part(w * 1.3, h * 0.18, l * 0.7, L.colors.wing, (side * w * 1.3) / 2, 0, 0), mat));
      return pivot;
    };
    this.wings = [wing(-1), wing(1)];
    this.root.add(body, this.head, ...this.wings);
    // only the body casts a shadow: at this size the rest is a pixel or two, and each caster is another draw call
    body.castShadow = true;
    this.setWings('folded');
  }

  /** Hold a wing frame. Folded wings tuck in along the back. */
  setWings(f: WingFrame): void {
    this.frame = f;
    const a = WING_ANGLE[f];
    const fold = f === 'folded';
    this.wings[0].rotation.z = -a;
    this.wings[1].rotation.z = a;
    for (const [i, wg] of this.wings.entries()) {
      wg.scale.x = fold ? 0.25 : 1;
      wg.position.x = (i ? 1 : -1) * LOOKS[this.species].body[0] * (fold ? 0.4 : 0.5);
    }
  }

  /** Dip the head (0 = up, 1 = right down to the ground). */
  setPeck(k: number): void {
    this.head.rotation.x = 1.1 * Math.max(0, Math.min(1, k));
  }

  /** The head's dip, for tests. */
  get peck(): number {
    return this.head.rotation.x / 1.1;
  }
}
