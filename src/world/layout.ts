import type { Vec2, Rect } from '../core/math';
import type { SignSpec } from '../render/glyphs';

/**
 * The neighbourhood as data. Builders read this; the nav grid reads this; the
 * build tool reads this. Moving something here moves it everywhere.
 *
 * Coordinates: metres. x runs left->right along the front, z runs back->front
 * (camera sits at +x,+z looking at the corner). Ground level is G; the raised
 * temple terrace at the back is TG.
 */
export const G = 0.32;
export const TG = G + 1.4;

export const PLINTH = { w: 34, d: 26, h: 3.4 } as const;
export const GROUND: Rect = { x0: -16.4, x1: 16.4, z0: -12.4, z1: 12.4 };
export const TERRACE_FRONT_Z = -6;
export const STEPS: Rect = { x0: 2, x1: 4.4, z0: -8.4, z1: -6 };

/** Sudo-koen inspired pocket park pond (ornamental pond, vermilion bridge, Benzaiten islet).
 *  The narrow arm reaching to z=-3.8 is the stream fed by the waterfall on the terrace wall. */
export const POND: Vec2[] = [
  [-1.5, 0.5],
  [-0.45, -0.4],
  [-0.45, -3.8],
  [0.25, -3.8],
  [0.25, -1.0],
  [0.6, -1.3],
  [3.7, -1.5],
  [6.4, -0.2],
  [6.8, 2.6],
  [5.5, 4.9],
  [2.7, 5.5],
  [0, 4.7],
  [-1.6, 2.8],
];
export const ISLET = { x: 4.6, z: 2, r: 0.95 } as const;
/** A snow-viewing stone lantern (yukimi-dōrō) standing in the shallows, so the pond has a light to mirror at night. */
export const POND_LANTERN = { x: 2.9, z: -0.95 } as const;
export const BRIDGE = { x0: -2.2, x1: 3.65, z: 2, halfW: 0.55, rise: 0.85 } as const;
export const STREAM = { x: -0.1, z0: -6, z1: -0.6, w: 0.7 } as const;

export type RegionKind = 'lane' | 'path' | 'grass' | 'paving' | 'soil' | 'terrace' | 'steps' | 'front';
export interface Region extends Rect {
  id: string;
  kind: RegionKind;
}

/** Walkable surfaces. Order matters for `regionAt` (first match wins). */
export const REGIONS: Region[] = [
  { id: 'steps', kind: 'steps', x0: 2.05, x1: 4.35, z0: -8.4, z1: -6 },
  { id: 'terrace-walk', kind: 'terrace', x0: -16, x1: 16.2, z0: -9.0, z1: -6.2 },
  { id: 'lane-north', kind: 'lane', x0: -10.5, x1: 16.4, z0: -6, z1: -3.8 },
  { id: 'lane-west', kind: 'lane', x0: -10.5, x1: -8, z0: -3.8, z1: 12.4 },
  { id: 'path-south', kind: 'path', x0: -8, x1: 10.2, z0: 8.6, z1: 10.4 },
  { id: 'path-east', kind: 'path', x0: 8.2, x1: 10.2, z0: -3.8, z1: 8.6 },
  { id: 'park', kind: 'grass', x0: -8, x1: 8.2, z0: -3.8, z1: 8.6 },
  { id: 'cafe-terrace', kind: 'paving', x0: 10.2, x1: 16.4, z0: 1.6, z1: 4.4 },
  { id: 'allotment', kind: 'soil', x0: 10.2, x1: 16.4, z0: 4.4, z1: 12 },
  { id: 'front', kind: 'front', x0: -8, x1: 10.2, z0: 10.4, z1: 11.2 },
];

/** Circular / rectangular obstacles on walkable ground (trunks, benches, posts...). */
export type Obstacle = { x: number; z: number; r: number } | ({ rect: true } & Rect);

export interface DoorSpec {
  id: string;
  x: number;
  z: number;
  /** Direction the person faces when "inside" the door. */
  facing: number;
}

/** Where people disappear into buildings. */
export const DOORS: Record<string, DoorSpec> = {
  aptA: { id: 'aptA', x: -4.3, z: -9.25, facing: Math.PI },
  aptB: { id: 'aptB', x: -2, z: -9.25, facing: Math.PI },
  aptC: { id: 'aptC', x: 0.3, z: -9.25, facing: Math.PI },
  kyosho: { id: 'kyosho', x: -8.3, z: -9.0, facing: Math.PI },
  sento: { id: 'sento', x: -12.8, z: -8.3, facing: Math.PI },
  ramen: { id: 'ramen', x: -10.15, z: -2, facing: -Math.PI / 2 },
  bakery: { id: 'bakery', x: -10.15, z: 1.5, facing: -Math.PI / 2 },
  florist: { id: 'florist', x: -9.7, z: 4.7, facing: -Math.PI / 2 },
  books: { id: 'books', x: -10.15, z: 7.6, facing: -Math.PI / 2 },
  kissaten: { id: 'kissaten', x: 10.75, z: 1.75, facing: Math.PI * 0.75 },
  shed: { id: 'shed', x: 15.2, z: 10.8, facing: Math.PI },
  temple: { id: 'temple', x: 9.5, z: -8.75, facing: Math.PI },
};

/** Edges of the world where commuters come and go ("to the station"). */
export const EXITS: Vec2[] = [
  [-9.25, 12.3],
  [16.3, -4.9],
];

export type TreeKind = 'sakura' | 'deciduous' | 'evergreen';
export interface TreeSpec {
  x: number;
  z: number;
  r: number;
  kind: TreeKind;
  h: number;
  y?: number;
}
export const TREES: TreeSpec[] = [
  { x: -5.4, z: -1.4, r: 1.8, kind: 'sakura', h: 2.2 },
  { x: 0.2, z: 7.4, r: 1.5, kind: 'sakura', h: 2 },
  { x: 6.9, z: 7.6, r: 1.4, kind: 'sakura', h: 2 },
  { x: -7, z: 2, r: 2.2, kind: 'deciduous', h: 2.6 },
  { x: 7.3, z: -1.9, r: 1.2, kind: 'evergreen', h: 1.8 },
  { x: 14.6, z: -10.6, r: 2.5, kind: 'evergreen', h: 2.6, y: TG },
  { x: 5.2, z: -11.6, r: 1.7, kind: 'deciduous', h: 2.2, y: TG },
];

export const SHRUBS: Vec2[] = [
  [-1.9, 5.6],
  [6.3, 5.4],
  [-2.4, -0.4],
  [7.7, 1.4],
  [-7.4, 7.6],
  [-1.7, -3.3],
];

export interface BenchSpec {
  id: string;
  x: number;
  z: number;
  ry: number;
}
export const BENCHES: BenchSpec[] = [
  { id: 'bench-pond-a', x: -2.6, z: -2.6, ry: 0 },
  { id: 'bench-pond-b', x: 1.7, z: -2.8, ry: 0 },
  { id: 'bench-sakura', x: 7.3, z: 6.4, ry: -Math.PI / 2 },
  { id: 'bench-play', x: -2.8, z: 8.1, ry: Math.PI },
];

export const PARK_LAMPS: Vec2[] = [
  [-3.6, -3.2],
  [6.6, 8.1],
  [-7.6, 8.3],
];
export const POLES: Vec2[] = [
  [-7.85, -3.4],
  [-7.85, 2.6],
  [-7.85, 8.3],
  [0.6, -3.65],
  [8, -3.65],
];
export const VENDING: { x: number; z: number; body: string; face: string; glow: string }[] = [
  { x: 0.9, z: -5.6, body: '#e8ebee', face: '#c4f0ff', glow: '#4fd6ff' },
  { x: 1.9, z: -5.6, body: '#d0402a', face: '#fff1c4', glow: '#ffd37a' },
];

export const PLAYGROUND = { swingX: [-6.75, -5.85], swingZ: 5.4, slide: { x: -4.2, z: 7.1 }, sand: { x0: -7.4, x1: -3.6, z0: 4.8, z1: 8.0 } } as const;
export const CAFE_TABLES: Vec2[] = [
  [12.8, 3],
  [15, 3],
];
export const ALLOTMENT_ROWS = [5.4, 6.8, 8.2, 9.6];

// ── Quiet props (the density pass). One culturally loud prop for every three quiet ones. ──

/**
 * Potted plants on the doorsteps (Yanaka homes spill greenery onto the lane).
 * Per door: which sides get a pot (-1 / +1 along the wall), and how far to step
 * from the door spot toward the wall. Doors with goods out front (florist, books,
 * the bakery's rack side) keep their space.
 */
const DOORSTEPS: Record<string, { sides: readonly number[]; inset: number }> = {
  aptA: { sides: [-1, 1], inset: 0.2 },
  aptB: { sides: [1], inset: 0.2 },
  aptC: { sides: [-1], inset: 0.2 },
  kyosho: { sides: [1], inset: 0 },
  sento: { sides: [-1, 1], inset: 0 },
  ramen: { sides: [-1, 1], inset: 0.2 },
  bakery: { sides: [-1], inset: 0.2 },
  kissaten: { sides: [1], inset: 0.62 },
};
export const DOORSTEP_POTS: readonly Vec2[] = Object.entries(DOORSTEPS).flatMap(([id, { sides, inset }]) => {
  const d = DOORS[id]!;
  // a resident inside the door faces (sin f, cos f): "in" points at the wall, the side runs along it
  const inX = Math.sin(d.facing),
    inZ = Math.cos(d.facing);
  return sides.map((side): Vec2 => [d.x + inX * inset + inZ * side * 0.7, d.z + inZ * inset - inX * side * 0.7]);
});

/** Electricity meters on house walls: position on the wall and the way the wall faces. */
export const METERS: readonly { x: number; y: number; z: number; ry: number }[] = [
  { x: -5.1, y: TG + 1.5, z: -9.56, ry: 0 },
  { x: -15.88, y: TG + 0.8, z: -8.97, ry: 0 },
  { x: -10.47, y: G + 1.4, z: -3.4, ry: Math.PI / 2 },
  { x: 16.23, y: G + 1.3, z: 0.9, ry: Math.PI / 2 },
  { x: -6.47, y: TG + 1.4, z: -9.67, ry: Math.PI / 4 },
];

/** Rain-water downpipes: wall corner, top and bottom. They empty at the foot of the wall (a drip stain). */
export const DOWNPIPES: readonly { x: number; z: number; y0: number; y1: number }[] = [
  { x: 1.32, z: -9.66, y0: TG, y1: TG + 5.35 },
  { x: -5.32, z: -9.66, y0: TG, y1: TG + 5.35 },
  { x: -9.56, z: -9.06, y0: TG, y1: TG + 3.95 },
  { x: -10.55, z: -0.3, y0: G, y1: G + 4.4 },
  { x: -10.55, z: 6.1, y0: G, y1: G + 3.6 },
  { x: 16.28, z: 1.68, y0: G, y1: G + 5.6 },
];

export const ROAD_MIRRORS: readonly { x: number; z: number; ry: number }[] = [
  { x: -8.15, z: -3.95, ry: Math.PI / 4 },
  { x: 10.4, z: -3.72, ry: -Math.PI / 4 },
];

export const HOSE_REELS: readonly Vec2[] = [
  [-7.2, -9.15],
  [16.05, 10.6],
];
export const UMBRELLA_STANDS: readonly Vec2[] = [
  [12.1, 1.98],
  [-10.3, 0.35],
];
export const MILK_CRATES: Vec2 = [-10.22, -0.55];
/** Neighbourhood garbage point: bags under a weighted net, by the pole. */
export const GARBAGE_POINT: Vec2 = [-8.3, 9.05];
export const MAILBOX: Vec2 = [-8.3, 11.85];

export const OBSTACLES: Obstacle[] = [
  ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.45 })),
  ...SHRUBS.map(([x, z]) => ({ x, z, r: 0.55 })),
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 0.55 })),
  ...PARK_LAMPS.map(([x, z]) => ({ x, z, r: 0.25 })),
  ...POLES.map(([x, z]) => ({ x, z, r: 0.3 })),
  ...VENDING.map((v) => ({ x: v.x, z: v.z, r: 0.55 })),
  ...CAFE_TABLES.map(([x, z]) => ({ x, z, r: 0.7 })),
  { x: 3.3, z: -3.0, r: 0.25 },
  { x: 4.95, z: 2, r: 0.25 },
  { rect: true, x0: -7.45, x1: -5.2, z0: 5.1, z1: 5.7 },
  { rect: true, x0: -4.6, x1: -3.8, z0: 5, z1: 7.5 },
  { rect: true, x0: 14.8, x1: 16.2, z0: 11, z1: 12.2 },
  ...ALLOTMENT_ROWS.map((z) => ({ rect: true as const, x0: 10.8, x1: 15.8, z0: z - 0.38, z1: z + 0.38 })),
  { x: 6.8, z: -8.8, r: 0.4 },
  { x: 12.2, z: -8.8, r: 0.4 },
  { x: 8, z: -8.9, r: 0.35 },
  { x: 11, z: -8.9, r: 0.35 },
  { rect: true, x0: -0.6, x1: 0.4, z0: -6, z1: -5.2 },
  ...DOORSTEP_POTS.map(([x, z]) => ({ x, z, r: 0.22 })),
  ...HOSE_REELS.map(([x, z]) => ({ x, z, r: 0.3 })),
  ...UMBRELLA_STANDS.map(([x, z]) => ({ x, z, r: 0.2 })),
  { x: MILK_CRATES[0], z: MILK_CRATES[1], r: 0.3 },
  { x: GARBAGE_POINT[0], z: GARBAGE_POINT[1], r: 0.45 },
  { x: MAILBOX[0], z: MAILBOX[1], r: 0.3 },
];

/** Pond, stream and building interiors are never buildable; these are the soft areas players may decorate. */
export const BUILDABLE: RegionKind[] = ['grass', 'paving', 'front'];

/**
 * Signage, painted from the glyph atlas (render/glyphs.ts): short English words, so they fit a
 * shopfront and read at a glance. The shops' full names (Sunday Café, Midnight Noodle Club,
 * Butter & Blossom, Porchlight Florist, Paper Moon Books, Sunbeam Bathhouse) are in src/i18n/en.ts.
 * All invented; nothing names a real business. Listed for review in prompt 16.
 */
export const SIGNS = {
  // shotengai arch: the street's name
  // light letters on a dark ground: at 3×5, dark-on-light reads as its bright gaps instead of its strokes
  arch: { text: 'KOMOREBI', ink: '#fff1c4', bg: '#9a2b22', border: '#d0402a', pad: 0 },
  ramen: { text: 'RAMEN', vertical: true, ink: '#fff1c4', bg: '#9a2b22', pad: 1 },
  ramenCrest: { picto: 'ramen', ink: '#f6efe0', bg: '#9a2b22', pad: 0 },
  bakery: { text: 'BAKERY', ink: '#f6efe0', bg: '#653d27', pad: 0 },
  florist: { text: 'FLORIST', ink: '#f6efe0', bg: '#3c6838', pad: 0 },
  books: { text: 'BOOKS', ink: '#e8dcc2', bg: '#45291b', pad: 1 },
  booksCrest: { picto: 'book', ink: '#e8dcc2', bg: '#2f4a72', pad: 0 },
  sento: { text: 'BATH', ink: '#f6efe0', bg: '#2f4a72', pad: 0 },
  sentoBoard: { picto: 'bath', ink: '#2f4a72', bg: '#f6efe0', pad: 0 },
  // Sunday Café's blade sign, hanging off the front
  kissaten: { text: 'CAFE', vertical: true, ink: '#fff1c4', bg: '#2a1912', pad: 1 },
  kissatenCup: { picto: 'coffee', ink: '#ffd37a', bg: '#2a1912', border: '#8a5634', pad: 0 },
  plaque: { text: 'KOMOREBI-CHO', ink: '#45291b', bg: '#c9a36b', border: '#7d6b5a', pad: 1 },
  gas: { text: 'GAS', ink: '#16141f', bg: '#ffd37a', pad: 0 },
  water: { text: 'WATER', ink: '#f6efe0', bg: '#2f4a72', pad: 0 },
  fibre: { text: 'FIBER', ink: '#16141f', bg: '#ff6b3d', pad: 0 },
} as const satisfies Record<string, SignSpec>;
