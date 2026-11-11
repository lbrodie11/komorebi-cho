import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartObject, SmartRegistry } from '../src/sim/smart';

beforeAll(() => installHeadlessDom());

type Internals = { smart: SmartRegistry; lightFactor(o: SmartObject, hour: number): number; printAge: Float32Array };

describe('weather behaviour (prompt 08)', () => {
  it('a sudden shower sends people sitting out to shelter, umbrellas opening on the way and closing under cover', async () => {
    const { residents } = await buildSim(31);
    const r = residents as unknown as Internals;
    for (const a of residents.agents) a.hidden = true;
    // people with the afternoon free (shopkeepers are working, the kids are at school)
    const sitters = residents.agents.filter((a) => !a.p.work && !a.p.commute && !a.p.kid).slice(0, 3);
    const benches = ['bench-pond-a', 'bench-pond-b', 'bench-sakura'].map((id) => r.smart.objects.get(id)!);
    sitters.forEach((a, i) => {
      const b = benches[i]!,
        slot = b.slots[0]!;
      a.hidden = false;
      a.root.visible = true;
      a.placeAt(slot.x, slot.z);
      a.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [slot.x, slot.z], dwell: 300, pose: 'sit', obj: b, interruptible: true };
      a.arrived = true;
      a.dwellLeft = 300;
      a.pose = 'sit';
    });
    for (let s = 0; s < 20; s++) residents.update(1 / 20, 0.05, 14, 0, s / 20);
    let midway = false;
    const sheltered = new Set<string>();
    let closedUnderCover = 0;
    for (let s = 0; s < 20 * 60; s++) {
      residents.update(1 / 20, 0.05, 14, 0.8, 1 + s / 20);
      if (sitters.some((a) => a.umbrellaOpen > 0.1 && a.umbrellaOpen < 0.9)) midway = true;
      for (const a of sitters)
        if (a.task?.kind === 'shelter' && a.arrived) {
          sheltered.add(a.p.id);
          if (a.umbrellaOpen < 0.1) closedUnderCover++;
        }
    }
    expect(sheltered.size).toBeGreaterThanOrEqual(2);
    expect(midway).toBe(true); // the umbrella opened, it didn't just appear
    expect(closedUnderCover).toBeGreaterThan(0); // and closed under cover
  });

  it('sends the kids home when it rains hard', async () => {
    const { residents } = await buildSim(32);
    const rin = residents.agents.find((a) => a.p.id === 'rin')!;
    for (const a of residents.agents) a.hidden = a !== rin;
    rin.placeAt(0, 5);
    rin.task = null;
    rin.thinkUntil = 0;
    for (let s = 0; s < 5; s++) residents.update(1 / 20, 0.05, 11, 0.95, s / 20);
    expect((rin.task as { kind: string } | null)?.kind).toBe('home');
  });

  it('draws people toward light after dark, not by day', async () => {
    const { residents } = await buildSim(33);
    const r = residents as unknown as Internals;
    const bench = r.smart.objects.get('bench-sakura')!;
    r.smart.add({ id: 'lamp', kind: 'admire', label: 'lantern', x: bench.x + 1.5, z: bench.z, slots: [], glow: true, placed: true });
    expect(r.lightFactor(bench, 13)).toBe(1);
    expect(r.lightFactor(bench, 21)).toBeGreaterThan(1);
    expect(r.lightFactor(r.smart.objects.get('bench-play')!, 21)).toBe(1);
  });

  it('slows walking in snow and leaves footprints', async () => {
    const pace = async (season: 'winter' | 'summer') => {
      const { residents } = await buildSim(34);
      residents.season = season;
      const a = residents.agents[0]!;
      for (const x of residents.agents) x.hidden = x !== a;
      a.placeAt(-4, -4.9);
      a.task = { kind: 'wander', label: { key: 'task.stroll' }, goal: [4, -4.9], dwell: 60, pose: 'stand', interruptible: true };
      a.arrived = false;
      a.path = [
        [-4, -4.9],
        [4, -4.9],
      ];
      a.pathIdx = 1;
      for (let s = 0; s < 40; s++) residents.update(1 / 20, 0.05, 12, 0.6, s / 20);
      const prints = [...(residents as unknown as Internals).printAge].filter((t) => t < 90).length;
      return { x: a.x, prints };
    };
    const snow = await pace('winter'),
      rain = await pace('summer');
    expect(snow.x).toBeLessThan(rain.x);
    expect(snow.prints).toBeGreaterThan(2);
    expect(rain.prints).toBe(0);
  });
});
