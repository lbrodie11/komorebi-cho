import { clamp, smoothstep, type Rect } from '../core/math';

/**
 * Art-directed night lighting: the pure part (no three.js), so it can be unit-tested.
 *
 * Every important light has up to five layers:
 *   1. ambient (sun/hemisphere rig, sky.ts)
 *   2. emissive core (the glass or lamp head itself)
 *   3. local fill (a few real point lights, props.ts)
 *   4. a ground pool or spill (lightpools.ts), shaped by the source and facing outward
 *   5. the optical halo (post.ts glow, Film Diffusion)
 * This module decides how bright each source is and where its spill falls.
 */

export type WindowKind = 'shop' | 'cafe' | 'home';

/**
 * Night-time brightness hierarchy (emissive intensity at full lamp level). The kissaten
 * is the focal point; streetlamps next; shopfronts and lanterns; homes quieter, so the
 * neighbourhood stays calm and the warm/cool separation carries the night.
 */
export const EMISSIVE = {
  cafe: 3.2,
  streetlamp: 2.7,
  shop: 2.0,
  lantern: 2.0,
  home: 1.5,
} as const;

/** Windows fade on and off over this many in-world hours (18 minutes), never popping. */
export const FADE_H = 0.3;
/** Brightness steps for window glass (shared materials per step: per-window fades without per-window materials). */
export const WINDOW_STEPS = 8;

/** 1 inside [a, b], 0 outside, with FADE_H-long smooth edges at both ends. Continuous in `h`. */
export function ramp(h: number, a: number, b: number, fade = FADE_H): number {
  return smoothstep(a, a + fade, h) * (1 - smoothstep(b - fade, b, h));
}

/** Deterministic 0..1 hash of two integers (window index, day). */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** About one home window in five stays dark on a given night: residents are out, or asleep early. */
export const occupiedTonight = (index: number, day: number): boolean => hash2(index, day) >= 0.2;

/** Each window has its own warmth of lamp (0.7..1), constant over time. */
export const windowWarmth = (index: number): number => 0.7 + 0.3 * hash2(index, 7919);

/**
 * How lit a window is, 0..1. `hour` is the clock, `offset` the window's own jitter (hours),
 * `darkness` 0..1 how much shops need their lights (dusk, night, rain). Everything derives
 * from the clock, so a paused or jumped clock gives the same answer as a running one.
 */
export function windowLevel(
  kind: WindowKind,
  hour: number,
  offset: number,
  index: number,
  day: number,
  darkness: number,
  hours?: readonly [number, number],
): number {
  if (kind === 'home') {
    const h = (((hour + offset) % 24) + 24) % 24;
    // "tonight" runs noon to noon on the window's own (offset) clock: the calendar day ticks
    // over at midnight, and keying on it would pop a late-lit window on or off at 00:00
    const night = Math.floor((day * 24 + hour + offset - 12) / 24);
    if (!occupiedTonight(index, night)) return 0;
    return Math.max(ramp(h, 17.5, 23.6), ramp(h, 5.6, 7)) * windowWarmth(index);
  }
  // a shop window follows its own opening hours (and its shutter), so a closed shop goes dark
  const h = hours ? hour : (((hour + offset) % 24) + 24) % 24;
  const [a, b] = hours ?? [7, 21.5];
  return ramp(h, a, b) * clamp(darkness, 0, 1);
}

/** How much the shops need their lights: dusk/night (lamp level) or heavy rain. */
export const shopDarkness = (lamp: number, rain: number): number => smoothstep(0.1, 0.4, Math.max(lamp, rain * 0.8));

/** The step (0..WINDOW_STEPS) a level is shown at. */
export const windowStep = (level: number): number => Math.round(clamp(level, 0, 1) * WINDOW_STEPS);

export interface WindowGeom {
  x: number;
  y: number;
  z: number;
  /** Facing: 0 faces +z, π/2 faces +x (three.js rotation.y). */
  ry: number;
  w: number;
  h: number;
}

/** A spill footprint on the ground in front of a window: centre, facing and size (metres). */
export interface Spill {
  x: number;
  z: number;
  ry: number;
  width: number;
  depth: number;
}

/** Windows whose sill is higher than this above the ground cast no ground spill (upper floors). */
export const SPILL_MAX_SILL = 1.0;
/** A spill shorter than this isn't worth drawing (the window faces the plinth edge). */
const MIN_SPILL = 0.4;

/**
 * Where a window's light lands: a footprint on the ground directly in front of the glass,
 * opening outward from the wall (never behind it, so it can't leak through the building).
 * Upper-floor windows return null: their glass glows, but they don't light the street.
 */
export function windowSpill(win: WindowGeom, groundY: number, big = false, ground?: Rect): Spill | null {
  const sill = win.y - win.h / 2 - groundY;
  if (sill > SPILL_MAX_SILL) return null;
  const nx = Math.sin(win.ry),
    nz = Math.cos(win.ry);
  let depth = clamp(win.h * (big ? 1.2 : 0.9), 1.0, 2.4);
  if (ground) {
    // light only lands on ground that exists: stop at the plinth edge (and skip a window facing straight off it)
    const reach = (p: number, n: number, lo: number, hi: number) => (n > 1e-6 ? (hi - p) / n : n < -1e-6 ? (lo - p) / n : Infinity);
    depth = Math.min(depth, Math.min(reach(win.x, nx, ground.x0, ground.x1), reach(win.z, nz, ground.z0, ground.z1)) - 0.08);
    if (depth < MIN_SPILL) return null;
  }
  const width = win.w * 1.3 + 0.4;
  return { x: win.x + nx * (depth / 2 + 0.04), z: win.z + nz * (depth / 2 + 0.04), ry: win.ry, width, depth };
}
