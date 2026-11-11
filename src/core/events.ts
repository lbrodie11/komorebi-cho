import type { Msg } from '../i18n';

/** Minimal typed event bus. Systems talk through events, never through each other's internals. */
export type Handler<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<E[K]>)(payload);
  }
}

export interface WorldEditEvent {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** 0..1 how visually novel the change is (a sakura tree > a planter). */
  novelty: number;
}

export type GameEvents = {
  objectPlaced: WorldEditEvent;
  objectRemoved: WorldEditEvent;
  /** A line for the story feed and Notes; `who` is the persona it is about, if any. */
  story: { msg: Msg; who?: string; /** A greeting, not an event: shown in the feed, not kept in Notes. */ fleeting?: boolean };
  /** A placed object was used, or inspected, by a resident (drives the first-minutes hints). */
  noticed: { who: string; id: string };
  /** Something the player placed became a resident's favourite of its kind (drives a Memory). */
  routine: { who: string; id: string };
  /** A resident used a placed object; `with` are the others using it at the same moment (drives Memories). */
  used: { who: string; id: string; with: string[] };
  bell: { hour: number };
  sfx: { name: 'place' | 'remove' | 'flap' | 'meow' | 'click' | 'shutter' | 'chime'; x?: number; z?: number };
};
