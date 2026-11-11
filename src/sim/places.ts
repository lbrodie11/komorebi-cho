/**
 * Place memory (prompt 08): how familiar a resident is with each place, fading with a half-life
 * of about two in-game days, plus when they first saw it. The favourite of a kind is the most
 * familiar place of that kind, once it is familiar enough; it shifts when a better option has been
 * used more lately. That shift is the visible-adaptation engine. Pure: no three.js, no DOM.
 */

/** Familiarity halves in two in-game days (game minutes). */
export const HALF_LIFE = 2 * 1440;
/** How familiar a place must be before it can be someone's favourite (about two recent days). */
export const FAVOURITE_MIN = 1.5;
/** Familiarity counts days: the first visit of a day adds 1, later ones that day a little; it tops out here. */
export const DAY_VISIT = 1;
export const REVISIT = 0.1;
/** Something new stays new for a while: its pull on the curious halves every four in-game days. */
export const NOVELTY_HALF_LIFE = 4 * 1440;
export const MAX_FAMILIARITY = 6;
/** A favourite is a habit: used on at least this many different days. */
export const FAVOURITE_DAYS = 3;
/** To take over, a place must be this much more familiar than the current favourite (hysteresis). */
export const FAVOURITE_MARGIN = 1.15;

interface Mark {
  /** Familiarity as of `at` (game minutes). */
  f: number;
  at: number;
  /** Where it was (to look for it if it goes). */
  x: number;
  z: number;
  /** Game minute they first noticed it, and the day they first used it. */
  seen: number;
  /** The last day they used it, and on how many different days they have. */
  lastDay: number | null;
  days: number;
}

/** As saved: a few numbers per place. */
export type PlaceMemoryData = Record<string, { f: number; at: number; x: number; z: number; seen: number; day: number | null; days: number }>;

const decay = (f: number, dt: number) => f * Math.pow(0.5, Math.max(0, dt) / HALF_LIFE);

export class PlaceMemory {
  private readonly marks = new Map<string, Mark>();

  familiarity(id: string, now: number): number {
    const m = this.marks.get(id);
    return m ? decay(m.f, now - m.at) : 0;
  }

  /** They noticed it (first sight is kept). */
  noticed(id: string, x: number, z: number, now: number): void {
    if (!this.marks.has(id)) this.marks.set(id, { f: 0, at: now, x, z, seen: now, lastDay: null, days: 0 });
  }

  /**
   * They used it: it grows familiar, by a day's worth the first time on a day and a little after
   * that (sitting on the pond bench three times today is one day of habit, not three). Returns what
   * the use meant: the first ever, the first return on another day ('again'), or a visit.
   */
  used(id: string, x: number, z: number, now: number, weight = DAY_VISIT): 'first' | 'again' | 'visit' {
    const day = Math.floor(now / 1440);
    const m = this.marks.get(id) ?? { f: 0, at: now, x, z, seen: now, lastDay: null, days: 0 };
    const newDay = m.lastDay !== day;
    m.f = Math.min(MAX_FAMILIARITY, decay(m.f, now - m.at) + (newDay ? weight : REVISIT));
    m.at = now;
    m.x = x;
    m.z = z;
    if (newDay) m.days++;
    m.lastDay = day;
    this.marks.set(id, m);
    return m.days === 1 && newDay ? 'first' : m.days === 2 && newDay ? 'again' : 'visit';
  }

  /** A place that was theirs before the story starts (a haunt): a settled habit. */
  haunt(id: string, x: number, z: number, now: number): void {
    this.marks.set(id, { f: 3, at: now, x, z, seen: now - 30 * 1440, lastDay: null, days: FAVOURITE_DAYS });
  }

  /** How new a place still is to them: 1 when first seen, halving every NOVELTY_HALF_LIFE (0 if never seen). */
  novelty(id: string, now: number): number {
    const m = this.marks.get(id);
    return m ? Math.pow(0.5, Math.max(0, now - m.seen) / NOVELTY_HALF_LIFE) : 0;
  }

  /**
   * The favourite among `ids`: the most familiar place they have used on FAVOURITE_DAYS different
   * days, familiar enough. A `current` favourite keeps its place unless another is FAVOURITE_MARGIN
   * more familiar (no flip-flopping between two near-equal benches). Ties: the first.
   */
  favourite(ids: Iterable<string>, now: number, current: string | null = null): string | null {
    let best: string | null = null,
      bf = FAVOURITE_MIN;
    const list = [...ids];
    for (const id of list) {
      const m = this.marks.get(id);
      if (!m || m.days < FAVOURITE_DAYS) continue;
      const f = this.familiarity(id, now);
      if (f > bf + 1e-9) [best, bf] = [id, f];
    }
    if (current && best !== current && list.includes(current)) {
      const c = this.marks.get(current);
      const cf = this.familiarity(current, now);
      if (c && c.days >= FAVOURITE_DAYS && cf >= FAVOURITE_MIN && bf < cf * FAVOURITE_MARGIN) return current;
    }
    return best;
  }

  /** Where a remembered place was. */
  where(id: string): { x: number; z: number } | null {
    const m = this.marks.get(id);
    return m ? { x: m.x, z: m.z } : null;
  }

  forget(id: string): void {
    this.marks.delete(id);
  }

  /** Every place they remember (ids). */
  get ids(): string[] {
    return [...this.marks.keys()];
  }

  toJSON(): PlaceMemoryData {
    const out: PlaceMemoryData = {};
    for (const [id, m] of this.marks) out[id] = { f: m.f, at: m.at, x: m.x, z: m.z, seen: m.seen, day: m.lastDay, days: m.days };
    return out;
  }

  /** Restore from a save, field by field: anything malformed is skipped. */
  static from(d: unknown): PlaceMemory {
    const p = new PlaceMemory();
    if (typeof d !== 'object' || d === null) return p;
    for (const [id, v] of Object.entries(d as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const r = v as Record<string, unknown>;
      const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : null);
      const f = num('f'),
        at = num('at'),
        x = num('x'),
        z = num('z'),
        seen = num('seen');
      if (f === null || at === null || x === null || z === null || seen === null || f < 0) continue;
      p.marks.set(id, { f: Math.min(f, MAX_FAMILIARITY), at, x, z, seen, lastDay: num('day'), days: Math.max(0, Math.floor(num('days') ?? 0)) });
    }
    return p;
  }
}
