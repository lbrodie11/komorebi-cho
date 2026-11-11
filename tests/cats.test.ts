import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartRegistry } from '../src/sim/smart';

/** Prompt 08's thin slice: a cat prefers to sit within 2 m of Mitsuko while she's out on a bench. */
beforeAll(() => installHeadlessDom());

async function nearHer(catFriend: boolean): Promise<number> {
  const { residents, animals } = await buildSim(41);
  const smart = (residents as unknown as { smart: SmartRegistry }).smart;
  const m = residents.agents.find((a) => a.p.id === 'mitsuko')!;
  const was = m.p.catFriend;
  m.p.catFriend = catFriend;
  try {
    for (const a of residents.agents) a.hidden = a !== m;
    const bench = smart.objects.get('bench-pond-a')!,
      slot = bench.slots[0]!;
    m.root.visible = true;
    m.placeAt(slot.x, slot.z);
    m.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [slot.x, slot.z], dwell: 1e6, pose: 'sit', obj: bench, interruptible: true };
    m.arrived = true;
    m.dwellLeft = 1e6;
    m.pose = 'sit';
    const cats = (animals as unknown as { cats: { root: { position: { x: number; z: number } } }[] }).cats;
    let near = 0,
      n = 0;
    // three real minutes at normal speed, of an afternoon
    for (let s = 0; s < 20 * 180; s++) {
      residents.update(1 / 20, 1 / 20, 15, 0, s / 20);
      animals.update(1 / 20, s / 20, 15, 0, 'spring', residents.agents);
      if (s > 20 * 30) {
        n++;
        if (cats.some((c) => Math.hypot(c.root.position.x - m.x, c.root.position.z - m.z) < 2)) near++;
      }
    }
    return near / n;
  } finally {
    m.p.catFriend = was;
  }
}

describe('the cats and Mitsuko', () => {
  it('come and sit within 2 m of her while she is out, far more than they would by chance', async () => {
    const withHer = await nearHer(true),
      control = await nearHer(false);
    expect(withHer).toBeGreaterThan(0.5);
    expect(withHer).toBeGreaterThan(control + 0.3);
  }, 300_000);
});
