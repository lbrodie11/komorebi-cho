import { beforeAll, describe, expect, it } from 'vitest';
import { NavGrid } from '../src/sim/grid';
import { installHeadlessDom, buildSim } from './helpers/headless';

beforeAll(() => installHeadlessDom());

/** A flat 10 m square; the door anchor sits at its west edge. */
function square(): NavGrid {
  const g = new NavGrid({ x0: -5, z0: -5, w: 10, d: 10, cell: 0.5 }, { walkable: () => true, height: () => 0 }, []);
  g.setAnchors(() => [[-4.5, 0]]);
  return g;
}
/** A ring of posts around (x, z): nothing gets in or out. */
function ring(g: NavGrid, x: number, z: number, r: number, delta: 1 | -1 = 1): void {
  for (let a = 0; a < 24; a++) g.stamp({ x: x + Math.cos((a / 24) * Math.PI * 2) * r, z: z + Math.sin((a / 24) * Math.PI * 2) * r, r: 0.3 }, delta);
}

describe('nav regions and islands (prompt 07)', () => {
  it('labels a sealed pocket as an island, and the side with the door as the town', () => {
    const g = square();
    expect(g.island(2, 2)).toBe(false);
    ring(g, 2, 2, 1.6);
    expect(g.island(2, 2)).toBe(true);
    expect(g.island(-3, -3)).toBe(false);
    expect(g.islandCells().length).toBeGreaterThan(4);
    // no path in or out, known without searching
    expect(g.findPath(-3, -3, 2, 2)).toBeNull();
    // the way out is just beyond the ring
    const out = g.nearestMain(2, 2, 10)!;
    expect(Math.hypot(out[0] - 2, out[1] - 2)).toBeGreaterThan(1.6);
    expect(Math.hypot(out[0] - 2, out[1] - 2)).toBeLessThan(3);
    // undo the ring: one town again
    ring(g, 2, 2, 1.6, -1);
    expect(g.island(2, 2)).toBe(false);
    expect(g.findPath(-3, -3, 2, 2)).not.toBeNull();
  });

  it('calls the region most doors open onto the town, even if it is the smaller one', () => {
    const g = new NavGrid({ x0: -5, z0: -5, w: 10, d: 10, cell: 0.5 }, { walkable: () => true, height: () => 0 }, []);
    // a wall across the middle, two doors on the north side, one on the south
    g.stamp({ rect: true, x0: -5, x1: 5, z0: 1.9, z1: 2.1 }, 1);
    g.setAnchors(() => [
      [0, 4],
      [2, 4],
      [0, -4],
    ]);
    expect(g.island(0, 4)).toBe(false);
    expect(g.island(0, -4)).toBe(true);
  });

  it('walks a resident sealed in by the player back into the town, at walking pace', async () => {
    const { residents, world } = await buildSim(3);
    const grid = (residents as unknown as { grid: NavGrid }).grid;
    const a = residents.agents[0]!;
    a.hidden = false;
    a.root.visible = true;
    a.placeAt(0, 2);
    a.task = null;
    ring(grid, 0, 2, 1.4);
    expect(grid.trapped(a.x, a.z)).toBe(true);
    let last = [a.x, a.z];
    let maxStep = 0;
    for (let s = 0; s < 120; s++) {
      residents.update(1 / 20, 0.05, 10, 0, s / 20);
      maxStep = Math.max(maxStep, Math.hypot(a.x - last[0]!, a.z - last[1]!));
      last = [a.x, a.z];
    }
    expect(grid.trapped(a.x, a.z)).toBe(false);
    expect(maxStep).toBeLessThan(0.15); // never faster than a walk
    void world;
  });

  it('checks where someone comes out of a door the player sealed in while they were inside', async () => {
    const { residents } = await buildSim(9);
    const grid = (residents as unknown as { grid: NavGrid }).grid;
    const a = residents.agents[0]!;
    // inside (hidden) at a door; the player rings it while they're in
    a.hidden = true;
    a.hiddenAt = [0, 2];
    a.regionChecked = grid.version + 5; // whatever was last checked
    ring(grid, 0, 2, 1.4);
    a.regionChecked = grid.version; // as if checked since: emerging must check again anyway
    a.task = null;
    (residents as unknown as { emerge(a: unknown): void }).emerge(a);
    for (let s = 0; s < 120; s++) residents.update(1 / 20, 0.05, 10, 0, s / 20);
    expect(a.hidden || !grid.trapped(a.x, a.z)).toBe(true);
  });

  it('rations path searches: a crowd re-planning at once spreads over ticks', async () => {
    const { residents } = await buildSim(4);
    const grid = (residents as unknown as { grid: NavGrid }).grid;
    const { PATHS_PER_TICK } = await import('../src/sim/residents');
    let calls = 0;
    const orig = grid.findPath.bind(grid);
    grid.findPath = (...args) => {
      calls++;
      return orig(...args);
    };
    for (const a of residents.agents) {
      a.hidden = false;
      a.task = null;
    }
    let most = 0;
    for (let s = 0; s < 40; s++) {
      calls = 0;
      residents.update(1 / 20, 0.05, 10, 0, s / 20);
      most = Math.max(most, calls);
    }
    expect(most).toBeLessThanOrEqual(PATHS_PER_TICK);
    // and nobody is left waiting for long
    expect(residents.agents.filter((a) => a.needsPath).length).toBe(0);
  });

  it('two people walking straight at each other step aside and pass', async () => {
    const { residents } = await buildSim(5);
    const [a, b] = residents.agents;
    for (const x of residents.agents) x.hidden = true; // just the two of them
    const go = (p: typeof a, from: [number, number], to: [number, number]) => {
      p!.hidden = false;
      p!.placeAt(from[0], from[1]);
      p!.task = { kind: 'wander', label: { key: 'task.stroll' }, goal: to, dwell: 30, pose: 'stand', interruptible: true };
      p!.arrived = false;
      p!.path = [from, to];
      p!.pathIdx = 1;
      p!.pathVersion = (residents as unknown as { grid: NavGrid }).grid.version;
    };
    go(a, [-4, -4.9], [4, -4.9]);
    go(b, [4, -4.9], [-4, -4.9]);
    let closest = Infinity;
    for (let s = 0; s < 20 * 12; s++) {
      residents.update(1 / 20, 0.05, 10, 0, s / 20);
      if (!a!.hidden && !b!.hidden) closest = Math.min(closest, Math.hypot(a!.x - b!.x, a!.z - b!.z));
    }
    expect(closest).toBeGreaterThan(0.35);
    // and they got past each other
    expect(a!.x).toBeGreaterThan(2);
    expect(b!.x).toBeLessThan(-2);
  });
});
