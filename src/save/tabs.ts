/**
 * One saving tab at a time.
 *
 * Every tab autosaves every 10 s, so with the game open in two tabs the last writer used to win:
 * a bench placed in one tab was erased by the other's next autosave. Two layers prevent that:
 *
 * 1. A Web Lock (`navigator.locks`) picks one owner. Other tabs pause saving and say so at once,
 *    before the player builds anything there. A lock is released when its tab closes or crashes,
 *    and, unlike a timestamp heartbeat, it can't go stale while a background tab is throttled.
 * 2. Before every write the owner checks the save's stamp (`writer`, `savedAt`). If another tab
 *    wrote since this one last knew, it pauses instead of overwriting. That covers browsers
 *    without Web Locks, and the moment around a hand-over.
 *
 * "Use this tab" asks the owner (over a BroadcastChannel) to save and step back, then reloads, so
 * the new owner starts from the newest save instead of its own stale copy. A reload is not a
 * teleport: nobody is on screen while the page restarts. If the owner doesn't answer (closed,
 * frozen), the reload steals the lock, and the old tab's stamp check stops it from writing.
 */

export const LOCK_NAME = 'komorebi-cho/save-owner';
export const CHANNEL_NAME = 'komorebi-cho/tabs';
/** Session flag: "this reload is a take-over, steal the lock if anyone still holds it". */
export const TAKEOVER_KEY = 'komorebi-cho/takeover';
/** How long "Use this tab" waits for the owner to save and step back before reloading anyway. */
export const HANDOVER_TIMEOUT_MS = 1500;

/** Who wrote the save last, and when (ms since epoch). Both absent on saves from before this existed. */
export interface SaveStamp {
  writer?: string;
  savedAt?: number;
}

/**
 * Has another tab written the save since `knownAt` (this tab's last load or write)? Old saves with
 * no stamp, and our own writes, never conflict.
 */
export function wroteElsewhere(onDisk: SaveStamp | null, me: string, knownAt: number): boolean {
  if (!onDisk?.writer || onDisk.writer === me) return false;
  return (onDisk.savedAt ?? 0) > knownAt;
}

/** Why this tab isn't saving: another tab was open first, or the player moved to another tab. */
export type PauseReason = 'other-tab' | 'moved';

type Message = { type: 'handover'; from: string } | { type: 'released'; from: string };

/** The slice of the Web Locks API used here (typed narrowly so tests can supply a fake). */
export interface Locks {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: unknown) => unknown): Promise<unknown>;
}
export interface Channel {
  postMessage(m: Message): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}
export interface SaveGuardDeps {
  id: string;
  /** Absent where Web Locks aren't available (old browsers, insecure origins): the stamp check still guards writes. */
  locks?: Locks | null;
  channel?: Channel | null;
  session?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  reload(): void;
  setTimeout(fn: () => void, ms: number): unknown;
}

export class SaveGuard {
  /** Paused tabs keep running and stay playable; they just don't write the save. */
  paused: PauseReason | null = null;
  /** Called whenever `paused` changes (the HUD shows or hides its note). */
  onChange: (paused: PauseReason | null) => void = () => {};
  /** Called on a hand-over request, while this tab still owns the save: write it now. */
  beforeRelease: () => void = () => {};
  private release: (() => void) | null = null;
  private handingOver = false;
  private reloading = false;

  constructor(private readonly d: SaveGuardDeps) {
    d.channel?.addEventListener('message', (e) => this.onMessage(e.data));
  }

  get id(): string {
    return this.d.id;
  }

  get canSave(): boolean {
    return this.paused === null;
  }

  /** Claim the save if no other tab has it. Resolves once ownership is decided. */
  async start(): Promise<void> {
    let takeover = false;
    try {
      takeover = this.d.session?.getItem(TAKEOVER_KEY) === '1';
      this.d.session?.removeItem(TAKEOVER_KEY);
    } catch {
      /* no session storage: a plain claim */
    }
    const locks = this.d.locks;
    if (!locks) return; // owner by default; wroteElsewhere() still guards every write
    await new Promise<void>((decided) => {
      const held = new Promise<void>((resolve) => (this.release = resolve));
      locks
        .request(LOCK_NAME, takeover ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            this.pause('other-tab');
            decided();
            return undefined;
          }
          decided();
          return held; // hold the lock until this tab closes or hands over
        })
        .catch(() => {
          // another tab stole the lock ("Use this tab" there while this one was frozen or slow)
          this.release = null;
          this.pause('moved');
          decided();
        });
    });
  }

  /** Stop saving from this tab (a lost lock, a hand-over, or a stamp conflict on write). */
  pause(reason: PauseReason): void {
    if (this.paused === reason) return;
    this.paused = reason;
    this.release?.();
    this.release = null;
    this.onChange(reason);
  }

  /** "Use this tab": ask the owner to save and step back, then reload into the newest save. */
  takeOver(): void {
    if (this.handingOver) return;
    this.handingOver = true;
    try {
      this.d.session?.setItem(TAKEOVER_KEY, '1');
    } catch {
      /* without the flag the reload claims normally; the owner has released by then if it answered */
    }
    this.d.channel?.postMessage({ type: 'handover', from: this.d.id });
    this.d.setTimeout(() => this.reloadOnce(), this.d.channel ? HANDOVER_TIMEOUT_MS : 0);
  }

  private reloadOnce(): void {
    if (this.reloading) return;
    this.reloading = true;
    this.d.reload();
  }

  private onMessage(data: unknown): void {
    const m = data as Message | null;
    if (!m || typeof m !== 'object' || m.from === this.d.id) return;
    if (m.type === 'handover' && this.canSave) {
      this.beforeRelease();
      this.pause('moved');
      this.d.channel?.postMessage({ type: 'released', from: this.d.id });
    } else if (m.type === 'released' && this.handingOver) {
      this.reloadOnce();
    }
  }
}
