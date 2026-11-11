import { describe, it, expect, beforeAll } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';

beforeAll(installHeadlessDom);

type Sim = Awaited<ReturnType<typeof buildSim>>;
const snapshot = (s: Sim) => ({
  hour: s.clock.hour,
  rain: s.world.weather.rain,
  agents: s.residents.agents.map((a) => [a.p.id, a.hidden, +a.x.toFixed(6), +a.z.toFixed(6), a.task?.kind ?? null]),
});

describe('warmUp (seeded screenshot state)', () => {
  it('is deterministic for a seed and lands exactly on the hour', async () => {
    const { warmUp } = await import('../src/sim/warmup');
    const a = await buildSim(7);
    const b = await buildSim(7);
    warmUp(a, 15, 18);
    warmUp(b, 15, 18);
    expect(a.clock.hour).toBeCloseTo(18, 9);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.residents.agents.some((x) => !x.hidden)).toBe(true);
  }, 60_000);

  it('a different seed gives a different neighbourhood moment', async () => {
    const { warmUp } = await import('../src/sim/warmup');
    const a = await buildSim(1);
    const b = await buildSim(2);
    warmUp(a, 15, 18);
    warmUp(b, 15, 18);
    expect(snapshot(a)).not.toEqual(snapshot(b));
  }, 60_000);
});
