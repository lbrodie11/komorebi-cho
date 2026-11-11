import { describe, it, expect, beforeAll } from 'vitest';
import { installHeadlessDom } from './helpers/headless';

/**
 * The 500-edit fuzz (prompt 06 acceptance): random places, removes, moves, shop moves and resizes,
 * undos and redos, half a second apart, while the neighbours live their routines. Zero exceptions,
 * zero visible teleports, nobody stuck, nobody left standing inside something, and undoing
 * everything returns the town to a byte-identical hash.
 */
beforeAll(() => installHeadlessDom());

describe('edit fuzz', () => {
  it('survives 500 random edits with no teleports, no one stuck, and undoes to the start', async () => {
    const { EventBus } = await import('../src/core/events');
    const { WorldClock } = await import('../src/core/clock');
    const { skyAt } = await import('../src/render/sky');
    const { World } = await import('../src/world/world');
    const { GROUND, OBSTACLES } = await import('../src/world/layout');
    const { groundHeight, isWalkableSurface } = await import('../src/world/terrain');
    const { NavGrid } = await import('../src/sim/grid');
    const { SmartRegistry, registerStaticObjects } = await import('../src/sim/smart');
    const { Residents } = await import('../src/sim/residents');
    const { BuildTool } = await import('../src/ui/build');
    const { History } = await import('../src/edit/history');
    const { applyShopEdit } = await import('../src/edit/shopedit');
    const { shopCheck } = await import('../src/edit/shops');
    const { PLACEABLES } = await import('../src/world/props');
    const { Rng } = await import('../src/core/rng');
    type Events = import('../src/core/events').GameEvents;

    const bus = new EventBus<Events>();
    const clock = new WorldClock(15);
    const world = new World();
    const grid = new NavGrid(
      { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
      { walkable: isWalkableSurface, height: groundHeight },
      OBSTACLES,
    );
    const smart = new SmartRegistry();
    registerStaticObjects(smart);
    const residents = new Residents(world.scene, grid, smart, bus, world.mats);
    const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);
    let fresh = false;
    const ctx = { world, grid, smart, residents, bus, hour: () => clock.hour };
    const history = new History({
      place: (r) => build.place(r as Parameters<typeof build.place>[0], fresh),
      remove: (id) => build.remove(id),
      move: (id, x, z, ry) => build.move(id, x, z, ry),
      shop: (id, z0, z1) => applyShopEdit(ctx, id, z0, z1, fresh),
    });
    const hash = () =>
      JSON.stringify({
        placed: build.records().sort((a, b) => (a.id < b.id ? -1 : 1)),
        shops: world.shopStreet.specs.map(({ id, z0, z1 }) => [id, z0, z1]),
        nav: grid.occupancyHash,
      });
    // the town before each remembered edit, mirroring History's stacks, so "undo everything" has an exact target
    const { HISTORY_MAX } = await import('../src/edit/history');
    const before: string[] = [];
    const undoneBefore: string[] = [];
    const perform = (c: Parameters<typeof history.perform>[0]) => {
      before.push(hash());
      if (before.length > HISTORY_MAX) before.shift();
      undoneBefore.length = 0;
      history.perform(c);
    };
    const rng = new Rng(500);
    const kinds = Object.keys(PLACEABLES) as (keyof typeof PLACEABLES)[];
    // near the people: the lanes, the park and the shopping street, where edits land on someone
    const spot = () => [Math.round(rng.range(-9, 9) * 4) / 4, Math.round(rng.range(-5, 9) * 4) / 4] as const;

    let n = 0;
    const edit = (): void => {
      const r = rng.next();
      fresh = true;
      try {
        if (r < 0.32) {
          for (let k = 0; k < 30; k++) {
            const [x, z] = spot();
            const kind = rng.pick(kinds);
            // ignoring residents: undo and redo put things back wherever people now stand
            if (!build.canPlace(kind, x, z, { ignoreResidents: true })) continue;
            perform({ op: 'place', rec: { id: `f${n}`, kind, x, z, ry: rng.int(0, 7) * (Math.PI / 4) } });
            return;
          }
        } else if (r < 0.45 && build.placed.size) {
          const p = build.placed.get(rng.pick([...build.placed.keys()].sort()))!;
          perform({ op: 'remove', rec: { id: p.id, kind: p.kind, x: p.x, z: p.z, ry: p.ry } });
        } else if (r < 0.58 && build.placed.size) {
          const p = build.placed.get(rng.pick([...build.placed.keys()].sort()))!;
          for (let k = 0; k < 30; k++) {
            const [x, z] = spot();
            if (!build.canPlace(p.kind, x, z, { ignoreResidents: true, ignoreId: p.id })) continue;
            perform({ op: 'move', id: p.id, from: { x: p.x, z: p.z, ry: p.ry }, to: { x, z, ry: p.ry } });
            return;
          }
        } else if (r < 0.7) {
          const row = world.shopStreet.specs.map(({ id, z0, z1 }) => ({ id, z0, z1 }));
          const s = rng.pick(row);
          const z0 = Math.round((s.z0 + rng.int(-4, 4) * 0.25) * 100) / 100;
          const z1 = Math.round((z0 + (s.z1 - s.z0) + rng.int(-2, 2) * 0.5) * 100) / 100;
          if (!shopCheck(row, s.id, z0, z1)) perform({ op: 'shop', id: s.id, from: { z0: s.z0, z1: s.z1 }, to: { z0, z1 } });
        } else if (r < 0.88) {
          fresh = false;
          if (history.undo()) undoneBefore.push(before.pop()!);
        } else {
          fresh = false;
          const h = hash();
          if (history.redo()) {
            undoneBefore.pop();
            before.push(h);
          }
        }
      } finally {
        fresh = false;
      }
    };

    const dt = 1 / 20;
    let t = 0;
    let teleports = 0;
    let maxStill = 0;
    let maxInside = 0;
    const last = new Map<string, { x: number; z: number; visible: boolean }>();
    const still = new Map<string, { x: number; z: number; since: number }>();
    const inside = new Map<string, number>();
    while (n < 500) {
      for (let s = 0; s < 10; s++) {
        t += dt;
        const gm = clock.tick(dt);
        world.update(dt, t, clock, skyAt(clock.hour, world.weather.rain, clock.season), gm);
        residents.update(dt, gm, clock.hour, world.weather.rain, t);
        if (s === 0) residents.noticePass(build.placedSmart(), clock.hour);
        for (const a of residents.agents) {
          expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
          const visible = !a.hidden;
          const was = last.get(a.p.id);
          // a visible jump faster than anyone walks or shuffles is a teleport
          if (was?.visible && visible && Math.hypot(a.x - was.x, a.z - was.z) > 0.35) teleports++;
          last.set(a.p.id, { x: a.x, z: a.z, visible });
          // walking but not getting anywhere
          if (a.hidden || a.arrived || a.standUp > 0 || a.shuffle) still.delete(a.p.id);
          else {
            const st = still.get(a.p.id);
            if (!st || Math.hypot(st.x - a.x, st.z - a.z) > 0.05) still.set(a.p.id, { x: a.x, z: a.z, since: t });
            else maxStill = Math.max(maxStill, t - st.since);
          }
          // standing inside something placed (sitting on a bench is using it, not inside it)
          const using = a.task?.obj?.id;
          const inSomething =
            visible &&
            a.pose === 'stand' &&
            !a.shuffle &&
            [...build.placed.values()].some((p) => p.id !== using && Math.hypot(p.x - a.x, p.z - a.z) < p.radius * 0.6);
          const k = inSomething ? (inside.get(a.p.id) ?? 0) + dt : 0;
          inside.set(a.p.id, k);
          maxInside = Math.max(maxInside, k);
        }
      }
      edit();
      n++;
    }
    expect(teleports).toBe(0);
    expect(maxStill).toBeLessThan(5);
    expect(maxInside).toBeLessThan(1);
    expect(history.log.some((c) => c.op === 'shop')).toBe(true);
    const end = hash();
    const depth = history.log.length;
    const oldest = before[0];
    while (history.canUndo) history.undo();
    if (oldest) expect(hash()).toBe(oldest);
    // redo exactly what was undone (anything already undone during the fuzz stays undone)
    for (let k = 0; k < depth; k++) history.redo();
    expect(hash()).toBe(end);
  }, 180_000);
});
