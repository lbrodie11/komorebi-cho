import * as THREE from 'three';
import type { Kit } from './kit';
import type { SignSpec } from '../render/glyphs';
import { G, SIGNS, TG } from './layout';

/** A roller shutter that rolls up at opening time. */
export interface Shutter {
  mesh: THREE.Mesh;
  open: number; // 0 closed .. 1 open (animated)
  hours: [number, number];
  baseY: number;
  height: number;
}

export interface BuildingsOut {
  lanterns: THREE.Mesh[];
  shutters: Shutter[];
  parasols: THREE.Object3D[];
  chimneyTop: THREE.Vector3;
}

export function buildBuildings(k: Kit): BuildingsOut {
  const m = k.m;
  const lanterns: THREE.Mesh[] = [];
  const shutters: Shutter[] = [];
  const parasols: THREE.Object3D[] = [];

  const lantern = (x: number, y: number, z: number, r = 0.26, mat: THREE.Material = m.lantern) => {
    const l = k.mesh(new THREE.SphereGeometry(r, 8, 6), mat, x, y, z);
    l.scale.y = 1.4;
    lanterns.push(l);
    return l;
  };
  const shutter = (x: number, y: number, z: number, ry: number, w: number, h: number, hours: [number, number]) => {
    const s = k.plane(w, h, m.tex2('shutter', '#adb2b8', 1, 3, 0.6), x, y, z, ry);
    s.translateZ(0.03);
    shutters.push({ mesh: s, open: 0, hours, baseY: y, height: h });
  };

  // ── Sento (public bath) on the terrace, with its tall chimney ──────────────
  // Weathering ages are art direction: the old timber bath and temple are the most stained,
  // the recent concrete micro-home the least.
  const sx = -12.8,
    sz = -10.7;
  k.weathering({ age: 0.85 }, () => {
    k.box(6.6, 4, 3.4, m.tex2('wood', '#8a5634', 2.5, 1.4), sx, TG + 2, sz);
    k.gableX(7.2, 4.4, 2.2, m.roof, sx, TG + 4, sz);
    k.box(2.6, 2.8, 0.6, m.tex2('wood', '#653d27', 1, 1), sx, TG + 1.4, -8.75);
    k.gableZ(1.2, 3.2, 0.9, m.roofDark, sx, TG + 2.8, -8.7);
    k.win(sx, TG + 0.95, -8.42, 0, 2, 1.5, 'shop');
    k.win(sx - 2.4, TG + 1.6, -8.96, 0, 1.1, 0.9, 'shop');
    k.win(sx + 2.4, TG + 1.6, -8.96, 0, 1.1, 0.9, 'shop');
    // soot and rain streak down from the top of the chimney
    const chimney = m.tex2('concrete', '#adb2b8', 1, 4);
    k.cyl(0.55, 0.72, 13, chimney, -14.9, TG + 6.5, -11.9, 12);
    k.cyl(0.62, 0.62, 0.4, m.dark, -14.9, TG + 10, -11.9, 12);
    k.cyl(0.64, 0.64, 0.5, m.dark, -14.9, TG + 12.8, -11.9, 12);
    // shoe lockers / wooden sandals rack
    k.box(0.9, 0.9, 0.35, m.solid('#653d27'), sx + 1.9, TG + 0.45, -8.75);
  });
  // noren with ゆ (hot water) over the door, the hot-spring mark above it
  k.plane(1.8, 0.7, m.solid('#2f4a72'), sx, TG + 1.4, -8.43, 0);
  k.sign(SIGNS.sento, sx, TG + 1.4, -8.42, 0);
  k.sign(SIGNS.sentoBoard, sx, TG + 2.3, -8.42, 0);

  // ── Kyosho jutaku: narrow chamfered concrete micro-home, tallest at the back ─
  const conc = m.tex2('concrete', '#b3b7bc', 0.4, 0.36);
  k.weathering({ age: 0.25 }, () => {
    k.prism(
      [
        [-9.2, -12.4],
        [-6, -12.4],
        [-6, -10.2],
        [-7, -9.2],
        [-9.2, -9.2],
      ],
      TG,
      9.2,
      conc,
    );
    k.shed(-9.2, -6, -12.4, -9.2, TG + 9.2, 1.4, 'x0', conc, m.solid('#4b4f5a', 0.6));
    [TG + 1.6, TG + 4.4, TG + 7.2].forEach((y, f) => {
      k.win(-8.3, y, -9.16, 0, 0.9, 1.1);
      k.win(-6.54, y, -9.66, Math.PI / 4, 0.7, 1.1);
      if (f) k.ac(-8.3, y - 0.8, -8.98, 0);
    });
    k.box(2, 0.08, 0.6, m.solid('#8a8f99'), -8.1, TG + 6.4, -8.9);
    ['#f6efe0', '#86aed4', '#e59b9b'].forEach((c, i) => k.plane(0.45, 0.6, m.std(c, 0.9, { side: THREE.DoubleSide }), -8.7 + i * 0.6, TG + 6.9, -8.95, 0));
    k.plane(0.8, 1.7, m.solid('#45291b'), -8.3, TG + 0.85, -9.17, 0);
  });

  // ── Two-storey "apaato" with an open corridor and steel stair ──────────────
  k.weathering({ age: 0.6 }, () => {
    k.box(6.8, 5.4, 2.8, m.tex2('plaster', '#e8dcc2', 2, 1.5), -2, TG + 2.7, -11);
    k.gableX(7.2, 3.6, 1.1, m.roofDark, -2, TG + 5.4, -11);
    k.box(6.8, 0.14, 1, m.solid('#8a8f99'), -2, TG + 2.8, -9.1);
    k.box(6.8, 0.8, 0.08, m.std('#adb2b8', 0.5, { metalness: 0.4 }), -2, TG + 3.25, -8.62);
    [-4.3, -2, 0.3].forEach((x, i) => {
      k.plane(0.7, 1.5, m.solid(i === 1 ? '#2f7f7a' : '#2f4a72', 0.7), x, TG + 0.85, -9.56, 0);
      k.plane(0.7, 1.5, m.solid('#2f4a72', 0.7), x, TG + 3.6, -9.56, 0);
      k.win(x + 0.85, TG + 1.2, -9.56, 0, 0.6, 0.6);
      k.win(x + 0.85, TG + 3.95, -9.56, 0, 0.6, 0.6);
      k.box(0.18, 0.2, 0.12, m.solid('#cfd2d4'), x - 0.5, TG + 1.3, -9.5);
    });
  });
  {
    const L = Math.hypot(2.8, 2.8);
    const s = k.box(0.8, 0.14, L, m.std('#686d78', 0.5, { metalness: 0.4 }), 1.85, TG + 1.4, -10.8);
    s.rotation.x = -Math.PI / 4;
    const r = k.box(0.1, 0.1, L, m.dark, 2.25, TG + 2.25, -10.8);
    r.rotation.x = -Math.PI / 4;
  }

  // ── Temple on the terrace (Yanaka has ~70 of them) ─────────────────────────
  k.weathering({ age: 0.9, moss: 0.5 }, () => {
    k.box(7.6, 0.4, 3.6, m.solid('#8a8f99'), 9.5, TG + 0.2, -10.9);
    k.box(6, 2.6, 2.4, m.tex2('wood', '#5a3622', 2, 1), 9.5, TG + 1.7, -10.9);
    k.gableX(7.6, 4.4, 2.1, m.roofDark, 9.5, TG + 2.9, -10.9);
    const s = k.box(7.8, 0.16, 1, m.roofDark, 9.5, TG + 2.85, -9.05);
    s.rotation.x = 0.4;
  });
  k.box(0.9, 0.5, 0.5, m.solid('#45291b'), 9.5, TG + 0.65, -9.4);
  k.cyl(0.04, 0.04, 1.6, m.vermilion, 9.5, TG + 2, -9.6, 4);
  k.cyl(0.18, 0.18, 0.2, m.solid('#c9a36b', 0.4), 9.5, TG + 2.75, -9.6, 8);
  const stoneL = m.lamp('#fff1c4', '#ffa94d', 2);
  [
    [6.8, -8.8],
    [12.2, -8.8],
  ].forEach(([x, z]) => {
    k.box(0.32, 0.7, 0.32, m.stone, x!, TG + 0.35, z!);
    k.box(0.48, 0.38, 0.48, stoneL, x!, TG + 0.9, z!);
    k.box(0.64, 0.16, 0.64, m.solid('#8a8f99'), x!, TG + 1.17, z!);
  });
  [
    [8, -8.9],
    [11, -8.9],
  ].forEach(([x, z]) => {
    k.box(0.4, 0.5, 0.4, m.solid('#8a8f99'), x!, TG + 0.25, z!);
    k.box(0.32, 0.4, 0.4, m.stone, x!, TG + 0.7, z!);
  });
  // ema (prayer plaque) board
  k.box(1.4, 0.7, 0.1, m.solid('#8a5634'), 13.2, TG + 0.9, -9.4);
  for (let i = 0; i < 6; i++) k.box(0.18, 0.13, 0.03, m.solid('#e8dcc2'), 12.7 + (i % 3) * 0.32, TG + 0.95 + Math.floor(i / 3) * 0.2, -9.33);

  // ── Shotengai: four shops facing the lane, arch at the entrance ────────────
  const shop = (
    z0: number,
    z1: number,
    h: number,
    wall: THREE.Material,
    o: { roof?: 'gable' | 'shed'; awning?: THREE.Material; noren?: string; crest?: SignSpec; tank?: boolean; hours: [number, number]; age: number },
  ) => {
    const w = 5.7,
      cx = -13.35,
      cz = (z0 + z1) / 2,
      d = z1 - z0;
    k.weathering({ age: o.age }, () => {
      k.box(w, h, d, wall, cx, G + h / 2, cz);
      if (o.roof === 'gable') k.gableZ(d + 0.4, w + 0.6, 1.4, m.roof, cx, G + h, cz);
      else if (o.roof === 'shed') k.shed(-16.2, -10.5, z0, z1, G + h, 1, 'x0', wall, m.roof);
      else {
        k.box(w + 0.1, 0.3, d + 0.1, m.dark, cx, G + h + 0.15, cz);
        if (o.tank) k.cyl(0.45, 0.45, 0.8, m.solid('#86aed4', 0.5), cx - 1.5, G + h + 0.7, cz);
      }
      k.win(-10.46, G + 1.15, cz, Math.PI / 2, d * 0.72, 1.6, 'shop');
      k.windows[k.windows.length - 1]!.hours = o.hours;
      k.box(0.3, 0.25, d * 0.78, m.solid('#686d78'), -10.45, G + 2.08, cz);
      if (h > 4.4) [cz - d / 4, cz + d / 4].forEach((z) => k.win(-10.46, G + 3.8, z, Math.PI / 2, 0.9, 1));
    });
    shutter(-10.46, G + 1.15, cz, Math.PI / 2, d * 0.74, 1.62, o.hours);
    if (o.noren) {
      k.plane(d * 0.55, 0.9, m.solid(o.noren), -10.42, G + 1.85, cz, Math.PI / 2);
      if (o.crest) k.sign(o.crest, -10.41, G + 1.85, cz, Math.PI / 2);
    }
    if (o.awning) {
      const a = k.box(1.1, 0.14, d * 0.9, o.awning, -9.95, G + 2.55, cz);
      a.rotation.z = -0.38;
    }
  };
  shop(-3.6, -0.4, 5.2, m.tex2('wood', '#653d27', 2, 2), { noren: '#9a2b22', crest: SIGNS.ramenCrest, tank: true, hours: [11, 23], age: 0.8 });
  shop(-0.2, 3.2, 4.4, m.tex2('plaster', '#e8dcc2', 2, 1.5), { roof: 'gable', awning: m.tex2('stripe', '#ffffff', 3, 1, 0.8), hours: [7, 19], age: 0.5 });
  shop(3.4, 6, 3.6, m.tex2('wood', '#8a5634', 2, 1.2), { roof: 'shed', awning: m.solid('#3c6838'), hours: [9, 18], age: 0.65 });
  shop(6.2, 9, 5, m.tex2('siding', '#8a8f99', 2, 2), { noren: '#2f4a72', crest: SIGNS.booksCrest, hours: [10, 20], age: 0.7 });
  // ramen: lanterns + a tall back-lit sign between them
  lantern(-10.2, G + 2.3, -3.2);
  lantern(-10.2, G + 2.3, -0.8);
  k.box(0.12, 3.25, 1, m.lamp('#d0402a', '#9a2b22', 0.6), -10.36, G + 3.6, -2);
  k.sign(SIGNS.ramen, -10.29, G + 3.6, -2, Math.PI / 2, 0.6);
  k.weathering({ age: 0.8 }, () => k.ac(-10.36, G + 4, 1.6, Math.PI / 2));
  // shop boards above the awnings, and the bookshop's name between its upper windows
  k.sign(SIGNS.bakery, -10.42, G + 3.4, 1.5, Math.PI / 2);
  k.sign(SIGNS.florist, -10.42, G + 3.1, 4.7, Math.PI / 2);
  k.sign(SIGNS.books, -10.42, G + 3.8, 7.6, Math.PI / 2);
  // bakery bread rack
  k.box(0.5, 0.8, 1.2, m.solid('#8a5634'), -9.95, G + 0.4, 2.4);
  for (let i = 0; i < 6; i++) k.blob(-9.95, G + 0.88, 1.95 + i * 0.18, 0.09).material = m.solid('#d4a774');
  // florist buckets
  const flowers = ['#f4c7cf', '#ffd37a', '#d0402a', '#f6efe0', '#6a5a9a', '#ff6b3d'];
  k.box(0.9, 0.5, 2.2, m.solid('#8a5634'), -10, G + 0.25, 4.7);
  k.box(0.6, 0.4, 2, m.solid('#653d27'), -10.15, G + 0.7, 4.7);
  for (let i = 0; i < 22; i++) {
    const b = k.mesh(
      new THREE.IcosahedronGeometry(0.14, 0),
      m.std(flowers[i % flowers.length]!, 0.9, { flatShading: true }),
      -9.75 - (i % 2) * 0.35,
      G + 0.62 + (i % 2) * 0.42,
      3.8 + (i % 11) * 0.18,
    );
    b.castShadow = true;
  }
  // used books cart
  k.box(0.5, 0.7, 1.4, m.solid('#45291b'), -10, G + 0.35, 7.6);
  for (let i = 0; i < 7; i++) k.box(0.3, 0.32, 0.16, m.solid(['#9a2b22', '#2f4a72', '#e8dcc2', '#3c6838'][i % 4]!), -10, G + 0.86, 7.05 + i * 0.18);
  // shotengai arch
  [-10.55, -7.95].forEach((x) => k.cyl(0.14, 0.14, 4.4, m.std('#adb2b8', 0.4, { metalness: 0.5 }), x, G + 2.2, 9.6, 8));
  // kept dimmer than the kissaten: after dark the eye should land on the café first (docs/ARCHITECTURE.md, art direction)
  k.box(3.6, 1.15, 0.26, m.lamp('#d0402a', '#ff6b3d', 0.45), -9.25, G + 4.4, 9.6);
  for (const [z, ry] of [
    [9.74, 0],
    [9.46, Math.PI],
  ] as const)
    k.sign(SIGNS.arch, -9.25, G + 4.4, z, ry, 0.25);
  const archLantern = m.lamp('#ff7a55', '#ff3a1e', 1.1);
  [-10.2, -9.25, -8.3].forEach((x) => lantern(x, G + 3.6, 9.6, 0.18, archLantern));

  // ── Kissaten on the corner (chamfered, the human-scale landmark) ──────────
  const KK: [number, number][] = [
    [10.6, -3.6],
    [16.2, -3.6],
    [16.2, 1.6],
    [11.8, 1.6],
    [10.6, 0.4],
  ];
  const KX: [number, number][] = [
    [10.45, -3.75],
    [16.35, -3.75],
    [16.35, 1.75],
    [11.86, 1.75],
    [10.45, 0.34],
  ];
  k.weathering({ age: 0.55 }, () => {
    k.prism(KK, G, 3, m.tex2('wood', '#45291b', 0.5, 0.4));
    k.prism(KK, G + 3, 2.6, m.tex2('plaster', '#e8dcc2', 0.45, 0.36));
    k.prism(KX, G + 2.92, 0.22, m.solid('#2a1912'));
    k.prism(KX, G + 5.6, 0.34, m.solid('#45291b'));
    k.win(14, G + 1.35, 1.64, 0, 3.6, 1.9, 'cafe');
    [13, 14, 15].forEach((x) => k.box(0.14, 1.9, 0.06, m.solid('#2a1912'), x, G + 1.35, 1.67));
    k.win(11.17, G + 1.15, 1.03, -Math.PI / 4, 1.1, 2.1, 'cafe');
    [12.7, 14.2, 15.6].forEach((x) => k.win(x, G + 4.3, 1.64, 0, 0.9, 1.1));
    k.win(11.17, G + 4.45, 1.03, -Math.PI / 4, 0.8, 0.8);
    k.win(16.24, G + 1.4, -1.2, Math.PI / 2, 2.4, 1.6, 'cafe');
    k.win(16.24, G + 4.3, -1.2, Math.PI / 2, 0.9, 1.1);
  });
  {
    const a = k.box(4.6, 0.14, 1.1, m.tex2('stripe', '#ffffff', 4, 1, 0.8), 14, G + 2.8, 2.15);
    a.rotation.x = 0.38;
    // the cup over the corner door, and "Kotori" hanging off the front like a blade sign
    k.sign(SIGNS.kissatenCup, 11.12, G + 3.55, 1.08, -Math.PI / 4, 0.6);
    k.box(1, 2.5, 0.1, m.lamp('#2a1912', '#45291b', 0.3), 11.95, G + 4.25, 2.26).rotation.y = Math.PI / 2;
    k.sign(SIGNS.kissaten, 12.01, G + 4.25, 2.26, Math.PI / 2, 0.6);
  }
  for (const [x, z] of [
    [12.8, 3],
    [15, 3],
  ] as const) {
    k.cyl(0.35, 0.35, 0.06, m.solid('#f6efe0'), x, G + 0.78, z, 10);
    k.cyl(0.05, 0.05, 0.75, m.dark, x, G + 0.38, z, 4);
    k.box(0.3, 0.45, 0.3, m.solid('#8a5634'), x - 0.6, G + 0.22, z);
    k.box(0.3, 0.45, 0.3, m.solid('#8a5634'), x + 0.6, G + 0.22, z);
    const p = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 4), m.solid('#adb2b8'));
    pole.position.y = 1;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.35, 8), m.solid(x > 14 ? '#2f7f7a' : '#f6efe0'));
    top.position.y = 2.05;
    p.add(pole, top);
    p.position.set(x, G, z);
    parasols.push(k.add(p));
  }
  k.pot(10.9, 2.4, G);
  k.pot(16, 2.4, G);
  [
    [11.5, 0],
    [13.5, -1.5],
    [15.5, 0.6],
  ].forEach(([x, z]) => k.blob(x!, G + 6.3, z!, 0.4));
  [
    [13.2, -2.6],
    [15.2, -2.4],
  ].forEach(([x, z]) => k.pot(x!, z!, G + 5.94, 0.26));

  // ── Allotment tool shed ────────────────────────────────────────────────────
  k.weathering({ age: 0.5 }, () => {
    k.box(1.2, 1.4, 1, m.tex2('siding', '#4f73a3', 1, 1), 15.5, G + 0.7, 11.6);
    k.shed(14.9, 16.1, 11.1, 12.1, G + 1.4, 0.3, 'z0', m.solid('#4f73a3'), m.roof);
  });

  return { lanterns, shutters, parasols, chimneyTop: new THREE.Vector3(-14.9, TG + 13.2, -11.9) };
}
