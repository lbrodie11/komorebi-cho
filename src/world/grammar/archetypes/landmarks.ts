import type { SignSpec } from '../../../render/glyphs';
import type { MatRef, Part } from '../types';
import { ROOF_TERRACE } from '../../layout';

/**
 * The one-of-a-kind buildings, as archetypes: a spec (where, how big, what it's made of, how old)
 * and rules that derive the rest from it. Repeated features follow the size (the apāto's units,
 * the micro-home's floors, the bathhouse's side windows, the café's mullions), so a resized
 * building re-plans rather than stretches. Each plan keeps the original build order, because
 * Kit's window jitter is seeded by order (the port is pixel-identical).
 */

const PI = Math.PI;

// ── Sunbeam Bathhouse (sento): wooden hall, gabled entrance, tall chimney ──
export interface SentoSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  wall: MatRef;
  entrance: MatRef;
  chimney: { x: number; z: number; h: number; mat: MatRef };
  noren: string;
  sign: SignSpec;
  board: SignSpec;
  age: number;
}
export function planSento(s: SentoSpec): Part[] {
  const f = s.z + s.d / 2; // front face (+z)
  const c = s.chimney;
  const side = s.w / 2 - 0.9; // side windows sit just inside the corners
  return [
    {
      op: 'scope',
      age: s.age,
      parts: [
        { op: 'box', w: s.w, h: s.h, d: s.d, mat: s.wall, x: s.x, y: s.y + s.h / 2, z: s.z },
        { op: 'gableX', w: s.w + 0.6, d: s.d + 1, h: 2.2, mat: { named: 'roof' }, x: s.x, y: s.y + s.h, z: s.z },
        { op: 'box', w: 2.6, h: 2.8, d: 0.6, mat: s.entrance, x: s.x, y: s.y + 1.4, z: f + 0.25 },
        { op: 'gableZ', w: 1.2, d: 3.2, h: 0.9, mat: { named: 'roofDark' }, x: s.x, y: s.y + 2.8, z: f + 0.3 },
        { op: 'win', x: s.x, y: s.y + 0.95, z: f + 0.58, ry: 0, w: 2, h: 1.5, kind: 'shop' },
        { op: 'win', x: s.x - side, y: s.y + 1.6, z: f + 0.04, ry: 0, w: 1.1, h: 0.9, kind: 'shop' },
        { op: 'win', x: s.x + side, y: s.y + 1.6, z: f + 0.04, ry: 0, w: 1.1, h: 0.9, kind: 'shop' },
        // soot and rain streak down from the top of the chimney
        { op: 'cyl', rt: 0.55, rb: 0.72, h: c.h, mat: c.mat, x: c.x, y: s.y + c.h / 2, z: c.z, seg: 12 },
        { op: 'cyl', rt: 0.62, rb: 0.62, h: 0.4, mat: { named: 'dark' }, x: c.x, y: s.y + c.h - 3, z: c.z, seg: 12 },
        { op: 'cyl', rt: 0.64, rb: 0.64, h: 0.5, mat: { named: 'dark' }, x: c.x, y: s.y + c.h - 0.2, z: c.z, seg: 12 },
        // shoe lockers by the door
        { op: 'box', w: 0.9, h: 0.9, d: 0.35, mat: { solid: '#653d27' }, x: s.x + 1.9, y: s.y + 0.45, z: f + 0.25 },
      ],
    },
    // noren reading BATH over the door, the hot-spring mark above it
    { op: 'plane', w: 2.1, h: 0.7, mat: { solid: s.noren }, x: s.x, y: s.y + 1.4, z: f + 0.57, ry: 0 },
    { op: 'sign', sign: s.sign, x: s.x, y: s.y + 1.4, z: f + 0.58, ry: 0 },
    { op: 'sign', sign: s.board, x: s.x, y: s.y + 2.3, z: f + 0.58, ry: 0 },
  ];
}

// ── Kyosho micro-home: a narrow chamfered concrete tower, a window per floor ──
export interface MicroHomeSpec {
  /** Footprint outline (x, z), with the chamfered corner. */
  pts: readonly (readonly [number, number])[];
  y: number;
  h: number;
  wall: MatRef;
  roof: MatRef;
  age: number;
}
/** One floor per this many metres (a 9.2 m tower has three). */
export const FLOOR_M = 2.8;
export function planMicroHome(s: MicroHomeSpec): Part[] {
  const xs = s.pts.map((p) => p[0]),
    zs = s.pts.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    fz = Math.max(...zs); // front face (+z)
  // + epsilon: (9.2 − 0.8) / 2.8 is 2.9999999999999996 in floating point, and a floor must not vanish to rounding
  const floors = Math.floor((s.h - 0.8) / FLOOR_M + 1e-9);
  const body: Part[] = [
    { op: 'prism', pts: s.pts, y: s.y, h: s.h, mat: s.wall },
    { op: 'shed', x0, x1, z0, z1: fz, y: s.y + s.h, rise: 1.4, hi: 'x0', wall: s.wall, roof: s.roof },
  ];
  for (let f = 0; f < floors; f++) {
    const y = s.y + 1.6 + f * FLOOR_M;
    body.push({ op: 'win', x: x0 + 0.9, y, z: fz + 0.04, ry: 0, w: 0.9, h: 1.1, kind: 'home' });
    body.push({ op: 'win', x: x0 + 2.66, y, z: fz - 0.46, ry: PI / 4, w: 0.7, h: 1.1, kind: 'home' });
    if (f) body.push({ op: 'ac', x: x0 + 0.9, y: y - 0.8, z: fz + 0.22, ry: 0 });
  }
  // the top-floor balcony with its laundry, and the front door
  body.push({ op: 'box', w: 2, h: 0.08, d: 0.6, mat: { solid: '#8a8f99' }, x: x0 + 1.1, y: s.y + 6.4, z: fz + 0.3 });
  ['#f6efe0', '#86aed4', '#e59b9b'].forEach((c, i) =>
    body.push({ op: 'plane', w: 0.45, h: 0.6, mat: { std: c, double: true }, x: x0 + 0.5 + i * 0.6, y: s.y + 6.9, z: fz + 0.25, ry: 0 }),
  );
  body.push({ op: 'plane', w: 0.8, h: 1.7, mat: { solid: '#45291b' }, x: x0 + 0.9, y: s.y + 0.85, z: fz + 0.03, ry: 0 });
  return [{ op: 'scope', age: s.age, parts: body }];
}

// ── Apāto: two storeys of small units off an open corridor, a steel stair at the end ──
export interface ApatoSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  wall: MatRef;
  age: number;
}
/** One unit per this many metres of frontage (6.8 m → 3). */
export const UNIT_M = 2.3;
export function planApato(s: ApatoSpec): Part[] {
  const f = s.z + s.d / 2;
  const n = Math.max(1, Math.round(s.w / UNIT_M));
  const body: Part[] = [
    { op: 'box', w: s.w, h: s.h, d: s.d, mat: s.wall, x: s.x, y: s.y + s.h / 2, z: s.z },
    { op: 'gableX', w: s.w + 0.4, d: s.d + 0.8, h: 1.1, mat: { named: 'roofDark' }, x: s.x, y: s.y + s.h, z: s.z },
    { op: 'box', w: s.w, h: 0.14, d: 1, mat: { solid: '#8a8f99' }, x: s.x, y: s.y + 2.8, z: f + 0.5 },
    { op: 'box', w: s.w, h: 0.8, d: 0.08, mat: { std: '#adb2b8', rough: 0.5, metal: 0.4 }, x: s.x, y: s.y + 3.25, z: f + 0.98 },
  ];
  for (let i = 0; i < n; i++) {
    const ux = s.x + (i - (n - 1) / 2) * UNIT_M;
    body.push({
      op: 'plane',
      w: 0.7,
      h: 1.5,
      mat: { solid: i === Math.floor(n / 2) ? '#2f7f7a' : '#2f4a72', rough: 0.7 },
      x: ux,
      y: s.y + 0.85,
      z: f + 0.04,
      ry: 0,
    });
    body.push({ op: 'plane', w: 0.7, h: 1.5, mat: { solid: '#2f4a72', rough: 0.7 }, x: ux, y: s.y + 3.6, z: f + 0.04, ry: 0 });
    body.push({ op: 'win', x: ux + 0.85, y: s.y + 1.2, z: f + 0.04, ry: 0, w: 0.6, h: 0.6, kind: 'home' });
    body.push({ op: 'win', x: ux + 0.85, y: s.y + 3.95, z: f + 0.04, ry: 0, w: 0.6, h: 0.6, kind: 'home' });
    body.push({ op: 'box', w: 0.18, h: 0.2, d: 0.12, mat: { solid: '#cfd2d4' }, x: ux - 0.5, y: s.y + 1.3, z: f + 0.1 });
  }
  const L = Math.hypot(2.8, 2.8);
  return [
    { op: 'scope', age: s.age, parts: body },
    { op: 'box', w: 0.8, h: 0.14, d: L, mat: { std: '#686d78', rough: 0.5, metal: 0.4 }, x: s.x + s.w / 2 + 0.45, y: s.y + 1.4, z: s.z + 0.2, rx: -PI / 4 },
    { op: 'box', w: 0.1, h: 0.1, d: L, mat: { named: 'dark' }, x: s.x + s.w / 2 + 0.85, y: s.y + 2.25, z: s.z + 0.2, rx: -PI / 4 },
  ];
}

// ── Temple hall on a stone base, with lanterns, guardian stones and an ema board ──
export interface TempleSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  wall: MatRef;
  age: number;
  moss: number;
}
export function planTemple(s: TempleSpec): Part[] {
  const lamp: MatRef = { lamp: '#fff1c4', glow: '#ffa94d', intensity: 2 };
  const parts: Part[] = [
    {
      op: 'scope',
      age: s.age,
      moss: s.moss,
      parts: [
        { op: 'box', w: s.w + 1.6, h: 0.4, d: s.d + 1.2, mat: { solid: '#8a8f99' }, x: s.x, y: s.y + 0.2, z: s.z },
        { op: 'box', w: s.w, h: s.h, d: s.d, mat: s.wall, x: s.x, y: s.y + 0.4 + s.h / 2, z: s.z },
        { op: 'gableX', w: s.w + 1.6, d: s.d + 2, h: 2.1, mat: { named: 'roofDark' }, x: s.x, y: s.y + 0.3 + s.h, z: s.z },
        { op: 'box', w: s.w + 1.8, h: 0.16, d: 1, mat: { named: 'roofDark' }, x: s.x, y: s.y + 2.85, z: s.z + 1.85, rx: 0.4 },
      ],
    },
    // offering box, bell rope and bell
    { op: 'box', w: 0.9, h: 0.5, d: 0.5, mat: { solid: '#45291b' }, x: s.x, y: s.y + 0.65, z: s.z + 1.5 },
    { op: 'cyl', rt: 0.04, rb: 0.04, h: 1.6, mat: { named: 'vermilion' }, x: s.x, y: s.y + 2, z: s.z + 1.3, seg: 4 },
    { op: 'cyl', rt: 0.18, rb: 0.18, h: 0.2, mat: { solid: '#c9a36b', rough: 0.4 }, x: s.x, y: s.y + 2.75, z: s.z + 1.3, seg: 8 },
  ];
  // stone lanterns at the corners of the base, guardian stones nearer the steps
  for (const dx of [-2.7, 2.7]) {
    const x = s.x + dx,
      z = s.z + 2.1;
    parts.push(
      { op: 'box', w: 0.32, h: 0.7, d: 0.32, mat: { named: 'stone' }, x, y: s.y + 0.35, z },
      { op: 'box', w: 0.48, h: 0.38, d: 0.48, mat: lamp, x, y: s.y + 0.9, z },
      { op: 'box', w: 0.64, h: 0.16, d: 0.64, mat: { solid: '#8a8f99' }, x, y: s.y + 1.17, z },
    );
  }
  for (const dx of [-1.5, 1.5]) {
    const x = s.x + dx,
      z = s.z + 2;
    parts.push(
      { op: 'box', w: 0.4, h: 0.5, d: 0.4, mat: { solid: '#8a8f99' }, x, y: s.y + 0.25, z },
      { op: 'box', w: 0.32, h: 0.4, d: 0.4, mat: { named: 'stone' }, x, y: s.y + 0.7, z },
    );
  }
  // ema (prayer plaque) rack: two posts, a little roof, and the plaques people have hung on it
  // (without the posts and roof it read as a plank with six squares)
  parts.push(
    { op: 'box', w: 1.4, h: 0.7, d: 0.1, mat: { solid: '#8a5634' }, x: s.x + 3.7, y: s.y + 0.9, z: s.z + 1.5 },
    { op: 'box', w: 0.12, h: 1.45, d: 0.12, mat: { solid: '#45291b' }, x: s.x + 2.95, y: s.y + 0.72, z: s.z + 1.5 },
    { op: 'box', w: 0.12, h: 1.45, d: 0.12, mat: { solid: '#45291b' }, x: s.x + 4.45, y: s.y + 0.72, z: s.z + 1.5 },
    { op: 'gableX', w: 1.9, d: 0.6, h: 0.22, mat: { solid: '#2e2a42' }, x: s.x + 3.7, y: s.y + 1.45, z: s.z + 1.5 },
  );
  for (let i = 0; i < 6; i++)
    parts.push({
      op: 'box',
      w: 0.18,
      h: 0.13,
      d: 0.03,
      mat: { solid: '#e8dcc2' },
      x: s.x + 3.2 + (i % 3) * 0.32,
      y: s.y + 0.95 + Math.floor(i / 3) * 0.2,
      z: s.z + 1.57,
    });
  return parts;
}

// ── The shopping street's entrance arch ──
export interface ArchSpec {
  x: number;
  z: number;
  y: number;
  span: number;
  h: number;
  sign: SignSpec;
}
export function planArch(s: ArchSpec): Part[] {
  const lantern: MatRef = { lamp: '#ff7a55', glow: '#ff3a1e', intensity: 1.1, accent: true };
  const parts: Part[] = [-s.span / 2, s.span / 2].map((dx) => ({
    op: 'cyl' as const,
    rt: 0.14,
    rb: 0.14,
    h: s.h,
    mat: { std: '#adb2b8', rough: 0.4, metal: 0.5 },
    x: s.x + dx,
    y: s.y + s.h / 2,
    z: s.z,
    seg: 8,
  }));
  // kept dimmer than the café: after dark the eye should land on Sunday Café first
  parts.push({ op: 'box', w: 4.4, h: 1.15, d: 0.26, mat: { lamp: '#d0402a', glow: '#ff6b3d', intensity: 0.45, accent: true }, x: s.x, y: s.y + s.h, z: s.z });
  parts.push({ op: 'sign', sign: s.sign, x: s.x, y: s.y + s.h, z: s.z + 0.14, ry: 0, glow: 0.25 });
  parts.push({ op: 'sign', sign: s.sign, x: s.x, y: s.y + s.h, z: s.z - 0.14, ry: PI, glow: 0.25 });
  for (const dx of [-0.95, 0, 0.95]) parts.push({ op: 'lantern', x: s.x + dx, y: s.y + s.h - 0.8, z: s.z, r: 0.18, mat: lantern });
  return parts;
}

// ── Sunday Café: the chamfered corner café, the town's focal point ──
export interface CafeSpec {
  /** Ground floor outline and the slightly larger trim outline (x, z), front along +z. */
  pts: readonly (readonly [number, number])[];
  trim: readonly (readonly [number, number])[];
  y: number;
  h1: number;
  h2: number;
  /** Upper-floor window centres along the front. */
  upper: readonly number[];
  cup: SignSpec;
  blade: SignSpec;
  /** Terrace tables (x along the front), and which parasol colour each gets. */
  tables: readonly { x: number; top: string }[];
  age: number;
}
export function planCafe(s: CafeSpec): Part[] {
  const xs = s.pts.map((p) => p[0]),
    zs = s.pts.map((p) => p[1]);
  const x1 = Math.max(...xs),
    fz = Math.max(...zs);
  const fx0 = s.pts.find((p) => p[1] === fz && p[0] !== x1)![0]; // where the front starts after the chamfer
  const cx = (fx0 + x1) / 2;
  const winW = x1 - fx0 - 0.8;
  const mullions = Math.floor(winW);
  const top = s.y + s.h1 + s.h2;
  const body: Part[] = [
    { op: 'prism', pts: s.pts, y: s.y, h: s.h1, mat: { tex: 'wood', color: '#45291b', rx: 0.5, ry: 0.4 } },
    { op: 'prism', pts: s.pts, y: s.y + s.h1, h: s.h2, mat: { tex: 'plaster', color: '#e8dcc2', rx: 0.45, ry: 0.36 } },
    { op: 'prism', pts: s.trim, y: s.y + s.h1 - 0.08, h: 0.22, mat: { solid: '#2a1912' } },
    { op: 'prism', pts: s.trim, y: top, h: 0.34, mat: { solid: '#45291b' } },
    { op: 'win', x: cx, y: s.y + 1.35, z: fz + 0.04, ry: 0, w: winW, h: 1.9, kind: 'cafe' },
  ];
  for (let i = 0; i < mullions; i++)
    body.push({ op: 'box', w: 0.14, h: 1.9, d: 0.06, mat: { solid: '#2a1912' }, x: cx + (i - (mullions - 1) / 2), y: s.y + 1.35, z: fz + 0.07 });
  body.push({ op: 'win', x: 11.17, y: s.y + 1.15, z: 1.03, ry: -PI / 4, w: 1.1, h: 2.1, kind: 'cafe' });
  for (const x of s.upper) body.push({ op: 'win', x, y: s.y + 4.3, z: fz + 0.04, ry: 0, w: 0.9, h: 1.1, kind: 'home' });
  body.push(
    { op: 'win', x: 11.17, y: s.y + 4.45, z: 1.03, ry: -PI / 4, w: 0.8, h: 0.8, kind: 'home' },
    { op: 'win', x: x1 + 0.04, y: s.y + 1.4, z: -1.2, ry: PI / 2, w: 2.4, h: 1.6, kind: 'cafe' },
    { op: 'win', x: x1 + 0.04, y: s.y + 4.3, z: -1.2, ry: PI / 2, w: 0.9, h: 1.1, kind: 'home' },
  );
  const parts: Part[] = [
    { op: 'scope', age: s.age, parts: body },
    {
      op: 'box',
      w: winW + 1,
      h: 0.14,
      d: 1.1,
      mat: { tex: 'stripe', color: '#ffffff', rx: 4, ry: 1, rough: 0.8 },
      x: cx,
      y: s.y + 2.8,
      z: fz + 0.55,
      rx: 0.38,
    },
    // the cup over the corner door, and CAFE hanging off the front like a blade sign
    { op: 'sign', sign: s.cup, x: 11.12, y: s.y + 3.55, z: 1.08, ry: -PI / 4, glow: 0.6 },
    { op: 'box', w: 1, h: 3.3, d: 0.1, mat: { lamp: '#2a1912', glow: '#45291b', intensity: 0.3 }, x: 11.95, y: s.y + 4.25, z: fz + 0.66, ry: PI / 2 },
    { op: 'sign', sign: s.blade, x: 12.01, y: s.y + 4.25, z: fz + 0.66, ry: PI / 2, glow: 0.6 },
  ];
  const tz = fz + 1.4;
  for (const t of s.tables)
    parts.push(
      { op: 'cyl', rt: 0.35, rb: 0.35, h: 0.06, mat: { solid: '#f6efe0' }, x: t.x, y: s.y + 0.78, z: tz, seg: 10 },
      { op: 'cyl', rt: 0.05, rb: 0.05, h: 0.75, mat: { named: 'dark' }, x: t.x, y: s.y + 0.38, z: tz, seg: 4 },
      { op: 'box', w: 0.3, h: 0.45, d: 0.3, mat: { solid: '#8a5634' }, x: t.x - 0.6, y: s.y + 0.22, z: tz },
      { op: 'box', w: 0.3, h: 0.45, d: 0.3, mat: { solid: '#8a5634' }, x: t.x + 0.6, y: s.y + 0.22, z: tz },
      { op: 'parasol', x: t.x, z: tz, y: s.y, top: t.top },
    );
  // pots by the door, and the roof garden
  parts.push({ op: 'pot', x: 10.9, z: fz + 0.8, y: s.y }, { op: 'pot', x: 16, z: fz + 0.8, y: s.y });
  for (const [x, z] of [
    [11.5, 0],
    [13.5, -1.5],
    [15.5, 0.6],
  ] as const)
    parts.push({ op: 'blob', x, y: top + 0.7, z, r: 0.4 });
  for (const [x, z] of [
    [13.2, -2.6],
    [14.1, 0.9],
  ] as const)
    parts.push({ op: 'pot', x, z, y: top + 0.34, r: 0.26 });
  parts.push(...roofTerrace(s, top + 0.34));
  return parts;
}

/**
 * The café's roof terrace: a steel railing round the edge, a string of small bulbs on poles above
 * it, a stair head with a door (how anyone gets up here), and a deck chair looking over the park.
 */
function roofTerrace(s: CafeSpec, y: number): Part[] {
  const parts: Part[] = [];
  const steel: MatRef = { solid: '#686d78' };
  // the railing follows the roof's edge, a little in from it
  const cx = s.pts.reduce((a, p) => a + p[0], 0) / s.pts.length,
    cz = s.pts.reduce((a, p) => a + p[1], 0) / s.pts.length;
  const ring = s.pts.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz);
    return [x - ((x - cx) / d) * 0.18, z - ((z - cz) / d) * 0.18] as const;
  });
  const bulb: MatRef = { lamp: '#fff1c4', glow: '#ffd37a', intensity: 0.9 };
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const dx = q[0] - p[0],
      dz = q[1] - p[1];
    const len = Math.hypot(dx, dz),
      ry = Math.atan2(-dz, dx);
    const mx = (p[0] + q[0]) / 2,
      mz = (p[1] + q[1]) / 2;
    // top rail, mid rail, a post at each corner and every 1.4 m or so
    parts.push(
      { op: 'box', w: len, h: 0.06, d: 0.06, mat: steel, x: mx, y: y + 0.95, z: mz, ry },
      { op: 'box', w: len, h: 0.04, d: 0.04, mat: steel, x: mx, y: y + 0.5, z: mz, ry },
    );
    const n = Math.max(1, Math.round(len / 1.4));
    for (let k = 0; k < n; k++) parts.push({ op: 'box', w: 0.06, h: 0.95, d: 0.06, mat: steel, x: p[0] + (dx * k) / n, y: y + 0.475, z: p[1] + (dz * k) / n });
    // a taller pole at each corner carries the string of bulbs, which sags a little between poles
    parts.push({ op: 'box', w: 0.05, h: 2.1, d: 0.05, mat: steel, x: p[0], y: y + 1.05, z: p[1] });
    const bulbs = Math.max(2, Math.round(len / 0.75));
    for (let k = 1; k < bulbs; k++) {
      const t = k / bulbs;
      parts.push({ op: 'box', w: 0.09, h: 0.09, d: 0.09, mat: bulb, x: p[0] + dx * t, y: y + 2.05 - Math.sin(Math.PI * t) * 0.28, z: p[1] + dz * t });
    }
  });
  // the stair head: a small plaster box with a door facing the terrace and a lean-to roof
  const [dx0, dz0] = ROOF_TERRACE.door;
  parts.push(
    { op: 'box', w: 1.5, h: 2.1, d: 1.6, mat: { tex: 'plaster', color: '#e8dcc2', rx: 0.5, ry: 0.5 }, x: dx0, y: y + 1.05, z: dz0 - 0.85 },
    { op: 'box', w: 1.7, h: 0.1, d: 1.8, mat: { solid: '#45291b' }, x: dx0, y: y + 2.15, z: dz0 - 0.85, rx: 0.12 },
    { op: 'box', w: 0.8, h: 1.7, d: 0.05, mat: { solid: '#2f4a72' }, x: dx0, y: y + 0.85, z: dz0 - 0.03 },
    { op: 'box', w: 0.08, h: 0.08, d: 0.05, mat: { solid: '#ffd37a' }, x: dx0 + 0.28, y: y + 0.9, z: dz0 },
    { op: 'box', w: 0.9, h: 0.06, d: 0.4, mat: { solid: '#8a8f99' }, x: dx0, y: y + 0.03, z: dz0 + 0.2 },
  );
  // the deck chair: a low striped sling on a wooden frame, facing west over the park
  const [chx, chz] = ROOF_TERRACE.chair;
  const sling: MatRef = { tex: 'stripe', color: '#ffffff', rx: 1, ry: 2, rough: 0.9 };
  parts.push(
    { op: 'box', w: 0.75, h: 0.06, d: 0.6, mat: sling, x: chx - 0.1, y: y + 0.3, z: chz, rz: -0.12 },
    { op: 'box', w: 0.7, h: 0.06, d: 0.6, mat: sling, x: chx + 0.45, y: y + 0.6, z: chz, rz: -0.95 },
    { op: 'box', w: 1.3, h: 0.05, d: 0.05, mat: { solid: '#8a5634' }, x: chx + 0.1, y: y + 0.22, z: chz - 0.32 },
    { op: 'box', w: 1.3, h: 0.05, d: 0.05, mat: { solid: '#8a5634' }, x: chx + 0.1, y: y + 0.22, z: chz + 0.32 },
    // a little side table and a cup
    { op: 'cyl', rt: 0.2, rb: 0.2, h: 0.04, mat: { solid: '#8a5634' }, x: chx, y: y + 0.42, z: chz + 0.75, seg: 8 },
    { op: 'cyl', rt: 0.03, rb: 0.03, h: 0.4, mat: { named: 'dark' }, x: chx, y: y + 0.2, z: chz + 0.75, seg: 4 },
    { op: 'box', w: 0.1, h: 0.09, d: 0.1, mat: { solid: '#f6efe0' }, x: chx, y: y + 0.49, z: chz + 0.75 },
  );
  return parts;
}

// ── The allotment's tool shed ──
export interface ShedSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  colour: string;
  age: number;
}
export function planToolShed(s: ShedSpec): Part[] {
  return [
    {
      op: 'scope',
      age: s.age,
      parts: [
        { op: 'box', w: s.w, h: s.h, d: s.d, mat: { tex: 'siding', color: s.colour, rx: 1, ry: 1 }, x: s.x, y: s.y + s.h / 2, z: s.z },
        {
          op: 'shed',
          x0: s.x - s.w / 2,
          x1: s.x + s.w / 2,
          z0: s.z - s.d / 2,
          z1: s.z + s.d / 2,
          y: s.y + s.h,
          rise: 0.3,
          hi: 'z0',
          wall: { solid: s.colour },
          roof: { named: 'roof' },
        },
      ],
    },
  ];
}
