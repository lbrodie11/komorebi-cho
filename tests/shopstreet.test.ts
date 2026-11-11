import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import * as THREE from 'three';
import { DOORS, TG } from '../src/world/layout';

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

  it('puts a shop back exactly as first built when the edit is undone (windows, details, seams)', async () => {
    const { world } = await buildSim(11);
    const look = () => {
      const parts: string[] = [];
      world.scene.updateMatrixWorld(true);
      world.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const p = m.isMesh ? m.geometry.getAttribute('position') : undefined;
        if (!p || !m.parent) return;
        const v = new THREE.Vector3().fromBufferAttribute(p, 0).applyMatrix4(m.matrixWorld);
        if (v.x > -17 && v.x < -9.5 && v.z > -4 && v.z < 10) parts.push(`${p.count}|${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`);
      });
      const win = world.kit.windows.map((w) => `${w.kind}:${w.index}:${w.offset.toFixed(4)}`).sort();
      return parts.sort().join('\n') + '\n' + win.join(';');
    };
    const before = look();
    world.setShopExtent('bakery', -0.2, 2.2);
    expect(look()).not.toBe(before);
    world.setShopExtent('bakery', -0.2, 3.2);
    expect(look()).toBe(before);
  });

  it('steps people aside at their own level, never over the terrace wall', async () => {
    const { residents } = await buildSim(12);
    const a = residents.agents[0]!;
    for (const x of residents.agents) x.hidden = true;
    a.hidden = false;
    // on the terrace walk, right at its lane-side edge
    a.placeAt(0, -6.35);
    a.task = null;
    residents.shuffleAside(0, -6.45, 0.45);
    expect(a.shuffle).not.toBeNull();
    expect(a.shuffle!.tz).toBeLessThan(-6.2); // still on the terrace (z < -6.2), not the lane below
    void TG;
  });
});
