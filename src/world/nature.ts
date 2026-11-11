import * as THREE from 'three';
import type { Kit } from './kit';
import { ALLOTMENT_ROWS, BRIDGE, G, ISLET, PLINTH, POND, POND_LANTERN, SHRUBS, SIGNS, STREAM, TG, TREES } from './layout';

/**
 * Soil strata in the plinth cutaway, top to bottom: asphalt, crushed-stone road
 * base, bedding sand, fill, Kanto loam, clay. Thickness in metres.
 */
const STRATA: readonly (readonly [number, string])[] = [
  [0.12, '#4b4f5a'],
  [0.35, '#8a8f99'],
  [0.3, '#d4a774'],
  [0.8, '#653d27'],
  [0.6, '#8a5634'],
  [0.5, '#45291b'],
];
const CUT_TOP = -0.32;

/** Utilities under a lane, seen end-on in the cutaway: u = position along the face, y = depth. */
const PIPES = [
  { u: 2.1, y: -0.8, r: 0.15, color: '#ff6b3d', label: SIGNS.fibre },
  { u: 4.2, y: -1.05, r: 0.2, color: '#ffd37a', label: SIGNS.gas },
  { u: 6.3, y: -1.35, r: 0.28, color: '#4f73a3', label: SIGNS.water },
] as const;

export interface NatureOut {
  waterfall: THREE.Texture;
  crops: THREE.Object3D[];
}

export function buildNature(k: Kit): NatureOut {
  const m = k.m;
  const { w, d, h } = PLINTH;

  // ── Plinth: oiled walnut slab, bevelled rim, brass label, utility cutaway ──
  k.box(w, h, d, m.tex2('grain', '#6b4128', 6, 1, 0.55), 0, -0.2 - h / 2, 0);
  {
    // The rim is chamfered all round. Its chamfer and lip use a lighter walnut, so the
    // top edge reads as a highlight line against the dark body (the way light catches oiled wood).
    const b = 0.12;
    const W = w + 0.4 - 2 * b,
      D = d + 0.4 - 2 * b;
    const shape = new THREE.Shape([
      new THREE.Vector2(-W / 2, -D / 2),
      new THREE.Vector2(W / 2, -D / 2),
      new THREE.Vector2(W / 2, D / 2),
      new THREE.Vector2(-W / 2, D / 2),
    ]);
    const rim = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1 });
    rim.rotateX(-Math.PI / 2);
    rim.translate(0, -0.18, 0);
    const top = k.mesh(rim, m.solid('#8a5634', 0.45));
    top.material = [m.solid('#8a5634', 0.45), m.solid('#b07a4c', 0.4)];
  }
  k.box(w + 0.6, 0.3, d + 0.6, m.solid('#45291b', 0.6), 0, -h - 0.05, 0);
  // brass plaque, centred on the front
  k.box(5.95, 1.3, 0.04, m.solid('#7d6b5a', 0.5), 2.5, -1.8, d / 2 + 0.02);
  k.sign(SIGNS.plaque, 2.5, -1.8, d / 2 + 0.045, 0);

  // Cutaways under the two lanes that reach the plinth edge: the west lane (front face)
  // and the north lane (right face). Pipes run along each lane, so they show end-on.
  const cutaway = (face: 'front' | 'right', u0: number, u1: number) => {
    // u runs left to right as seen from outside the face; `out` is distance proud of it
    const at = (u: number, out: number): [number, number] => (face === 'front' ? [u, d / 2 + out] : [w / 2 + out, -u]);
    const ry = face === 'front' ? 0 : Math.PI / 2;
    const span = u1 - u0;
    const slab = (uc: number, y: number, len: number, hh: number, out: number, mat: THREE.Material) => {
      const [x, z] = at(uc, out);
      return face === 'front' ? k.box(len, hh, 0.04, mat, x, y, z) : k.box(0.04, hh, len, mat, x, y, z);
    };
    let y = CUT_TOP;
    for (const [t, c] of STRATA) {
      slab((u0 + u1) / 2, y - t / 2, span, t, 0.02, m.solid(c, 1));
      y -= t;
    }
    // the raw cut edge
    const frame = m.solid('#2a1912', 1);
    slab((u0 + u1) / 2, y - 0.05, span + 0.2, 0.1, 0.03, frame);
    for (const uc of [u0 - 0.05, u1 + 0.05]) slab(uc, (CUT_TOP + y) / 2, 0.1, CUT_TOP - y, 0.03, frame);
    for (const p of PIPES) {
      const [x, z] = at(u0 + p.u, 0.07);
      const pipe = k.cyl(p.r, p.r, 0.1, m.std(p.color, 0.4, { metalness: 0.4 }), x, p.y, z, 12);
      const bore = k.cyl(p.r * 0.6, p.r * 0.6, 0.1, m.solid('#16141f'), x, p.y, z + (face === 'front' ? 0.02 : 0), 12);
      if (face === 'front') pipe.rotation.x = bore.rotation.x = Math.PI / 2;
      else {
        pipe.rotation.z = bore.rotation.z = Math.PI / 2;
        bore.position.x += 0.02;
      }
      const [lx, lz] = at(u0 + p.u, 0.045);
      k.sign(p.label, lx, p.y - p.r - 0.45, lz, ry);
    }
  };
  k.merged(() => {
    cutaway('front', -12.9, -6.1);
    cutaway('right', 2.2, 9.4);
  });

  // ── Base ground + raised temple terrace with stone retaining wall ──────────
  k.box(32.8, 0.12, 24.8, m.tex2('concrete', '#8a8f99', 8, 6), 0, 0.26, 0);
  // old stone: moss on its shaded north faces and damp foot
  const wall = m.tex2('stone', '#9a958c', 4, 0.5);
  k.weathering({ age: 0.95, moss: 1 }, () => {
    k.box(18.4, 1.4, 6.4, wall, -7.2, G + 0.7, -9.2);
    k.box(12, 1.4, 6.4, wall, 10.4, G + 0.7, -9.2);
    k.box(2.4, 1.4, 4, wall, 3.2, G + 0.7, -10.4);
    for (let i = 0; i < 6; i++) {
      const hh = (1.4 * (i + 1)) / 6;
      k.box(2.4, hh, 0.4, m.solid('#adb2b8'), 3.2, G + hh / 2, -6.2 - i * 0.4);
    }
  });
  for (const [a, b] of [
    [-16, 2],
    [4.4, 16.2],
  ] as const) {
    k.box(b - a, 0.12, 0.12, m.dark, (a + b) / 2, TG + 0.75, -6.12);
    for (let x = a + 0.2; x < b; x += 1.8) k.box(0.12, 0.75, 0.12, m.dark, x, TG + 0.37, -6.12);
  }
  // moss and ivy spilling over the wall
  for (let i = 0; i < 14; i++) k.blob(-15 + i * 2.2 + k.rng.range(-0.5, 0.5), TG - 0.15, -5.98, k.rng.range(0.22, 0.4));

  // ── Lanes and paths ─────────────────────────────────────────────────────────
  k.box(26.9, 0.04, 2.2, m.road(10, 1), 2.95, G + 0.02, -4.9);
  k.box(2.5, 0.04, 16.2, m.road(1, 6), -9.25, G + 0.02, 4.3);
  k.box(18.2, 0.05, 1.8, m.tex2('paving', '#a3a29a', 8, 1), 1.1, G + 0.025, 9.5);
  k.box(2, 0.05, 12.4, m.tex2('gravel', '#a39a8a', 1, 6), 9.2, G + 0.025, 2.4);
  k.box(6.2, 0.05, 2.8, m.tex2('paving', '#b3aa9c', 3, 1.4), 13.3, G + 0.025, 3);
  for (let z = -3; z < 11.5; z += 1.3) k.box(0.3, 0.03, 0.9, m.solid('#3f3a58', 0.6), -10.38, G + 0.04, z);
  // culvert slabs where the stream crosses the north lane
  for (let z = -5.0; z < -3.8; z += 0.55) k.box(0.9, 0.05, 0.45, m.solid('#8a8f99'), STREAM.x, G + 0.05, z);

  // ── Park: grass with the pond cut out ──────────────────────────────────────
  k.prism(
    [
      [-8, -3.8],
      [8.2, -3.8],
      [8.2, 8.6],
      [-8, 8.6],
    ],
    G,
    0.1,
    m.grass,
    [POND],
  );
  k.box(18.2, 0.1, 1.95, m.grass, 1.1, G + 0.05, 11.4);
  k.prism(POND, G, 0.04, m.water);
  // rim stones
  for (let i = 0; i < POND.length; i++) {
    const a = POND[i]!;
    const b = POND[(i + 1) % POND.length]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(L / 0.7);
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const s = k.box(0.5, 0.22, 0.42, m.solid(k.rng.pick(['#8a8f99', '#adb2b8', '#686d78'])), a[0] + (b[0] - a[0]) * t, G + 0.12, a[1] + (b[1] - a[1]) * t);
      s.rotation.y = k.rng.next() * 3;
    }
  }
  for (const [x, z] of [
    [0.8, 0.2],
    [1.6, 4],
    [5.6, 0.4],
    [2.6, -0.6],
    [5.8, 3.8],
    [-0.6, 2.2],
  ] as const)
    k.cyl(0.26, 0.26, 0.03, m.solid('#3c6838'), x, G + 0.06, z, 8);

  // yukimi-dōrō: three legs in the water, a lit firebox, a broad hat to catch snow
  k.merged(() => {
    const { x, z } = POND_LANTERN;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      k.cyl(0.05, 0.07, 0.42, m.stone, x + Math.cos(a) * 0.24, G + 0.31, z + Math.sin(a) * 0.24, 5);
    }
    k.cyl(0.3, 0.3, 0.08, m.solid('#8a8f99'), x, G + 0.56, z, 6);
    k.box(0.32, 0.3, 0.32, m.lamp('#fff1c4', '#ffa94d', 2), x, G + 0.75, z);
    k.cyl(0.08, 0.62, 0.26, m.solid('#8a8f99'), x, G + 1.03, z, 6);
    k.cyl(0.07, 0.09, 0.14, m.stone, x, G + 1.22, z, 6);
  });

  // waterfall down the retaining wall (Sudo-koen has one tumbling down its hill)
  const wf = m.tex['waterfall'].clone();
  wf.needsUpdate = true;
  wf.repeat.set(1, 2);
  k.plane(0.7, 1.4, m.std('#ffffff', 0.2, { map: wf, emissive: new THREE.Color('#2f4a72'), emissiveIntensity: 0.25 }), STREAM.x, G + 0.7, -5.96, 0);
  k.box(1.1, 0.25, 0.8, m.solid('#8a8f99'), STREAM.x, G + 0.12, -5.6);
  k.box(0.8, 0.05, 0.6, m.water, STREAM.x, G + 0.22, -5.6);
  for (let i = 0; i < 4; i++) k.box(0.4, 0.3, 0.35, m.solid('#686d78'), STREAM.x + (i % 2 ? 0.5 : -0.5), G + 0.2, -5.85 + Math.floor(i / 2) * 0.5);

  // ── Benzaiten islet + vermilion taiko bridge ───────────────────────────────
  k.cyl(ISLET.r, ISLET.r + 0.1, 0.3, m.grass, ISLET.x, G + 0.15, ISLET.z, 12);
  k.box(0.6, 0.55, 0.5, m.tex2('wood', '#653d27', 1, 1), ISLET.x + 0.35, G + 0.57, ISLET.z);
  k.gableZ(0.7, 0.9, 0.35, m.roofDark, ISLET.x + 0.35, G + 0.85, ISLET.z);
  // the torii is the islet's vermilion accent: sized to read as a shape from the default view
  [ISLET.z - 0.32, ISLET.z + 0.32].forEach((z) => k.cyl(0.06, 0.06, 1.15, m.vermilion, ISLET.x - 0.55, G + 0.87, z, 4));
  k.box(0.14, 0.1, 0.98, m.vermilion, ISLET.x - 0.55, G + 1.47, ISLET.z);
  k.box(0.16, 0.06, 1.08, m.dark, ISLET.x - 0.55, G + 1.55, ISLET.z);
  k.box(0.1, 0.07, 0.72, m.vermilion, ISLET.x - 0.55, G + 1.3, ISLET.z);
  // a votive lamp before the shrine: the islet's beat in the evening, mirrored in the pond
  k.cyl(0.03, 0.03, 0.3, m.dark, ISLET.x - 0.12, G + 0.45, ISLET.z, 4);
  k.box(0.17, 0.2, 0.17, m.lamp('#fff1c4', '#ffa94d', 1.8), ISLET.x - 0.12, G + 0.68, ISLET.z);
  const deck = m.solid('#8a5634', 0.8);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const t0 = i / N,
      t1 = (i + 1) / N;
    const x0 = BRIDGE.x0 + t0 * (BRIDGE.x1 - BRIDGE.x0),
      x1 = BRIDGE.x0 + t1 * (BRIDGE.x1 - BRIDGE.x0);
    const y0 = G + 0.15 + Math.sin(t0 * Math.PI) * BRIDGE.rise,
      y1 = G + 0.15 + Math.sin(t1 * Math.PI) * BRIDGE.rise;
    const len = Math.hypot(x1 - x0, y1 - y0) + 0.02;
    const s = k.box(len, 0.12, 1.1, deck, (x0 + x1) / 2, (y0 + y1) / 2, BRIDGE.z);
    s.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    for (const z of [BRIDGE.z - 0.5, BRIDGE.z + 0.5]) {
      const r = k.box(len, 0.1, 0.1, m.vermilion, (x0 + x1) / 2, (y0 + y1) / 2 + 0.62, z);
      r.rotation.z = s.rotation.z;
      if (i % 3 === 0) k.box(0.12, 0.62, 0.12, m.vermilion, x0, y0 + 0.31, z);
    }
  }
  for (const z of [BRIDGE.z - 0.5, BRIDGE.z + 0.5]) k.box(0.14, 0.75, 0.14, m.vermilion, BRIDGE.x1, G + 0.5, z);

  // ── Trees and shrubs ────────────────────────────────────────────────────────
  for (const t of TREES) k.tree(t.x, t.z, t.r, t.kind, t.h, t.y ?? G);
  for (const [x, z] of SHRUBS) {
    k.blob(x, G + 0.42, z, 0.5);
    k.blob(x + 0.35, G + 0.32, z + 0.2, 0.32);
  }
  // hedge along the front edge
  for (const [a, b] of [
    [-7.5, -3.2],
    [-1, 3.4],
    [5, 9.6],
  ] as const)
    for (let x = a; x < b; x += 0.55) k.blob(x, G + 0.42, 11.7, 0.38);

  // ── Playground ─────────────────────────────────────────────────────────────
  k.box(3.8, 0.06, 3.2, m.solid('#d4a774', 1), -5.5, G + 0.13, 6.4);
  for (const x of [-7.1, -5.5])
    for (const o of [-0.35, 0.35]) {
      const p = k.box(0.12, 2.3, 0.12, m.solid('#4f73a3'), x, G + 1.2, 5.4 + o);
      p.rotation.x = o * 0.35;
    }
  k.box(1.9, 0.12, 0.12, m.solid('#4f73a3'), -6.3, G + 2.3, 5.4);
  k.box(0.5, 1.5, 0.12, m.solid('#ffd37a'), -4.2, G + 0.85, 7.4);
  k.box(0.7, 0.12, 0.7, m.solid('#d0402a'), -4.2, G + 1.55, 7.1);
  {
    const s = k.box(0.6, 0.08, 2.2, m.std('#d0402a', 0.4), -4.2, G + 0.85, 6.0);
    s.rotation.x = -0.62;
  }
  // park clock
  k.cyl(0.07, 0.07, 2.8, m.dark, 3.3, G + 1.5, -3.0, 4);
  k.box(0.5, 0.5, 0.5, m.solid('#f6efe0', 0.6), 3.3, G + 3, -3.0);

  // ── Community allotment (shimin-noen) ──────────────────────────────────────
  k.box(6.2, 0.08, 7.6, m.solid('#653d27', 1), 13.3, G + 0.04, 8.2);
  const crops: THREE.Object3D[] = [];
  ALLOTMENT_ROWS.forEach((z, r) => {
    k.box(4.8, 0.18, 0.7, m.solid('#45291b', 1), 13.3, G + 0.17, z);
    for (let x = 11.3; x < 15.6; x += 0.6) {
      crops.push(k.blob(x, G + 0.36, z, r % 2 ? 0.2 : 0.24));
      if (r === 1 && x > 13) crops.push(k.box(0.1, 0.1, 0.1, m.solid('#d0402a'), x + 0.1, G + 0.5, z + 0.15));
      if (r === 3 && x < 13) crops.push(k.box(0.14, 0.14, 0.14, m.solid('#ffa94d'), x, G + 0.32, z + 0.18));
    }
  });
  for (let x = 10.5; x < 16.4; x += 1.2) k.box(0.08, 0.5, 0.08, m.solid('#d4a774'), x, G + 0.25, 4.45);
  k.box(5.9, 0.06, 0.06, m.solid('#d4a774'), 13.45, G + 0.45, 4.45);

  return { waterfall: wf, crops };
}
