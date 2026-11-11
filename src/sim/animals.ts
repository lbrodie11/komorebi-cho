import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { EventBus, GameEvents } from '../core/events';
import type { Materials } from '../render/materials';
import { G, ISLET, TG } from '../world/layout';
import { groundHeight } from '../world/terrain';
import type { NavGrid } from './grid';
import type { Agent } from './residents';
import type { SmartRegistry } from './smart';
import type { Season } from '../core/clock';

interface Cat {
  root: THREE.Group;
  body: THREE.Mesh;
  path: [number, number][];
  idx: number;
  rest: number;
  sleeping: boolean;
  rng: Rng;
}

interface Pigeon {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  fly: number; // 0 = grounded, >0 = seconds left in flight
  from: THREE.Vector3;
  to: THREE.Vector3;
  ph: number;
}

/** Yanaka is "cat town": the cats are the real residents. */
const CAT_SPOTS: [number, number][] = [
  [-2.4, -1.9],
  [1.6, -2.1],
  [-6.2, 3.6],
  [6.2, 6.2],
  [12.2, 2.0],
  [-9.4, 5.2],
  [3.2, -8.0],
  [-12.8, -7.6],
  [8.9, 9.8],
  [-4.8, 9.8],
  [4.2, 2.0],
];

/**
 * Ambient life that isn't a person: cats (navigate the same grid, nap in warm
 * spots, find bowls), pigeons (scatter when someone walks through), koi,
 * crows around the chimney, butterflies by the flowers.
 */
export class Animals {
  private readonly cats: Cat[] = [];
  private readonly sleepers: THREE.Mesh[] = [];
  private readonly pigeons: Pigeon[] = [];
  private readonly koi: { mesh: THREE.Mesh; r: number; ph: number; sp: number }[] = [];
  private readonly crows: { mesh: THREE.Mesh; r: number; ph: number }[] = [];
  private readonly butterflies: { mesh: THREE.Mesh; c: THREE.Vector3; ph: number }[] = [];
  private readonly rng: Rng;
  private flapCooldown = 0;

  constructor(
    root: THREE.Object3D,
    m: Materials,
    private readonly grid: NavGrid,
    private readonly smart: SmartRegistry,
    private readonly bus: EventBus<GameEvents>,
    private readonly chimney: THREE.Vector3,
    seed = 0,
  ) {
    this.rng = new Rng((31337 ^ seed) >>> 0);
    const catColors = ['#ff9f5a', '#2e2a42', '#f6efe0', '#b07a4c', '#686d78'];
    catColors.forEach((c, i) => {
      const mat = m.solid(c, 0.85);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.32), mat);
      body.position.y = 0.2;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mat);
      head.position.set(0, 0.3, 0.38);
      const ears = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.06), mat);
      ears.position.set(0, 0.47, 0.38);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.38), mat);
      tail.position.set(0, 0.3, -0.42);
      tail.rotation.x = -0.6;
      g.add(body, head, ears, tail);
      body.scale.set(0.55, 1, 1.9);
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
      const [x, z] = CAT_SPOTS[(i * 2) % CAT_SPOTS.length]!;
      g.position.set(x, groundHeight(x, z), z);
      root.add(g);
      this.cats.push({ root: g, body, path: [], idx: 0, rest: this.rng.range(2, 10), sleeping: false, rng: new Rng(((500 + i) ^ seed) >>> 0) });
    });
    // two cats that never move: one on the kissaten awning, one on the terrace wall
    for (const [x, y, z, c] of [
      [13.2, G + 3.08, 2.05, '#f6efe0'],
      [-3, TG + 0.05, -6.35, '#ff9f5a'],
    ] as const) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.36), m.solid(c));
      s.position.set(x, y + 0.11, z);
      s.castShadow = true;
      root.add(s);
      this.sleepers.push(s);
    }
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.18), m.solid(i % 3 ? '#8a8f99' : '#686d78'));
      const home = new THREE.Vector3(-3.2 + (i % 4) * 0.55, G + 0.2, -1.4 + Math.floor(i / 4) * 0.5);
      mesh.position.copy(home);
      mesh.castShadow = true;
      root.add(mesh);
      this.pigeons.push({ mesh, home: home.clone(), fly: 0, from: home.clone(), to: home.clone(), ph: i * 1.3 });
    }
    ['#ff6b3d', '#f6efe0', '#d0402a', '#ffa94d', '#f6efe0', '#ff6b3d'].forEach((c, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.14), m.solid(c));
      root.add(mesh);
      this.koi.push({ mesh, r: 1.2 + i * 0.22, ph: i * 1.3, sp: 0.22 + i * 0.04 });
    });
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.25), m.solid('#16141f'));
      root.add(mesh);
      this.crows.push({ mesh, r: 2.6 + i * 1.1, ph: i * 2.1 });
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), m.solid(i % 2 ? '#fff1c4' : '#f6efe0'));
      root.add(mesh);
      const c = i < 2 ? new THREE.Vector3(-9, G + 1.2, 4.7) : new THREE.Vector3(13, G + 1, 7.6);
      this.butterflies.push({ mesh, c, ph: i * 1.7 });
    }
  }

  update(dt: number, time: number, hour: number, rain: number, season: Season, agents: readonly Agent[]): void {
    const night = hour > 20 || hour < 5.5;
    this.flapCooldown -= dt;
    // cats
    for (const c of this.cats) {
      if (c.path.length && c.idx < c.path.length) {
        const [tx, tz] = c.path[c.idx]!;
        const dx = tx - c.root.position.x,
          dz = tz - c.root.position.z;
        const d = Math.hypot(dx, dz);
        const s = Math.min(d, dt * 0.9);
        if (d > 1e-3) {
          c.root.position.x += (dx / d) * s;
          c.root.position.z += (dz / d) * s;
          c.root.rotation.y = Math.atan2(dx, dz);
        }
        if (s >= d) c.idx++;
        c.root.position.y = groundHeight(c.root.position.x, c.root.position.z) + Math.abs(Math.sin(time * 10)) * 0.02;
        c.root.scale.y = 1;
        continue;
      }
      c.rest -= dt;
      c.sleeping = night || rain > 0.6 || c.rest > 8;
      c.root.scale.y = c.sleeping ? 0.75 + Math.sin(time * 1.5) * 0.03 : 1;
      if (c.rest <= 0) {
        const bowls = [...this.smart.objects.values()].filter((o) => o.kind === 'catbowl');
        const goal: [number, number] = bowls.length && c.rng.chance(0.6) ? [bowls[0]!.x + c.rng.range(-0.5, 0.5), bowls[0]!.z + 0.5] : c.rng.pick(CAT_SPOTS);
        const p = this.grid.findPath(c.root.position.x, c.root.position.z, goal[0], goal[1]);
        c.path = p ?? [];
        c.idx = 1;
        c.rest = c.rng.range(8, 30) * (night ? 3 : 1);
      }
    }
    for (const s of this.sleepers) s.scale.y = 1 + Math.sin(time * 1.4 + s.position.x) * 0.08;

    // pigeons: scatter when someone walks within 1.4 m, land again elsewhere in the park
    for (const p of this.pigeons) {
      if (p.fly > 0) {
        p.fly -= dt;
        const t = 1 - p.fly / 2.2;
        p.mesh.position.lerpVectors(p.from, p.to, t);
        p.mesh.position.y += Math.sin(t * Math.PI) * 2.6;
        p.mesh.scale.x = 0.6 + Math.abs(Math.sin(time * 22)) * 1.2;
        if (p.fly <= 0) p.mesh.scale.x = 1;
        continue;
      }
      p.mesh.position.y = p.home.y + Math.max(0, Math.sin(time * 3 + p.ph)) * 0.08;
      p.mesh.rotation.y = Math.sin(time * 0.5 + p.ph) * 2;
      p.mesh.visible = !night;
      const near = agents.some((a) => !a.hidden && Math.hypot(a.x - p.mesh.position.x, a.z - p.mesh.position.z) < 1.4);
      if (near && !night) {
        const dest = this.grid.randomOpenIn(() => this.rng.next(), -7, 7, -3.4, 8) ?? [p.home.x, p.home.z];
        p.from.copy(p.mesh.position);
        p.to.set(dest[0], G + 0.2, dest[1]);
        p.home.copy(p.to);
        p.fly = 2.2;
        if (this.flapCooldown <= 0) {
          this.bus.emit('sfx', { name: 'flap', x: p.from.x, z: p.from.z });
          this.flapCooldown = 1.5;
        }
      }
    }
    // koi circle the pond (skipping under the islet is fine: they're fish)
    for (const k of this.koi) {
      const a = time * k.sp + k.ph;
      k.mesh.position.set(2.4 + Math.cos(a) * k.r * 1.25, G + 0.05, 2.1 + Math.sin(a) * k.r * 0.95);
      k.mesh.rotation.y = -a - Math.PI / 2;
      const nearIslet = Math.hypot(k.mesh.position.x - ISLET.x, k.mesh.position.z - ISLET.z) < ISLET.r;
      k.mesh.visible = !nearIslet && season !== 'winter';
    }
    // crows circle the sento chimney by day and gather at dusk
    for (const c of this.crows) {
      const a = time * 0.35 + c.ph;
      c.mesh.position.set(this.chimney.x + Math.cos(a) * c.r, this.chimney.y + 1.4 + Math.sin(a * 1.7) * 0.8, this.chimney.z + Math.sin(a) * c.r);
      c.mesh.rotation.y = -a;
      c.mesh.scale.x = 0.6 + Math.abs(Math.sin(time * 6 + c.ph)) * 0.6;
      c.mesh.visible = !night && rain < 0.5;
    }
    // butterflies over the flower stall and the allotment
    const bugs = (season === 'spring' || season === 'summer') && !night && rain < 0.2;
    for (const b of this.butterflies) {
      b.mesh.visible = bugs;
      if (!bugs) continue;
      const t = time * 0.8 + b.ph;
      b.mesh.position.set(b.c.x + Math.sin(t) * 1.2, b.c.y + Math.sin(t * 2.3) * 0.4, b.c.z + Math.cos(t * 0.7) * 1.4);
      b.mesh.scale.x = 0.4 + Math.abs(Math.sin(time * 18 + b.ph)) * 0.8;
    }
  }
}
