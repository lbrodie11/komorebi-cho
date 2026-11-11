import { describe, it, expect } from 'vitest';
import { AudioLifecycle, type AudioTarget } from '../src/audio/lifecycle';

/** A fake audio graph that counts what is running, with controllable delays and refusals. */
function fake(opts: { refuse?: boolean; delay?: number } = {}) {
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const wait = () => new Promise<void>((r) => setTimeout(r, opts.delay ?? 0));
  const target: AudioTarget = {
    async start() {
      await wait();
      if (opts.refuse) return false;
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push('start');
      return true;
    },
    async stop() {
      await wait();
      running = Math.max(0, running - 1);
      log.push('stop');
    },
  };
  return {
    target,
    log,
    get running() {
      return running;
    },
    get maxRunning() {
      return maxRunning;
    },
  };
}

describe('audio lifecycle', () => {
  it('turns on and off, and really stops', async () => {
    const f = fake();
    const life = new AudioLifecycle(f.target);
    expect(await life.setWant(true)).toBe(true);
    expect(f.running).toBe(1);
    expect(await life.setWant(false)).toBe(false);
    expect(f.running).toBe(0);
    expect(f.log).toEqual(['start', 'stop']);
  });

  it('collapses rapid toggling: never two engines running, ends in the last state', async () => {
    const f = fake({ delay: 2 });
    const life = new AudioLifecycle(f.target);
    const all: Promise<boolean>[] = [];
    for (let i = 0; i < 9; i++) all.push(life.setWant(i % 2 === 0));
    await Promise.all(all);
    expect(f.maxRunning).toBe(1);
    expect(life.want).toBe(true);
    expect(life.active).toBe(true);
    expect(f.running).toBe(1);
  });

  it('goes quiet in a hidden tab and comes back when visible, keeping the choice', async () => {
    const f = fake();
    const life = new AudioLifecycle(f.target);
    await life.setWant(true);
    await life.setHidden(true);
    expect(f.running).toBe(0);
    expect(life.want).toBe(true);
    await life.setHidden(false);
    expect(f.running).toBe(1);
  });

  it('does not start a hidden tab, even when the player asks', async () => {
    const f = fake();
    const life = new AudioLifecycle(f.target);
    await life.setHidden(true);
    expect(await life.setWant(true)).toBe(true);
    expect(f.running).toBe(0);
    await life.setHidden(false);
    expect(f.running).toBe(1);
  });

  it('reports a refused start as off, so the button never lies', async () => {
    const life = new AudioLifecycle(fake({ refuse: true }).target);
    expect(await life.setWant(true)).toBe(false);
    expect(life.active).toBe(false);
  });

  it('keeps the choice when a background retry is refused, and recovers after an interruption', async () => {
    let refuse = false;
    let running = 0;
    const life = new AudioLifecycle({
      start: () => {
        if (refuse) return Promise.resolve(false);
        running++;
        return Promise.resolve(true);
      },
      stop: () => {
        running--;
        return Promise.resolve();
      },
    });
    await life.setWant(true);
    await life.interrupted(); // a phone call
    expect(running).toBe(0);
    refuse = true;
    await life.retry(); // tab visible again, but no gesture yet
    expect(life.want).toBe(true);
    refuse = false;
    await life.retry(); // the next tap
    expect(running).toBe(1);
    expect(life.active).toBe(true);
  });
});
