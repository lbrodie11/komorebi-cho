import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import { gaitFor } from '../src/sim/residents';
import type * as THREE from 'three';

/** Prompt 09: the procedural rig. Arms that counter-swing, a head that nods and glances, no snapping turns. */
beforeAll(() => installHeadlessDom());

type Rig = { head: THREE.Group; arms: THREE.Object3D[]; torso: THREE.Group };

describe('the rig (prompt 09)', () => {
  it('gives kids, runners and someone with a cane gaits of their own', () => {
    const walk = gaitFor({ kid: false, accessory: 'bag' }, false);
    const kid = gaitFor({ kid: true }, false);
    const cane = gaitFor({ accessory: 'cane' }, false);
    const run = gaitFor({}, true);
    expect(kid.bob).toBeGreaterThan(walk.bob); // kids bounce more
    expect(cane.rate).toBeLessThan(walk.rate); // slower steps
    expect(cane.swing).toBeLessThan(walk.swing); // and shorter
    expect(run.rate).toBeGreaterThan(walk.rate);
    expect(run.arm).toBeGreaterThan(walk.arm);
  });

  it('turns toward a new heading at a capped rate, never snapping round', async () => {
    const { residents } = await buildSim(3);
    const a = residents.agents[0]!;
    a.faceNow(0);
    a.heading = Math.PI; // straight behind
    a.animate(1 / 60, false, 0, 0);
    expect(Math.abs(a.root.rotation.y)).toBeLessThan(0.2); // one frame: a sliver of the turn
    for (let i = 0; i < 30; i++) a.animate(1 / 60, false, 0, i / 60);
    expect(Math.abs(Math.abs(a.root.rotation.y) - Math.PI)).toBeLessThan(1e-6); // half a second: there
  });

  it('swings the arms against the legs while walking, and rests them in the lap when sitting', async () => {
    const { residents } = await buildSim(3);
    const a = residents.agents[1]!;
    const rig = a as unknown as Rig & { legs: THREE.Mesh[] };
    a.walkPhase = 0;
    a.animate(0.05, true, 0, 0);
    const legL = rig.legs[0]!.rotation.x,
      armL = rig.arms[0]!.rotation.x;
    expect(Math.sign(armL)).toBe(-Math.sign(legL)); // counter-swing
    a.pose = 'sit';
    a.animate(0.05, false, 0, 0);
    expect(rig.arms[0]!.rotation.x).toBeLessThan(-0.3);
  });

  it('plays a nod, a glance and a wave, each moving the right part, then ends them', async () => {
    const { residents } = await buildSim(3);
    const a = residents.agents[2]!;
    const rig = a as unknown as Rig;
    a.faceNow(0);
    a.gestureTo('nod');
    a.animate(0.25, false, 0, 0);
    expect(rig.head.rotation.x).toBeGreaterThan(0.3); // head dips forward
    a.animate(0.4, false, 0, 0);
    expect(a.gesture).toBeNull();
    expect(rig.head.rotation.x).toBeCloseTo(0);
    a.gestureTo('glance', Math.PI / 2); // something off to their left-hand side of the screen
    a.animate(0.5, false, 0, 0);
    expect(rig.head.rotation.y).toBeGreaterThan(0.8);
    expect(a.root.rotation.y).toBeCloseTo(0); // only the head turns
    a.gesture = null;
    a.gestureTo('wave');
    a.animate(0.6, false, 0, 0.3);
    expect(rig.arms[1]!.rotation.z).toBeGreaterThan(2); // the right hand up
    expect(rig.arms[0]!.rotation.z).toBeCloseTo(0);
  });

  it('bows from the hips: the head and arms go with the body', async () => {
    const { residents } = await buildSim(3);
    const a = residents.agents[3]!;
    const rig = a as unknown as Rig;
    a.bowT = 0.4;
    a.animate(0.001, false, 0, 0);
    expect(rig.torso.rotation.x).toBeGreaterThan(0.4);
    expect(rig.torso.children).toContain(rig.head);
  });
});
