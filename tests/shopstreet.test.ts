import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import { DOORS } from '../src/world/layout';

beforeAll(() => installHeadlessDom());

describe('moving a shop-house (prompt 06 phase C)', () => {
  it('rebuilds the shop, keeps its windows lit-able, and carries its fixtures', async () => {
    const { world } = await buildSim(1);
    const windows = world.kit.windows.length;
    const nav = world.setShopExtent('ramen', -3.8, -0.4);
    expect(world.shopStreet.get('ramen')).toMatchObject({ z0: -3.8, z1: -0.4 });
    expect(world.kit.windows.length).toBe(windows);
    // the ramen shop's doorstep pots move by its middle's shift (-0.1 m), nav spots with them
    expect(nav.length).toBe(2);
    for (const n of nav) expect(n.to - n.from).toBeCloseTo(-0.1, 6);
    // and back again: the street is as it was
    world.setShopExtent('ramen', -3.6, -0.4);
    expect(world.shopStreet.changed()).toEqual({});
  });

  it('sends people to a moved door, and lets those inside out of the new one', async () => {
    const { residents } = await buildSim(2);
    const d = DOORS.bakery!;
    const from: [number, number] = [d.x, d.z];
    const [inside, walking] = residents.agents;
    inside!.hidden = true;
    inside!.hiddenAt = [...from];
    walking!.hidden = false;
    walking!.task = { kind: 'inside', label: { key: 'task.busyInside' }, goal: [...from], dwell: 10, pose: 'stand', hide: true, interruptible: true };
    residents.onDoorMoved(from, [d.x, 1]);
    expect(inside!.hiddenAt).toEqual([d.x, 1]);
    expect(walking!.task.goal).toEqual([d.x, 1]);
    // path searches wait for the next tick (they're rationed per tick); then the path ends at the new door
    residents.update(1 / 20, 0.05, 10, 0, 0);
    const end = walking!.path[walking!.path.length - 1]!;
    expect(Math.hypot(end[0] - d.x, end[1] - 1)).toBeLessThan(0.8);
  });
});
