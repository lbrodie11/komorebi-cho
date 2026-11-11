/**
 * When audio should be running, kept apart from the Web Audio graph so it can be tested.
 *
 * Two inputs: whether the player wants sound (`want`, the Sound button and M) and whether
 * the tab is hidden. Sound plays only when wanted and visible. Every change is queued
 * behind the previous one, so rapid toggling, or a hide that lands mid-start, can never
 * leave two schedulers running or a context awake with nothing to play.
 */
export interface AudioTarget {
  /** Create the graph if needed, resume the context, fade in, start scheduling. Resolves false if the browser refused. */
  start(): Promise<boolean>;
  /** Stop scheduling, fade out, then suspend the context. */
  stop(): Promise<void>;
}

export class AudioLifecycle {
  /** The player's choice. */
  want = false;
  hidden = false;
  /** Audio is actually playing. */
  active = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly target: AudioTarget) {}

  /** Turn sound on or off. Resolves with whether the player's choice stands (false if the browser refused to start). */
  async setWant(on: boolean): Promise<boolean> {
    this.want = on;
    await this.sync(true);
    return this.want;
  }

  setHidden(hidden: boolean): Promise<void> {
    this.hidden = hidden;
    return this.sync();
  }

  /**
   * The browser stopped the context behind our back (a phone call, the OS taking the audio device).
   * Stop scheduling so nothing piles up, and start again cleanly at the next retry().
   */
  interrupted(): Promise<void> {
    if (!this.active) return this.queue;
    this.active = false;
    this.queue = this.queue.then(() => this.target.stop().catch(() => undefined));
    return this.queue;
  }

  /** Try again (after a user gesture, or the tab becoming visible): starts if wanted and not playing. */
  retry(): Promise<void> {
    return this.sync();
  }

  /** `fromPlayer`: the player just asked for sound, so a refusal turns the choice off. A refused retry keeps it, for the next gesture. */
  private sync(fromPlayer = false): Promise<void> {
    this.queue = this.queue.then(async () => {
      // read the latest wishes now, not when the change was queued: a burst of toggles collapses to the last one
      const should = this.want && !this.hidden;
      if (should === this.active) return;
      if (should) {
        this.active = await this.target.start().catch(() => false);
        if (!this.active && fromPlayer) this.want = false; // the browser said no: the button must say Sound off
      } else {
        this.active = false;
        await this.target.stop().catch(() => undefined);
      }
    });
    return this.queue;
  }
}
