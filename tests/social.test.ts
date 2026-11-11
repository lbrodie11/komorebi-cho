import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import type { SmartObject, SmartRegistry } from '../src/sim/smart';

beforeAll(() => installHeadlessDom());

type Internals = { smart: SmartRegistry; socialFactor(a: unknown, o: SmartObject): number; crowdFactor(a: unknown, o: SmartObject): number };

describe('the social layer (prompt 08)', () => {
  it('friends sitting on one bench talk in turns, and it makes a story once', async () => {
    const { residents } = await buildSim(21);
    const r = residents as unknown as Internals;
    const stories: string[] = [];
    (residents as unknown as { bus: { on(e: string, f: (s: { msg: { key: string } }) => void): void } }).bus.on('story', (s) => stories.push(s.msg.key));
    for (const x of residents.agents) x.hidden = true;
    const mitsuko = residents.agents.find((a) => a.p.id === 'mitsuko')!,
      genzo = residents.agents.find((a) => a.p.id === 'genzo')!;
    const bench = r.smart.objects.get('bench-pond-a')!;
    for (const [a, slot] of [
      [mitsuko, bench.slots[0]!],
      [genzo, bench.slots[1]!],
    ] as const) {
      a.hidden = false;
      a.placeAt(slot.x, slot.z);
      a.task = { kind: 'use', label: { key: 'task.sitting' }, goal: [slot.x, slot.z], dwell: 600, pose: 'sit', obj: bench, interruptible: true };
      a.arrived = true;
      a.dwellLeft = 600;
      a.pose = 'sit';
      a.needs.social = 1;
    }
    const speakers: string[] = [];
    for (let s = 0; s < 20 * 12; s++) {
      residents.update(1 / 20, 0.01, 15, 0, s / 20);
      for (const a of [mitsuko, genzo]) if (a.bubbleT > 1.6) speakers.push(a.p.id);
    }
    const turns = speakers.filter((id, i) => i === 0 || speakers[i - 1] !== id);
    expect(turns.length).toBeGreaterThanOrEqual(4); // they took turns, several times
    expect(new Set(turns)).toEqual(new Set(['genzo', 'mitsuko']));
    expect(stories.filter((k) => k === 'story.chat')).toHaveLength(1);
    expect(mitsuko.needs.social).toBeLessThan(1); // company is what they wanted
  });

  it('neighbours passing on the lane bow, once an hour per pair', async () => {
    const { residents } = await buildSim(22);
    for (const x of residents.agents) x.hidden = true;
    const [a, b] = residents.agents;
    for (const [p, from, to] of [
      [a!, [-4, -4.9], [4, -4.9]],
      [b!, [4, -4.9], [-4, -4.9]],
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
    // (others may come out of their doors meanwhile: count only bows the two start together)
    let bows = 0,
      wasA = 0,
      wasB = 0;
    for (let s = 0; s < 20 * 12; s++) {
      residents.update(1 / 20, 0.01, 10, 0, s / 20);
      if (a!.bowT > wasA && b!.bowT > wasB) bows++;
      wasA = a!.bowT;
      wasB = b!.bowT;
    }
    expect(bows).toBe(1);
  });

  it('friends walking along the street a few meters apart wave', async () => {
    const { residents } = await buildSim(24);
    for (const x of residents.agents) x.hidden = true;
    const haru = residents.agents.find((a) => a.p.id === 'haru')!,
      aiko = residents.agents.find((a) => a.p.id === 'aiko')!;
    // side by side, 4 m apart, walking the same way: they won't pass close, so they wave
    for (const [p, z] of [
      [haru, -4.9],
      [aiko, -0.9],
    ] as const) {
      p.hidden = false;
      p.placeAt(-4, z);
      p.task = { kind: 'wander', label: { key: 'task.stroll' }, goal: [4, z], dwell: 60, pose: 'stand', interruptible: true };
      p.arrived = false;
      p.path = [
        [-4, z],
        [4, z],
      ];
      p.pathIdx = 1;
    }
    let waved = 0;
    for (let s = 0; s < 40; s++) {
      residents.update(1 / 20, 0.01, 10, 0, s / 20);
      if (haru.bubbleT > 1.3 && aiko.bubbleT > 1.3) waved++;
    }
    expect(waved).toBeGreaterThan(0);
    expect(haru.bowT).toBe(0);
  });

  it('makes a friend a reason to go, not a crowd to avoid', async () => {
    const { residents } = await buildSim(23);
    const r = residents as unknown as Internals;
    for (const x of residents.agents) x.hidden = true;
    const rin = residents.agents.find((a) => a.p.id === 'rin')!,
      sora = residents.agents.find((a) => a.p.id === 'sora')!,
      stranger = residents.agents.find((a) => a.p.id === 'genzo')!;
    const bench = r.smart.objects.get('bench-play')!;
    const alone = r.socialFactor(rin, bench);
    sora.hidden = false;
    sora.placeAt(bench.x + 0.5, bench.z);
    expect(r.socialFactor(rin, bench)).toBeGreaterThan(alone);
    expect(r.crowdFactor(rin, bench)).toBe(1); // her friend isn't a crowd
    stranger.hidden = false;
    stranger.placeAt(bench.x - 0.5, bench.z);
    expect(r.crowdFactor(rin, bench)).toBeLessThan(1); // a stranger is
  });
});
