import * as THREE from 'three';
import { ANCHOR_CLEAR, dropPoles, poleSpans, routeDrop } from './grammar/wires';
import { townRoofs, type RoofBox } from './grammar/footprints';
import type { Kit } from './kit';
import type { Materials } from '../render/materials';
import {
  BENCHES,
  DOORSTEP_POT_OWNERS,
  DOORSTEP_POTS,
  DOWNPIPES,
  G,
  GARBAGE_POINT,
  HOSE_REELS,
  MAILBOX,
  METERS,
  MILK_CRATES,
  PARK_LAMPS,
  POLES,
  DROPS,
  ROAD_MIRRORS,
  SHOPS,
  TG,
  type ShopAnchor,
  UMBRELLA_STANDS,
  VENDING,
} from './layout';
import { stream } from '../core/rng';
import { EMISSIVE } from './lighting';
import { buildShapes, CATALOGUE, type CatalogueItem, type CatalogueKind, type Category, type Shape } from './catalogue';
import { groundHeight } from './terrain';

export interface LightRef {
  light: THREE.PointLight;
  base: number;
  /** Share of `base` after clustering (see crowd.ts); 1 for fixed lights. */
  crowd?: number;
}

export interface PropsOut {
  lights: LightRef[];
  /** Pre-allocated lights for player-placed lanterns/vending machines. A constant light count means
   *  three.js never recompiles shaders when the player places something (no hitch). */
  lightPool: LightRef[];
  swings: THREE.Object3D[];
  flags: THREE.Mesh[];
  /** Where each streetlamp's light lands (ground pool centre and radius). */
  lampPools: { x: number; z: number; r: number }[];
  /** Shop-front fixtures, each in its own group, that move with their shop (prompt 06 phase C). */
  shopFollowers: ShopFollower[];
  /** The service drops to the shop-houses: re-routed when a shop moves (`routeDrops`). */
  shopDrops: THREE.Group;
}

/** A fixture on a shop-house front, and the nav obstacles it carries with it. */
export interface ShopFollower {
  anchor: ShopAnchor;
  group: THREE.Object3D;
  obstacles: { x: number; z: number; r: number }[];
}

const SHOP_IDS = new Set(SHOPS.map((s) => s.id));

/** Service drops: each hangs from its nearest pole, held up by an anchor bracket where it would pass through a roof. */
export function routeDrops(k: Kit, drops: readonly { x: number; y: number; z: number }[], roofs: RoofBox[], wireMat: THREE.LineBasicMaterial): void {
  const poleM = k.m.solid('#8a8f99');
  const owners = dropPoles(
    drops.map((d) => [d.x, d.z] as const),
    POLES,
  );
  drops.forEach((d, i) => {
    const p = owners[i]!;
    if (p < 0) return;
    const route = routeDrop([POLES[p]![0], G + 7.2, POLES[p]![1]], [d.x, d.y, d.z], roofs);
    for (let j = 0; j + 1 < route.length; j++) k.wire(new THREE.Vector3(...route[j]!), new THREE.Vector3(...route[j + 1]!), 0.05, wireMat);
    for (const [x, y, z] of route.slice(1, -1)) k.cyl(0.03, 0.03, ANCHOR_CLEAR + 0.2, poleM, x, y - (ANCHOR_CLEAR + 0.2) / 2, z, 4);
  });
}

function benchMesh(m: Materials): THREE.Group {
  const g = new THREE.Group();
  const wood = m.solid('#8a5634');
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), wood);
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.06), wood);
  back.position.set(0, 0.75, -0.22);
  g.add(seat, back);
  for (const o of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), m.dark);
    l.position.set(o, 0.22, 0);
    g.add(l);
  }
  return g;
}

function vendingMesh(m: Materials, body: string, face: string, glow: string): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.7), m.std(body, 0.4));
  b.position.y = 0.95;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.1), m.lamp(face, glow, 1.6));
  f.position.set(0, 1.2, 0.36);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.04), m.solid('#16141f'));
  slot.position.set(0, 0.32, 0.36);
  g.add(b, f, slot);
  return g;
}

export function buildProps(k: Kit, wireMat: THREE.LineBasicMaterial): PropsOut {
  const m = k.m;
  const lights: LightRef[] = [];
  const pl = (color: string, base: number, x: number, y: number, z: number, dist = 9) => {
    const l = new THREE.PointLight(color, base, dist, 2);
    l.position.set(x, y, z);
    k.root.add(l);
    lights.push({ light: l, base });
  };
  const shopFollowers: ShopFollower[] = [];
  /** Build a shop-front fixture into a group of its own (merged on its own), so it can move with the shop. */
  const follow: Follow = (anchor, fn, obstacles = []) => {
    if (!anchor) return fn();
    const g = new THREE.Group();
    g.userData.apart = true;
    k.into(g, () => k.merged(fn));
    shopFollowers.push({ anchor, group: g, obstacles });
  };

  for (const b of BENCHES) {
    const g = benchMesh(m);
    g.position.set(b.x, G + 0.1, b.z);
    g.rotation.y = b.ry;
    k.add(g);
  }
  for (const v of VENDING) {
    const g = vendingMesh(m, v.body, v.face, v.glow);
    g.position.set(v.x, G, v.z);
    k.add(g);
  }
  pl('#4fd6ff', 6, 1.4, G + 1.3, -4.9, 4);

  // bicycles: the mamachari is the true vehicle of the shitamachi
  const bike = (x: number, z: number, ry: number, c: string) => {
    const g = new THREE.Group();
    const metal = m.std('#adb2b8', 0.4, { metalness: 0.5 });
    for (const o of [-0.5, 0.5]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 4, 10), metal);
      t.position.set(o, 0.36, 0);
      g.add(t);
    }
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.08), m.solid(c));
    fr.position.y = 0.6;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), metal);
    basket.position.set(0.62, 0.76, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.14), m.dark);
    seat.position.set(-0.3, 0.78, 0);
    g.add(fr, basket, seat);
    g.position.set(x, G, z);
    g.rotation.y = ry;
    k.add(g);
  };
  bike(-6.6, 10.9, 0, '#9a2b22');
  bike(-5.4, 10.95, 0.1, '#2f4a72');
  bike(-9.65, 0.2, Math.PI / 2, '#e8dcc2');
  bike(10.6, -0.9, Math.PI / 2, '#3c6838');
  bike(-14.2, -8.5, 0, '#e8dcc2');

  // crates outside the ramen shop's back door
  for (const [x, z, n] of [
    [-9.9, -3.55, 3],
    [-9.9, -3.1, 2],
  ] as const)
    for (let i = 0; i < n; i++) k.box(0.42, 0.3, 0.36, m.solid(['#d9a62e', '#2f4a72', '#3c6838'][(i + Math.round(z)) % 3]!), x, G + 0.17 + i * 0.31, z);

  // utility poles + transformer + wires + street lamps
  const poleM = m.solid('#8a8f99');
  // lamp heads sit at the top of the hierarchy after the kissaten (lighting.ts); setLampLevel scales by 0.15 + level
  const lampHead = () => m.lamp('#fff1c4', '#ffe2b0', EMISSIVE.streetlamp / 1.15);
  const lampPools: PropsOut['lampPools'] = [];
  POLES.forEach(([x, z], i) => {
    k.cyl(0.15, 0.19, 8.4, poleM, x, G + 4.2, z, 6);
    const along = i < 3;
    k.box(along ? 1.6 : 0.13, 0.13, along ? 0.13 : 1.6, m.solid('#686d78'), x, G + 7.9, z);
    if (i === 1) k.cyl(0.32, 0.32, 0.8, m.std('#686d78', 0.5, { metalness: 0.4 }), x + 0.4, G + 6.6, z - 0.4, 8);
    if (i !== 3) {
      const d = along ? [-0.6, 0] : [0, 0.6];
      k.box(0.45, 0.13, 0.26, lampHead(), x + d[0]!, G + 4.8, z + d[1]!);
      // a modest local fill; the visible pool on the ground is a decal (lightpools.ts)
      pl('#ffd9a0', 7, x + d[0]! * 1.5, G + 4.5, z + d[1]! * 1.5, 10);
      lampPools.push({ x: x + d[0]! * 1.4, z: z + d[1]! * 1.4, r: 2.5 });
    }
    // little ad sign on the pole (all shitamachi poles have one)
    if (i % 2 === 0) k.box(0.06, 0.8, 0.3, m.solid(i ? '#ffd37a' : '#2f4a72'), x + 0.18, G + 2.4, z);
  });
  const P = POLES;
  const span = (a: number, b: number) => {
    const A = P[a]!,
      B = P[b]!;
    const alongZ = Math.abs(A[0] - B[0]) < 0.5;
    for (const [o, y, s] of [
      [-0.6, G + 7.95, 0.03],
      [0.6, G + 7.95, 0.025],
      [0, G + 7.2, 0.035],
    ] as const)
      k.wire(
        new THREE.Vector3(A[0] + (alongZ ? o : 0), y, A[1] + (alongZ ? 0 : o)),
        new THREE.Vector3(B[0] + (alongZ ? o : 0), y, B[1] + (alongZ ? 0 : o)),
        s,
        wireMat,
      );
  };
  // the wire network is solved, not hand-placed: a spanning tree over the poles, each drop to its nearest pole
  for (const [a, b] of poleSpans(P)) span(a, b);
  const roofs = townRoofs();
  // the shop-houses' drops first, in a group of their own (re-routed when a shop moves)
  const shopDrops = new THREE.Group();
  k.into(shopDrops, () =>
    routeDrops(
      k,
      DROPS.filter((d) => d.follows),
      roofs,
      wireMat,
    ),
  );
  routeDrops(
    k,
    DROPS.filter((d) => !d.follows),
    roofs,
    wireMat,
  );
  // convex road mirrors at the blind corners: orange-rimmed, angled down the lane
  k.merged(() => {
    for (const r of ROAD_MIRRORS) {
      k.cyl(0.08, 0.08, 2.7, m.solid('#adb2b8'), r.x, G + 1.35, r.z, 6);
      const g = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 12), m.solid('#ff6b3d', 0.5));
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 12), m.std('#c4dcee', 0.1, { metalness: 0.6 }));
      glass.position.y = 0.02;
      g.add(rim, glass);
      g.rotation.set(Math.PI / 2 - 0.15, 0, 0, 'YXZ');
      g.rotation.y = r.ry;
      g.position.set(r.x, G + 2.75, r.z);
      k.add(g);
    }
  });

  for (const [x, z] of PARK_LAMPS) {
    k.cyl(0.07, 0.09, 2.6, m.dark, x, G + 1.3, z, 6);
    k.box(0.3, 0.3, 0.3, lampHead(), x, G + 2.7, z);
    pl('#ffe2b0', 6, x, G + 2.4, z, 7);
    lampPools.push({ x, z, r: 1.8 });
  }
  // shop / building light sources
  follow({ shop: 'ramen', edge: 'mid' }, () => pl('#ff6a3d', 10, -9.9, G + 2.4, -2, 6));
  follow({ shop: 'bakery', edge: 'mid' }, () => pl('#ffb35a', 8, -9.6, G + 1.4, 1.5, 5));
  pl('#ffb35a', 12, 14, G + 1.6, 2.7, 7);
  pl('#ffb35a', 9, -12.8, TG + 1.2, -8, 6);
  pl('#ffb35a', 7, 9.5, TG + 1.4, -8.6, 6);
  pl('#ff7040', 7, -9.25, G + 3.8, 10.2, 5);
  pl('#ff6a3d', 9, 3.5, G + 3.2 + 1.4, -6.5, 6);

  k.merged(() => buildQuietProps(k, follow));

  // swings (animated by the world)
  const swings = [-6.75, -5.85].map((x) => {
    const g = new THREE.Group();
    g.position.set(x, G + 2.3, 5.4);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.6, 0.04), m.dark);
    rope.position.y = -0.8;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.26), m.solid('#ffd37a'));
    seat.position.y = -1.62;
    g.add(rope, seat);
    return k.add(g);
  });

  // faded stickers and flyers on the poles (sun-bleached: pale colours only)
  const stickerRng = stream('pole-stickers');
  const faded = ['#e8dcc2', '#c4dcee', '#f4c7cf', '#cfd2d4', '#d4a774'];
  k.merged(() =>
    POLES.forEach(([x, z]) => {
      const n = stickerRng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 4 + stickerRng.range(-0.5, 0.5);
        const p = k.plane(stickerRng.range(0.14, 0.24), stickerRng.range(0.2, 0.34), m.solid(stickerRng.pick(faded), 0.95), 0, 0, 0, a);
        p.position.set(x + Math.sin(a) * 0.19, G + stickerRng.range(1.1, 2.0), z + Math.cos(a) * 0.19);
      }
    }),
  );

  // shotengai bunting
  const flags: THREE.Mesh[] = [];
  for (let z = -2.5; z < 9; z += 2.9) {
    k.cyl(0.05, 0.05, 3.2, m.solid('#adb2b8'), -10.3, G + 1.6, z, 4);
    const f = k.plane(0.5, 0.9, m.flags, -10.3, G + 2.7, z + 0.3, Math.PI / 2);
    flags.push(f);
  }
  // lantern string over the temple steps (lit for evening festivals)
  for (let i = 0; i < 5; i++) {
    const l = k.mesh(new THREE.SphereGeometry(0.17, 8, 6), m.lantern, 2.3 + i * 0.45, TG + 2.0 - Math.sin((i / 4) * Math.PI) * 0.25, -6.2);
    l.scale.y = 1.35;
  }
  k.wire(new THREE.Vector3(2.0, TG + 2.4, -6.2), new THREE.Vector3(4.4, TG + 2.4, -6.2), 0.04, wireMat);
  for (const x of [2.0, 4.4]) k.cyl(0.06, 0.06, 2.4, m.dark, x, TG + 1.2, -6.2, 4);

  const lightPool: LightRef[] = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight('#ffb35a', 0, 5, 2);
    l.position.set(0, -20, 0);
    k.root.add(l);
    const ref = { light: l, base: 0 };
    lights.push(ref);
    lightPool.push(ref);
  }

  return { lights, swings, flags, lightPool, lampPools, shopFollowers, shopDrops };
}

/**
 * The quiet props: meter boxes, downpipes, hose reels, umbrella stands, crates,
 * the garbage point, a post box and doorstep pots. None of them shout; together
 * they make the street look lived in. Positions are data (layout.ts).
 */
type Follow = (anchor: ShopAnchor | undefined, fn: () => void, obstacles?: ShopFollower['obstacles']) => void;

function buildQuietProps(k: Kit, follow: Follow): void {
  const m = k.m;
  // a stream of its own, so adding a pot never reshuffles anything else
  const rng = stream('quiet-props');
  const grey = m.solid('#686d78', 0.6);

  for (const me of METERS)
    follow(me.follows, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.12), m.solid('#cfd2d4', 0.6));
      const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), m.solid('#2a3040', 0.3));
      dial.position.set(0, 0.06, 0.061);
      // conduit down to the ground
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, me.y - groundHeight(me.x, me.z), 4), grey);
      conduit.position.set(0.08, -(me.y - groundHeight(me.x, me.z)) / 2, 0.02);
      g.add(body, dial, conduit);
      g.position.set(me.x, me.y, me.z);
      g.rotation.y = me.ry;
      k.add(g);
    });

  const pipe = m.solid('#8a8f99', 0.6);
  for (const d of DOWNPIPES) {
    follow(d.follows, () => {
      k.cyl(0.06, 0.06, d.y1 - d.y0, pipe, d.x, (d.y0 + d.y1) / 2, d.z, 6);
      k.box(0.2, 0.08, 0.2, pipe, d.x, d.y1, d.z);
    });
    // it empties at the foot of the wall: a splash stain on the masonry beside it
    k.drips.push({ x: d.x, y: d.y0 + 0.7, z: d.z, r: 0.35, len: 0.7 });
  }

  for (const [x, z] of HOSE_REELS) {
    const y = groundHeight(x, z);
    k.box(0.08, 0.5, 0.3, grey, x, y + 0.25, z);
    const reel = k.cyl(0.24, 0.24, 0.14, m.solid('#3c6838', 0.7), x + 0.1, y + 0.38, z, 10);
    reel.rotation.z = Math.PI / 2;
    const coil = k.mesh(new THREE.TorusGeometry(0.19, 0.06, 4, 10), m.solid('#5b8c45', 0.7), x + 0.18, y + 0.38, z);
    coil.rotation.y = Math.PI / 2;
  }

  const shafts = ['#2f4a72', '#9a2b22', '#f6efe0', '#3c6838'];
  for (const [x, z] of UMBRELLA_STANDS) {
    const y = groundHeight(x, z);
    k.cyl(0.15, 0.13, 0.45, m.solid('#adb2b8', 0.4), x, y + 0.22, z, 8);
    for (let i = 0; i < 3; i++) {
      const u = k.cyl(0.04, 0.03, 0.9, m.solid(rng.pick(shafts), 0.6), x + rng.range(-0.06, 0.06), y + 0.5, z + rng.range(-0.06, 0.06), 4);
      u.rotation.set(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15));
    }
  }

  {
    // milk crates by the bakery's side door, stacked
    const [x, z] = MILK_CRATES;
    for (let i = 0; i < 3; i++) k.box(0.36, 0.26, 0.36, m.solid(i === 1 ? '#4f73a3' : '#ffd37a', 0.7), x, G + 0.14 + i * 0.27, z + (i === 2 ? 0.04 : 0));
  }

  {
    // garbage point: pale bags under a weighted green net
    const [x, z] = GARBAGE_POINT;
    for (let i = 0; i < 5; i++) {
      const b = k.mesh(
        new THREE.IcosahedronGeometry(0.2 + rng.range(0, 0.06), 0),
        m.solid(i % 2 ? '#f6efe0' : '#cfd2d4', 0.8),
        x + rng.range(-0.3, 0.3),
        G + 0.18,
        z + rng.range(-0.25, 0.25),
      );
      b.scale.y = 0.8;
    }
    const net = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.52, 1)), new THREE.LineBasicMaterial({ color: '#2f7f7a' }));
    net.scale.set(1, 0.5, 0.8);
    net.position.set(x, G + 0.16, z);
    k.root.add(net);
  }

  {
    // the neighbourhood post box: plain red, no marks
    const [x, z] = MAILBOX;
    k.cyl(0.07, 0.07, 0.6, m.dark, x, G + 0.3, z, 6);
    k.box(0.46, 0.7, 0.38, m.solid('#d0402a', 0.5), x, G + 0.95, z);
    k.box(0.52, 0.08, 0.44, m.solid('#9a2b22', 0.5), x, G + 1.34, z);
    k.box(0.3, 0.05, 0.02, m.solid('#16141f'), x, G + 1.12, z + 0.2);
  }

  const potColours = ['#8a5634', '#b07a4c', '#4b4f5a', '#9a2b22'];
  DOORSTEP_POTS.forEach(([x, z], i) => {
    const owner = DOORSTEP_POT_OWNERS[i]!;
    // a pot on a shop's doorstep moves with the shop, and so does the spot it takes on the nav grid
    follow(
      SHOP_IDS.has(owner) ? { shop: owner, edge: 'mid' } : undefined,
      () => {
        const y = groundHeight(x, z);
        const r = rng.range(0.22, 0.34);
        k.box(0.32, 0.28, 0.32, m.solid(rng.pick(potColours)), x, y + 0.14, z);
        k.blob(x, y + 0.3 + r * 0.7, z, r);
        if (rng.chance(0.4)) k.blob(x + 0.08, y + 0.32 + r * 1.3, z - 0.05, r * 0.6);
      },
      [{ x, z, r: 0.22 }],
    );
  });
}

// ── Player-placeable objects ────────────────────────────────────────────────
/** The original six placeables, plus everything in the data catalogue (catalogue.ts). */
export type PlaceableKind = 'bench' | 'sakura' | 'lantern' | 'vending' | 'planter' | 'catbowl' | CatalogueKind;

export interface PlaceableDef {
  kind: PlaceableKind;
  label: string;
  /** The palette tab it lives under. */
  category: Category;
  /** A wind chime: rings now and then while sound is on. */
  chime?: boolean;
  /** Catalogue items draw their palette icon from their shapes. */
  shapes?: readonly Shape[];
  /** Footprint radius for the nav grid. */
  radius: number;
  /** How much residents care that it appeared (0..1). */
  novelty: number;
  /** Smart-object actions it advertises. */
  affords: ('sit' | 'drink' | 'admire' | 'feed-cats' | 'warmth')[];
  /** Borrow a pooled point light while placed. */
  glow?: { color: string; base: number; y: number };
  build: (m: Materials) => { object: THREE.Object3D };
}

const ORIGINAL: Record<'bench' | 'sakura' | 'lantern' | 'vending' | 'planter' | 'catbowl', PlaceableDef> = {
  bench: { kind: 'bench', label: 'Bench', category: 'rest', radius: 0.6, novelty: 0.55, affords: ['sit'], build: (m) => ({ object: benchMesh(m) }) },
  sakura: {
    kind: 'sakura',
    label: 'Sakura',
    category: 'green',
    radius: 0.45,
    novelty: 0.9,
    affords: ['admire'],
    build: (m) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 6), m.solid('#45291b'));
      trunk.position.y = 0.9;
      g.add(trunk);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 * 3.1;
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + (i % 3) * 0.08, 0), m.leaves.sakura[i % 3]);
        b.position.set(Math.cos(a) * (0.3 + (i % 4) * 0.2), 2.0 + (i % 5) * 0.18, Math.sin(a) * (0.3 + (i % 4) * 0.2));
        g.add(b);
      }
      return { object: g };
    },
  },
  lantern: {
    kind: 'lantern',
    label: 'Stone lantern',
    category: 'light',
    radius: 0.35,
    novelty: 0.6,
    affords: ['admire', 'warmth'],
    glow: { color: '#ffb35a', base: 6, y: 1 },
    build: (m) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.7, 0.32), m.stone);
      base.position.y = 0.35;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 0.48), m.lamp('#fff1c4', '#ffa94d', 2));
      lamp.position.y = 0.9;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.16, 0.64), m.solid('#8a8f99'));
      cap.position.y = 1.17;
      g.add(base, lamp, cap);
      return { object: g };
    },
  },
  vending: {
    kind: 'vending',
    label: 'Vending machine',
    category: 'street',
    radius: 0.55,
    novelty: 0.5,
    affords: ['drink'],
    glow: { color: '#4fd6ff', base: 4, y: 1.3 },
    build: (m) => {
      return { object: vendingMesh(m, '#e8ebee', '#c4f0ff', '#4fd6ff') };
    },
  },
  planter: {
    kind: 'planter',
    label: 'Flower planter',
    category: 'green',
    radius: 0.5,
    novelty: 0.4,
    affords: ['admire'],
    build: (m) => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.5), m.tex2('wood', '#8a5634', 1, 1));
      box.position.y = 0.2;
      g.add(box);
      const cols = ['#f4c7cf', '#ffd37a', '#d0402a', '#f6efe0', '#6a5a9a'];
      for (let i = 0; i < 9; i++) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), m.std(cols[i % 5]!, 0.9, { flatShading: true }));
        f.position.set(-0.42 + (i % 5) * 0.21, 0.5 + (i % 2) * 0.08, i < 5 ? -0.08 : 0.1);
        g.add(f);
      }
      return { object: g };
    },
  },
  catbowl: {
    kind: 'catbowl',
    label: 'Cat bowl',
    category: 'critters',
    radius: 0.3,
    novelty: 0.35,
    affords: ['feed-cats'],
    build: (m) => {
      const g = new THREE.Group();
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.1, 10), m.solid('#4f73a3'));
      bowl.position.y = 0.05;
      const food = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 10), m.solid('#b07a4c'));
      food.position.y = 0.1;
      g.add(bowl, food);
      return { object: g };
    },
  },
};

/** The catalogue's items as placeables (one builder for all: shapes → mesh). */
function fromCatalogue(): Record<CatalogueKind, PlaceableDef> {
  const out = {} as Record<CatalogueKind, PlaceableDef>;
  for (const kind of Object.keys(CATALOGUE) as CatalogueKind[]) {
    const c: CatalogueItem = CATALOGUE[kind];
    out[kind] = {
      kind,
      label: kind,
      category: c.category,
      radius: c.radius,
      novelty: c.novelty,
      affords: [...c.affords],
      ...(c.glow ? { glow: c.glow } : {}),
      ...(c.chime ? { chime: true } : {}),
      shapes: c.shapes,
      build: (m: Materials) => ({ object: buildShapes(m, c.shapes) }),
    };
  }
  return out;
}

/** Every placeable: the original six, then the catalogue, each as data (en.ts has their names). */
export const PLACEABLES: Record<PlaceableKind, PlaceableDef> = { ...ORIGINAL, ...fromCatalogue() };
