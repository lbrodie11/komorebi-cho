import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import { Rng } from '../src/core/rng';
import { edgeDistance, inPolygon, swim, swimmable, type KoiState, type Water } from '../src/sim/creatures';
import { ISLET, POND } from '../src/world/layout';

/** Cats and koi with a shape and a way of their own (2026-11 animal review). */
beforeAll(() => installHeadlessDom());

const WATER: Water = { pond: POND, islet: ISLET, margin: 0.35, zMin: -0.9 };

describe('the koi', () => {
  it('knows the pond: in from the banks, round the islet, not up the stream', () => {
    expect(swimmable(2.4, 3.6, WATER)).toBe(true);
    expect(swimmable(ISLET.x, ISLET.z, WATER)).toBe(false); // the islet
    expect(swimmable(-0.1, -2.5, WATER)).toBe(false); // the stream's narrow arm
    expect(swimmable(20, 20, WATER)).toBe(false);
    expect(inPolygon(2, 2, POND)).toBe(true);
    expect(edgeDistance(2.4, 3.6, POND)).toBeGreaterThan(0.35);
  });

  it('never leaves the water in half an hour of swimming, turns at a fish’s pace, and really gets about', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = new Rng(seed);
      const k: KoiState = { x: 2.4, z: 3.6, heading: seed, tx: 2.4, tz: 3.6, think: 0, rise: 0 };
      let minX = k.x,
        maxX = k.x,
        maxTurn = 0,
        moved = 0;
      for (let s = 0; s < 20 * 1800; s++) {
        const h0 = k.heading,
          x0 = k.x,
          z0 = k.z;
        swim(k, 1 / 20, WATER, rng);
        if (!swimmable(k.x, k.z, WATER)) throw new Error(`seed ${seed}: out of the water at ${k.x.toFixed(2)},${k.z.toFixed(2)}`);
        maxTurn = Math.max(maxTurn, Math.abs(k.heading - h0));
        moved += Math.hypot(k.x - x0, k.z - z0);
        minX = Math.min(minX, k.x);
        maxX = Math.max(maxX, k.x);
      }
      expect(maxTurn).toBeLessThanOrEqual(1.6 / 20 + 1e-9); // no snapping round
      expect(maxX - minX).toBeGreaterThan(3); // it uses the pond, not one corner
      expect(moved).toBeGreaterThan(150); // and isn't stuck against a bank
    }
  });

  it('is slow in winter but still there, and keeps to its own stream of chance', () => {
    const run = (pace: number) => {
      const rng = new Rng(4);
      const k: KoiState = { x: 2.4, z: 3.6, heading: 0, tx: 2.4, tz: 3.6, think: 0, rise: 0 };
      let moved = 0;
      for (let s = 0; s < 20 * 600; s++) {
        const x0 = k.x,
          z0 = k.z;
        swim(k, 1 / 20, WATER, rng, pace);
        moved += Math.hypot(k.x - x0, k.z - z0);
      }
      return moved;
    };
    expect(run(0.3)).toBeGreaterThan(5);
    expect(run(0.3)).toBeLessThan(run(1) * 0.5);
    expect(run(1)).toBe(run(1)); // deterministic
  });

  it('swims in the town’s pond all year, every one of the six inside the water', async () => {
    const { animals, residents } = await buildSim(2);
    const koi = (animals as unknown as { koi: { rig: { root: { visible: boolean; position: { x: number; z: number } } } }[] }).koi;
    expect(koi).toHaveLength(6);
    for (const season of ['summer', 'winter'] as const)
      for (let s = 0; s < 20 * 60; s++) {
        animals.update(1 / 20, s / 20, 13, 0, season, residents.agents);
        for (const k of koi) {
          expect(k.rig.root.visible).toBe(true);
          expect(swimmable(k.rig.root.position.x, k.rig.root.position.z, WATER)).toBe(true);
        }
      }
  });
});

describe('the cats', () => {
  it('have poses of their own: tail up on the move, wrapped round asleep, and a stretch on waking', async () => {
    const { animals, residents } = await buildSim(2);
    for (const a of residents.agents) a.hidden = true;
    type C = { rig: { pose: string; tailYaw: number; stretch: number }; sleeping: boolean; path: unknown[]; idx: number; rest: number };
    const cats = (animals as unknown as { cats: C[] }).cats;
    const poses = new Set<string>();
    // a day: they walk, sit or loaf, and at night they sleep
    for (let s = 0; s < 20 * 120; s++) {
      animals.update(1 / 20, s / 20, 14, 0, 'spring', residents.agents);
      for (const c of cats) poses.add(c.rig.pose);
    }
    expect(poses.has('walk')).toBe(true);
    expect(poses.has('sit') || poses.has('loaf')).toBe(true);
    for (const c of cats) {
      c.path = [];
      c.rest = 20;
    }
    animals.update(1 / 20, 200, 23, 0, 'spring', residents.agents);
    for (const c of cats) {
      expect(c.rig.pose).toBe('sleep');
      expect(Math.abs(c.rig.tailYaw)).toBeGreaterThan(1); // wrapped round
    }
    // morning: awake, and the first thing is a stretch
    for (const c of cats) c.rest = 4;
    animals.update(1 / 20, 201, 9, 0, 'spring', residents.agents);
    expect(cats.every((c) => c.rig.pose !== 'sleep')).toBe(true);
    expect(cats.some((c) => c.rig.stretch > 0)).toBe(true);
  });
});
