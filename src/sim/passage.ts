/**
 * Managed narrow passages (prompt 07): where two people can't pass (clear width under 1.4 m; here
 * the bridge), walkers take turns. A direction token: an empty passage goes to whoever asks first;
 * others heading the same way follow; anyone heading the other way waits at the entry. Once someone
 * has waited MAX_WAIT seconds, nobody new is let in, the passage drains, and the token flips. People
 * standing still inside (watching the koi from the bridge) aren't traffic. Pure: no three.js, no DOM.
 */
export interface PassageSpec {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The direction people cross along. */
  axis: 'x' | 'z';
}

/** Seconds someone waits before the passage stops letting the other way in. */
export const MAX_WAIT = 6;

export class Passage {
  /** The way traffic is moving: +1 / -1 along the axis, 0 when nobody is crossing. */
  dir: -1 | 0 | 1 = 0;
  /** Walkers inside and the way each is heading. */
  private readonly crossing = new Map<string, -1 | 1>();
  /** Since when each waiter has been waiting. */
  private readonly waiting = new Map<string, number>();
  private draining = false;

  constructor(readonly spec: PassageSpec) {}

  contains(x: number, z: number): boolean {
    const s = this.spec;
    return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
  }

  /** Which way a step (dx, dz) crosses: +1 / -1 along the axis. */
  heading(dx: number, dz: number): -1 | 1 {
    return (this.spec.axis === 'x' ? dx : dz) >= 0 ? 1 : -1;
  }

  /** May `who`, heading `dir`, step in now? (Being let in registers them as crossing.) */
  request(who: string, dir: -1 | 1, now: number): boolean {
    if (this.crossing.has(who)) return true;
    if (this.crossing.size === 0) {
      this.dir = 0;
      this.draining = false;
    }
    if (this.dir === 0 || (this.dir === dir && !this.draining)) {
      this.dir = dir;
      this.crossing.set(who, dir);
      this.waiting.delete(who);
      return true;
    }
    const since = this.waiting.get(who) ?? now;
    this.waiting.set(who, since);
    if (now - since >= MAX_WAIT) this.draining = true;
    return false;
  }

  /**
   * Once a tick: who is walking inside now (id → heading). Those who left or stopped are no longer
   * traffic; anyone walking inside without having asked (they set off from a viewing spot) joins.
   */
  sync(walkersInside: ReadonlyMap<string, -1 | 1>, waitersStillWaiting: ReadonlySet<string>): void {
    for (const id of [...this.crossing.keys()]) if (!walkersInside.has(id)) this.crossing.delete(id);
    for (const [id, d] of walkersInside) if (!this.crossing.has(id)) this.crossing.set(id, d);
    for (const id of [...this.waiting.keys()]) if (!waitersStillWaiting.has(id)) this.waiting.delete(id);
    if (this.crossing.size === 0) {
      this.dir = 0;
      this.draining = false;
    }
  }

  get traffic(): number {
    return this.crossing.size;
  }
}
