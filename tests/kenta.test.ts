import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom } from './helpers/headless';

/**
 * Prompt 08's first acceptance criterion: place a vending machine by the way home from school, and
 * within the afternoon Kenta goes out of his way to it, and his diary says so that night.
 */
beforeAll(() => installHeadlessDom());

describe('Kenta and the new vending machine (prompt 08 acceptance)', () => {
  it('adopts it the same afternoon and writes it in his diary', async () => {
    const { EventBus } = await import('../src/core/events');
    const { WorldClock } = await import('../src/core/clock');
    const { skyAt } = await import('../src/render/sky');
    const { World } = await import('../src/world/world');
    const { townGrid } = await import('../src/sim/town');
    const { SmartRegistry, registerStaticObjects } = await import('../src/sim/smart');
    const { Residents } = await import('../src/sim/residents');
    const { BuildTool } = await import('../src/ui/build');
    const bus = new EventBus<import('../src/core/events').GameEvents>();
    const clock = new WorldClock(13);
    clock.speed = 4;
    const world = new World();
    const grid = townGrid();
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    const residents = new Residents(world.scene, grid, smart, bus, world.mats);
    const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);
    const kenta = residents.agents.find((a) => a.p.id === 'kenta')!;
    // just off the north lane, which every way home from school takes (he's at school now)
    let spot: [number, number] = [0, 0],
      bd = Infinity;
    for (let x = -8; x <= 0; x += 0.25)
      for (let z = -3.8; z <= -1; z += 0.25)
        if (build.canPlace('vending', x, z) && Math.hypot(x + 5, z + 3.2) < bd) [spot, bd] = [[x, z], Math.hypot(x + 5, z + 3.2)];
    build.place({ id: 'new-vending', kind: 'vending', x: spot[0], z: spot[1], ry: Math.PI / 2 }, true);
    let t = 0,
      firstUse = Infinity,
      visits = 0,
      last = '';
    while (clock.minutes < 1440 + 30) {
      const dt = 0.1;
      t += dt;
      const gm = clock.tick(dt);
      world.update(dt, t, clock, skyAt(clock.hour, 0, clock.season), gm);
      residents.minutes = clock.minutes;
      residents.update(dt, gm, clock.hour, 0, t);
      if (Math.round(t * 10) % 10 === 0) residents.noticePass(build.placedSmart(), clock.hour);
      const now = `${kenta.task?.kind}:${kenta.task?.obj?.id ?? ''}`;
      if (now !== last && kenta.task?.obj?.id === 'new-vending') {
        visits++;
        firstUse = Math.min(firstUse, clock.minutes);
      }
      last = now;
    }
    expect(firstUse).toBeLessThan(21 * 60); // by early evening, the day it appeared
    expect(visits).toBeLessThanOrEqual(4); // a drink now and then, not drink after drink
    const entry = kenta.diary.entries.find((e) => e.day === 0)!;
    const what = (entry.msg.params as Record<string, { key: string; params?: Record<string, { key: string }> }>).what!;
    expect(['diary.tried', 'diary.noticed']).toContain(what.key);
    expect(what.params?.thing?.key).toBe('noun.vending');
  }, 600_000);
});
