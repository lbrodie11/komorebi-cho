import type { Vec2, Rect } from '../core/math';
import type { ShopHouseSpec } from './grammar/types';
import type { ApatoSpec, ArchSpec, CafeSpec, MicroHomeSpec, SentoSpec, ShedSpec, TempleSpec } from './grammar/archetypes/landmarks';
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
/**
 * Where service wires enter buildings (x, socket height, z). The wire solver hangs each from its
 * nearest pole (src/world/grammar/wires.ts); nothing here says which pole.
 */
export const DROPS: readonly { x: number; y: number; z: number }[] = [
  { x: -10.5, y: G + 4.6, z: -2 },
  { x: -10.5, y: G + 3.8, z: 1.5 },
  { x: -10.5, y: G + 3.4, z: 4.7 },
  { x: -10.5, y: G + 4.4, z: 7.6 },
  { x: 0, y: TG + 5, z: -9.6 },
  { x: -7.6, y: TG + 7, z: -9.2 },
  { x: 10.7, y: G + 5, z: -1 },
  { x: 9.5, y: TG + 4.4, z: -9.4 },
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

/**
 * The shopping street's shop-houses, as data for the building grammar (src/world/grammar).
 * They front east on the lane at x = -10.5; the frontage is z0..z1. Change a frontage and the
 * grammar re-plans the bays, windows, awning and sign; nothing is stretched.
 */
export const SHOPS: readonly ShopHouseSpec[] = [
  {
    id: 'ramen',
    use: 'food',
    z0: -3.6,
    z1: -0.4,
    frontX: -10.5,
    depth: 5.7,
    height: 5.2,
    wall: { tex: 'wood', color: '#653d27', rx: 2, ry: 2 },
    roof: 'flat',
    tank: true,
    noren: '#9a2b22',
    crest: SIGNS.ramenCrest,
    hours: [11, 23],
    age: 0.8,
    attachments: [{ kind: 'lanternSign', sign: SIGNS.ramen }],
  },
  {
    id: 'bakery',
    use: 'food',
    z0: -0.2,
    z1: 3.2,
    frontX: -10.5,
    depth: 5.7,
    height: 4.4,
    wall: { tex: 'plaster', color: '#e8dcc2', rx: 2, ry: 1.5 },
    roof: 'gable',
    awning: { tex: 'stripe', color: '#ffffff', rx: 3, ry: 1, rough: 0.8 },
    sign: { spec: SIGNS.bakery, y: 3.4 },
    hours: [7, 19],
    age: 0.5,
    attachments: [{ kind: 'ac', y: 4, dz: 0.1, age: 0.8 }, { kind: 'breadRack' }],
  },
  {
    id: 'florist',
    use: 'shop',
    z0: 3.4,
    z1: 6,
    frontX: -10.5,
    depth: 5.7,
    height: 3.6,
    wall: { tex: 'wood', color: '#8a5634', rx: 2, ry: 1.2 },
    roof: 'shed',
    awning: { solid: '#3c6838' },
    sign: { spec: SIGNS.florist, y: 3.1 },
    hours: [9, 18],
    age: 0.65,
    attachments: [{ kind: 'flowerBuckets' }],
  },
  {
    id: 'books',
    use: 'shop',
    z0: 6.2,
    z1: 9,
    frontX: -10.5,
    depth: 5.7,
    height: 5,
    wall: { tex: 'siding', color: '#8a8f99', rx: 2, ry: 2 },
    roof: 'flat',
    noren: '#2f4a72',
    crest: SIGNS.booksCrest,
    sign: { spec: SIGNS.books, y: 3.8 },
    hours: [10, 20],
    age: 0.7,
    attachments: [{ kind: 'bookCart' }],
  },
];

/**
 * The landmarks, as data for their archetypes (src/world/grammar/archetypes/landmarks.ts).
 * Weathering ages are art direction: the old timber bath and temple are the most stained, the
 * recent concrete micro-home the least.
 */
export const SENTO: SentoSpec = {
  x: -12.8,
  z: -10.7,
  y: TG,
  w: 6.6,
  d: 3.4,
  h: 4,
  wall: { tex: 'wood', color: '#8a5634', rx: 2.5, ry: 1.4 },
  entrance: { tex: 'wood', color: '#653d27', rx: 1, ry: 1 },
  chimney: { x: -14.9, z: -11.9, h: 13, mat: { tex: 'concrete', color: '#adb2b8', rx: 1, ry: 4 } },
  noren: '#2f4a72',
  sign: SIGNS.sento,
  board: SIGNS.sentoBoard,
  age: 0.85,
};
export const MICRO_HOME: MicroHomeSpec = {
  pts: [
    [-9.2, -12.4],
    [-6, -12.4],
    [-6, -10.2],
    [-7, -9.2],
    [-9.2, -9.2],
  ],
  y: TG,
  h: 9.2,
  wall: { tex: 'concrete', color: '#b3b7bc', rx: 0.4, ry: 0.36 },
  roof: { solid: '#4b4f5a', rough: 0.6 },
  age: 0.25,
};
export const APATO: ApatoSpec = { x: -2, z: -11, y: TG, w: 6.8, d: 2.8, h: 5.4, wall: { tex: 'plaster', color: '#e8dcc2', rx: 2, ry: 1.5 }, age: 0.6 };
export const TEMPLE: TempleSpec = { x: 9.5, z: -10.9, y: TG, w: 6, d: 2.4, h: 2.6, wall: { tex: 'wood', color: '#5a3622', rx: 2, ry: 1 }, age: 0.9, moss: 0.5 };
export const ARCH: ArchSpec = { x: -9.25, z: 9.6, y: G, span: 2.6, h: 4.4, sign: SIGNS.arch };
export const CAFE: CafeSpec = {
  pts: [
    [10.6, -3.6],
    [16.2, -3.6],
    [16.2, 1.6],
    [11.8, 1.6],
    [10.6, 0.4],
  ],
  trim: [
    [10.45, -3.75],
    [16.35, -3.75],
    [16.35, 1.75],
    [11.86, 1.75],
    [10.45, 0.34],
  ],
  y: G,
  h1: 3,
  h2: 2.6,
  upper: [12.7, 14.2, 15.6],
  cup: SIGNS.kissatenCup,
  blade: SIGNS.kissaten,
  tables: [
    { x: 12.8, top: '#f6efe0' },
    { x: 15, top: '#2f7f7a' },
  ],
  age: 0.55,
};
export const TOOL_SHED: ShedSpec = { x: 15.5, z: 11.6, y: G, w: 1.2, d: 1, h: 1.4, colour: '#4f73a3', age: 0.5 };
