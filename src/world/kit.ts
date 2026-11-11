import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { Materials } from '../render/materials';
import type { Vec2 } from '../core/math';
import type { TreeKind } from './layout';
import type { SignSpec } from '../render/glyphs';
import { weatherAttributes, type DripSource } from './weathering';
import type { WindowGeom, WindowKind } from './lighting';

/** One building's weathering: `age` 0 (fresh) .. 1 (decades of rain); `moss` 0..1 lets stone grow it. */
export interface WeatherScope {
  age: number;
  moss?: number;
}

/** Weathered faces are subdivided to about this size so stains can sit under a single window. */
const WEATHER_CELL = 1;
const segs = (len: number) => Math.min(16, Math.max(1, Math.ceil(len / WEATHER_CELL)));

export type { WindowKind } from './lighting';

/** A window the lighting system can switch on/off by schedule. */
export interface WindowRef {
  mesh: THREE.Mesh;
  /** Shops (and the kissaten) light up during opening hours; homes in the evening. */
  kind: WindowKind;
  /** Per-window jitter so a street never switches on in unison. */
  offset: number;
  /** Stable index (occupancy and warmth hash from it). */
  index: number;
  /** Where the glass is and which way it faces (for its light spill). */
  geom: WindowGeom;
  /** Its ground spill in World's LightPools, if it has one. */
  pool?: number;
  /** Opening hours of the shop behind it (its shutter's), if it has one. */
  hours?: readonly [number, number];
}

/**
 * Geometry kit: every primitive the builders need, with consistent shadow
 * settings and shared materials. Builders stay declarative ("a 5 m shop with a
 * gable roof"), the kit knows how to make that out of triangles.
 */
export class Kit {
  readonly windows: WindowRef[] = [];
  readonly rng: Rng;
  /** Things that drip on the walls below them (sills, AC drains), gathered while building. */
  readonly drips: DripSource[] = [];
  private scope: WeatherScope | null = null;
  private readonly weatheredMeshes: { mesh: THREE.Mesh; age: number }[] = [];
  constructor(
    public root: THREE.Object3D,
    readonly m: Materials,
    seed = 7,
  ) {
    this.rng = new Rng(seed);
  }

  /**
   * Build into `group` instead of the root for the duration of `fn` (same rng stream, same order),
   * so one building's meshes can later be taken out and rebuilt on their own.
   */
  into(group: THREE.Object3D, fn: () => void): void {
    const root = this.root;
    root.add(group);
    this.root = group;
    try {
      fn();
    } finally {
      this.root = root;
    }
  }

  /** Let go of meshes taken out of the scene (a rebuilt shop): the kit no longer keeps them alive. */
  forget(objects: ReadonlySet<THREE.Object3D>): void {
    for (let i = this.weatheredMeshes.length - 1; i >= 0; i--) if (objects.has(this.weatheredMeshes[i]!.mesh)) this.weatheredMeshes.splice(i, 1);
  }

  add<T extends THREE.Object3D>(o: T, shadows = true): T {
    if (shadows)
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
    this.root.add(o);
    return o;
  }

  /**
   * Build everything in `fn` as one weathered structure. Its meshes get the
   * weathered material twin and, once the whole diorama exists, per-vertex
   * weathering attributes (`finishWeathering`).
   */
  weathering(scope: WeatherScope, fn: () => void): void {
    const prev = this.scope;
    this.scope = scope;
    try {
      fn();
    } finally {
      this.scope = prev;
    }
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z);
    // lamps, signs and patched materials (leaves, water) keep their own look
    if (this.scope && mat instanceof THREE.MeshStandardMaterial && mat.emissive.getHex() === 0 && !mat.transparent && !mat.userData.ownLook) {
      me.material = this.m.weathered(mat, this.scope.moss ?? 0);
      this.weatheredMeshes.push({ mesh: me, age: this.scope.age });
    }
    return this.add(me);
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const g = this.scope ? new THREE.BoxGeometry(w, h, d, segs(w), segs(h), segs(d)) : new THREE.BoxGeometry(w, h, d);
    return this.mesh(g, mat, x, y, z);
  }

  cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg, this.scope ? segs(h) : 1), mat, x, y, z);
  }

  /** Extrude a footprint polygon (x,z points) upward from y by h, optional holes. */
  prism(pts: readonly Vec2[], y: number, h: number, mat: THREE.Material, holes: readonly (readonly Vec2[])[] = []): THREE.Mesh {
    // weathered walls need vertices along their length, not just at the corners
    const ring = (p: readonly Vec2[]) => (this.scope ? densify(p) : p);
    const v = (p: Vec2) => new THREE.Vector2(p[0], -p[1]);
    const s = new THREE.Shape(ring(pts).map(v));
    for (const hp of holes) s.holes.push(new THREE.Path(ring(hp).map(v)));
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, steps: this.scope ? segs(h) : 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return this.mesh(g, mat);
  }

  private tri(d: number, h: number): THREE.Shape {
    return new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  }

  /** Gable roof, ridge along X. w = length along ridge, d = span. */
  gableX(w: number, d: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const g = new THREE.ExtrudeGeometry(this.tri(d, h), { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** Gable roof, ridge along Z. */
  gableZ(w: number, d: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const g = new THREE.ExtrudeGeometry(this.tri(d, h), { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    return this.mesh(g, mat, x, y, z);
  }

  /** Asymmetric shed roof (kyosho jutaku signature): wedge wall + sloped slab. `hi` = high side. */
  shed(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    rise: number,
    hi: 'x0' | 'x1' | 'z0' | 'z1',
    wall: THREE.Material,
    roof: THREE.Material,
  ): void {
    if (hi === 'x0' || hi === 'x1') {
      const xh = hi === 'x0' ? x0 : x1;
      const xl = hi === 'x0' ? x1 : x0;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(xl, y), new THREE.Vector2(xh, y), new THREE.Vector2(xh, y + rise)]), {
        depth: z1 - z0,
        bevelEnabled: false,
      });
      g.translate(0, 0, z0);
      this.mesh(g, wall);
      const a = Math.atan2(rise, x1 - x0);
      const s = this.box(Math.hypot(x1 - x0, rise) + 0.6, 0.22, z1 - z0 + 0.5, roof, (x0 + x1) / 2, y + rise / 2 + 0.12, (z0 + z1) / 2);
      s.rotation.z = hi === 'x1' ? a : -a;
    } else {
      const zh = hi === 'z0' ? z0 : z1;
      const zl = hi === 'z0' ? z1 : z0;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-zl, y), new THREE.Vector2(-zh, y), new THREE.Vector2(-zh, y + rise)]), {
        depth: x1 - x0,
        bevelEnabled: false,
      });
      g.rotateY(Math.PI / 2);
      g.translate(x0, 0, 0);
      this.mesh(g, wall);
      const a = Math.atan2(rise, z1 - z0);
      const s = this.box(x1 - x0 + 0.5, 0.22, Math.hypot(z1 - z0, rise) + 0.6, roof, (x0 + x1) / 2, y + rise / 2 + 0.12, (z0 + z1) / 2);
      s.rotation.x = hi === 'z0' ? a : -a;
    }
  }

  plane(w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, ry: number): THREE.Mesh {
    const p = this.mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z);
    p.rotation.y = ry;
    p.receiveShadow = false;
    return p;
  }

  /**
   * A painted sign at native texel size, centred on (x,y,z) and facing `ry`
   * (0 faces +z). Receives shadows, casts none: it's paint on a board.
   */
  sign(spec: SignSpec, x: number, y: number, z: number, ry: number, glow = 0): THREE.Mesh {
    const s = this.m.sign(spec, glow);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), s.material);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    p.receiveShadow = true;
    this.root.add(p);
    return p;
  }

  /** Window with a dark frame. ry: 0 faces +z, PI faces -z, PI/2 faces +x, -PI/2 faces -x. */
  win(x: number, y: number, z: number, ry: number, w = 0.8, h = 1.1, kind: WindowKind = 'home'): THREE.Mesh {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.m.windowDark);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    this.root.add(p);
    this.windows.push({ mesh: p, kind, offset: this.rng.range(-1.2, 1.2), index: this.windows.length, geom: { x, y, z, ry, w, h } });
    // the sill sheds water down the wall below it
    if (this.scope) this.drips.push({ x, y: y - h / 2, z, r: w / 2, len: 1.4 + this.scope.age });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.22, h + 0.22), this.m.frame);
    f.position.copy(p.position);
    f.rotation.y = ry;
    f.translateZ(-0.015);
    this.root.add(f);
    return p;
  }

  ac(x: number, y: number, z: number, ry: number): void {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.34), this.m.solid('#dcd8cf', 0.6)));
    const fan = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.04), this.m.solid('#4b4f5a'));
    fan.position.set(0.12, 0, 0.18);
    g.add(fan);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.add(g);
    // condensate drips from the drain line: a long streak to the ground
    if (this.scope) this.drips.push({ x, y: y - 0.25, z, r: 0.2, len: 4 });
  }

  leafMat(kind: TreeKind): THREE.Material {
    const set = kind === 'sakura' ? this.m.leaves.sakura : kind === 'deciduous' ? this.m.leaves.deciduous : this.m.leaves.evergreen;
    return this.rng.pick(set);
  }

  blob(x: number, y: number, z: number, r: number, kind: TreeKind = 'evergreen'): THREE.Mesh {
    return this.mesh(new THREE.IcosahedronGeometry(r, 0), this.leafMat(kind), x, y, z);
  }

  /** Clustered-blob tree: reads as leafy canopy once dithered. */
  tree(x: number, z: number, r: number, kind: TreeKind, h: number, y0: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 6), this.m.solid('#45291b'));
    trunk.position.set(0, h / 2, 0);
    g.add(trunk);
    const n = Math.round(14 + r * 4);
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const e = this.rng.next();
      const rr = r * (0.3 + this.rng.next() * 0.6);
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.28 + this.rng.next() * 0.25), 0), this.leafMat(kind));
      b.position.set(Math.cos(a) * rr, h + r * 0.4 + e * r * 0.7, Math.sin(a) * rr);
      b.userData.canopy = true; // the sun comes through (komorebi)
      g.add(b);
    }
    g.position.set(x, y0, z);
    return this.add(g);
  }

  pot(x: number, z: number, y: number, r = 0.3): void {
    this.box(0.34, 0.3, 0.34, this.m.solid('#8a5634'), x, y + 0.15, z);
    this.blob(x, y + 0.46, z, r);
  }

  /**
   * Build a batch of small static props, then bake them into one mesh per material.
   * A street's worth of crates, pots and meters is otherwise one draw call each, in
   * both the main and the shadow pass. Meshes that must stay separate are left alone:
   * materials that read their own transform or carry their own look (swaying leaves,
   * signs, water, weathered walls) and windows the lighting swaps at runtime.
   */
  merged(fn: () => void): void {
    const n0 = this.root.children.length;
    fn();
    const added = this.root.children.slice(n0);
    this.root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const windows = new Set<THREE.Object3D>(this.windows.map((w) => w.mesh));
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const keep: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D): void => {
      // a group marked `apart` (a fixture that moves with its shop) is kept whole
      if (o.userData.apart) return void keep.push(o);
      const me = o as THREE.Mesh;
      if (!me.isMesh) {
        // lines, points, lights: kept as they are; groups and bare nodes are only containers
        if (!(o instanceof THREE.Group) && o.type !== 'Object3D') keep.push(o);
      } else {
        const mat = me.material;
        if (Array.isArray(mat) || mat.userData.ownLook || windows.has(me)) keep.push(me);
        else {
          const g = (me.geometry.index ? me.geometry.toNonIndexed() : me.geometry.clone()).applyMatrix4(
            new THREE.Matrix4().multiplyMatrices(toRoot, me.matrixWorld),
          );
          for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
          let list = buckets.get(mat);
          if (!list) buckets.set(mat, (list = []));
          list.push(g);
        }
      }
      for (const c of o.children) walk(c);
    };
    for (const top of added) walk(top);
    // survivors keep their world placement, then the originals go
    for (const o of keep) this.root.attach(o);
    for (const top of added) if (!keep.includes(top)) this.root.remove(top);
    for (const [mat, geos] of buckets) {
      const g = mergeGeometries(geos);
      if (!g) throw new Error('kit.merged: incompatible geometry');
      const me = new THREE.Mesh(g, mat);
      me.castShadow = me.receiveShadow = true;
      this.root.add(me);
    }
  }

  /**
   * Bake weathering attributes into every mesh built inside a weathering scope.
   * Run once, after everything (and every drip source) exists.
   */
  finishWeathering(): void {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const { mesh, age } of this.weatheredMeshes) {
      const g = mesh.geometry;
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      nm.getNormalMatrix(mesh.matrixWorld);
      const pos = new Float32Array(P.count * 3);
      const nrm = new Float32Array(P.count * 3);
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
        pos.set([v.x, v.y, v.z], i * 3);
        lo = Math.min(lo, v.y);
        hi = Math.max(hi, v.y);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        nrm.set([v.x, v.y, v.z], i * 3);
      }
      const a = weatherAttributes({ pos, nrm, baseY: lo, topY: hi, drips: this.drips });
      g.setAttribute('ao', new THREE.BufferAttribute(a.ao, 1));
      g.setAttribute('upFacing', new THREE.BufferAttribute(a.upFacing, 1));
      g.setAttribute('dripMask', new THREE.BufferAttribute(a.dripMask, 1));
      g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(P.count).fill(age), 1));
    }
  }

  /** Catenary wire as a 1px line: y = a*cosh((x-x0)/a)+c approximated by a parabola sag (visually identical at these spans). */
  wire(a: THREE.Vector3, b: THREE.Vector3, sag: number, mat: THREE.LineBasicMaterial): THREE.Vector3 {
    const pts: THREE.Vector3[] = [];
    const L = a.distanceTo(b);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const q = a.clone().lerp(b, t);
      q.y -= 4 * sag * L * t * (1 - t);
      pts.push(q);
    }
    this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    return pts[10]!;
  }
}

/** Insert points along each edge so no edge is longer than WEATHER_CELL. */
function densify(pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const n = segs(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}
