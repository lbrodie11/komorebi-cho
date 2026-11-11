import * as THREE from 'three';
import type { Materials } from '../render/materials';

/**
 * The placeables catalogue (prompt 06 task 5), as data: each item is a short list of primitive
 * shapes with materials, a footprint, what residents can do with it, how novel it is and its
 * category. One builder turns shapes into a mesh, and the same shapes draw the item's palette
 * icon, so adding an item is one entry here plus its name in en.ts. All code-made: no models.
 *
 * Respectful specificity: generic forms only (no real shrine's furniture, no brand liveries).
 */

/** A material by description. Not cached: each placed item owns its materials (released on removal). */
export type ShapeMat =
  /** A plain colour ('#rrggbb'), or 'stone' / 'dark' for the shared stone and dark materials. */
  | string
  | { lamp: string; glow: string; i: number }
  | { std: string; rough?: number; metal?: number; double?: boolean }
  | { tex: 'wood' | 'stone' | 'plaster' | 'concrete'; color: string }
  | { leaves: 'sakura' | 'deciduous' | 'evergreen'; n?: number };

export interface Shape {
  /** box: [w, h, d]; cyl: [rTop, h, rBottom]; cone: [r, h]; ball: [r]; plane: [w, h] (faces +z). */
  s: 'box' | 'cyl' | 'cone' | 'ball' | 'plane';
  size: readonly number[];
  at: readonly [number, number, number];
  rot?: readonly [number, number, number];
  mat: ShapeMat;
  seg?: number;
}

export type Category = 'rest' | 'green' | 'light' | 'street' | 'shrine' | 'critters';
export const CATEGORIES: readonly Category[] = ['rest', 'green', 'light', 'street', 'shrine', 'critters'];

export type Affordance = 'sit' | 'drink' | 'admire' | 'feed-cats' | 'warmth';

export interface CatalogueItem {
  category: Category;
  radius: number;
  novelty: number;
  affords: Affordance[];
  glow?: { color: string; base: number; y: number };
  /** Chimes in the wind (the furin): the sound plays now and then while sound is on. */
  chime?: boolean;
  shapes: readonly Shape[];
}

const B = (w: number, h: number, d: number, x: number, y: number, z: number, mat: ShapeMat, rot?: Shape['rot']): Shape => ({
  s: 'box',
  size: [w, h, d],
  at: [x, y, z],
  mat,
  ...(rot ? { rot } : {}),
});
const C = (rt: number, h: number, rb: number, x: number, y: number, z: number, mat: ShapeMat, seg = 10): Shape => ({
  s: 'cyl',
  size: [rt, h, rb],
  at: [x, y, z],
  mat,
  seg,
});
const S = (r: number, x: number, y: number, z: number, mat: ShapeMat): Shape => ({ s: 'ball', size: [r], at: [x, y, z], mat });
const WOOD = '#8a5634';
const DARK_WOOD = '#653d27';
const STEEL = { std: '#adb2b8', rough: 0.45, metal: 0.4 } as const;
const VERMILION = '#d0402a';

/** A bicycle, side on, 1.6 m long (wheels as thin cylinders turned on their side). */
const bike = (x: number, z: number): Shape[] => [
  { s: 'cyl', size: [0.32, 0.04, 0.32], at: [x - 0.5, 0.32, z], rot: [Math.PI / 2, 0, 0], mat: 'dark', seg: 12 },
  { s: 'cyl', size: [0.32, 0.04, 0.32], at: [x + 0.5, 0.32, z], rot: [Math.PI / 2, 0, 0], mat: 'dark', seg: 12 },
  B(1, 0.05, 0.05, x, 0.55, z, '#4f73a3'),
  B(0.05, 0.4, 0.05, x - 0.15, 0.6, z, '#4f73a3'),
  B(0.25, 0.05, 0.1, x - 0.15, 0.82, z, 'dark'),
  B(0.05, 0.05, 0.4, x + 0.45, 0.85, z, 'dark'),
];

export const CATALOGUE = {
  // ── Rest ──
  stools: {
    category: 'rest',
    radius: 0.55,
    novelty: 0.35,
    affords: ['sit'],
    shapes: [
      C(0.2, 0.45, 0.17, -0.35, 0.225, 0, WOOD),
      C(0.2, 0.45, 0.17, 0.35, 0.225, 0, WOOD),
      C(0.21, 0.05, 0.21, -0.35, 0.47, 0, VERMILION),
      C(0.21, 0.05, 0.21, 0.35, 0.47, 0, VERMILION),
    ],
  },
  porchBench: {
    category: 'rest',
    radius: 0.75,
    novelty: 0.45,
    affords: ['sit'],
    shapes: [B(1.8, 0.07, 0.6, 0, 0.4, 0, { tex: 'wood', color: '#b07a4c' }), ...[-0.75, 0, 0.75].map((x) => B(0.1, 0.38, 0.5, x, 0.19, 0, DARK_WOOD))],
  },
  busStop: {
    category: 'rest',
    radius: 0.9,
    novelty: 0.6,
    affords: ['sit'],
    shapes: [
      B(0.08, 2.3, 0.08, -0.9, 1.15, -0.35, STEEL),
      B(0.08, 2.3, 0.08, 0.9, 1.15, -0.35, STEEL),
      B(2.1, 0.08, 0.9, 0, 2.32, 0, '#2f4a72'),
      B(1.8, 1.4, 0.04, 0, 1.2, -0.4, { std: '#c4dcee', rough: 0.1, double: true }),
      B(1.5, 0.07, 0.35, 0, 0.45, -0.2, WOOD),
      B(0.06, 0.45, 0.3, -0.6, 0.22, -0.2, 'dark'),
      B(0.06, 0.45, 0.3, 0.6, 0.22, -0.2, 'dark'),
      C(0.18, 0.06, 0.18, 1.2, 2.1, 0.3, '#ffd37a'),
      B(0.05, 2.1, 0.05, 1.2, 1.05, 0.3, STEEL),
    ],
  },
  picnicTable: {
    category: 'rest',
    radius: 0.9,
    novelty: 0.5,
    affords: ['sit'],
    shapes: [
      B(1.5, 0.06, 0.7, 0, 0.75, 0, WOOD),
      B(1.5, 0.05, 0.25, 0, 0.45, -0.55, WOOD),
      B(1.5, 0.05, 0.25, 0, 0.45, 0.55, WOOD),
      B(0.08, 0.75, 1.3, -0.6, 0.37, 0, DARK_WOOD),
      B(0.08, 0.75, 1.3, 0.6, 0.37, 0, DARK_WOOD),
    ],
  },
  // ── Green ──
  bonsai: {
    category: 'green',
    radius: 0.4,
    novelty: 0.5,
    affords: ['admire'],
    shapes: [
      B(0.6, 0.5, 0.4, 0, 0.25, 0, DARK_WOOD),
      B(0.4, 0.12, 0.28, 0, 0.56, 0, '#4f73a3'),
      C(0.04, 0.35, 0.06, 0.05, 0.78, 0, '#45291b', 5),
      S(0.22, -0.08, 0.98, 0, { leaves: 'evergreen' }),
      S(0.16, 0.18, 1.02, 0.05, { leaves: 'evergreen', n: 1 }),
    ],
  },
  vegPlanter: {
    category: 'green',
    radius: 0.55,
    novelty: 0.4,
    affords: ['admire'],
    shapes: [
      B(1.2, 0.35, 0.6, 0, 0.175, 0, { tex: 'wood', color: WOOD }),
      B(1.1, 0.05, 0.5, 0, 0.36, 0, '#45291b'),
      ...[-0.4, 0, 0.4].map((x, i) => S(0.13, x, 0.48, 0, i === 1 ? '#d0402a' : '#5b8c45')),
    ],
  },
  bamboo: {
    category: 'green',
    radius: 0.45,
    novelty: 0.6,
    affords: ['admire'],
    shapes: [
      ...[-0.15, 0.1, 0.2, -0.05].map((x, i) => C(0.04, 2.6 + i * 0.3, 0.05, x, (2.6 + i * 0.3) / 2, (i % 2) * 0.15 - 0.05, '#86b45a', 6)),
      S(0.35, -0.1, 2.7, 0, { leaves: 'evergreen' }),
      S(0.3, 0.15, 3.1, 0.1, { leaves: 'evergreen', n: 1 }),
    ],
  },
  maple: {
    category: 'green',
    radius: 0.45,
    novelty: 0.85,
    affords: ['admire'],
    shapes: [
      C(0.1, 1.6, 0.16, 0, 0.8, 0, '#45291b', 6),
      S(0.6, 0, 1.9, 0, { leaves: 'deciduous' }),
      S(0.45, 0.4, 1.7, 0.15, { leaves: 'deciduous', n: 1 }),
      S(0.4, -0.35, 1.75, -0.1, { leaves: 'deciduous', n: 2 }),
    ],
  },
  potCluster: {
    category: 'green',
    radius: 0.45,
    novelty: 0.3,
    affords: ['admire'],
    shapes: [
      C(0.17, 0.3, 0.13, -0.2, 0.15, 0, '#b07a4c'),
      S(0.2, -0.2, 0.42, 0, { leaves: 'evergreen' }),
      C(0.14, 0.25, 0.1, 0.18, 0.125, 0.12, '#cfd2d4'),
      S(0.15, 0.18, 0.33, 0.12, { leaves: 'evergreen', n: 1 }),
      C(0.12, 0.22, 0.1, 0.1, 0.11, -0.2, '#b07a4c'),
      S(0.11, 0.1, 0.3, -0.2, '#f4c7cf'),
    ],
  },
  // ── Light ──
  andon: {
    category: 'light',
    radius: 0.35,
    novelty: 0.55,
    affords: ['admire', 'warmth'],
    glow: { color: '#ffb35a', base: 5, y: 0.9 },
    shapes: [
      B(0.4, 0.06, 0.4, 0, 0.03, 0, DARK_WOOD),
      B(0.36, 0.7, 0.36, 0, 0.75, 0, { lamp: '#fff1c4', glow: '#ffa94d', i: 1.8 }),
      B(0.42, 0.06, 0.42, 0, 1.13, 0, DARK_WOOD),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.04, 0.4, 0.04, sx * 0.18, 0.2, sz * 0.18, DARK_WOOD))),
    ],
  },
  lanternString: {
    category: 'light',
    radius: 0.4,
    novelty: 0.75,
    affords: ['admire'],
    glow: { color: '#ff7a55', base: 5, y: 2.2 },
    shapes: [
      B(0.07, 2.6, 0.07, -1.4, 1.3, 0, DARK_WOOD),
      B(0.07, 2.6, 0.07, 1.4, 1.3, 0, DARK_WOOD),
      B(2.8, 0.02, 0.02, 0, 2.5, 0, 'dark'),
      ...[-1, -0.33, 0.33, 1].map((x) => ({ ...S(0.15, x, 2.25 - (1 - Math.abs(x)) * 0.12, 0, { lamp: '#ff7a55', glow: '#ff3a1e', i: 1.6 }), size: [0.15] })),
    ],
  },
  lampPost: {
    category: 'light',
    radius: 0.3,
    novelty: 0.45,
    affords: ['admire', 'warmth'],
    glow: { color: '#ffd9a0', base: 6, y: 2.6 },
    shapes: [
      C(0.06, 2.6, 0.08, 0, 1.3, 0, '#3f3a58', 6),
      C(0.12, 0.08, 0.16, 0, 0.04, 0, '#3f3a58', 6),
      B(0.26, 0.32, 0.26, 0, 2.75, 0, { lamp: '#fff1c4', glow: '#ffe2b0', i: 2 }),
      { s: 'cone', size: [0.24, 0.16], at: [0, 3, 0], mat: '#3f3a58', seg: 4 },
    ],
  },
  // ── Street ──
  bikeRack: {
    category: 'street',
    radius: 0.85,
    novelty: 0.35,
    affords: ['admire'],
    shapes: [B(1.6, 0.05, 0.05, 0, 0.3, -0.2, STEEL), ...[-0.6, 0, 0.6].map((x) => B(0.05, 0.3, 0.05, x, 0.15, -0.2, STEEL)), ...bike(0, 0.1)],
  },
  postBox: {
    category: 'street',
    radius: 0.3,
    novelty: 0.3,
    affords: ['admire'],
    shapes: [
      C(0.25, 1.2, 0.25, 0, 0.6, 0, '#c0392b', 12),
      { s: 'cone', size: [0.27, 0.12], at: [0, 1.26, 0], mat: '#c0392b', seg: 12 },
      B(0.3, 0.04, 0.02, 0, 0.95, 0.25, 'dark'),
    ],
  },
  crates: {
    category: 'street',
    radius: 0.45,
    novelty: 0.25,
    affords: ['admire'],
    shapes: [
      B(0.5, 0.3, 0.38, -0.1, 0.15, 0, '#d0402a'),
      B(0.5, 0.3, 0.38, -0.1, 0.45, 0, '#ffd37a'),
      B(0.5, 0.3, 0.38, 0.35, 0.15, 0.1, '#2f4a72'),
      ...[-0.25, -0.1, 0.05].map((x) => C(0.04, 0.22, 0.04, x, 0.71, 0, '#3c6838', 6)),
    ],
  },
  laundryPole: {
    category: 'street',
    radius: 0.75,
    novelty: 0.35,
    affords: ['admire'],
    shapes: [
      B(0.06, 1.8, 0.06, -0.8, 0.9, 0, STEEL),
      B(0.06, 1.8, 0.06, 0.8, 0.9, 0, STEEL),
      C(0.02, 1.7, 0.02, 0, 1.75, 0, STEEL, 6),
      ...['#f6efe0', '#86aed4', '#e59b9b', '#ffd37a'].map((c, i): Shape => ({
        s: 'plane',
        size: [0.32, 0.45],
        at: [-0.55 + i * 0.37, 1.5, 0],
        mat: { std: c, double: true },
      })),
    ],
  },
  sandwichBoard: {
    category: 'street',
    radius: 0.35,
    novelty: 0.3,
    affords: ['admire'],
    shapes: [
      B(0.55, 0.85, 0.04, 0, 0.42, 0.12, '#2a1912', [-0.22, 0, 0]),
      B(0.55, 0.85, 0.04, 0, 0.42, -0.12, '#2a1912', [0.22, 0, 0]),
      B(0.4, 0.3, 0.01, 0, 0.55, 0.15, '#f6efe0', [-0.22, 0, 0]),
    ],
  },
  vendingRed: {
    category: 'street',
    radius: 0.55,
    novelty: 0.45,
    affords: ['drink'],
    glow: { color: '#ffd9a0', base: 4, y: 1.3 },
    shapes: [
      B(0.9, 1.9, 0.7, 0, 0.95, 0, { std: '#c0392b', rough: 0.4 }),
      { s: 'plane', size: [0.72, 1.1], at: [0, 1.2, 0.36], mat: { lamp: '#fff1c4', glow: '#ffd9a0', i: 1.6 } },
      B(0.6, 0.22, 0.04, 0, 0.32, 0.36, '#16141f'),
    ],
  },
  // ── Shrine pieces (generic; nothing copied from a real shrine) ──
  foxStatues: {
    category: 'shrine',
    radius: 0.7,
    novelty: 0.55,
    affords: ['admire'],
    shapes: [-0.55, 0.55].flatMap(
      (x) =>
        [
          B(0.36, 0.3, 0.36, x, 0.15, 0, 'stone'),
          B(0.22, 0.4, 0.26, x, 0.5, 0, '#e8ebee'),
          { s: 'cone', size: [0.13, 0.25], at: [x, 0.83, 0.03], mat: '#e8ebee', seg: 4 },
          B(0.2, 0.06, 0.06, x, 0.6, 0.15, VERMILION),
        ] as Shape[],
    ),
  },
  emaBoard: {
    category: 'shrine',
    radius: 0.6,
    novelty: 0.45,
    affords: ['admire'],
    shapes: [
      B(0.07, 1.2, 0.07, -0.6, 0.6, 0, DARK_WOOD),
      B(0.07, 1.2, 0.07, 0.6, 0.6, 0, DARK_WOOD),
      B(1.3, 0.6, 0.06, 0, 0.95, 0, WOOD),
      B(1.45, 0.08, 0.2, 0, 1.3, 0, '#3f3a58'),
      ...[0, 1, 2, 3, 4, 5].map((i) => B(0.18, 0.13, 0.02, -0.4 + (i % 3) * 0.4, 0.88 + Math.floor(i / 3) * 0.18, 0.05, '#e8dcc2')),
    ],
  },
  tanuki: {
    category: 'shrine',
    radius: 0.35,
    novelty: 0.6,
    affords: ['admire'],
    shapes: [
      S(0.3, 0, 0.3, 0, '#8a5634'),
      S(0.2, 0, 0.72, 0, '#8a5634'),
      { s: 'cone', size: [0.2, 0.12], at: [0, 0.92, 0], mat: '#c9a36b', seg: 8 },
      S(0.07, 0, 0.66, 0.18, '#45291b'),
      C(0.08, 0.3, 0.08, 0.25, 0.35, 0.12, '#c9a36b', 6),
    ],
  },
  waterBasin: {
    category: 'shrine',
    radius: 0.45,
    novelty: 0.5,
    affords: ['admire'],
    shapes: [
      C(0.38, 0.4, 0.42, 0, 0.2, 0, 'stone', 10),
      C(0.3, 0.02, 0.3, 0, 0.4, 0, { std: '#4f73a3', rough: 0.1 }, 10),
      B(0.9, 0.03, 0.05, 0.1, 0.5, 0, '#86b45a', [0, 0.3, 0.12]),
    ],
  },
  // ── Critters ──
  catHouse: {
    category: 'critters',
    radius: 0.4,
    novelty: 0.45,
    affords: ['feed-cats'],
    shapes: [
      B(0.6, 0.45, 0.5, 0, 0.225, 0, { tex: 'wood', color: '#b07a4c' }),
      { s: 'cone', size: [0.48, 0.3], at: [0, 0.6, 0], mat: VERMILION, seg: 4, rot: [0, Math.PI / 4, 0] },
      B(0.22, 0.24, 0.02, 0, 0.17, 0.26, '#16141f'),
      C(0.12, 0.05, 0.1, 0.4, 0.025, 0.2, '#4f73a3'),
    ],
  },
  windChime: {
    category: 'critters',
    radius: 0.3,
    novelty: 0.4,
    affords: ['admire'],
    chime: true,
    shapes: [
      B(0.05, 1.7, 0.05, 0, 0.85, 0, DARK_WOOD),
      B(0.45, 0.04, 0.04, 0.2, 1.7, 0, DARK_WOOD),
      { s: 'ball', size: [0.09], at: [0.4, 1.56, 0], mat: { std: '#c4dcee', rough: 0.1 } },
      { s: 'plane', size: [0.06, 0.2], at: [0.4, 1.38, 0], mat: { std: '#f4c7cf', double: true } },
    ],
  },
  birdBath: {
    category: 'critters',
    radius: 0.35,
    novelty: 0.4,
    affords: ['admire'],
    shapes: [
      C(0.08, 0.7, 0.12, 0, 0.35, 0, 'stone', 8),
      C(0.35, 0.08, 0.25, 0, 0.74, 0, 'stone', 12),
      C(0.3, 0.02, 0.3, 0, 0.78, 0, { std: '#86aed4', rough: 0.1 }, 12),
    ],
  },
} as const satisfies Record<string, CatalogueItem>;

export type CatalogueKind = keyof typeof CATALOGUE;

function material(m: Materials, mat: ShapeMat): THREE.Material {
  if (typeof mat === 'string') return mat === 'stone' ? m.stone : mat === 'dark' ? m.dark : m.solid(mat);
  if ('lamp' in mat) return m.lamp(mat.lamp, mat.glow, mat.i);
  if ('leaves' in mat) {
    const set = m.leaves[mat.leaves];
    return set[(mat.n ?? 0) % set.length]!;
  }
  if ('tex' in mat) return m.tex2(mat.tex, mat.color, 1, 1);
  return m.std(mat.std, mat.rough ?? 0.9, { ...(mat.metal !== undefined ? { metalness: mat.metal } : {}), ...(mat.double ? { side: THREE.DoubleSide } : {}) });
}

function geometry(sh: Shape): THREE.BufferGeometry {
  const z = sh.size;
  switch (sh.s) {
    case 'box':
      return new THREE.BoxGeometry(z[0], z[1], z[2]);
    case 'cyl':
      return new THREE.CylinderGeometry(z[0], z[2] ?? z[0], z[1], sh.seg ?? 10);
    case 'cone':
      return new THREE.ConeGeometry(z[0], z[1], sh.seg ?? 8);
    case 'ball':
      return new THREE.IcosahedronGeometry(z[0], 0);
    case 'plane':
      return new THREE.PlaneGeometry(z[0], z[1]);
  }
}

/** Build a catalogue item's mesh from its shapes (front faces +z, like the original placeables). */
export function buildShapes(m: Materials, shapes: readonly Shape[]): THREE.Group {
  const g = new THREE.Group();
  for (const sh of shapes) {
    const mesh = new THREE.Mesh(geometry(sh), material(m, sh.mat));
    mesh.position.set(sh.at[0], sh.at[1], sh.at[2]);
    if (sh.rot) mesh.rotation.set(sh.rot[0], sh.rot[1], sh.rot[2]);
    // foliage above head height is a canopy: the sun comes through it (komorebi); a bonsai stays solid
    if (typeof sh.mat === 'object' && 'leaves' in sh.mat && sh.at[1] >= 1.5) mesh.userData.canopy = true;
    g.add(mesh);
  }
  return g;
}

/** A shape's colour for the palette icon. */
function iconColour(mat: ShapeMat): string {
  if (typeof mat === 'string') return mat === 'stone' ? '#adb2b8' : mat === 'dark' ? '#2e2a42' : mat;
  if ('lamp' in mat) return mat.lamp;
  if ('leaves' in mat) return mat.leaves === 'sakura' ? '#f4c7cf' : mat.leaves === 'deciduous' ? '#e08a3c' : '#5b8c45';
  if ('tex' in mat) return mat.color;
  return mat.std;
}

/**
 * Rasterise an item's shapes, seen from the front, into an n×n icon: each shape's x/y extent as a
 * filled rectangle (spheres and cylinders as their bounding boxes), back to front. Pure: returns
 * colours per cell (null = empty), so it is unit-tested; the HUD paints it into a canvas.
 */
export function iconCells(shapes: readonly Shape[], n = 8): (string | null)[] {
  const ext = shapes.map((sh) => {
    const [a, b] = sh.size;
    const hw = sh.s === 'box' || sh.s === 'plane' ? a! / 2 : sh.s === 'cyl' ? Math.max(a!, sh.size[2] ?? a!) : a!;
    const hh = sh.s === 'box' || sh.s === 'plane' ? b! / 2 : sh.s === 'ball' ? a! : sh.s === 'cyl' || sh.s === 'cone' ? b! / 2 : a!;
    return { x0: sh.at[0] - hw, x1: sh.at[0] + hw, y0: sh.at[1] - hh, y1: sh.at[1] + hh, z: sh.at[2], c: iconColour(sh.mat) };
  });
  const X0 = Math.min(...ext.map((e) => e.x0)),
    X1 = Math.max(...ext.map((e) => e.x1)),
    Y0 = Math.min(...ext.map((e) => e.y0)),
    Y1 = Math.max(...ext.map((e) => e.y1));
  const span = Math.max(X1 - X0, Y1 - Y0, 1e-6);
  const ox = (span - (X1 - X0)) / 2,
    oy = (span - (Y1 - Y0)) / 2;
  const cells: (string | null)[] = new Array<string | null>(n * n).fill(null);
  for (const e of [...ext].sort((a, b) => a.z - b.z)) {
    const cx0 = Math.floor(((e.x0 - X0 + ox) / span) * n),
      cx1 = Math.max(cx0, Math.ceil(((e.x1 - X0 + ox) / span) * n) - 1);
    const cy0 = Math.floor(((Y1 - e.y1 + oy) / span) * n),
      cy1 = Math.max(cy0, Math.ceil(((Y1 - e.y0 + oy) / span) * n) - 1);
    for (let y = Math.max(0, cy0); y <= Math.min(n - 1, cy1); y++) for (let x = Math.max(0, cx0); x <= Math.min(n - 1, cx1); x++) cells[y * n + x] = e.c;
  }
  return cells;
}
