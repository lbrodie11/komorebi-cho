import { it, beforeAll } from 'vitest';
import { installHeadlessDom } from './helpers/headless';

/**
 * The nav profile behind docs/NAV.md (prompt 07): 40 residents, 40 placed objects, A* across the
 * town and three game hours of the sim tick. Opt-in (timings vary by machine):
 *   NAV_PROFILE=1 npx vitest run tests/nav-profile.test.ts
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } }).process;
beforeAll(() => installHeadlessDom());

it.skipIf(!env.env.NAV_PROFILE)(
  'profiles navigation',
  async () => {
    const out = (...v: unknown[]) => env.stderr.write(`\nNAV ${v.join(' ')}`);
    const { EventBus } = await import('../src/core/events');
    const { WorldClock } = await import('../src/core/clock');
    const { skyAt } = await import('../src/render/sky');
    const { World } = await import('../src/world/world');
    const { GROUND } = await import('../src/world/layout');
    const { townGrid } = await import('../src/sim/town');
    const { SmartRegistry, registerStaticObjects } = await import('../src/sim/smart');
    const { PERSONAS } = await import('../src/sim/personas');
    const { Residents } = await import('../src/sim/residents');
    const { BuildTool } = await import('../src/ui/build');
    const { Rng } = await import('../src/core/rng');
    const bus = new EventBus<import('../src/core/events').GameEvents>();
    const clock = new WorldClock(8);
    const world = new World();
    const grid = townGrid();
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    const base = [...PERSONAS];
    for (let i = 0; PERSONAS.length < 40; i++) PERSONAS.push({ ...base[i % base.length]!, id: `${base[i % base.length]!.id}${i}` });
    const residents = new Residents(world.scene, grid, smart, bus, world.mats);
    const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);
    const rng = new Rng(4);
    for (let n = 0; build.placed.size < 40 && n < 4000; n++) {
      const x = Math.round(rng.range(-15, 15) * 4) / 4,
        z = Math.round(rng.range(-11, 11) * 4) / 4;
      const kind = rng.pick(['bench', 'planter', 'lantern', 'bonsai', 'tanuki', 'catbowl'] as const);
      if (build.canPlace(kind, x, z, { ignoreResidents: true })) build.place({ id: `p${n}`, kind, x, z, ry: 0 }, false);
    }
    out('cells', grid.cols * grid.rows, 'residents', residents.agents.length, 'placed', build.placed.size, 'island cells', grid.islandCells().length);
    const pts: [number, number][] = [];
    while (pts.length < 400) {
      const x = GROUND.x0 + (GROUND.x1 - GROUND.x0) * rng.next(),
        z = GROUND.z0 + (GROUND.z1 - GROUND.z0) * rng.next();
      if (grid.isOpenAt(x, z)) pts.push([x, z]);
    }
    const ts: number[] = [];
    let fails = 0;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const t = performance.now();
      if (!grid.findPath(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])) fails++;
      ts.push(performance.now() - t);
    }
    ts.sort((a, b) => a - b);
    out('A* ms median', ts[100]!.toFixed(3), 'p95', ts[190]!.toFixed(3), 'max', ts[199]!.toFixed(3), 'unreachable', fails, 'of 200');
    const dt = 1 / 20;
    let t = 0;
    const tick: number[] = [];
    for (let s = 0; s < 20 * 60 * 3; s++) {
      t += dt;
      const gm = clock.tick(dt);
      world.update(dt, t, clock, skyAt(clock.hour, 0, clock.season), gm);
      const a = performance.now();
      residents.update(dt, gm, clock.hour, 0, t);
      if (s % 20 === 0) residents.noticePass(build.placedSmart(), clock.hour);
      tick.push(performance.now() - a);
    }
    tick.sort((a, b) => a - b);
    const mean = tick.reduce((a, b) => a + b, 0) / tick.length;
    const pct = (p: number) => tick[Math.floor(tick.length * p)]!.toFixed(3);
    out('sim tick ms mean', mean.toFixed(3), 'p95', pct(0.95), 'p99', pct(0.99), 'max', tick[tick.length - 1]!.toFixed(3));
  },
  300_000,
);
