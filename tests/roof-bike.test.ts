import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installHeadlessDom, buildSim } from './helpers/headless';
import { DOORS, ROOF_TERRACE } from '../src/world/layout';

/** The café's roof terrace and the bicycle (2026-11-11). Nobody teleports: doors in, doors out. */
beforeAll(() => installHeadlessDom());

type Internals = { assign(a: unknown, t: unknown): void; rideTask(a: unknown): unknown; bikeOut: boolean };

describe('the roof terrace', () => {
  it('Haru goes in at the café door, comes out of the stair head, sits in the deck chair, and goes back down', async () => {
    const { residents } = await buildSim(3);
    const r = residents as unknown as Internals;
    for (const x of residents.agents) x.hidden = true;
    const haru = residents.agents.find((a) => a.p.id === 'haru')!;
    const d = DOORS.kissaten!;
    haru.hidden = false;
    haru.root.visible = true;
    haru.placeAt(d.x + 1.5, d.z + 1.5);
    r.assign(haru, { kind: 'roof', label: { key: 'task.toRoof' }, goal: [d.x, d.z], dwell: 6, pose: 'stand', hide: true, interruptible: false });
    const seen: string[] = [];
    let sat = false,
      maxStep = 0,
      last = haru.root.position.clone(),
      onRoof = false;
    for (let s = 0; s < 20 * 40 && (haru.roof || !seen.includes('back')); s++) {
      residents.update(1 / 20, 0.05, 16, 0, s / 20);
      if (haru.roof) {
        if (seen[seen.length - 1] !== haru.roof.phase) seen.push(haru.roof.phase);
        expect(haru.hidden).toBe(true); // the street doesn't meet them
        expect(haru.root.visible).toBe(true); // but you can see them
        expect(haru.root.position.y).toBeGreaterThan(ROOF_TERRACE.y - 0.01);
        // (from their first moment on the roof: going up the stairs is out of sight)
        if (onRoof) maxStep = Math.max(maxStep, Math.hypot(haru.x - last.x, haru.z - last.z));
        onRoof = true;
        if (haru.roof.phase === 'sit') {
          sat = true;
          expect(haru.pose).toBe('sit');
          expect(Math.hypot(haru.x - ROOF_TERRACE.chair[0], haru.z - ROOF_TERRACE.chair[1])).toBeLessThan(0.01);
        }
        last = haru.root.position.clone();
      }
    }
    expect(seen).toEqual(['out', 'sit', 'back']);
    expect(sat).toBe(true);
    expect(maxStep).toBeLessThan(0.15); // walked across the roof, never jumped
    // gone down the stairs: out of sight, and due to come out of the café's door
    expect(haru.roof).toBeNull();
    expect(haru.perch).toBeNull();
    expect(Math.hypot(haru.hiddenAt![0] - d.x, haru.hiddenAt![1] - d.z)).toBeLessThan(0.1);
    expect(residents.info(haru).doing.key).not.toBe('task.onRoof');
  });

  it('comes in from the roof when it starts to rain', async () => {
    const { residents } = await buildSim(4);
    const r = residents as unknown as Internals;
    for (const x of residents.agents) x.hidden = true;
    const haru = residents.agents.find((a) => a.p.id === 'haru')!;
    const d = DOORS.kissaten!;
    haru.hiddenAt = [d.x, d.z];
    r.assign(haru, { kind: 'roof', label: { key: 'task.toRoof' }, goal: [d.x, d.z], dwell: 600, pose: 'stand', hide: true, interruptible: false });
    expect(haru.roof?.phase).toBe('out'); // already indoors: straight up
    for (let s = 0; s < 20 * 8; s++) residents.update(1 / 20, 0.05, 16, 0, s / 20);
    expect(haru.roof?.phase).toBe('sit');
    for (let s = 0; s < 20 * 8 && haru.roof; s++) residents.update(1 / 20, 0.05, 16, 0.6, 8 + s / 20);
    expect(haru.roof).toBeNull();
  });
});

describe('the bicycle', () => {
  it('Hiro fetches it, rides the block with it under him, and puts it back exactly where it was', async () => {
    const { residents } = await buildSim(9);
    const r = residents as unknown as Internals;
    for (const x of residents.agents) x.hidden = true;
    const bike = new THREE.Group();
    bike.position.set(-6.6, 0.32, 10.9);
    residents.bike = bike;
    const home = bike.position.clone();
    const hiro = residents.agents.find((a) => a.p.id === 'hiro')!;
    expect(hiro.p.rides).toBe(true);
    hiro.hidden = false;
    hiro.root.visible = true;
    hiro.placeAt(-4, 9.5);
    r.assign(hiro, r.rideTask(hiro));
    expect(r.bikeOut).toBe(true);
    let rode = 0,
      far = 0;
    for (let s = 0; s < 20 * 240 && hiro.task?.kind === 'ride'; s++) {
      residents.update(1 / 20, 0.05, 11, 0, s / 20);
      if (hiro.riding !== null && hiro.task?.kind === 'ride') {
        rode++;
        expect(Math.hypot(bike.position.x - hiro.x, bike.position.z - hiro.z)).toBeLessThan(0.01); // under him
        far = Math.max(far, Math.hypot(hiro.x - home.x, hiro.z - home.z));
      }
    }
    expect(rode).toBeGreaterThan(100);
    expect(far).toBeGreaterThan(8); // a real turn round the block
    expect(hiro.riding).toBeNull();
    expect(r.bikeOut).toBe(false);
    expect(bike.position.distanceTo(home)).toBeLessThan(1e-6);
    expect(Math.hypot(hiro.x - home.x, hiro.z - home.z)).toBeLessThan(2.5); // he got off by the rack
  });
});
