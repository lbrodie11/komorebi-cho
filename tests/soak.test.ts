import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Headless soak: build the whole world (real three.js scene graph, no WebGL),
 * run residents, animals and weather for 48 in-game hours while "the player"
 * places and removes things. Catches crashes, NaNs and residents who get stuck.
 */
beforeAll(() => {
  const ctx2d = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillRect() {},
    fillText() {},
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  g.requestAnimationFrame ??= () => 0;
});

describe('soak', () => {
  it('runs 48 game hours of life and edits without errors or stuck residents', async () => {
    const { EventBus } = await import('../src/core/events');
    const { WorldClock, SEASONS } = await import('../src/core/clock');
    const { skyAt } = await import('../src/render/sky');
    const { World } = await import('../src/world/world');
    const { townGrid } = await import('../src/sim/town');
    const { SmartRegistry, registerStaticObjects } = await import('../src/sim/smart');
    const { Residents } = await import('../src/sim/residents');
    const { Animals } = await import('../src/sim/animals');
    const { BuildTool } = await import('../src/ui/build');
    const { Rng } = await import('../src/core/rng');
    type Events = import('../src/core/events').GameEvents;

    const bus = new EventBus<Events>();
    const clock = new WorldClock(16.6);
    const world = new World();
    const grid = townGrid();
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    const residents = new Residents(world.scene, grid, smart, bus, world.mats);
    const animals = new Animals(world.scene, world.mats, grid, smart, bus, world.chimneyTop);
    const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);
    const rng = new Rng(99);
    const kinds = ['bench', 'sakura', 'lantern', 'vending', 'planter', 'catbowl'] as const;

    const dt = 1 / 20;
    let t = 0;
    let maxStill = 0;
    const waits = new Map<string, number>();
    let longestWait = 0;
    const still = new Map<string, { x: number; z: number; since: number }>();
    // prompt 08: nobody idle forever, nobody flip-flopping between two things of a kind
    const idle = new Map<string, number>();
    let longestIdle = 0;
    const chose = new Map<string, { kind: string; id: string; at: number }[]>();
    let flipFlops = 0;
    const lastTask = new Map<string, unknown>();
    const steps = 20 * 60 * 48;
    for (let s = 0; s < steps; s++) {
      t += dt;
      const gm = clock.tick(dt);
      world.update(dt, t, clock, skyAt(clock.hour, world.weather.rain, clock.season), gm);
      residents.update(dt, gm, clock.hour, world.weather.rain, t);
      animals.update(dt, t, clock.hour, world.weather.rain, clock.season, residents.agents);
      if (s % 20 === 0) residents.noticePass(build.placedSmart(), clock.hour);
      if (s % (20 * 60 * 12) === 0) clock.season = SEASONS[(s / (20 * 60 * 12)) % 4]!;
      if (s % (20 * 150) === 50) {
        for (let k = 0; k < 40; k++) {
          const x = Math.round(rng.range(-7, 7) * 4) / 4,
            z = Math.round(rng.range(-3, 8) * 4) / 4;
          const kind = rng.pick(kinds);
          if (build.canPlace(kind, x, z)) {
            build.place({ id: `soak${s}`, kind, x, z, ry: 0 }, true);
            break;
          }
        }
        if (build.placed.size > 8) build.remove([...build.placed.keys()][0]!);
      }
      for (const a of residents.agents) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.root.position.y)).toBe(true);
        const idleFor = !a.hidden && !a.task ? (idle.get(a.p.id) ?? 0) + dt : 0;
        idle.set(a.p.id, idleFor);
        longestIdle = Math.max(longestIdle, idleFor);
        if (a.task !== lastTask.get(a.p.id)) {
          lastTask.set(a.p.id, a.task);
          const o = a.task?.obj;
          if (a.task?.kind === 'use' && o) {
            const list = chose.get(a.p.id) ?? [];
            const same = list.filter((c) => c.kind === o.kind);
            const [x, y] = [same.at(-2), same.at(-1)];
            // A, then B, then A again, all within 20 game minutes: dithering
            if (x && y && x.id === o.id && y.id !== o.id && clock.minutes - x.at < 20) flipFlops++;
            list.push({ kind: o.kind, id: o.id, at: clock.minutes });
            chose.set(a.p.id, list.slice(-12));
          }
        }
        // waiting a turn at the bridge is fine (a deadlock is not: see below)
        const w = a.waitingFor ? (waits.get(a.p.id) ?? 0) + dt : 0;
        waits.set(a.p.id, w);
        longestWait = Math.max(longestWait, w);
        if (a.hidden || a.arrived || a.standUp > 0 || a.shuffle || a.waitingFor) {
          still.delete(a.p.id);
          continue;
        }
        const st = still.get(a.p.id);
        if (!st || Math.hypot(st.x - a.x, st.z - a.z) > 0.05) still.set(a.p.id, { x: a.x, z: a.z, since: t });
        else maxStill = Math.max(maxStill, t - st.since);
      }
    }
    expect(maxStill).toBeLessThan(5);
    expect(longestWait).toBeLessThan(20);
    expect(longestIdle).toBeLessThan(30);
    expect(flipFlops).toBe(0);
    // diaries: written each midnight, never the same line two days running
    const { fmt } = await import('../src/i18n');
    expect(residents.agents.some((a) => a.diary.entries.length >= 2)).toBe(true);
    for (const a of residents.agents) {
      const lines = a.diary.entries.map((e) => fmt(e.msg));
      for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1]);
    }
    expect(residents.agents.some((a) => a.known.size > 0)).toBe(true);
  }, 120_000);
});
