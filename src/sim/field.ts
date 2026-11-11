/**
 * The place field (prompt 09b, after William H. Whyte's plaza studies): what makes one spot better
 * to sit in than another, right now. People choose shade at summer noon and sun on a winter
 * morning, shelter when it rains, light after dark, water and food nearby, something at their back
 * and a view in front, and (the cat people) wherever the cats are fed.
 *
 * It is one more consideration in the residents' choices, not a new AI: a multiplier near 1. Each
 * part also names the placed things behind it, so a choice can be traced to an edit (attribution).
 * Pure: no three.js, no DOM.
 */
import type { Season } from '../core/clock';

export interface Spot {
  x: number;
  z: number;
  /** The way someone there faces (rotation.y), if it's a seat. */
  face?: number;
}

/** Something in the world the field reads. `id` is set for things the player placed. */
export interface Feature {
  x: number;
  z: number;
  /** Its reach (a canopy's radius, a pond's). */
  r?: number;
  id?: string;
}

export interface FieldEnv {
  hour: number;
  season: Season;
  rain: number;
  /** Tree canopies (shade). */
  trees: readonly Feature[];
  /** Roofs to stand or sit under (awnings, the arch, the café terrace). */
  shelters: readonly Feature[];
  /** Lights that are lit after dark (lanterns, vending machines). */
  lights: readonly Feature[];
  /** Water to sit by. */
  water: readonly Feature[];
  /** Somewhere to get a drink or a bite. */
  food: readonly Feature[];
  /** Where the cats are fed. */
  bowls: readonly Feature[];
  /** Is this point open ground? (For "something at your back, a view in front".) */
  isOpen?: (x: number, z: number) => boolean;
}

export interface FieldScore {
  /** The multiplier for a choice (about 0.75 to 1.9). */
  score: number;
  /** Each part's own multiplier, for the "Why?" view. */
  parts: { shade: number; shelter: number; light: number; near: number; refuge: number; cats: number };
  /** Placed things that raised the score. */
  because: string[];
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const dark = (h: number): boolean => h >= 18 || h < 5.5;
/** How much the sun is worth avoiding (1) or seeking (-1) now. */
export function sunPressure(hour: number, season: Season): number {
  if (dark(hour) || hour < 7) return 0;
  const midday = Math.max(0, 1 - Math.abs(hour - 13) / 3.5); // 0 at 09:30 and 16:30, 1 at 13:00
  if (season === 'summer') return midday; // shade, please
  if (season === 'winter') return -0.6 * Math.max(0, 1 - Math.abs(hour - 11) / 4); // a sunny spot
  return 0.35 * midday; // spring and autumn: shade is pleasant at noon, no more
}

/** Score a spot. `catPerson`: the cats matter to them. */
export function placeScore(spot: Spot, env: FieldEnv, catPerson = false): FieldScore {
  const because = new Set<string>();
  const credit = (f: Feature | undefined) => f?.id && because.add(f.id);
  const within = (list: readonly Feature[], extra: number) => list.filter((f) => dist(spot, f) < (f.r ?? 0) + extra);

  // shade and sun
  const canopy = within(env.trees, 0.6);
  const sun = sunPressure(env.hour, env.season);
  let shade = 1;
  if (sun > 0) shade = canopy.length ? 1 + 0.3 * sun : 1 - 0.15 * sun;
  else if (sun < 0) shade = canopy.length ? 1 + 0.12 * sun : 1 - 0.15 * sun;
  if (shade > 1) canopy.forEach(credit);

  // shelter, when it rains
  const roof = within(env.shelters, 1.6);
  const shelter = env.rain > 0.2 && roof.length ? 1 + 1.6 * Math.min(1, env.rain) : 1;
  if (shelter > 1) roof.forEach(credit);

  // light after dark
  const lit = dark(env.hour) ? within(env.lights, 3) : [];
  const light = lit.length ? 1.5 : 1;
  lit.forEach(credit);

  // water and food nearby (people sit where there is something to watch, and something to drink)
  const byWater = within(env.water, 2.5),
    byFood = within(env.food, 4);
  const near = 1 + (byWater.length ? 0.08 : 0) + (byFood.length ? 0.06 : 0);
  byWater.forEach(credit);
  byFood.forEach(credit);

  // something at your back, a view in front (prospect and refuge, in miniature)
  let refuge = 1;
  if (spot.face !== undefined && env.isOpen) {
    const fx = Math.sin(spot.face),
      fz = Math.cos(spot.face);
    const back = !env.isOpen(spot.x - fx * 1.2, spot.z - fz * 1.2);
    let view = 0;
    for (let d = 1; d <= 5; d++) if (env.isOpen(spot.x + fx * d, spot.z + fz * d)) view++;
    refuge = 1 + (back ? 0.07 : 0) + (view >= 4 ? 0.06 : 0);
  }

  // the cats
  const fed = catPerson ? within(env.bowls, 3.5) : [];
  const cats = fed.length ? 1.3 : 1;
  fed.forEach(credit);

  return { score: shade * shelter * light * near * refuge * cats, parts: { shade, shelter, light, near, refuge, cats }, because: [...because] };
}
