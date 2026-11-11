import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartRegistry } from '../src/sim/smart';
import { benchSlots } from '../src/sim/smart';

/**
 * Prompt 09b's acceptance, "the hook, as a test": build a little, and the neighbourhood notices,
 * in a way that can be traced to what was built. The same town runs twice from the same seed, once
 * with a bench and a wind chime placed by the pond and once without.
 */
beforeAll(() => installHeadlessDom());

type Bus = { bus: { on(e: string, f: (s: never) => void): void } };

async function run(withEdit: boolean, days: number, opt: { ids?: [string, string]; far?: boolean; timing?: { ms: number; ticks: number } } = {}) {
  const [benchId, chimeId] = opt.ids ?? ['p-bench', 'p-chime'];
  const { residents, clock, world } = await buildSim(41);
  const smart = (residents as unknown as { smart: SmartRegistry }).smart;
  const bonds: { a: string; b: string; to: string; credited: string[]; helped: string[] }[] = [];
  (residents as unknown as Bus).bus.on('bond', (e: (typeof bonds)[number]) => bonds.push(e));
  let chime: ReturnType<SmartRegistry['add']> | undefined;
  if (withEdit) {
    smart.add({ id: benchId, kind: 'bench', label: 'bench', x: 0.6, z: 6.6, placed: true, slots: benchSlots(0.6, 6.6, Math.PI) });
    chime = smart.add({ id: chimeId, kind: 'admire', label: 'windChime', x: 1.8, z: 6.6, placed: true, radius: 0.3, slots: [] });
    for (const a of residents.agents) {
      a.known.add(benchId);
      a.known.add(chimeId);
    }
  }
  // something unrelated, far from everyone and known to nobody (a planter in the far corner)
  if (opt.far) smart.add({ id: 'p-far', kind: 'admire', label: 'planter', x: 15.5, z: -11.5, placed: true, radius: 0.3, slots: [] });
  const dt = 1 / 20,
    gm = 0.4; // 8 game minutes a second: a day in three minutes of ticks
  let t = 0,
    ring = 0;
  for (let m = clock.minutes; m < clock.minutes + days * 1440;) {
    m += gm;
    t += dt;
    const hour = (m / 60) % 24;
    residents.minutes = m;
    const t0 = opt.timing ? performance.now() : 0;
    residents.update(dt, gm, hour, 0, t);
    if (opt.timing) {
      opt.timing.ms += performance.now() - t0;
      opt.timing.ticks++;
    }
    // the chime rings about four times an hour by day (as main does from its own stream)
    ring += gm;
    if (chime && ring >= 15) {
      ring = 0;
      if (hour > 6 && hour < 21) residents.attention(chime.x, chime.z, 4.5, 'chime', chime);
    }
    void world;
    if (m >= clock.minutes + days * 1440) break;
  }
  return { residents, bonds };
}

describe('the hook (prompt 09b acceptance)', () => {
  it(
    'a bench and a wind chime bring neighbours together, the town says which edit did it, and without them it does not happen',
    { timeout: 240000 },
    async () => {
      const built = await run(true, 9);
      const bare = await run(false, 9);
      const mine = (e: { credited: string[]; helped: string[] }) => [...e.credited, ...e.helped].some((id) => id === 'p-bench' || id === 'p-chime');
      const credited = built.bonds.filter(mine);
      // someone grew closer because of what was placed, and the event names it
      expect(credited.length, JSON.stringify(built.bonds.slice(-12))).toBeGreaterThan(0);
      // those same pairs, in the town where nothing was placed, did not climb as far
      const order = ['unseen', 'familiar', 'nod', 'greeting', 'chat', 'friends'];
      const further = credited.filter((e) => order.indexOf(built.residents.bonds.rung(e.a, e.b)) > order.indexOf(bare.residents.bonds.rung(e.a, e.b)));
      expect(
        further.length,
        credited.map((e) => `${e.a}+${e.b}: ${built.residents.bonds.rung(e.a, e.b)} vs ${bare.residents.bonds.rung(e.a, e.b)}`).join(', '),
      ).toBeGreaterThan(0);
      // and nothing in the bare town is ever credited to an edit
      expect(bare.bonds.filter((e) => e.credited.length || e.helped.length)).toEqual([]);
      // no one neighbour is the star of every story (diversity: 1 − Σp²)
      const count = new Map<string, number>();
      for (const e of built.bonds) for (const id of [e.a, e.b]) count.set(id, (count.get(id) ?? 0) + 1);
      const total = [...count.values()].reduce((s, v) => s + v, 0);
      const diversity = 1 - [...count.values()].reduce((s, v) => s + (v / total) ** 2, 0);
      expect(diversity).toBeGreaterThan(0.75);
    },
  );

  it('is deterministic: the same seed and the same edits give the same ledger', { timeout: 120000 }, async () => {
    const a = await run(true, 2);
    const b = await run(true, 2);
    expect(a.residents.bonds.hash()).toBe(b.residents.bonds.hash());
    expect(a.bonds).toEqual(b.bonds);
  });

  it('does not change a thing when something unrelated is placed far away, or when the edits are merely named differently', { timeout: 240000 }, async () => {
    const base = await run(true, 5);
    const far = await run(true, 5, { far: true });
    expect(far.residents.bonds.hash()).toBe(base.residents.bonds.hash());
    expect(far.bonds).toEqual(base.bonds); // the same promotions, the same credits: none to the far planter
    const renamed = await run(true, 5, { ids: ['bench-xyz', 'chime-xyz'] });
    expect(renamed.residents.bonds.hash()).toBe(base.residents.bonds.hash());
    const swap = (id: string) => (id === 'bench-xyz' ? 'p-bench' : id === 'chime-xyz' ? 'p-chime' : id);
    expect(renamed.bonds.map((e) => ({ ...e, credited: e.credited.map(swap), helped: e.helped.map(swap) }))).toEqual(base.bonds);
  });

  it('costs next to nothing: a tick of the whole resident simulation, bonds and attribution included', { timeout: 120000 }, async () => {
    const timing = { ms: 0, ticks: 0 };
    await run(true, 2, { timing });
    const perTick = timing.ms / timing.ticks;
    // a loose ceiling (CI machines vary): the budget in the prompt is far below this
    expect(perTick).toBeLessThan(2);
  });
});
