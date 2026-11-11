import { describe, it, expect, beforeEach } from 'vitest';
import { HANDOVER_TIMEOUT_MS, SaveGuard, TAKEOVER_KEY, wroteElsewhere, type Channel, type Locks } from '../src/save/tabs';
import { load, readStamp, SAVE_VERSION } from '../src/save/storage';

/** One exclusive lock with the Web Locks semantics the guard relies on: ifAvailable, steal, release on resolve. */
class FakeLocks implements Locks {
  private holder: { reject: (e: unknown) => void } | null = null;
  get held(): boolean {
    return this.holder !== null;
  }
  request(_name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => unknown): Promise<unknown> {
    if (opts.steal && this.holder) {
      this.holder.reject(new Error('AbortError: lock stolen'));
      this.holder = null;
    }
    if (this.holder) return opts.ifAvailable ? Promise.resolve(cb(null)) : Promise.reject(new Error('queued requests not modelled'));
    return new Promise((resolve, reject) => {
      const me = { reject };
      this.holder = me;
      void Promise.resolve(cb({ name: _name })).then((v) => {
        if (this.holder === me) this.holder = null;
        resolve(v);
      });
    });
  }
}

/** BroadcastChannel stand-in: delivers to every other open channel, asynchronously, never to itself. */
class Hub {
  readonly channels = new Set<FakeChannel>();
  open(): FakeChannel {
    const c = new FakeChannel(this);
    this.channels.add(c);
    return c;
  }
}
class FakeChannel implements Channel {
  private listeners: ((e: { data: unknown }) => void)[] = [];
  /** A frozen or closed tab hears nothing. */
  deaf = false;
  constructor(private readonly hub: Hub) {}
  postMessage(m: unknown): void {
    for (const c of this.hub.channels) if (c !== this && !c.deaf) queueMicrotask(() => c.listeners.forEach((l) => l({ data: m })));
  }
  addEventListener(_t: 'message', l: (e: { data: unknown }) => void): void {
    this.listeners.push(l);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function tab(id: string, locks: FakeLocks | null, hub: Hub | null, session = new Map<string, string>()) {
  const timers: (() => void)[] = [];
  const reloads = { n: 0 };
  const channel = hub?.open() ?? null;
  const g = new SaveGuard({
    id,
    locks,
    channel,
    session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v), removeItem: (k) => void session.delete(k) },
    reload: () => reloads.n++,
    setTimeout: (fn, ms) => {
      expect(ms).toBe(channel ? HANDOVER_TIMEOUT_MS : 0);
      timers.push(fn);
    },
  });
  const changes: (string | null)[] = [];
  g.onChange = (r) => changes.push(r);
  return { g, timers, reloads, session, changes, channel };
}

describe('wroteElsewhere (the pre-write check)', () => {
  it('never conflicts with an unstamped (older) save or our own write', () => {
    expect(wroteElsewhere(null, 'a', 0)).toBe(false);
    expect(wroteElsewhere({}, 'a', 0)).toBe(false);
    expect(wroteElsewhere({ writer: 'a', savedAt: 99 }, 'a', 10)).toBe(false);
  });
  it('conflicts only when another tab wrote after what we knew', () => {
    expect(wroteElsewhere({ writer: 'b', savedAt: 20 }, 'a', 10)).toBe(true);
    expect(wroteElsewhere({ writer: 'b', savedAt: 10 }, 'a', 10)).toBe(false); // the save we loaded
    expect(wroteElsewhere({ writer: 'b' }, 'a', 10)).toBe(false);
  });
});

describe('SaveGuard: one saving tab at a time', () => {
  let locks: FakeLocks;
  let hub: Hub;
  beforeEach(() => {
    locks = new FakeLocks();
    hub = new Hub();
  });

  it('the first tab saves; a second tab pauses at once and says why', async () => {
    const a = tab('a', locks, hub);
    const b = tab('b', locks, hub);
    await a.g.start();
    await b.g.start();
    expect(a.g.canSave).toBe(true);
    expect(b.g.canSave).toBe(false);
    expect(b.g.paused).toBe('other-tab');
    expect(b.changes).toEqual(['other-tab']);
    expect(a.changes).toEqual([]);
  });

  it('"Use this tab": the owner saves first, steps back, and the other tab reloads into the newest save', async () => {
    const a = tab('a', locks, hub);
    const b = tab('b', locks, hub);
    await a.g.start();
    await b.g.start();
    let savedByA = 0;
    a.g.beforeRelease = () => savedByA++;
    b.g.takeOver();
    await flush();
    expect(savedByA).toBe(1);
    expect(a.g.paused).toBe('moved');
    expect(locks.held).toBe(false); // released, so the reloaded tab can claim it
    expect(b.reloads.n).toBe(1);
    expect(b.session.get(TAKEOVER_KEY)).toBe('1');
    b.timers.forEach((t) => t()); // the fallback timer firing too must not reload twice
    expect(b.reloads.n).toBe(1);

    // the reloaded tab (same session) claims the lock and clears the flag
    const b2 = tab('b2', locks, hub, b.session);
    await b2.g.start();
    expect(b2.g.canSave).toBe(true);
    expect(b2.session.has(TAKEOVER_KEY)).toBe(false);
  });

  it('a paused tab ignores hand-over requests (only the owner answers)', async () => {
    const a = tab('a', locks, hub);
    const b = tab('b', locks, hub);
    const c = tab('c', locks, hub);
    await a.g.start();
    await b.g.start();
    await c.g.start();
    let bSaved = 0;
    b.g.beforeRelease = () => bSaved++;
    c.g.takeOver();
    await flush();
    expect(bSaved).toBe(0);
    expect(a.g.paused).toBe('moved');
    expect(b.g.paused).toBe('other-tab');
  });

  it('an owner that never answers (frozen, closed) has its lock stolen after the timeout', async () => {
    const a = tab('a', locks, hub);
    const b = tab('b', locks, hub);
    await a.g.start();
    await b.g.start();
    a.channel!.deaf = true;
    b.g.takeOver();
    await flush();
    expect(b.reloads.n).toBe(0); // no answer yet
    b.timers.forEach((t) => t());
    expect(b.reloads.n).toBe(1);
    const b2 = tab('b2', locks, hub, b.session);
    await b2.g.start(); // steals
    await flush();
    expect(b2.g.canSave).toBe(true);
    expect(a.g.paused).toBe('moved'); // the old owner learns it lost the lock and stops saving
  });

  it('without Web Locks a tab saves by default (the stamp check guards writes instead)', async () => {
    const a = tab('a', null, null);
    await a.g.start();
    expect(a.g.canSave).toBe(true);
    a.g.takeOver(); // no channel: reload straight away
    a.timers.forEach((t) => t());
    expect(a.reloads.n).toBe(1);
  });

  it('pausing twice for the same reason reports once', async () => {
    const a = tab('a', locks, hub);
    await a.g.start();
    a.g.pause('moved');
    a.g.pause('moved');
    expect(a.changes).toEqual(['moved']);
    await flush();
    expect(locks.held).toBe(false); // pausing gives the lock back
  });
});

describe('save stamp on disk', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  });
  const base = { version: SAVE_VERSION, minutes: 600, season: 'spring', weather: 'auto', placed: [], memory: {}, settings: {} };

  it('load() keeps a valid stamp and drops a malformed one', () => {
    mem.set('komorebi-cho/save', JSON.stringify({ ...base, writer: 'a', savedAt: 123 }));
    expect(load()).toMatchObject({ writer: 'a', savedAt: 123 });
    mem.set('komorebi-cho/save', JSON.stringify({ ...base, writer: 7, savedAt: 'soon' }));
    const d = load()!;
    expect('writer' in d).toBe(false);
    expect('savedAt' in d).toBe(false);
  });

  it('readStamp() reads just the stamp, and copes with no save or junk', () => {
    expect(readStamp()).toBeNull();
    mem.set('komorebi-cho/save', 'not json');
    expect(readStamp()).toBeNull();
    mem.set('komorebi-cho/save', JSON.stringify({ ...base, writer: 'b', savedAt: 5 }));
    expect(readStamp()).toEqual({ writer: 'b', savedAt: 5 });
  });
});
