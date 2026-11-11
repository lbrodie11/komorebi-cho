import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartObject, SmartRegistry } from '../src/sim/smart';

/** Edge cases found in the 2026-11-11 review of prompt 08. */
beforeAll(() => installHeadlessDom());

type Internals = {
  smart: SmartRegistry;
  queueTask(a: unknown, o: SmartObject, label: unknown, dwell: number): unknown;
  assign(a: unknown, t: unknown): void;
};

describe('prompt 08 review: edge cases', () => {
  it('keeps your place in line when the free counter is covered by something placed', async () => {
    const { residents } = await buildSim(8);
    const r = residents as unknown as Internals;
    const o = r.smart.objects.get('shop-bakery')!;
    for (const a of residents.agents) a.hidden = true;
    const [c1, c2, q1] = residents.agents;
    o.slots[0]!.takenBy = c1!.p.id;
    o.slots[1]!.takenBy = c2!.p.id;
    q1!.hidden = false;
    q1!.root.visible = true;
    q1!.placeAt(-6, o.z);
    r.assign(q1, r.queueTask(q1, o, { key: 'task.browsing' }, 5));
    for (let s = 0; s < 100; s++) residents.update(1 / 20, 0.01, 10, 0, s / 20);
    expect(q1!.arrived).toBe(true);
    // a counter frees, but a placed planter now stands on it: nobody can use it
    const s0 = o.slots[0]!;
    r.smart.add({ id: 'p-cover', kind: 'admire', label: 'planter', x: s0.x, z: s0.z, radius: 0.5, slots: [], placed: true });
    s0.takenBy = null;
    for (let s = 0; s < 10; s++) residents.update(1 / 20, 0.01, 10, 0, 5 + s / 20);
    expect(q1!.task?.kind).toBe('queue');
    expect(o.queue![0]!.takenBy).toBe(q1!.p.id); // still theirs: nobody else can stand in it
  });

  it("doesn't treat rain already falling at load as a sudden shower (nobody leaps up from a bench)", async () => {
    const { residents } = await buildSim(31);
    const r = residents as unknown as { smart: SmartRegistry };
    for (const a of residents.agents) a.hidden = true;
    const a = residents.agents.find((x) => !x.p.work && !x.p.kid)!;
    const b = r.smart.objects.get('bench-sakura')!,
      slot = b.slots[0]!;
    a.hidden = false;
    a.root.visible = true;
    a.placeAt(slot.x, slot.z);
    a.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [slot.x, slot.z], dwell: 300, pose: 'sit', obj: b, interruptible: true };
    a.arrived = true;
    a.dwellLeft = 300;
    a.pose = 'sit';
    // the very first tick is already in heavy rain
    for (let s = 0; s < 20; s++) residents.update(1 / 20, 0.05, 14, 0.8, s / 20);
    expect(a.task?.kind).toBe('use');
    expect(a.pose).toBe('sit');
  });

  it('gives an old save’s haunts to their owners as of now, not faded since day one', async () => {
    const { residents } = await buildSim(5);
    const mitsuko = residents.agents.find((a) => a.p.id === 'mitsuko')!;
    residents.minutes = 40 * 1440; // forty days in
    residents.restorePlaces({}); // a save from before place memory
    expect(mitsuko.places.familiarity('bench-pond-a', residents.minutes)).toBeGreaterThan(2.5);
    expect(residents.favouriteOf(mitsuko, 'bench')).toBe('bench-pond-a');
  });
});
