import type { SignSpec } from '../../render/glyphs';
import type { TexKind } from '../../render/materials';
import type { WindowKind } from '../lighting';

/**
 * The building grammar's vocabulary (prompt 05). A building is data (a spec); the grammar turns
 * it into parts (plain data, no three.js), and evaluate.ts turns parts into geometry with Kit.
 * Keeping the middle step as data makes the rules unit-testable and lets an edit re-plan one
 * building, or one seam, without touching the rest.
 */

/** A material by description, resolved by evaluate.ts through Materials' caches. */
export type MatRef =
  | { tex: TexKind; color: string; rx: number; ry: number; rough?: number }
  | { solid: string; rough?: number }
  | { std: string; rough?: number; metal?: number; double?: boolean; flat?: boolean }
  /** A lamp material (it glows at night). The same description gives the same material within one build. */
  | { lamp: string; glow: string; intensity: number }
  | { named: 'roof' | 'roofDark' | 'dark' | 'lantern' | 'stone' | 'vermilion' };

export type Part =
  /** Everything inside weathers together (age 0 new .. 1 old). */
  | { op: 'scope'; age: number; moss?: number; parts: Part[] }
  | { op: 'box'; w: number; h: number; d: number; mat: MatRef; x: number; y: number; z: number; rx?: number; ry?: number; rz?: number }
  | { op: 'gableZ'; w: number; d: number; h: number; mat: MatRef; x: number; y: number; z: number }
  | { op: 'gableX'; w: number; d: number; h: number; mat: MatRef; x: number; y: number; z: number }
  | { op: 'prism'; pts: readonly (readonly [number, number])[]; y: number; h: number; mat: MatRef }
  | { op: 'shed'; x0: number; x1: number; z0: number; z1: number; y: number; rise: number; hi: 'x0' | 'x1' | 'z0' | 'z1'; wall: MatRef; roof: MatRef }
  | { op: 'cyl'; rt: number; rb: number; h: number; mat: MatRef; x: number; y: number; z: number; seg?: number }
  | { op: 'win'; x: number; y: number; z: number; ry: number; w: number; h: number; kind: WindowKind; hours?: readonly [number, number] }
  | { op: 'plane'; w: number; h: number; mat: MatRef; x: number; y: number; z: number; ry: number }
  | { op: 'sign'; sign: SignSpec; x: number; y: number; z: number; ry: number; glow?: number }
  | { op: 'shutter'; x: number; y: number; z: number; ry: number; w: number; h: number; hours: readonly [number, number] }
  | { op: 'ac'; x: number; y: number; z: number; ry: number }
  /** A paper lantern (tracked: lanterns sway and light up at dusk). */
  | { op: 'lantern'; x: number; y: number; z: number; r?: number; mat?: MatRef }
  /** A rounded clump: foliage by default, or any material. */
  | { op: 'blob'; x: number; y: number; z: number; r: number; mat?: MatRef }
  /** A small faceted bloom (the florist's buckets). */
  | { op: 'gem'; x: number; y: number; z: number; r: number; mat: MatRef }
  | { op: 'pot'; x: number; z: number; y: number; r?: number }
  /** A café parasol (tracked: parasols fold away in rain). */
  | { op: 'parasol'; x: number; z: number; y: number; top: string };

/** What a building is used for, as far as its neighbours care (shared awnings over food, laundry at the back of homes). */
export type Use = 'food' | 'shop' | 'home' | 'civic';

/**
 * A shop-house (machiya / Showa shop-house) on the shopping street: it fronts east (+x) on the
 * lane at `frontX`, runs `depth` back, and spans z0..z1 along the street (its frontage).
 */
export interface ShopHouseSpec {
  id: string;
  use: Use;
  z0: number;
  z1: number;
  frontX: number;
  depth: number;
  /** Wall height above ground. */
  height: number;
  wall: MatRef;
  roof: 'flat' | 'gable' | 'shed';
  /** Flat roofs only: a water tank. */
  tank?: boolean;
  awning?: MatRef;
  /** Noren curtain colour, and the crest painted on it. */
  noren?: string;
  crest?: SignSpec;
  /** The shop board, centred on the frontage at this height. */
  sign?: { spec: SignSpec; y: number };
  hours: readonly [number, number];
  age: number;
  /** Street-side attachments (planned after all shop bodies, in street order). */
  attachments?: readonly ShopAttachment[];
}

export type ShopAttachment =
  | { kind: 'lanternSign'; sign: SignSpec }
  | { kind: 'ac'; y: number; dz: number; age: number }
  | { kind: 'breadRack' }
  | { kind: 'flowerBuckets' }
  | { kind: 'bookCart' };

/** A footprint on the ground, for seam rules. `front` is the side the building faces. */
export interface Footprint {
  id: string;
  use: Use;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Lowest eave height (seam props stay under it). */
  height: number;
  front: 'x0' | 'x1' | 'z0' | 'z1';
}

/** What fills the gap between two neighbours. */
export type SeamKind = 'utility' | 'service' | 'yokocho' | 'awning' | 'laundry' | 'none';

export interface Seam {
  a: string;
  b: string;
  kind: SeamKind;
  /** Gap width, metres. */
  gap: number;
  /** Deterministic per pair of neighbours: an edit elsewhere never changes it. */
  seed: number;
}
