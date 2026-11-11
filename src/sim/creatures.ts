import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Materials } from '../render/materials';
import type { Rng } from '../core/rng';

/**
 * Cats and koi with a shape of their own (2026-11 animal review). The order that matters at ten
 * pixels: silhouette, the one feature that says what it is (two ears and a tail; a tapered body and
 * a fan tail), how it moves, then colour. Small rigs, like the birds': parts that never move apart
 * are one mesh with colours on the vertices, and everything shares one material.
 */

const shared = new WeakMap<Materials, THREE.Material>();
function creatureMaterial(m: Materials): THREE.Material {
  let mat = shared.get(m);
  if (!mat) shared.set(m, (mat = m.std('#ffffff', 0.85, { vertexColors: true })));
  return mat;
}

/** A coloured, placed piece of geometry (so pieces can merge). */
function tinted(g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = out.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.deleteAttribute('uv');
  return out;
}
const box = (w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry =>
  tinted(new THREE.BoxGeometry(w, h, d), color, x, y, z);

// ── Cats ────────────────────────────────────────────────────────────────────

export type CatPose = 'walk' | 'sit' | 'loaf' | 'sleep';

/** A cat's coat: its main colour, and a second for the tail tip, paws and a patch (or the same again). */
export interface Coat {
  main: string;
  second: string;
}

/**
 * A cat: a body, a head with two pointed ears, four paws, and a tail in two joints that swishes,
 * stands up when it walks and wraps round when it sleeps. +z is forward.
 */
export class CatRig {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly tip = new THREE.Group();
  private readonly paws: THREE.Mesh;
  pose: CatPose = 'walk';
  /** Seconds left of a stretch (on waking), and of a look around (the head turns). */
  stretch = 0;
  look = 0;
  private lookTo = 0;

  constructor(m: Materials, coat: Coat) {
    const mat = creatureMaterial(m);
    // the body, with a patch of the second colour over the shoulders
    this.body = new THREE.Mesh(mergeGeometries([box(0.24, 0.22, 0.56, coat.main, 0, 0.25, 0), box(0.245, 0.1, 0.2, coat.second, 0, 0.32, 0.1)]), mat);
    this.paws = new THREE.Mesh(
      mergeGeometries([
        box(0.07, 0.14, 0.08, coat.second, -0.08, 0.07, 0.2),
        box(0.07, 0.14, 0.08, coat.second, 0.08, 0.07, 0.2),
        box(0.07, 0.14, 0.08, coat.main, -0.08, 0.07, -0.2),
        box(0.07, 0.14, 0.08, coat.main, 0.08, 0.07, -0.2),
      ]),
      mat,
    );
    // the head, forward and a little up, with two ears that are triangles, not a bar
    this.head.position.set(0, 0.34, 0.32);
    const ear = (side: number) => {
      const g = new THREE.ConeGeometry(0.06, 0.12, 3);
      g.rotateY(Math.PI / 6);
      return tinted(g, coat.main, side * 0.075, 0.2, 0);
    };
    this.head.add(
      new THREE.Mesh(mergeGeometries([box(0.24, 0.2, 0.2, coat.main, 0, 0.06, 0), ear(-1), ear(1), box(0.1, 0.07, 0.05, coat.second, 0, 0.02, 0.11)]), mat),
    );
    // the tail: two joints from the rump
    this.tail.position.set(0, 0.32, -0.28);
    this.tail.add(new THREE.Mesh(box(0.07, 0.07, 0.24, coat.main, 0, 0, -0.12), mat));
    this.tip.position.set(0, 0, -0.24);
    this.tip.add(new THREE.Mesh(box(0.07, 0.07, 0.2, coat.second, 0, 0, -0.1), mat));
    this.tail.add(this.tip);
    this.root.add(this.body, this.paws, this.head, this.tail);
    this.body.castShadow = true;
  }

  /** Glance somewhere (an angle off straight ahead, radians) for a moment. */
  lookAround(angle: number, seconds = 1.6): void {
    this.lookTo = Math.max(-1.1, Math.min(1.1, angle));
    this.look = seconds;
  }

  /** Pose the parts. `moving`: the legs are carrying it. `still`: reduced motion (no idle swish). */
  update(dt: number, time: number, moving: boolean, still = false): void {
    const p = this.pose;
    this.stretch = Math.max(0, this.stretch - dt);
    this.look = Math.max(0, this.look - dt);
    const sw = still ? 0 : Math.sin(time * (moving ? 5 : 1.6) + this.root.id);
    // body: level when walking, front raised when sitting, flat and low when loafing or asleep
    const sit = p === 'sit';
    const low = p === 'loaf' || p === 'sleep';
    const k = this.stretch > 0 ? Math.sin((Math.PI * this.stretch) / 0.7) : 0;
    this.body.rotation.x = sit ? -0.5 : 0;
    this.body.position.y = sit ? 0.05 : low ? -0.12 : 0;
    this.body.scale.set(1, low ? 0.8 : 1 - 0.15 * k, 1 + 0.22 * k); // a stretch: long and low
    this.paws.visible = !low;
    this.paws.scale.y = sit ? 1 : 1;
    this.head.position.set(0, sit ? 0.5 : low ? 0.2 : 0.34, sit ? 0.2 : 0.32);
    this.head.rotation.set(p === 'sleep' ? 0.5 : 0, this.look > 0 ? this.lookTo * Math.sin((Math.PI * this.look) / 1.6) : p === 'sleep' ? 0.6 : 0, 0);
    // tail: up and swaying on the move, a slow swish sitting, wrapped round asleep
    this.tail.position.y = sit ? 0.12 : low ? 0.14 : 0.32;
    if (p === 'sleep') {
      this.tail.rotation.set(0, 1.5, 0);
      this.tip.rotation.set(0, 1.2, 0);
    } else if (p === 'walk') {
      this.tail.rotation.set(-0.9, sw * 0.18, 0);
      this.tip.rotation.set(-0.5, sw * 0.25, 0);
    } else {
      this.tail.rotation.set(0.1, 0.9 + sw * 0.35, 0);
      this.tip.rotation.set(0, 0.5 + sw * 0.4, 0);
    }
  }

  /** The tail's sideways angle, and the ears' count, for tests. */
  get tailYaw(): number {
    return this.tail.rotation.y;
  }
}

// ── Koi ─────────────────────────────────────────────────────────────────────

/** A koi's colours: body, the patches along its back, and its fins and tail. */
export interface KoiColors {
  body: string;
  patch: string;
  fin: string;
}

/** A koi from above: a body that tapers to the tail, patches along the back, two side fins, a fan tail that beats. +z is forward. */
export class KoiRig {
  readonly root = new THREE.Group();
  private readonly tail = new THREE.Group();

  constructor(m: Materials, c: KoiColors, patches: readonly number[]) {
    const mat = creatureMaterial(m);
    // the body tapers: broad shoulders, a narrow wrist before the tail
    const parts = [
      box(0.15, 0.06, 0.16, c.body, 0, 0, 0.12),
      box(0.17, 0.065, 0.16, c.body, 0, 0, -0.02),
      box(0.12, 0.055, 0.14, c.body, 0, 0, -0.16),
      box(0.07, 0.045, 0.1, c.body, 0, 0, -0.27),
      // side fins, swept back
      box(0.1, 0.012, 0.07, c.fin, -0.12, -0.01, 0.06),
      box(0.1, 0.012, 0.07, c.fin, 0.12, -0.01, 0.06),
    ];
    // broad patches on the back (a few big ones read; speckle would be noise at this size)
    for (const z of patches) parts.push(box(0.13, 0.012, 0.11, c.patch, 0, 0.036, z));
    const body = new THREE.Mesh(mergeGeometries(parts), mat);
    this.tail.position.z = -0.32;
    const fan = new THREE.ConeGeometry(0.1, 0.18, 3);
    fan.rotateX(-Math.PI / 2);
    fan.scale(1, 0.25, 1);
    this.tail.add(new THREE.Mesh(tinted(fan, c.fin, 0, 0, -0.07), mat));
    this.root.add(body, this.tail);
  }

  /** Beat the tail (faster the faster it swims). */
  beat(time: number, speed: number, phase: number, still = false): void {
    this.tail.rotation.y = still ? 0 : 0.45 * Math.sin(time * (3 + speed * 12) + phase);
  }
}

/** Is (x, z) inside the polygon? */
export function inPolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!,
      [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Distance from (x, z) to the polygon's nearest edge. */
export function edgeDistance(x: number, z: number, poly: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!,
      [bx, bz] = poly[i]!;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
  }
  return best;
}

/** The water a koi may swim in: the pond, a margin in from its banks, and round the islet. */
export interface Water {
  pond: readonly (readonly [number, number])[];
  islet: { x: number; z: number; r: number };
  /** Keep this far from the bank and the islet (m). */
  margin: number;
  /** No further north than this (the stream's arm is too narrow to turn in). */
  zMin: number;
}
export const swimmable = (x: number, z: number, w: Water): boolean =>
  z > w.zMin && inPolygon(x, z, w.pond) && edgeDistance(x, z, w.pond) > w.margin && Math.hypot(x - w.islet.x, z - w.islet.z) > w.islet.r + w.margin;

export interface KoiState {
  x: number;
  z: number;
  heading: number;
  /** Where it is making for, and how long until it thinks of somewhere else (s). */
  tx: number;
  tz: number;
  think: number;
  /** A pause near the surface (s left). */
  rise: number;
}

/** Somewhere in the water to make for (tries a few random points; stays put if none is good). */
function pickTarget(k: KoiState, w: Water, rng: Rng): void {
  const xs = w.pond.map((p) => p[0]),
    zs = w.pond.map((p) => p[1]);
  for (let i = 0; i < 12; i++) {
    const x = rng.range(Math.min(...xs), Math.max(...xs)),
      z = rng.range(Math.max(w.zMin, Math.min(...zs)), Math.max(...zs));
    if (swimmable(x, z, w)) {
      k.tx = x;
      k.tz = z;
      return;
    }
  }
}

/**
 * One step of a koi's swim: turn toward where it's going at a fish's turning rate, glide forward,
 * and never leave the water: if the way ahead is bank or islet, it turns toward open water instead
 * (and thinks of somewhere else). `pace` scales its speed (winter and night are slow). Pure.
 */
export function swim(k: KoiState, dt: number, w: Water, rng: Rng, pace = 1): number {
  k.think -= dt;
  if (k.rise > 0) {
    k.rise -= dt;
    return 0;
  }
  if (k.think <= 0 || Math.hypot(k.tx - k.x, k.tz - k.z) < 0.3) {
    pickTarget(k, w, rng);
    k.think = rng.range(6, 18);
    if (rng.chance(0.15)) k.rise = rng.range(1.5, 4); // hangs at the surface a moment
  }
  const want = Math.atan2(k.tx - k.x, k.tz - k.z);
  let turn = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
  const speed = 0.32 * pace;
  // feel ahead: bank or islet in the way means turn (toward whichever side is open), and re-think soon
  const ahead = (h: number, d: number) => swimmable(k.x + Math.sin(h) * d, k.z + Math.cos(h) * d, w);
  if (!ahead(k.heading, 0.45)) {
    turn = ahead(k.heading + 0.9, 0.45) ? 2 : ahead(k.heading - 0.9, 0.45) ? -2 : 2.5;
    k.think = Math.min(k.think, 0.8);
  }
  const maxTurn = 1.6 * dt;
  k.heading += Math.max(-maxTurn, Math.min(maxTurn, turn));
  const nx = k.x + Math.sin(k.heading) * speed * dt,
    nz = k.z + Math.cos(k.heading) * speed * dt;
  // the last word: it does not leave the water (it turns on the spot until the way is clear)
  if (swimmable(nx, nz, w)) {
    k.x = nx;
    k.z = nz;
    return speed;
  }
  return 0;
}
