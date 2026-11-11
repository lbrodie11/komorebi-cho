import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartRegistry } from '../src/sim/smart';

/** Prompt 09b: the bond ladder at work in the town. */
beforeAll(() => installHeadlessDom());

type Bus = { bus: { on(e: string, f: (s: never) => void): void } };

describe('bonds in the town (prompt 09b)', () => {
  it('starts from the authored pairs: the kids are friends, old neighbours greet, most people are strangers', async () => {
    const { residents } = await buildSim(1);
    expect(residents.bonds.rung('rin', 'sora')).toBe('friends');
    expect(residents.bonds.rung('mitsuko', 'genzo')).toBe('greeting');
    expect(residents.bonds.rung('kenta', 'kaito')).toBe('nod');
    expect(residents.bonds.rung('nana', 'genzo')).toBe('unseen');
    const info = residents.info(residents.agents.find((a) => a.p.id === 'mitsuko')!);
    expect(info.neighbors[0]).toEqual({ id: 'genzo', rung: 'greeting' });
  });

  it('greets by the rung: strangers walk on, a familiar face gets a glance, then a nod, then a bow', async () => {
    for (const [rung, expectIt] of [
      ['unseen', (a: { bowT: number; gesture: unknown }) => a.bowT === 0 && a.gesture === null],
      ['familiar', (a: { bowT: number; gesture: { kind: string } | null }) => a.bowT === 0 && a.gesture?.kind === 'glance'],
      ['nod', (a: { bowT: number; gesture: { kind: string } | null }) => a.bowT === 0 && a.gesture?.kind === 'nod'],
      ['greeting', (a: { bowT: number }) => a.bowT > 0],
    ] as const) {
      const { residents } = await buildSim(22);
      for (const x of residents.agents) x.hidden = true;
      const a = residents.agents.find((x) => x.p.id === 'nana')!,
        b = residents.agents.find((x) => x.p.id === 'genzo')!;
      if (rung !== 'unseen') residents.bonds.seed('nana', 'genzo', rung);
      for (const [p, from, to] of [
        [a, [-1.2, -4.9], [4, -4.9]],
        [b, [1.2, -4.9], [-4, -4.9]],
      ] as const) {
        p.hidden = false;
        p.placeAt(from[0], from[1]);
        p.task = { kind: 'wander', label: { key: 'task.stroll' }, goal: [to[0], to[1]], dwell: 60, pose: 'stand', interruptible: true };
        p.arrived = false;
        p.path = [
          [from[0], from[1]],
          [to[0], to[1]],
        ];
        p.pathIdx = 1;
      }
      let seen = false;
      for (let s = 0; s < 20 * 3; s++) {
        residents.update(1 / 20, 0.01, 10, 0, s / 20);
        if ((expectIt as (x: unknown) => boolean)(a) && rung !== 'unseen') seen = true;
      }
      if (rung === 'unseen') expect(a.bowT === 0 && a.gesture === null, rung).toBe(true);
      else expect(seen, rung).toBe(true);
    }
  });

  it('counts a minute near each other as a day together, once a day, and three such days make familiar faces', async () => {
    const { residents } = await buildSim(5);
    for (const x of residents.agents) x.hidden = true;
    const a = residents.agents.find((x) => x.p.id === 'nana')!,
      b = residents.agents.find((x) => x.p.id === 'genzo')!;
    for (const [p, x] of [
      [a, 0],
      [b, 2],
    ] as const) {
      p.hidden = false;
      p.placeAt(x, -4.9);
      p.task = { kind: 'linger', label: { key: 'task.stroll' }, goal: [x, -4.9], dwell: 1e9, pose: 'stand', interruptible: false };
      p.arrived = true;
      p.dwellLeft = 1e9;
    }
    const events: { a: string; b: string; to: string }[] = [];
    (residents as unknown as Bus).bus.on('bond', (e: { a: string; b: string; to: string }) => events.push(e));
    for (let day = 0; day < 3; day++) {
      residents.minutes = day * 1440 + 600;
      for (let s = 0; s < 40; s++) residents.update(1 / 20, 0.05, 10, 0, s / 20); // two game minutes side by side
      expect(residents.bonds.get('nana', 'genzo')!.days.length).toBe(day + 1);
    }
    expect(residents.bonds.rung('nana', 'genzo')).toBe('familiar');
    // (others may come out of their doors meanwhile: only this pair's news counts here)
    expect(events.filter((e) => e.a === 'genzo' && e.b === 'nana').map((e) => e.to)).toEqual(['familiar']);
  });

  it('makes sitting side by side on a bench the player placed a shared moment, credited to that bench', async () => {
    const { residents } = await buildSim(6);
    const smart = (residents as unknown as { smart: SmartRegistry }).smart;
    for (const x of residents.agents) x.hidden = true;
    const a = residents.agents.find((x) => x.p.id === 'nana')!,
      b = residents.agents.find((x) => x.p.id === 'genzo')!;
    residents.bonds.seed('nana', 'genzo', 'nod');
    const bench = smart.add({
      id: 'p-bench',
      kind: 'bench',
      label: 'bench',
      x: 0,
      z: 6,
      placed: true,
      slots: [-0.4, 0.4].map((o) => ({ x: o, z: 6, face: 0, pose: 'sit' as const, takenBy: null })),
    });
    const stories: { key: string; params?: Record<string, unknown> }[] = [];
    (residents as unknown as Bus).bus.on('story', (s: { msg: { key: string; params?: Record<string, unknown> } }) => stories.push(s.msg));
    for (let day = 0; day < 6; day++) {
      residents.minutes = day * 1440 + 600;
      [a, b].forEach((p, i) => {
        const slot = bench.slots[i]!;
        p.hidden = false;
        p.placeAt(slot.x, slot.z);
        p.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [slot.x, slot.z], dwell: 1e9, pose: 'sit', obj: bench, interruptible: false };
        p.arrived = true;
        p.dwellLeft = 1e9;
        p.pose = 'sit';
      });
      for (let s = 0; s < 60; s++) residents.update(1 / 20, 0.05, 10, 0, s / 20);
    }
    expect(['greeting', 'chat']).toContain(residents.bonds.rung('nana', 'genzo'));
    const line = stories.find((s) => s.key === 'story.bond.greeting.because');
    expect(line, stories.map((s) => s.key).join(' ')).toBeTruthy();
    expect((line!.params!.thing as { key: string }).key).toBe('noun.bench');
    // and it is saved and restored
    const back = JSON.parse(JSON.stringify(residents.bondsData())) as Record<string, unknown>;
    const rung = residents.bonds.rung('nana', 'genzo');
    residents.restoreBonds(back);
    expect(residents.bonds.rung('nana', 'genzo')).toBe(rung);
    expect(residents.bonds.rung('rin', 'sora')).toBe('friends');
  });
});

describe('shared attention (prompt 09b: triangulators)', () => {
  it('a wind chime ringing makes the two people near it look up, and that is a moment credited to the chime', async () => {
    const { residents } = await buildSim(7);
    const smart = (residents as unknown as { smart: SmartRegistry }).smart;
    for (const x of residents.agents) x.hidden = true;
    const [a, b, far, busy] = ['nana', 'genzo', 'emi', 'yuki'].map((id) => residents.agents.find((x) => x.p.id === id)!);
    const chime = smart.add({ id: 'p-chime', kind: 'admire', label: 'windChime', x: 0, z: -4.9, placed: true, slots: [] });
    for (const [p, x, kind] of [
      [a!, -1, 'wander'],
      [b!, 1.2, 'wander'],
      [far!, 12, 'wander'],
      [busy!, 0.5, 'work'],
    ] as const) {
      p.hidden = false;
      p.placeAt(x, -4.9);
      p.task = { kind, label: { key: 'task.stroll' }, goal: [x, -4.9], dwell: 1e9, pose: 'stand', interruptible: false };
      p.arrived = true;
      p.dwellLeft = 1e9;
    }
    residents.bonds.seed('nana', 'genzo', 'nod');
    const before = residents.bonds.get('nana', 'genzo')!.moments;
    const yukiBefore = residents.bonds.get('nana', 'yuki')!.moments; // (they already greet each other)
    expect(residents.attention(0, -4.9, 4.5, 'chime', chime)).toBe(2); // not the one far off, not the one at work
    expect(a!.gesture?.kind).toBe('glance');
    expect(far!.gesture).toBeNull();
    const bond = residents.bonds.get('nana', 'genzo')!;
    expect(bond.moments).toBeGreaterThan(before);
    expect(bond.credit['p-chime']).toBeGreaterThan(0);
    // the same chime again today is the same moment, not another
    const m = bond.moments;
    residents.attention(0, -4.9, 4.5, 'chime', chime);
    expect(residents.bonds.get('nana', 'genzo')!.moments).toBe(m);
    // someone at work nearby wasn't part of it
    expect(residents.bonds.get('nana', 'yuki')!.moments).toBe(yukiBefore);
  });
});

describe('but-for attribution at the decision point (prompt 09b)', () => {
  type Free = {
    freeTime(a: unknown, hour: number, rain: number): void;
    smart: SmartRegistry;
    sharedMoment(a: unknown, b: unknown, what: string, madeBy?: unknown): void;
  };

  it('remembers the lantern as why someone chose a bench at dusk, only if they would have sat elsewhere without it', async () => {
    const pickBench = async (lantern: boolean) => {
      const { residents } = await buildSim(8);
      const r = residents as unknown as Free;
      for (const x of residents.agents) x.hidden = true;
      const a = residents.agents.find((x) => x.p.id === 'nana')!;
      const A = r.smart.objects.get('bench-pond-a')!,
        B = r.smart.objects.get('bench-pond-b')!;
      // a little nearer B than A: left to herself, B
      a.hidden = false;
      a.placeAt(A.x + (B.x - A.x) * 0.58, A.z + (B.z - A.z) * 0.58);
      a.needs.fatigue = 1;
      if (lantern) r.smart.add({ id: 'p-lantern', kind: 'admire', label: 'lantern', x: A.x + 1, z: A.z + 1, placed: true, glow: true, slots: [] });
      residents.minutes = 19 * 60;
      r.freeTime(a, 19, 0);
      return { a, A, B, residents, r };
    };
    const dark = await pickBench(false);
    const lit = await pickBench(true);
    // (tired out, at this seed, she does choose a bench both times: the test must not pass by skipping)
    expect([dark.a.task?.obj?.kind, lit.a.task?.obj?.kind]).toEqual(['bench', 'bench']);
    expect(dark.a.task?.obj?.id).toBe('bench-pond-b');
    expect(dark.a.cause).toBeNull();
    expect(lit.a.task?.obj?.id).toBe('bench-pond-a');
    expect(lit.a.cause).toEqual({ obj: 'bench-pond-a', ids: ['p-lantern'] });
    // a moment shared on that bench is the lantern's doing, though the bench was always there
    const b = lit.residents.agents.find((x) => x.p.id === 'genzo')!;
    b.hidden = false;
    b.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [lit.A.x, lit.A.z], dwell: 60, pose: 'sit', obj: lit.A, interruptible: true };
    lit.r.sharedMoment(lit.a, b, 'seat', lit.A);
    expect(lit.residents.bonds.get('nana', 'genzo')!.credit['p-lantern']).toBeGreaterThan(0);
  });
});
