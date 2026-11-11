import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom } from './helpers/headless';

/**
 * Prompt 08's thin slice, end to end: Mitsuko and a new bench. Day 1 she tries it, day 2 she comes
 * back to it ("tries the new bench again"), day 3+ it's her favourite. Remove it and the next day
 * she looks for it (a `?`), then settles on another. The cats sit near her while she's out.
 */
beforeAll(() => installHeadlessDom());

describe('Mitsuko and the new bench (prompt 08 thin slice)', () => {
  it('notices it, comes back to it, adopts it; looks for it when it goes, and settles on another', async () => {
    const { EventBus } = await import('../src/core/events');
    const { WorldClock } = await import('../src/core/clock');
    const { skyAt } = await import('../src/render/sky');
    const { World } = await import('../src/world/world');
    const { townGrid } = await import('../src/sim/town');
    const { SmartRegistry, registerStaticObjects } = await import('../src/sim/smart');
    const { Residents } = await import('../src/sim/residents');
    const { Animals } = await import('../src/sim/animals');
    const { BuildTool } = await import('../src/ui/build');
    const bus = new EventBus<import('../src/core/events').GameEvents>();
    const clock = new WorldClock(14);
    clock.speed = 4;
    const world = new World();
    const grid = townGrid();
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    const residents = new Residents(world.scene, grid, smart, bus, world.mats);
    const animals = new Animals(world.scene, world.mats, grid, smart, bus, world.chimneyTop);
    const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);
    const m = residents.agents.find((a) => a.p.id === 'mitsuko')!;
    const day = () => Math.floor(clock.minutes / 1440);
    const told: { day: number; key: string; thing?: string }[] = [];
    bus.on('story', ({ msg, who }) => {
      if (who !== 'mitsuko') return;
      const thing = (msg.params as { thing?: { key: string } } | undefined)?.thing?.key;
      told.push({ day: day(), key: msg.key, thing });
    });
    expect(residents.favouriteOf(m, 'bench')).toBe('bench-pond-a'); // her haunt
    expect(residents.info(m).favorite?.key).toBe('noun.bench-pond-a');

    let t = 0,
      seated = 0,
      catNear = 0;
    const run = (untilMinutes: number, each?: () => void) => {
      while (clock.minutes < untilMinutes) {
        const dt = 0.1;
        t += dt;
        const gm = clock.tick(dt);
        world.update(dt, t, clock, skyAt(clock.hour, 0, clock.season), gm);
        residents.minutes = clock.minutes;
        residents.update(dt, gm, clock.hour, 0, t);
        animals.update(dt, t, clock.hour, 0, clock.season, residents.agents);
        if (Math.round(t * 10) % 10 === 0) residents.noticePass(build.placedSmart(), clock.hour);
        if (!m.hidden && m.arrived && m.pose === 'sit') {
          seated++;
          if (
            (animals as unknown as { cats: { root: { position: { x: number; z: number } } }[] }).cats.some(
              (c) => Math.hypot(c.root.position.x - m.x, c.root.position.z - m.z) < 2,
            )
          )
            catNear++;
        }
        each?.();
      }
    };
    // a new bench near the pond, placed in the afternoon
    run(15 * 60);
    const spot = (
      [
        [-4, -1.25],
        [-4.5, -0.5],
        [-3.5, 0],
      ] as const
    ).find(([x, z]) => build.canPlace('bench', x, z))!;
    build.place({ id: 'new-bench', kind: 'bench', x: spot[0], z: spot[1], ry: 0 }, true);
    run(4 * 1440 + 18 * 60);

    const keys = told.map((s) => `${s.day}:${s.key}`);
    const first = told.findIndex((s) => s.key === 'story.useBench');
    const again = told.findIndex((s) => s.key === 'story.triesAgain');
    const fav = told.findIndex((s) => s.key === 'story.newFavorite');
    expect(first, keys.join(' ')).toBeGreaterThanOrEqual(0);
    expect(again, keys.join(' ')).toBeGreaterThan(first);
    expect(fav, keys.join(' ')).toBeGreaterThan(again);
    expect(told[again]!.day).toBeGreaterThan(told[first]!.day); // she came back on another day
    expect(told[fav]!.day).toBeGreaterThan(told[again]!.day); // a habit: a third day, not the same visit
    expect(residents.favouriteOf(m, 'bench')).toBe('new-bench');
    expect(residents.info(m).favorite?.key).toBe('noun.bench');

    // the player takes it away: next time, she looks for it, then a bench of hers again
    const before = told.length;
    build.remove('new-bench');
    run(8 * 1440 + 18 * 60); // a new habit takes three days
    const after = told.slice(before);
    const looked = after.findIndex((s) => s.key === 'story.looksFor');
    expect(looked, after.map((s) => s.key).join(' ')).toBeGreaterThanOrEqual(0);
    const adopted = after.findIndex((s, i) => i > looked && s.key === 'story.newFavorite');
    expect(adopted, after.map((s) => s.key).join(' ')).toBeGreaterThan(looked);
    expect(residents.favouriteOf(m, 'bench')).not.toBeNull();
    expect(m.missing.size).toBe(0);
    // no line told twice in a row
    for (let i = 1; i < told.length; i++) expect(`${told[i]!.key}|${told[i]!.thing}`).not.toBe(`${told[i - 1]!.key}|${told[i - 1]!.thing}`);
    // her diary tells the same story, a line a day, never the same line twice running
    const { fmt } = await import('../src/i18n');
    const lines = m.diary.entries.map((e) => fmt(e.msg));
    const whats = m.diary.entries.map((e) => (e.msg.params as Record<string, { key: string }>).what!.key);
    expect(
      whats.some((k) => k === 'diary.again' || k === 'diary.newFavorite' || k === 'diary.lookedFor'),
      lines.join(' | '),
    ).toBe(true);
    for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1]);
    expect(residents.info(m).diary.length).toBe(2);
    // and the cats came to sit by her
    expect(seated).toBeGreaterThan(0);
    // (at 4× her sittings last 2-5 real seconds while cats walk in real time, so this undercounts)
    expect(catNear / seated).toBeGreaterThan(0.2);
  }, 600_000);
});
