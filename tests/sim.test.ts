import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/sim/grid';
import { GROUND, OBSTACLES, DOORS, EXITS, STEPS, TG, G } from '../src/world/layout';
import { groundHeight, isWalkableSurface } from '../src/world/terrain';
import { SmartRegistry, registerStaticObjects } from '../src/sim/smart';
import { PERSONAS } from '../src/sim/personas';

const makeGrid = () =>
  new NavGrid(
    { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
    { walkable: isWalkableSurface, height: groundHeight },
    OBSTACLES,
  );

describe('terrain', () => {
  it('terrace is raised and steps ramp between', () => {
    expect(groundHeight(-5, -7.5)).toBeCloseTo(TG, 5);
    expect(groundHeight(0, 0) < TG).toBe(true);
    const mid = groundHeight((STEPS.x0 + STEPS.x1) / 2, -7.2);
    expect(mid > G && mid < TG).toBe(true);
  });
  it('pond is not walkable but the bridge and islet are', () => {
    expect(isWalkableSurface(3, 0)).toBe(false);
    expect(isWalkableSurface(0.7, 2)).toBe(true);
    expect(isWalkableSurface(4.6, 2)).toBe(true);
  });
});

describe('NavGrid', () => {
  const grid = makeGrid();
  it('reaches every door and exit from the park', () => {
    for (const d of Object.values(DOORS)) expect(grid.findPath(-4, 2, d.x, d.z), `door ${d.id}`).not.toBeNull();
    for (const e of EXITS) expect(grid.findPath(-4, 2, e[0], e[1])).not.toBeNull();
  });
  it('only climbs to the terrace via the steps', () => {
    const p = grid.findPath(-6, -4.9, -6, -7.5);
    expect(p).not.toBeNull();
    const passesSteps = p!.some(([x, z]) => x >= STEPS.x0 - 0.6 && x <= STEPS.x1 + 0.6 && z <= STEPS.z1 + 0.6);
    expect(passesSteps).toBe(true);
  });
  it('crosses to the islet over the bridge', () => {
    expect(grid.findPath(-4, 2, 4.4, 2)).not.toBeNull();
  });
  it('stamping an obstacle reroutes and unstamping restores', () => {
    const before = grid.version;
    grid.stamp({ x: -9.25, z: 4, r: 1.6 }, 1);
    expect(grid.version).toBeGreaterThan(before);
    expect(grid.isOpenAt(-9.25, 4)).toBe(false);
    grid.stamp({ x: -9.25, z: 4, r: 1.6 }, -1);
    expect(grid.isOpenAt(-9.25, 4)).toBe(true);
  });
  it('overlapping obstacles use reference counts', () => {
    expect(grid.isOpenAt(3.5, 7.8)).toBe(true);
    grid.stamp({ x: 3.5, z: 7.8, r: 0.5 }, 1);
    grid.stamp({ x: 3.5, z: 7.8, r: 0.5 }, 1);
    grid.stamp({ x: 3.5, z: 7.8, r: 0.5 }, -1);
    expect(grid.isOpenAt(3.5, 7.8)).toBe(false);
    grid.stamp({ x: 3.5, z: 7.8, r: 0.5 }, -1);
    expect(grid.isOpenAt(3.5, 7.8)).toBe(true);
  });
});

describe('smart objects and personas', () => {
  it('every work spot is reachable', () => {
    const grid = makeGrid();
    for (const p of PERSONAS) if (p.work) expect(grid.findPath(-4, 2, p.work.spot[0], p.work.spot[1]), p.id).not.toBeNull();
  });
  it('reservations are exclusive and released per resident', () => {
    const r = new SmartRegistry();
    registerStaticObjects(r);
    const bench = r.objects.get('bench-pond-a')!;
    expect(r.reserve(bench, 'a')).not.toBeNull();
    expect(r.reserve(bench, 'b')).not.toBeNull();
    expect(r.reserve(bench, 'c')).toBeNull();
    r.release('a');
    expect(r.reserve(bench, 'c')).not.toBeNull();
  });
});

describe('nav grid occupancy hash', () => {
  it('returns to the same hash when every stamp is undone', () => {
    const g = new NavGrid({ x0: -5, z0: -5, w: 10, d: 10, cell: 0.5 }, { walkable: () => true, height: () => 0 }, []);
    const h0 = g.occupancyHash;
    g.stamp({ x: 1, z: 1, r: 0.6 }, 1);
    g.stamp({ x: -2, z: 0, r: 0.4 }, 1);
    expect(g.occupancyHash).not.toBe(h0);
    g.stamp({ x: 1, z: 1, r: 0.6 }, -1);
    g.stamp({ x: -2, z: 0, r: 0.4 }, -1);
    expect(g.occupancyHash).toBe(h0);
  });
});
