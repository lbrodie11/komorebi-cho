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
  story: { text: string; who?: string };
  bell: { hour: number };
  sfx: { name: 'place' | 'remove' | 'flap' | 'meow' | 'click' | 'shutter'; x?: number; z?: number };
};
