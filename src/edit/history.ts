/**
 * Edits as small, serialisable commands (prompt 06 task 3). Every change the player makes to the
 * town is one of these; undo applies the inverse, redo re-applies the command. Commands carry
 * everything needed to rebuild exactly (ids, positions, kinds: placeables are deterministic by
 * kind), so redo regenerates identical geometry, and the stack doubles as the replay log for
 * sharing towns later (prompt 13). Pure: no three.js, no DOM.
 */
export interface Placement {
  id: string;
  kind: string;
  x: number;
  z: number;
  ry: number;
}

export type Command =
  | { op: 'place'; rec: Placement }
  | { op: 'remove'; rec: Placement }
  | { op: 'move'; id: string; from: { x: number; z: number; ry: number }; to: { x: number; z: number; ry: number } }
  /** A shop-house moved or resized along the street (its frontage, z0..z1). */
  | { op: 'shop'; id: string; from: { z0: number; z1: number }; to: { z0: number; z1: number } };

/** What commands act on (the build tool in the game, a map in tests). */
export interface EditTarget {
  place(rec: Placement): void;
  remove(id: string): void;
  move(id: string, x: number, z: number, ry: number): void;
  shop(id: string, z0: number, z1: number): void;
}

export function inverse(c: Command): Command {
  switch (c.op) {
    case 'place':
      return { op: 'remove', rec: c.rec };
    case 'remove':
      return { op: 'place', rec: c.rec };
    case 'move':
      return { op: 'move', id: c.id, from: c.to, to: c.from };
    case 'shop':
      return { op: 'shop', id: c.id, from: c.to, to: c.from };
  }
}

export function apply(t: EditTarget, c: Command): void {
  switch (c.op) {
    case 'place':
      return t.place(c.rec);
    case 'remove':
      return t.remove(c.rec.id);
    case 'move':
      return t.move(c.id, c.to.x, c.to.z, c.to.ry);
    case 'shop':
      return t.shop(c.id, c.to.z0, c.to.z1);
  }
}

/** How many edits undo remembers. */
export const HISTORY_MAX = 200;

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(private readonly target: EditTarget) {}

  /** Apply a new edit and remember it (a new edit after undo discards the redo branch). */
  perform(c: Command): void {
    apply(this.target, c);
    this.done.push(c);
    if (this.done.length > HISTORY_MAX) this.done.shift();
    this.undone = [];
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Undo the last edit; returns it (or null). */
  undo(): Command | null {
    const c = this.done.pop();
    if (!c) return null;
    apply(this.target, inverse(c));
    this.undone.push(c);
    return c;
  }

  redo(): Command | null {
    const c = this.undone.pop();
    if (!c) return null;
    apply(this.target, c);
    this.done.push(c);
    return c;
  }

  /** Forget everything (a reset of the town). */
  clear(): void {
    this.done = [];
    this.undone = [];
  }

  /** The edits in order, for the replay log. */
  get log(): readonly Command[] {
    return this.done;
  }
}
