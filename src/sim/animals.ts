import * as THREE from 'three';
import { Rng, stream } from '../core/rng';
import type { EventBus, GameEvents } from '../core/events';
import type { Materials } from '../render/materials';
import { G, ISLET, POND, TG, TREES } from '../world/layout';
import { clamp } from '../core/math';
import { groundHeight } from '../world/terrain';
import type { NavGrid } from './grid';
import type { Agent } from './residents';
import type { SmartRegistry } from './smart';
import type { Season } from '../core/clock';
import { BirdRig, flapFrame, hopHeight } from './birds';
import { CatRig, KoiRig, swim, swimmable, type KoiState, type Water } from './creatures';

interface Cat {
  root: THREE.Group;
  rig: CatRig;
  path: [number, number][];
  idx: number;
  rest: number;
  sleeping: boolean;
  /** Stopped on the way to look about (s left). */
  pause: number;
  rng: Rng;
}

/** The cats' coats: main colour, and a second for the paws, the tail's tip and a patch. */
const COATS = [
  { main: '#ff9f5a', second: '#f6efe0' }, // ginger and white
  { main: '#2e2a42', second: '#f6efe0' }, // a tuxedo
  { main: '#f6efe0', second: '#ff9f5a' }, // white with ginger
  { main: '#b07a4c', second: '#653d27' }, // a tabby
  { main: '#686d78', second: '#adb2b8' }, // grey
] as const;

/** The koi: each a variety you could name (red on white, black on white, all gold...). */
const KOI = [
  { c: { body: '#f6efe0', patch: '#d0402a', fin: '#f6efe0' }, patches: [0.1, -0.12] },
  { c: { body: '#f6efe0', patch: '#16141f', fin: '#eef2f5' }, patches: [0.02] },
  { c: { body: '#ffa94d', patch: '#ffd37a', fin: '#ffd37a' }, patches: [0.06] },
  { c: { body: '#d0402a', patch: '#f6efe0', fin: '#ff6b3d' }, patches: [-0.1] },
  { c: { body: '#f6efe0', patch: '#ff6b3d', fin: '#f6efe0' }, patches: [0.12, 0, -0.16] },
  { c: { body: '#16141f', patch: '#ffa94d', fin: '#2e2a42' }, patches: [0.08, -0.14] },
] as const;
/** Where koi may swim: the pond's main body, in from its banks and round the islet (not up the narrow stream). */
const WATER: Water = { pond: POND, islet: ISLET, margin: 0.35, zMin: -0.9 };

interface Pigeon {
  rig: BirdRig;
  home: THREE.Vector3;
  fly: number; // 0 = grounded, >0 = seconds left in flight
  from: THREE.Vector3;
  to: THREE.Vector3;
  ph: number;
  /** Seconds to the next small thing (a peck, a turn, a step), and a peck under way (s left). */
  next: number;
  pecking: number;
}

/**
 * A tree sparrow: forages in hops (both feet together) near the shop street and the park edge, and
 * the flock goes up together when someone comes close.
 */
interface Sparrow {
  rig: BirdRig;
  /** A hop or a flight under way: from, to, how far (0..1), how long (s), how high (m). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  u: number;
  dur: number;
  arc: number;
  flying: boolean;
  next: number;
  pecking: number;
  /** Up in a tree for the night or out of the rain (hidden in the leaves), or on the way there. */
  roost: 'no' | 'going' | 'in';
}

/** Seconds a pigeon's flight takes, and a sparrow's (low and short). */
const PIGEON_FLIGHT = 2.2;
const SPARROW_FLIGHT = 0.9;
/** Where the sparrows forage: the lane by the shops, and the park's edge. */
const SPARROW_AREA = { x0: -8.6, x1: -3, z0: -3.4, z1: 8 };

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
  private readonly sleepers: CatRig[] = [];
  private readonly pigeons: Pigeon[] = [];
  private readonly koi: { rig: KoiRig; s: KoiState; ph: number; rng: Rng }[] = [];
  private readonly crows: { rig: BirdRig; r: number; ph: number }[] = [];
  private readonly sparrows: Sparrow[] = [];
  private readonly butterflies: { mesh: THREE.Mesh; c: THREE.Vector3; ph: number }[] = [];
  private readonly rng: Rng;
  private flapCooldown = 0;
  /** A cat has arrived where it was going and is settling down, at (x, z). */
  onCatSettles: ((x: number, z: number) => void) | null = null;

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
    COATS.forEach((coat, i) => {
      const rig = new CatRig(m, coat);
      const [x, z] = CAT_SPOTS[(i * 2) % CAT_SPOTS.length]!;
      rig.root.position.set(x, groundHeight(x, z), z);
      root.add(rig.root);
      this.cats.push({ root: rig.root, rig, path: [], idx: 0, rest: this.rng.range(2, 10), sleeping: false, pause: 0, rng: new Rng(((500 + i) ^ seed) >>> 0) });
    });
    // two cats that never move: one on the kissaten awning, one on the terrace wall
    for (const [x, y, z, coat, ry] of [
      [13.2, G + 3.08, 2.05, COATS[2], 1.2],
      [-3, TG + 0.05, -6.35, COATS[0], -0.6],
    ] as const) {
      const rig = new CatRig(m, coat);
      rig.pose = 'sleep';
      rig.root.position.set(x, y + 0.1, z);
      rig.root.rotation.y = ry;
      rig.update(0, 0, false);
      root.add(rig.root);
      this.sleepers.push(rig);
    }
    for (let i = 0; i < 7; i++) {
      const rig = new BirdRig('pigeon', m);
      const home = new THREE.Vector3(-3.2 + (i % 4) * 0.55, G, -1.4 + Math.floor(i / 4) * 0.5);
      rig.root.position.copy(home);
      rig.root.rotation.y = this.rng.range(0, Math.PI * 2);
      root.add(rig.root);
      this.pigeons.push({ rig, home: home.clone(), fly: 0, from: home.clone(), to: home.clone(), ph: i * 1.3, next: this.rng.range(0.5, 3), pecking: 0 });
    }
    for (let i = 0; i < 5; i++) {
      const rig = new BirdRig('sparrow', m);
      const x = this.rng.range(SPARROW_AREA.x0, SPARROW_AREA.x1),
        z = this.rng.range(-1, 3);
      const at = this.grid.nearestOpen(x, z, 3) ?? [x, z];
      rig.root.position.set(at[0], groundHeight(at[0], at[1]), at[1]);
      rig.root.rotation.y = this.rng.range(0, Math.PI * 2);
      root.add(rig.root);
      const p = rig.root.position.clone();
      this.sparrows.push({ rig, from: p.clone(), to: p, u: 1, dur: 0.25, arc: 0, flying: false, next: this.rng.range(0.3, 2), pecking: 0, roost: 'no' });
    }
    KOI.forEach((k, i) => {
      const rig = new KoiRig(m, k.c, k.patches);
      // a named stream each: neighbouring numeric seeds start out alike, and six koi would set off as a shoal
      const rng = stream(`animals/koi/${i}/${seed}`);
      // somewhere in the water to start (the pond's middle, failing all else)
      let x = 2.4,
        z = 3.6;
      for (let t = 0; t < 20; t++) {
        const tx = rng.range(-1, 6.5),
          tz = rng.range(-0.5, 5);
        if (swimmable(tx, tz, WATER)) {
          [x, z] = [tx, tz];
          break;
        }
      }
      root.add(rig.root);
      this.koi.push({ rig, s: { x, z, heading: rng.range(0, Math.PI * 2), tx: x, tz: z, think: 0, rise: 0 }, ph: i * 1.3, rng });
    });
    for (let i = 0; i < 3; i++) {
      const rig = new BirdRig('crow', m);
      root.add(rig.root);
      this.crows.push({ rig, r: 2.6 + i * 1.1, ph: i * 2.1 });
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
        c.rig.pose = 'walk';
        // a cat doesn't march: it stops on the way to look about
        if (c.pause > 0) {
          c.pause -= dt;
          c.rig.update(dt, time, false);
          continue;
        }
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
        if (s >= d) {
          c.idx++;
          if (c.idx >= c.path.length) this.onCatSettles?.(c.root.position.x, c.root.position.z);
          if (c.idx < c.path.length && c.rng.chance(0.3)) {
            c.pause = c.rng.range(1, 2.6);
            c.rig.lookAround(c.rng.range(-1, 1), c.pause);
          }
        }
        c.root.position.y = groundHeight(c.root.position.x, c.root.position.z) + Math.abs(Math.sin(time * 10)) * 0.02;
        c.rig.update(dt, time, true);
        continue;
      }
      c.rest -= dt;
      const was = c.sleeping;
      c.sleeping = night || rain > 0.6 || c.rest > 8;
      if (was && !c.sleeping) c.rig.stretch = 0.7; // waking: a long stretch first
      // asleep curled up; awake, sitting upright or tucked in a loaf (each cat has its way)
      c.rig.pose = c.sleeping ? 'sleep' : c.rig.pose === 'walk' ? (c.rng.chance(0.5) ? 'sit' : 'loaf') : c.rig.pose === 'sleep' ? 'sit' : c.rig.pose;
      c.root.position.y = groundHeight(c.root.position.x, c.root.position.z);
      c.root.scale.y = c.sleeping ? 1 + Math.sin(time * 1.5) * 0.04 : 1; // breathing
      c.rig.update(dt, time, false);
      if (c.rest <= 0) {
        // a cat person sitting out (Mitsuko): the cats come and settle near her, within 2 m
        const friend = agents.find((a) => a.p.catFriend && !a.hidden && a.arrived && a.pose === 'sit');
        let goal: [number, number] | null = null;
        if (friend && c.rng.chance(0.85)) {
          const ang = c.rng.range(0, Math.PI * 2),
            r = c.rng.range(0.8, 1.6);
          goal = this.grid.nearestOpen(friend.x + Math.cos(ang) * r, friend.z + Math.sin(ang) * r, 2);
        }
        const bowls = [...this.smart.objects.values()].filter((o) => o.kind === 'catbowl');
        goal ??= bowls.length && c.rng.chance(0.6) ? [bowls[0]!.x + c.rng.range(-0.5, 0.5), bowls[0]!.z + 0.5] : c.rng.pick(CAT_SPOTS);
        const p = this.grid.findPath(c.root.position.x, c.root.position.z, goal[0], goal[1]);
        c.path = p ?? [];
        c.idx = 1;
        // beside her, a cat stays a while
        c.rest = c.rng.range(8, 30) * (night ? 3 : 1) * (friend && Math.hypot(goal[0] - friend.x, goal[1] - friend.z) < 2 ? 2 : 1);
      }
    }
    for (const s of this.sleepers) s.root.scale.y = 1 + Math.sin(time * 1.4 + s.root.position.x) * 0.06;

    // pigeons: peck and potter about; scatter when someone walks within 1.4 m, land again elsewhere in the park
    for (const p of this.pigeons) {
      const r = p.rig;
      if (p.fly > 0) {
        p.fly -= dt;
        const t = 1 - p.fly / PIGEON_FLIGHT;
        r.root.position.lerpVectors(p.from, p.to, t);
        r.root.position.y += Math.sin(t * Math.PI) * 2.6;
        r.root.rotation.y = Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z);
        r.setWings(flapFrame('pigeon', PIGEON_FLIGHT - p.fly));
        r.setPeck(0);
        if (p.fly <= 0) r.setWings('folded');
        continue;
      }
      r.root.visible = !night;
      this.potter(p, dt);
      const near = agents.some((a) => !a.hidden && Math.hypot(a.x - r.root.position.x, a.z - r.root.position.z) < 1.4);
      if (near && !night) {
        const dest = this.grid.randomOpenIn(() => this.rng.next(), -7, 7, -3.4, 8) ?? [p.home.x, p.home.z];
        p.from.copy(r.root.position);
        p.to.set(dest[0], groundHeight(dest[0], dest[1]), dest[1]); // lands on the ground there, not at the plaza's height
        p.home.copy(p.to);
        p.fly = PIGEON_FLIGHT;
        if (this.flapCooldown <= 0) {
          this.bus.emit('sfx', { name: 'flap', x: p.from.x, z: p.from.z });
          this.flapCooldown = 1.5;
        }
      }
    }
    this.sparrowsUpdate(dt, night, rain, agents);
    // koi: each goes its own slow way about the pond, round the islet, never up a bank; slower at
    // night and slower still in winter (they don't vanish with the cold: they hang nearly still)
    const pace = (season === 'winter' ? 0.3 : 1) * (night ? 0.5 : 1);
    for (const k of this.koi) {
      const speed = swim(k.s, dt, WATER, k.rng, pace);
      k.rig.root.position.set(k.s.x, G + (k.s.rise > 0 ? 0.065 : 0.05), k.s.z);
      k.rig.root.rotation.y = k.s.heading;
      k.rig.beat(time, speed, k.ph);
    }
    // crows circle the sento chimney by day and gather at dusk
    for (const c of this.crows) {
      const a = time * 0.35 + c.ph;
      c.rig.root.position.set(this.chimney.x + Math.cos(a) * c.r, this.chimney.y + 1.4 + Math.sin(a * 1.7) * 0.8, this.chimney.z + Math.sin(a) * c.r);
      // facing along the circle (its tangent), wings beating and gliding in held frames
      c.rig.root.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      c.rig.setWings(flapFrame('crow', time + c.ph));
      c.rig.root.visible = !night && rain < 0.5;
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

  /** A grounded pigeon's small business: pecks, a turn by a step, a short walk-hop. Never a spin. */
  private potter(p: Pigeon, dt: number): void {
    const r = p.rig;
    p.next -= dt;
    if (p.pecking > 0) {
      p.pecking = Math.max(0, p.pecking - dt);
      r.setPeck(Math.sin((Math.PI * p.pecking) / 0.35));
    } else r.setPeck(0);
    r.root.position.y = groundHeight(r.root.position.x, r.root.position.z);
    if (p.next > 0) return;
    p.next = this.rng.range(0.6, 2.8);
    const roll = this.rng.next();
    if (roll < 0.5) p.pecking = 0.35;
    else if (roll < 0.8) r.root.rotation.y += this.rng.pick([-0.6, -0.3, 0.3, 0.6]);
    else {
      // a step or two forward, if the ground is open
      const yaw = r.root.rotation.y;
      const nx = r.root.position.x + Math.sin(yaw) * 0.18,
        nz = r.root.position.z + Math.cos(yaw) * 0.18;
      if (this.grid.isOpenAt(nx, nz)) r.root.position.set(nx, groundHeight(nx, nz), nz);
    }
  }

  /**
   * Sparrows: by day, in any season, out of heavy rain. They hop (never walk) and peck; when someone
   * comes within 1.2 m, that bird and the flock-mates near it go up together, low and short, and
   * land a few meters on.
   */
  private sparrowsUpdate(dt: number, night: boolean, rain: number, agents: readonly Agent[]): void {
    const out = !night && rain < 0.6;
    let startle: THREE.Vector3 | null = null;
    for (const b of this.sparrows) {
      const r = b.rig;
      if (b.u < 1) {
        b.u = Math.min(1, b.u + dt / b.dur);
        r.root.position.lerpVectors(b.from, b.to, b.u);
        r.root.position.y += hopHeight(b.u, b.arc);
        r.setWings(b.flying ? flapFrame('sparrow', b.u * b.dur) : 'folded');
        if (b.u >= 1) {
          r.setWings('folded');
          // into the leaves: out of sight until morning (or the rain eases)
          if (b.roost === 'going') {
            b.roost = 'in';
            r.root.visible = false;
          }
        }
        continue;
      }
      b.flying = false;
      if (b.roost === 'in') {
        // morning: down from the tree to the ground nearby
        if (out) {
          const dest = this.grid.randomOpenIn(() => this.rng.next(), SPARROW_AREA.x0, SPARROW_AREA.x1, SPARROW_AREA.z0, SPARROW_AREA.z1);
          if (dest) {
            b.roost = 'no';
            r.root.visible = true;
            this.launch(b, dest[0], dest[1], SPARROW_FLIGHT + this.rng.range(0.2, 0.6), 0.5, true);
          }
        }
        continue;
      }
      if (!out) {
        // night, or heavy rain: fly up into the nearest tree (never just vanish)
        const p0 = r.root.position;
        let tree = TREES[0]!,
          bd = Infinity;
        for (const t of TREES) {
          const d = Math.hypot(t.x - p0.x, t.z - p0.z);
          if (d < bd) [tree, bd] = [t, d];
        }
        b.roost = 'going';
        this.launch(
          b,
          tree.x,
          tree.z,
          SPARROW_FLIGHT + bd * 0.12 + this.rng.range(0, 0.4),
          0.6,
          true,
          (tree.y ?? groundHeight(tree.x, tree.z)) + tree.h + tree.r * 0.4,
        );
        continue;
      }
      if (b.pecking > 0) {
        b.pecking = Math.max(0, b.pecking - dt);
        r.setPeck(Math.sin((Math.PI * b.pecking) / 0.2));
      } else r.setPeck(0);
      const p = r.root.position;
      if (!startle && agents.some((a) => !a.hidden && Math.hypot(a.x - p.x, a.z - p.z) < 1.2)) startle = p.clone();
      b.next -= dt;
      if (b.next > 0) continue;
      b.next = this.rng.range(0.4, 1.6);
      if (this.rng.chance(0.45)) {
        b.pecking = 0.2;
        continue;
      }
      // a hop: a short arc, turning to face where it lands
      const yaw = r.root.rotation.y + this.rng.range(-1.2, 1.2);
      const d = this.rng.range(0.12, 0.3);
      const tx = clamp(p.x + Math.sin(yaw) * d, SPARROW_AREA.x0, SPARROW_AREA.x1),
        tz = clamp(p.z + Math.cos(yaw) * d, SPARROW_AREA.z0, SPARROW_AREA.z1);
      if (!this.grid.isOpenAt(tx, tz)) continue;
      this.launch(b, tx, tz, 0.22, 0.07, false);
    }
    if (!startle) return;
    // the flock goes up together: everyone grounded within 1.5 m of the startled bird
    for (const b of this.sparrows) {
      const p = b.rig.root.position;
      if (b.u < 1 || b.roost !== 'no' || Math.hypot(p.x - startle.x, p.z - startle.z) > 1.5) continue;
      const dest = this.grid.randomOpenIn(() => this.rng.next(), SPARROW_AREA.x0, SPARROW_AREA.x1, SPARROW_AREA.z0, SPARROW_AREA.z1);
      if (dest) this.launch(b, dest[0], dest[1], SPARROW_FLIGHT + this.rng.range(0, 0.25), 1.1, true);
    }
  }

  /** Start a hop or a flight to (x, z), landing on the ground there unless `toY` says otherwise (a branch). */
  private launch(b: Sparrow, x: number, z: number, dur: number, arc: number, flying: boolean, toY?: number): void {
    const p = b.rig.root.position;
    b.from.copy(p); // from where it is (the ground, or its branch)
    b.to.set(x, toY ?? groundHeight(x, z), z);
    b.u = 0;
    b.dur = dur;
    b.arc = arc;
    b.flying = flying;
    b.rig.root.rotation.y = Math.atan2(x - p.x, z - p.z);
    b.rig.setPeck(0);
  }

  /** The birds, for tests and the debug overlay. */
  get birds(): { pigeons: readonly BirdRig[]; sparrows: readonly BirdRig[]; crows: readonly BirdRig[] } {
    return { pigeons: this.pigeons.map((p) => p.rig), sparrows: this.sparrows.map((b) => b.rig), crows: this.crows.map((c) => c.rig) };
  }
}
