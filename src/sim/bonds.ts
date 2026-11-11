/**
 * The bond ladder (prompt 09b): how two neighbours come to know each other. Nobody starts as
 * anyone's friend by decree: a pair climbs from never having met to friends through being in the
 * same place on different days (Milgram's "familiar strangers") and through shared moments,
 * something that made both look up at once (Whyte's triangulation). Passing each other every day
 * is enough to nod; anything warmer needs moments too.
 *
 * Each moment can carry credit for the things the player placed that made it possible, so a
 * promotion can say which edit it owes. Pure: no three.js, no DOM, no randomness.
 */

export const RUNGS = ['unseen', 'familiar', 'nod', 'greeting', 'chat', 'friends'] as const;
export type Rung = (typeof RUNGS)[number];

/** Distinct days together (within DAY_WINDOW) and shared moments needed to stand on each rung. */
export const NEEDS: Record<Rung, { days: number; moments: number }> = {
  unseen: { days: 0, moments: 0 },
  familiar: { days: 3, moments: 0 },
  nod: { days: 5, moments: 0 },
  greeting: { days: 5, moments: 2 },
  chat: { days: 7, moments: 4 },
  friends: { days: 10, moments: 7 },
};
/** Only days this recent count toward a rung (in-game days). */
export const DAY_WINDOW = 21;
/** Shared moments fade: half as vivid after this many days. */
export const MOMENT_HALF_LIFE = 8;
/** Without seeing each other for this many days, a bond slips one rung (and at most once per as many days). */
export const FADE_DAYS = 7;
/** An edit is credited with a promotion when it carries at least this share of the moments behind it. */
export const CREDIT_SHARE = 0.5;

const idx = (r: Rung): number => RUNGS.indexOf(r);

export interface Bond {
  /** Distinct days they were in the same place, oldest first (kept within DAY_WINDOW). */
  days: number[];
  /** Shared moments, fading (as of `at`, in days). */
  moments: number;
  at: number;
  /** The last day they saw each other, and the last day the bond slipped a rung. */
  lastDay: number;
  fadedOn: number;
  rung: Rung;
  /** The highest rung they've stood on: friends never slip below greeting, nobody unlearns a face. */
  peak: Rung;
  /** The day of the last promotion (one rung a day at most). */
  promotedOn: number;
  /** Moment weight per placed-object id since the last promotion, and the uncredited rest under ''. */
  credit: Record<string, number>;
}

/** A pair climbed a rung. `credited` are the edits that made it possible (may be empty). */
export interface Promotion {
  a: string;
  b: string;
  from: Rung;
  to: Rung;
  day: number;
  credited: string[];
}

/** One key per pair, whichever way round they're named. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const fresh = (): Bond => ({
  days: [],
  moments: 0,
  at: 0,
  lastDay: -Infinity,
  fadedOn: -Infinity,
  rung: 'unseen',
  peak: 'unseen',
  promotedOn: -Infinity,
  credit: {},
});

export class Bonds {
  private readonly pairs = new Map<string, Bond>();
  /** How much each pair takes to each other from the start (0..1): moments count for more. */
  private readonly affinity = new Map<string, number>();
  /** Edits that were removed after earning credit: the bond stays, the credit says "since removed". */
  private readonly gone = new Set<string>();

  /** An authored prior: how readily this pair warms to each other (persona `friends`). */
  setAffinity(a: string, b: string, v: number): void {
    this.affinity.set(pairKey(a, b), Math.max(0, Math.min(1, v)));
  }

  /** A pair that already knew each other when the story starts (the kids; old neighbours). */
  seed(a: string, b: string, rung: Rung, day = 0): void {
    const n = NEEDS[rung];
    const o = fresh();
    o.rung = o.peak = rung;
    o.moments = n.moments;
    o.at = o.lastDay = day;
    for (let i = n.days - 1; i >= 0; i--) o.days.push(day - i);
    this.pairs.set(pairKey(a, b), o);
  }

  get(a: string, b: string): Readonly<Bond> | null {
    return this.pairs.get(pairKey(a, b)) ?? null;
  }
  rung(a: string, b: string): Rung {
    return this.pairs.get(pairKey(a, b))?.rung ?? 'unseen';
  }
  /** Is this pair at least on `r`? */
  atLeast(a: string, b: string, r: Rung): boolean {
    return idx(this.rung(a, b)) >= idx(r);
  }

  private bond(a: string, b: string): Bond {
    const k = pairKey(a, b);
    let o = this.pairs.get(k);
    if (!o) this.pairs.set(k, (o = fresh()));
    return o;
  }

  private momentsNow(o: Bond, day: number): number {
    return o.moments * Math.pow(0.5, Math.max(0, day - o.at) / MOMENT_HALF_LIFE);
  }

  /** They were in the same place today (call as often as it's true: a day counts once). */
  together(a: string, b: string, day: number): Promotion | null {
    if (a === b) return null;
    const o = this.bond(a, b);
    const d = Math.floor(day);
    if (o.days[o.days.length - 1] !== d) {
      o.days.push(d);
      o.days = o.days.filter((x) => x > d - DAY_WINDOW);
    }
    o.lastDay = Math.max(o.lastDay, d);
    return this.climb(a, b, o, day);
  }

  /**
   * They shared a moment (both looked up at the same thing). `credit` says which placed things made
   * it possible and how much each (weights summing to at most 1; the rest is nobody's doing).
   */
  moment(a: string, b: string, day: number, credit: Readonly<Record<string, number>> = {}): Promotion | null {
    if (a === b) return null;
    const o = this.bond(a, b);
    const gain = 1 + (this.affinity.get(pairKey(a, b)) ?? 0);
    o.moments = this.momentsNow(o, day) + gain;
    o.at = day;
    let given = 0;
    for (const [id, w] of Object.entries(credit)) {
      const share = Math.max(0, Math.min(1 - given, w));
      if (share <= 0) continue;
      o.credit[id] = (o.credit[id] ?? 0) + share * gain;
      given += share;
    }
    o.credit[''] = (o.credit[''] ?? 0) + (1 - given) * gain;
    // a moment is also a day together
    return this.together(a, b, day) ?? this.climb(a, b, o, day);
  }

  /** Climb one rung if they've earned it (one a day at most). */
  private climb(a: string, b: string, o: Bond, day: number): Promotion | null {
    const d = Math.floor(day);
    const at = idx(o.rung);
    if (at >= RUNGS.length - 1 || o.promotedOn === d) return null;
    const next = RUNGS[at + 1]!;
    const need = NEEDS[next];
    if (o.days.length < need.days || this.momentsNow(o, day) < need.moments - 1e-9) return null;
    const from = o.rung;
    o.rung = next;
    if (idx(next) > idx(o.peak)) o.peak = next;
    o.promotedOn = d;
    // who made it possible: the edits behind at least CREDIT_SHARE of the moments since the last rung
    const total = Object.values(o.credit).reduce((s, v) => s + v, 0);
    const credited = total > 0 ? Object.keys(o.credit).filter((id) => id !== '' && o.credit[id]! / total >= CREDIT_SHARE - 1e-9) : [];
    o.credit = {};
    const [x, y] = a < b ? [a, b] : [b, a];
    return { a: x, b: y, from, to: next, day: d, credited };
  }

  /**
   * A new day: bonds that haven't been renewed slip, gently. One rung at most per FADE_DAYS, never
   * below a familiar face once they've been one, and friends never below a greeting.
   */
  newDay(day: number): void {
    const d = Math.floor(day);
    for (const o of this.pairs.values()) {
      if (d - o.lastDay < FADE_DAYS || d - o.fadedOn < FADE_DAYS) continue;
      const floor = o.peak === 'friends' ? idx('greeting') : idx(o.peak) >= idx('familiar') ? idx('familiar') : 0;
      const at = idx(o.rung);
      if (at <= floor) continue;
      o.rung = RUNGS[at - 1]!;
      o.fadedOn = d;
    }
  }

  /** The player removed something: any credit it earned stays, marked as since removed. */
  removed(editId: string): void {
    this.gone.add(editId);
  }
  /** It came back (an undo). */
  restored(editId: string): void {
    this.gone.delete(editId);
  }
  isGone(editId: string): boolean {
    return this.gone.has(editId);
  }

  /** Everyone `who` is at least on `r` with (for the card's Neighbors list). */
  known(who: string, r: Rung = 'nod'): { other: string; rung: Rung }[] {
    const out: { other: string; rung: Rung }[] = [];
    for (const [k, o] of this.pairs) {
      const [a, b] = k.split('|') as [string, string];
      if ((a === who || b === who) && idx(o.rung) >= idx(r)) out.push({ other: a === who ? b : a, rung: o.rung });
    }
    return out.sort((x, y) => idx(y.rung) - idx(x.rung) || (x.other < y.other ? -1 : 1));
  }

  /** A stable digest of the whole ledger: the same seed and edits must give the same one. */
  hash(): string {
    const keys = [...this.pairs.keys()].sort();
    return keys.map((k) => `${k}:${this.pairs.get(k)!.rung}:${this.pairs.get(k)!.days.length}:${this.pairs.get(k)!.moments.toFixed(3)}`).join(';');
  }

  toJSON(): Record<string, Bond> {
    const out: Record<string, Bond> = {};
    for (const [k, o] of this.pairs) out[k] = { ...o, days: [...o.days], credit: { ...o.credit } };
    return out;
  }

  /** Restore from a save, field by field: anything malformed is skipped. */
  static from(d: unknown, ids: readonly string[]): Bonds {
    const out = new Bonds();
    if (typeof d !== 'object' || d === null) return out;
    const known = new Set(ids);
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback);
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      const [a, b] = k.split('|');
      if (!a || !b || a >= b || !known.has(a) || !known.has(b) || typeof v !== 'object' || v === null) continue;
      const r = v as Record<string, unknown>;
      if (!RUNGS.includes(r.rung as Rung)) continue;
      const o = fresh();
      o.rung = r.rung as Rung;
      o.peak = RUNGS.includes(r.peak as Rung) && idx(r.peak as Rung) >= idx(o.rung) ? (r.peak as Rung) : o.rung;
      o.days = Array.isArray(r.days) ? [...new Set(r.days.filter((x): x is number => Number.isInteger(x)))].sort((x, y) => x - y).slice(-DAY_WINDOW) : [];
      o.moments = Math.max(0, Math.min(50, num(r.moments, 0)));
      o.at = num(r.at, 0);
      o.lastDay = num(r.lastDay, o.days[o.days.length - 1] ?? -Infinity);
      o.fadedOn = num(r.fadedOn, -Infinity);
      o.promotedOn = num(r.promotedOn, -Infinity);
      if (typeof r.credit === 'object' && r.credit !== null)
        for (const [id, w] of Object.entries(r.credit as Record<string, unknown>)) if (typeof w === 'number' && Number.isFinite(w) && w > 0) o.credit[id] = w;
      out.pairs.set(k, o);
    }
    return out;
  }
}
