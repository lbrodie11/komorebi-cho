import * as THREE from 'three';
import { Rng } from '../core/rng';
import { clamp, damp } from '../core/math';
import type { Season } from '../core/clock';
import type { Materials } from '../render/materials';
import { G, ISLET, POND, TREES, type TreeKind } from './layout';
import { pointInPolygon } from '../core/math';
import { groundHeight } from './terrain';

/** Where falling petals and leaves come from: each tree's canopy (centre and radius). */
export interface Canopy {
  x: number;
  y: number;
  z: number;
  r: number;
  kind: TreeKind;
}
export const CANOPIES: readonly Canopy[] = TREES.map((t) => ({ x: t.x, y: (t.y ?? G) + t.h + t.r * 0.75, z: t.z, r: t.r * 0.8, kind: t.kind }));

type AirMode = 'none' | 'sky' | 'spring' | 'autumn';

export type WeatherMode = 'auto' | 'clear' | 'rain';

/**
 * Weather is a slow state machine (clear <-> rain) with lagging wetness:
 * rain starts softly, streets darken over minutes, and stay shiny after it
 * stops. Precipitation type follows the season (rain / snow), and seasonal
 * "air" particles (sakura petals, autumn leaves, summer fireflies) drift through.
 */
export class Weather {
  mode: WeatherMode = 'auto';
  /** 0..1 current precipitation intensity. */
  rain = 0;
  /** 0..1 surfaces wetness, lags `rain`. */
  wetness = 0;
  readonly wind = new THREE.Vector2();
  /** Reduced motion: falling petals, leaves and snow drop straight, without drift. */
  still = false;
  private target = 0;
  private timer = 90;
  private readonly rng: Rng;
  /** Petals and leaves draw from their own stream, so they never shift the weather's timing. */
  private readonly airRng: Rng;
  private airMode: AirMode = 'none';
  /** Per particle: the ground it lands on. */
  private readonly airGround: Float32Array;

  private readonly rainGeo: THREE.BufferGeometry;
  private readonly rainLines: THREE.LineSegments;
  private readonly airGeo: THREE.BufferGeometry;
  private readonly air: THREE.Points;
  private readonly airMat: THREE.PointsMaterial;
  private readonly fliesGeo: THREE.BufferGeometry;
  private readonly flies: THREE.Points;
  private readonly ripples: { mesh: THREE.Mesh; t: number }[] = [];
  private readonly puddles: THREE.Mesh[] = [];
  private readonly RN = 1200;
  private readonly AN = 500;
  private readonly FN = 40;

  constructor(
    root: THREE.Object3D,
    private readonly m: Materials,
    seed = 0,
  ) {
    this.rng = new Rng((4242 ^ seed) >>> 0);
    this.airRng = new Rng((4243 ^ seed) >>> 0);
    this.airGround = new Float32Array(this.AN).fill(G + 0.2);
    const r = this.rng;
    const rp = new Float32Array(this.RN * 6);
    for (let i = 0; i < this.RN; i++) {
      const x = r.range(-16, 16),
        y = r.range(0, 20),
        z = r.range(-12, 12);
      rp.set([x, y, z, x - 0.05, y - 0.7, z], i * 6);
    }
    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainLines = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: '#86aed4' }));
    this.rainLines.frustumCulled = false;
    root.add(this.rainLines);

    const ap = new Float32Array(this.AN * 3);
    for (let i = 0; i < this.AN; i++) ap.set([r.range(-16, 16), r.range(0, 16), r.range(-12, 12)], i * 3);
    this.airGeo = new THREE.BufferGeometry();
    this.airGeo.setAttribute('position', new THREE.BufferAttribute(ap, 3));
    this.airMat = new THREE.PointsMaterial({ color: '#f4c7cf', size: 2, sizeAttenuation: false });
    this.air = new THREE.Points(this.airGeo, this.airMat);
    this.air.frustumCulled = false;
    root.add(this.air);

    const fp = new Float32Array(this.FN * 3);
    const fc = new Float32Array(this.FN * 3);
    for (let i = 0; i < this.FN; i++) {
      const a = r.range(0, Math.PI * 2),
        d = r.range(1, 5);
      fp.set([2.4 + Math.cos(a) * d * 1.3, G + r.range(0.3, 1.8), 2.2 + Math.sin(a) * d], i * 3);
    }
    this.fliesGeo = new THREE.BufferGeometry();
    this.fliesGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.fliesGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    this.flies = new THREE.Points(this.fliesGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    this.flies.frustumCulled = false;
    root.add(this.flies);

    const ringMat = new THREE.MeshBasicMaterial({ color: '#c4dcee', transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 12), ringMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      root.add(mesh);
      this.ripples.push({ mesh, t: r.range(0, 1) });
    }
    const puddleMat = m.puddle;
    for (const [x, z, w, d] of [
      [-6, -4.6, 2.2, 0.9],
      [4, -5.2, 1.6, 0.7],
      [-9.4, 3, 0.8, 1.8],
      [-9, 9.8, 1, 1.4],
      [12, -4.4, 1.8, 0.8],
      [9.1, 6, 0.9, 1.5],
    ] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(x, G + 0.05, z);
      p.visible = false;
      root.add(p);
      this.puddles.push(p);
    }
  }

  setMode(mode: WeatherMode): void {
    this.mode = mode;
    if (mode === 'clear') this.target = 0;
    if (mode === 'rain') this.target = 1;
  }

  /**
   * Place air particle `i`. Snow starts in the sky; petals and leaves start inside a canopy of
   * the right kind of tree (bigger canopies drop more). `midFall` scatters it down its fall path.
   */
  private spawnAir(a: Float32Array, i: number, mode: AirMode, midFall: boolean): void {
    const r = this.airRng;
    if (mode === 'spring' || mode === 'autumn') {
      const kinds: readonly TreeKind[] = mode === 'spring' ? ['sakura'] : ['sakura', 'deciduous'];
      const c = pickCanopy(r.next(), kinds);
      const x = c.x + r.range(-1, 1) * c.r,
        z = c.z + r.range(-1, 1) * c.r;
      const ground = groundHeight(x, z) + 0.05;
      const top = c.y + r.range(-0.5, 0.5) * c.r;
      a.set([x, midFall ? r.range(ground, top) : top, z], i * 3);
      this.airGround[i] = ground;
    } else {
      const y = midFall ? r.range(0, 16) : 15 + r.range(0, 1);
      a.set([r.range(-16, 14), y, r.range(-12, 12)], i * 3);
      this.airGround[i] = G + 0.2;
    }
  }

  update(dt: number, gameMinutes: number, time: number, hour: number, season: Season): void {
    if (this.mode === 'auto') {
      this.timer -= gameMinutes;
      if (this.timer <= 0) {
        const raining = this.target > 0.5;
        this.target = raining ? 0 : this.rng.chance(0.55) ? this.rng.range(0.5, 1) : 0;
        this.timer = raining ? this.rng.range(180, 420) : this.rng.range(40, 120);
      }
    }
    // rain eases in/out over in-world minutes, wetness lags behind (dries ~20 min)
    this.rain = damp(this.rain, this.target, 0.06, gameMinutes + dt * 0.5);
    const wetGoal = Math.max(this.rain, this.wetness - gameMinutes / 20);
    this.wetness = clamp(this.rain > this.wetness ? damp(this.wetness, this.rain, 0.05, gameMinutes) : wetGoal, 0, 1);
    // Snow isn't rain: no mirror-like roads, no puddles, no soaked walls while it settles.
    // (Wetness still accrues, so a thaw into spring leaves the streets wet, as melt would.)
    const wetLook = season === 'winter' ? 0 : this.wetness;
    this.m.setWetness(wetLook);
    for (const p of this.puddles) p.visible = wetLook > 0.35;
    this.wind.set(time * 0.02 + Math.sin(time * 0.05) * 0.4, time * 0.012);

    const snow = season === 'winter';
    // rain streaks
    this.rainLines.visible = !snow && this.rain > 0.05;
    if (this.rainLines.visible) {
      const a = this.rainGeo.attributes.position!.array as Float32Array;
      const n = Math.floor(this.RN * this.rain);
      for (let i = 0; i < n; i++) {
        let y = a[i * 6 + 1]! - dt * 17;
        if (y < 0.5) y += 20;
        a[i * 6 + 1] = y;
        a[i * 6 + 4] = y - 0.7;
      }
      this.rainGeo.setDrawRange(0, n * 2);
      this.rainGeo.attributes.position!.needsUpdate = true;
    }
    // seasonal air particles: snow from the sky; petals and leaves from the trees that drop them
    let count = 0,
      speed = 0.9,
      color = '#f4c7cf',
      mode: AirMode = 'none';
    if (snow) {
      count = Math.floor(80 + this.rain * 420);
      speed = 1.5;
      color = '#eef2f5';
      mode = 'sky';
    } else if (season === 'spring') {
      count = 40;
      speed = 0.55;
      mode = 'spring';
    } else if (season === 'autumn') {
      count = 36;
      color = '#ffa94d';
      speed = 0.75;
      mode = 'autumn';
    }
    const a = this.airGeo.attributes.position!.array as Float32Array;
    if (mode !== this.airMode) {
      // a new season: scatter every particle along its fall, so the change doesn't arrive as one wave
      this.airMode = mode;
      for (let i = 0; i < this.AN; i++) this.spawnAir(a, i, mode, true);
    }
    this.air.visible = count > 0;
    if (count > 0) {
      this.airMat.color.set(color);
      const fromTrees = mode !== 'sky';
      for (let i = 0; i < count; i++) {
        const y = a[i * 3 + 1]! - dt * speed;
        if (this.still) {
          // reduced motion: particles fall straight down, no drift or flutter
          if (y < this.airGround[i]!) this.spawnAir(a, i, mode, false);
          else a[i * 3 + 1] = y;
          continue;
        }
        a[i * 3] = a[i * 3]! + Math.sin(time * 0.9 + i) * dt * 0.7 + dt * 0.3;
        if (fromTrees) {
          // flutter: leaves rock side to side as they fall
          a[i * 3] = a[i * 3]! + Math.sin(time * 2.3 + i * 1.7) * dt * 0.5;
          a[i * 3 + 2] = a[i * 3 + 2]! + Math.cos(time * 0.7 + i * 1.3) * dt * 0.3;
        }
        if (y < this.airGround[i]! || a[i * 3]! > 16.5) this.spawnAir(a, i, mode, false);
        else a[i * 3 + 1] = y;
      }
      this.airGeo.setDrawRange(0, count);
      this.airGeo.attributes.position!.needsUpdate = true;
    }
    // fireflies: summer nights by the pond (HDR colour so the glow pass picks them up)
    const fliesOn = season === 'summer' && (hour > 19.4 || hour < 3) && this.rain < 0.3;
    this.flies.visible = fliesOn;
    if (fliesOn) {
      const p = this.fliesGeo.attributes.position!.array as Float32Array;
      const c = this.fliesGeo.attributes.color!.array as Float32Array;
      for (let i = 0; i < this.FN; i++) {
        p[i * 3] = p[i * 3]! + Math.sin(time * 0.7 + i * 1.7) * dt * 0.4;
        p[i * 3 + 1] = p[i * 3 + 1]! + Math.cos(time * 0.9 + i) * dt * 0.15;
        p[i * 3 + 2] = p[i * 3 + 2]! + Math.cos(time * 0.6 + i * 2.3) * dt * 0.4;
        const b = Math.max(0, Math.sin(time * 1.3 + i * 2.1)) ** 3 * 4;
        c.set([b * 1.1, b * 1.25, b * 0.4], i * 3);
      }
      this.fliesGeo.attributes.position!.needsUpdate = true;
      this.fliesGeo.attributes.color!.needsUpdate = true;
    }
    // ripples on the pond while it rains
    for (const r of this.ripples) {
      r.t += dt * 1.4;
      if (r.t > 1) {
        r.t = 0;
        let x = 0,
          z = 0;
        for (let tries = 0; tries < 8; tries++) {
          x = this.rng.range(-1, 6.6);
          z = this.rng.range(-1.2, 5.2);
          if (pointInPolygon(x, z, POND) && Math.hypot(x - ISLET.x, z - ISLET.z) > ISLET.r + 0.2) break;
        }
        r.mesh.position.set(x, G + 0.06, z);
      }
      r.mesh.visible = !snow && this.rain > 0.15;
      r.mesh.scale.setScalar(0.4 + r.t * 2.2);
    }
  }
}

/** Choose a canopy of one of `kinds`, weighted by canopy area. `u` is uniform in [0, 1). */
export function pickCanopy(u: number, kinds: readonly TreeKind[]): Canopy {
  const pool = CANOPIES.filter((c) => kinds.includes(c.kind));
  const total = pool.reduce((s, c) => s + c.r * c.r, 0);
  let t = u * total;
  for (const c of pool) {
    t -= c.r * c.r;
    if (t < 0) return c;
  }
  return pool[pool.length - 1]!;
}
