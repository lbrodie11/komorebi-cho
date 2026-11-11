/**
 * Neighborhood Memories: small stories the simulation actually produced, kept for the journal.
 *
 * Every memory is a measurable rule over what residents did with things the player placed, so the
 * journal never invents anything (no friendship from two people passing once):
 *   - noticed:   the first resident to notice a placed object (one per object)
 *   - favorite:  a resident used the same placed object at least 3 times, on at least 2 different days
 *   - together:  two residents used the same placed object at the same time (one per pair per object)
 *   - rainy:     a resident used the same placed object while it rained, on RAINY_DAYS different days
 *   - routine:   a placed object became a resident's favourite place of its kind (a new routine)
 * Captions are message templates, like the story feed. Memories are capped per in-game day, so
 * fast-forward can't flood the journal, and the journal keeps the newest MEMORIES_MAX.
 *
 * Each memory carries a small scene snapshot (a few hundred bytes), not a picture: the hour,
 * season, rain, the placed objects nearby and where the residents involved stood. The journal
 * re-renders its panels from that when opened, in the player's current look.
 * Pure (no DOM, no three.js), so it is unit-tested and could move to a Worker with the sim.
 */
import type { Season } from '../core/clock';

export type MemoryKind = 'noticed' | 'favorite' | 'together' | 'rainy' | 'routine';

export interface SnapshotObject {
  id: string;
  kind: string;
  x: number;
  z: number;
  ry: number;
}

export interface Snapshot {
  /** In-game minutes since day 0 (gives day and hour). */
  minutes: number;
  season: Season;
  rain: number;
  /** Where the memory happened (the object). */
  focus: { x: number; z: number };
  /** Placed objects within SNAPSHOT_RADIUS of the focus, as they were. */
  objects: SnapshotObject[];
  /** The residents in the memory, where they stood, how (sitting, crouching...) and which way they faced. */
  people: { id: string; x: number; z: number; pose?: string; ry?: number }[];
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  /** Persona ids, the main one first. */
  who: string[];
  objectId: string;
  objectKind: string;
  snapshot: Snapshot;
}

/** A resident used a placed object (sat on the bench, filled the cat bowl...). */
export interface UseFact {
  who: string;
  objectId: string;
  /** Others using the same object at that moment. */
  with: string[];
}

export const MEMORIES_MAX = 24;
export const MEMORIES_PER_DAY = 3;
export const FAVORITE_USES = 3;
export const FAVORITE_DAYS = 2;
export const SNAPSHOT_RADIUS = 8;
/** A rainy-day regular: used the same placed thing in the rain on this many days. */
export const RAINY_DAYS = 3;

/**
 * What leads up to a memory, kept across reloads (a rainy-day regular takes three rainy days, which
 * a player rarely sees in one sitting): per `${who}|${objectId}`, the use count and the recent days
 * of use, and the recent rainy days. Days are capped to the last few.
 */
export interface MemoryStats {
  uses: Record<string, { n: number; days: number[] }>;
  rainy: Record<string, number[]>;
}
const STAT_DAYS = 7;
const recent = (days: Iterable<number>): number[] => [...days].sort((a, b) => a - b).slice(-STAT_DAYS);

/** Saved stats, field by field: anything malformed is dropped. */
export function sanitizeStats(v: unknown): MemoryStats {
  const out: MemoryStats = { uses: {}, rainy: {} };
  if (typeof v !== 'object' || v === null) return out;
  const o = v as Record<string, unknown>;
  const day = (d: unknown): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0;
  const key = (k: string) => /^[\w-]+\|[\w-]+$/.test(k);
  if (typeof o.uses === 'object' && o.uses !== null)
    for (const [k, u] of Object.entries(o.uses as Record<string, unknown>)) {
      if (!key(k) || typeof u !== 'object' || u === null) continue;
      const r = u as Record<string, unknown>;
      if (typeof r.n !== 'number' || !Number.isFinite(r.n) || r.n < 0 || !Array.isArray(r.days)) continue;
      out.uses[k] = { n: Math.floor(r.n), days: recent(r.days.filter(day)) };
    }
  if (typeof o.rainy === 'object' && o.rainy !== null)
    for (const [k, d] of Object.entries(o.rainy as Record<string, unknown>)) if (key(k) && Array.isArray(d)) out.rainy[k] = recent(d.filter(day));
  return out;
}

/** What the recorder needs to know about the world at the moment a fact happens. */
export interface WorldView {
  minutes: number;
  season: Season;
  rain: number;
  objects: readonly SnapshotObject[];
  /** Where a resident is now, and how. */
  where(id: string): { x: number; z: number; pose?: string; ry?: number } | null;
}

export class MemoryRecorder {
  private list: Memory[] = [];
  /** `${who}|${objectId}` → in-game days on which it was used, and the use count. */
  private uses = new Map<string, { n: number; days: Set<number> }>();
  /** `${who}|${objectId}` → in-game days on which it was used in the rain. */
  private rainyDays = new Map<string, Set<number>>();
  private told = new Set<string>();
  private perDay = new Map<number, number>();
  private seq = 0;

  constructor(saved: readonly Memory[] = [], stats?: MemoryStats) {
    this.list = saved.slice(-MEMORIES_MAX);
    // what is already in the journal is never told twice
    for (const m of this.list) this.told.add(this.key(m.kind, m.who, m.objectId));
    this.seq = this.list.length;
    for (const [k, u] of Object.entries(stats?.uses ?? {})) this.uses.set(k, { n: u.n, days: new Set(u.days) });
    for (const [k, d] of Object.entries(stats?.rainy ?? {})) this.rainyDays.set(k, new Set(d));
  }

  /** What's building toward a memory, for the save. */
  stats(): MemoryStats {
    const out: MemoryStats = { uses: {}, rainy: {} };
    for (const [k, u] of this.uses) out.uses[k] = { n: u.n, days: recent(u.days) };
    for (const [k, d] of this.rainyDays) out.rainy[k] = recent(d);
    return out;
  }

  get memories(): readonly Memory[] {
    return this.list;
  }

  /** A resident noticed a placed object. */
  noticed(who: string, objectId: string, w: WorldView): Memory | null {
    return this.add('noticed', [who], objectId, w);
  }

  /** A resident used a placed object. May produce a favorite and/or a together memory. */
  used(f: UseFact, w: WorldView): Memory[] {
    const out: Memory[] = [];
    const day = Math.floor(w.minutes / 1440);
    const k = `${f.who}|${f.objectId}`;
    const u = this.uses.get(k) ?? { n: 0, days: new Set<number>() };
    u.n++;
    u.days.add(day);
    this.uses.set(k, u);
    if (u.n >= FAVORITE_USES && u.days.size >= FAVORITE_DAYS) {
      const m = this.add('favorite', [f.who], f.objectId, w);
      if (m) out.push(m);
    }
    if (w.rain > 0.3) {
      const r = this.rainyDays.get(k) ?? new Set<number>();
      r.add(day);
      this.rainyDays.set(k, r);
      if (r.size >= RAINY_DAYS) {
        const m = this.add('rainy', [f.who], f.objectId, w);
        if (m) out.push(m);
      }
    }
    for (const other of f.with) {
      if (other === f.who) continue;
      const m = this.add('together', [f.who, other].sort(), f.objectId, w);
      if (m) out.push(m);
    }
    return out;
  }

  /** A placed object became someone's favourite of its kind: a new routine. */
  routine(who: string, objectId: string, w: WorldView): Memory | null {
    return this.add('routine', [who], objectId, w);
  }

  /** A placed object was removed: its use counts go (the memories stay; their snapshots hold it). */
  removed(objectId: string): void {
    for (const k of [...this.uses.keys()]) if (k.endsWith(`|${objectId}`)) this.uses.delete(k);
    for (const k of [...this.rainyDays.keys()]) if (k.endsWith(`|${objectId}`)) this.rainyDays.delete(k);
  }

  private key(kind: MemoryKind, who: readonly string[], objectId: string): string {
    // "noticed" is once per object, whoever noticed; the others are per person (or pair) per object
    return kind === 'noticed' ? `noticed|${objectId}` : `${kind}|${[...who].sort().join('+')}|${objectId}`;
  }

  private add(kind: MemoryKind, who: string[], objectId: string, w: WorldView): Memory | null {
    const key = this.key(kind, who, objectId);
    if (this.told.has(key)) return null;
    const day = Math.floor(w.minutes / 1440);
    if ((this.perDay.get(day) ?? 0) >= MEMORIES_PER_DAY) return null; // fast-forward can't flood the journal
    const obj = w.objects.find((o) => o.id === objectId);
    if (!obj) return null;
    this.told.add(key);
    this.perDay.set(day, (this.perDay.get(day) ?? 0) + 1);
    const near = w.objects.filter((o) => Math.hypot(o.x - obj.x, o.z - obj.z) <= SNAPSHOT_RADIUS).map((o) => ({ ...o }));
    const people = who.flatMap((id) => {
      const p = w.where(id);
      return p ? [{ id, x: round(p.x), z: round(p.z), ...(p.pose ? { pose: p.pose } : {}), ...(p.ry !== undefined ? { ry: round(p.ry) } : {}) }] : [];
    });
    const m: Memory = {
      id: `m${day}-${this.seq++}`,
      kind,
      who,
      objectId,
      objectKind: obj.kind,
      snapshot: { minutes: Math.round(w.minutes), season: w.season, rain: round(w.rain), focus: { x: obj.x, z: obj.z }, objects: near, people },
    };
    this.list.push(m);
    if (this.list.length > MEMORIES_MAX) this.list.splice(0, this.list.length - MEMORIES_MAX);
    return m;
  }
}

const round = (v: number): number => Math.round(v * 100) / 100;
