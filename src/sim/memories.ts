/**
 * Neighborhood Memories: small stories the simulation actually produced, kept for the journal.
 *
 * Every memory is a measurable rule over what residents did with things the player placed, so the
 * journal never invents anything (no friendship from two people passing once):
 *   - noticed:   the first resident to notice a placed object (one per object)
 *   - favorite:  a resident used the same placed object at least 3 times, on at least 2 different days
 *   - together:  two residents used the same placed object at the same time (one per pair per object)
 * Captions are message templates, like the story feed. Memories are capped per in-game day, so
 * fast-forward can't flood the journal, and the journal keeps the newest MEMORIES_MAX.
 *
 * Each memory carries a small scene snapshot (a few hundred bytes), not a picture: the hour,
 * season, rain, the placed objects nearby and where the residents involved stood. The journal
 * re-renders its panels from that when opened, in the player's current look.
 * Pure (no DOM, no three.js), so it is unit-tested and could move to a Worker with the sim.
 */
import type { Season } from '../core/clock';

export type MemoryKind = 'noticed' | 'favorite' | 'together';

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
  /** The residents in the memory, where they stood. */
  people: { id: string; x: number; z: number }[];
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

/** What the recorder needs to know about the world at the moment a fact happens. */
export interface WorldView {
  minutes: number;
  season: Season;
  rain: number;
  objects: readonly SnapshotObject[];
  /** Where a resident is now. */
  where(id: string): { x: number; z: number } | null;
}

export class MemoryRecorder {
  private list: Memory[] = [];
  /** `${who}|${objectId}` → in-game days on which it was used, and the use count. */
  private uses = new Map<string, { n: number; days: Set<number> }>();
  private told = new Set<string>();
  private perDay = new Map<number, number>();
  private seq = 0;

  constructor(saved: readonly Memory[] = []) {
    this.list = saved.slice(-MEMORIES_MAX);
    // what is already in the journal is never told twice
    for (const m of this.list) this.told.add(this.key(m.kind, m.who, m.objectId));
    this.seq = this.list.length;
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
    for (const other of f.with) {
      if (other === f.who) continue;
      const m = this.add('together', [f.who, other].sort(), f.objectId, w);
      if (m) out.push(m);
    }
    return out;
  }

  /** A placed object was removed: its use counts go (the memories stay; their snapshots hold it). */
  removed(objectId: string): void {
    for (const k of [...this.uses.keys()]) if (k.endsWith(`|${objectId}`)) this.uses.delete(k);
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
      return p ? [{ id, x: round(p.x), z: round(p.z) }] : [];
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
