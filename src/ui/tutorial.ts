/**
 * The first minutes, as hints rather than a tutorial (prompt 04 task 2, prompt 18's beat sheet):
 *   10 s in: a sparkle on an empty patch of grass, "Try placing a bench here (B)".
 *   The player places something; the nearest curious neighbour is guaranteed to come and look.
 *   Once someone has reacted: "Click someone to meet them", until they do.
 * Each step is done once and saved; no hint ever repeats. Pure (no DOM), so it is unit-tested.
 */
export type HintStep = 'bench' | 'meet';
export type TutorialFlag = 'place' | 'react' | 'meet';

/** Seconds after load before the bench hint appears. */
export const BENCH_HINT_AFTER = 10;

export class Tutorial {
  private readonly done: Set<TutorialFlag>;
  private t = 0;

  constructor(done: readonly string[] = []) {
    this.done = new Set(done.filter((d): d is TutorialFlag => d === 'place' || d === 'react' || d === 'meet'));
  }

  /** Advance time; returns the hint to show now (or null). */
  update(dt: number): HintStep | null {
    this.t += dt;
    return this.current;
  }

  get current(): HintStep | null {
    if (!this.done.has('place')) return this.t >= BENCH_HINT_AFTER ? 'bench' : null;
    if (this.done.has('react') && !this.done.has('meet')) return 'meet';
    return null;
  }

  /** The next placement should be guaranteed a reaction (until someone has reacted once). */
  get wantsReaction(): boolean {
    return !this.done.has('react');
  }

  placed(): void {
    this.done.add('place');
  }

  /** A neighbour reacted to something the player placed. */
  noticed(): void {
    this.done.add('react');
    this.done.add('place'); // a reaction means something was placed, even if it happened before the hint
  }

  /** The player opened someone's card. */
  met(): void {
    this.done.add('meet');
  }

  /** Settings → "Show the hints again": everything from the start, the clock too. */
  reset(): void {
    this.done.clear();
    this.t = 0;
  }

  /** For the save. */
  get flags(): TutorialFlag[] {
    return [...this.done].sort();
  }
}
