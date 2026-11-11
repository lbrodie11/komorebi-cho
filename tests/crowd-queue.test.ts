import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartObject, SmartRegistry } from '../src/sim/smart';

beforeAll(() => installHeadlessDom());

type Internals = {
  smart: SmartRegistry;
  crowdFactor(a: unknown, o: SmartObject): number;
  queueTask(a: unknown, o: SmartObject, label: unknown, dwell: number): unknown;
  assign(a: unknown, t: unknown): void;
};

describe('crowding and queues (prompt 07)', () => {
  it('makes a crowded spot less inviting, more so to the people who mind crowds', async () => {
    const { residents } = await buildSim(7);
    const r = residents as unknown as Internals;
    const o = r.smart.objects.get('shop-bakery')!;
    const ag = residents.agents;
    for (const a of ag) a.hidden = true;
    const kid = ag.find((a) => a.p.id === 'rin')!;
    const quiet = ag.find((a) => a.p.id === 'nana')!;
    expect(r.crowdFactor(quiet, o)).toBe(1);
    // three people standing about the counter
    for (const a of ag.filter((x) => x !== kid && x !== quiet).slice(0, 3)) {
      a.hidden = false;
      a.placeAt(o.x + 0.8, o.z);
    }
    const q = r.crowdFactor(quiet, o),
      k = r.crowdFactor(kid, o);
    expect(q).toBeLessThan(0.25); // 1 / (1 + 3 × 1.6)
    expect(k).toBeGreaterThan(q);
  });

  it('queues when the counters are busy, moves up, and steps up when one frees', async () => {
    const { residents } = await buildSim(8);
    const r = residents as unknown as Internals;
    const o = r.smart.objects.get('shop-bakery')!;
    for (const a of residents.agents) a.hidden = true;
    const [c1, c2, q1, q2] = residents.agents;
    o.slots[0]!.takenBy = c1!.p.id;
    o.slots[1]!.takenBy = c2!.p.id;
    expect(r.smart.queueable('shop', 10).map((x) => x.id)).toContain('shop-bakery');
    for (const a of [q1!, q2!]) {
      a.hidden = false;
      a.root.visible = true;
      a.placeAt(-6, o.z);
      r.assign(a, r.queueTask(a, o, { key: 'task.browsing' }, 5));
    }
    expect(q1!.task!.kind).toBe('queue');
    expect(o.queue![0]!.takenBy).toBe(q1!.p.id);
    expect(o.queue![1]!.takenBy).toBe(q2!.p.id);
    const run = (n: number) => {
      for (let s = 0; s < n; s++) residents.update(1 / 20, 0.01, 10, 0, s / 20);
    };
    run(100); // they walk up and wait
    expect(q1!.arrived && q2!.arrived).toBe(true);
    // a counter frees: the first in line steps up, the second moves up a place
    o.slots[0]!.takenBy = null;
    run(5);
    expect(q1!.task!.kind).toBe('use');
    expect(o.slots[0]!.takenBy).toBe(q1!.p.id);
    expect(o.queue![0]!.takenBy).toBe(q2!.p.id);
  });
});
