import { beforeAll, describe, expect, it } from 'vitest';
import { installHeadlessDom, buildSim } from './helpers/headless';
import { FLAP_FPS, flapFrame, hopHeight } from '../src/sim/birds';

/** Birds with a rig (2026-11 pixel-art review): held wing frames on twos, pecks, hops, a flock that startles together. */
beforeAll(() => installHeadlessDom());

describe('birds', () => {
  it('beats the wings in held frames, stepping only twelve times a second', () => {
    const frames: string[] = [];
    for (let t = 0; t < 1; t += 1 / 240) frames.push(flapFrame('pigeon', t));
    let changes = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(FLAP_FPS);
    expect(new Set(frames)).toEqual(new Set(['up', 'level', 'down']));
    // a frame is held for its whole 1/12 s
    expect(flapFrame('pigeon', 0.001)).toBe(flapFrame('pigeon', 1 / 12 - 0.001));
  });

  it('lets crows glide between beats', () => {
    let level = 0;
    for (let i = 0; i < 14; i++) if (flapFrame('crow', (i + 0.5) / FLAP_FPS) === 'level') level++;
    expect(level).toBeGreaterThanOrEqual(8); // two beats (4 level of 8), then six frames of glide
  });

  it('hops on a parabola that starts and ends on the ground', () => {
    expect(hopHeight(0, 0.07)).toBe(0);
    expect(hopHeight(1, 0.07)).toBe(0);
    expect(hopHeight(0.5, 0.07)).toBeCloseTo(0.07);
  });

  it('keeps pigeons from spinning: they turn in small steps, peck, and fly off with their wings beating', async () => {
    const { animals, residents } = await buildSim(12);
    for (const a of residents.agents) a.hidden = true;
    const pig = animals.birds.pigeons[0]!;
    let maxTurn = 0,
      pecked = false;
    let yaw = pig.root.rotation.y;
    for (let s = 0; s < 20 * 30; s++) {
      animals.update(1 / 20, s / 20, 12, 0, 'spring', residents.agents);
      maxTurn = Math.max(maxTurn, Math.abs(pig.root.rotation.y - yaw));
      yaw = pig.root.rotation.y;
      if (pig.peck > 0.3) pecked = true;
    }
    expect(maxTurn).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(pecked).toBe(true);
    // someone walks right up: it flies, wings out
    const a = residents.agents[0]!;
    a.hidden = false;
    a.placeAt(pig.root.position.x + 0.5, pig.root.position.z);
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) {
      animals.update(1 / 20, 30 + s / 20, 12, 0, 'spring', residents.agents);
      seen.add(pig.frame);
    }
    expect(seen.has('up') && seen.has('down')).toBe(true);
  });

  it('sends the sparrow flock up together when someone comes close, and lands it again', async () => {
    const { animals, residents } = await buildSim(13);
    for (const a of residents.agents) a.hidden = true;
    const sp = animals.birds.sparrows;
    // gather them on one spot of the lane, then walk someone into the middle
    const o = sp[0]!.root.position.clone();
    sp.forEach((b, i) => b.root.position.set(o.x + (i % 3) * 0.3, o.y, o.z + Math.floor(i / 3) * 0.3));
    const a = residents.agents[0]!;
    a.hidden = false;
    a.placeAt(o.x + 0.3, o.z + 0.15);
    let maxUp = 0;
    for (let s = 0; s < 8; s++) {
      animals.update(1 / 20, s / 20, 10, 0, 'summer', residents.agents);
      maxUp = Math.max(maxUp, sp.filter((b) => b.frame !== 'folded').length);
    }
    expect(maxUp).toBeGreaterThanOrEqual(4); // not one bird: the flock
    a.hidden = true;
    for (let s = 0; s < 40; s++) animals.update(1 / 20, 1 + s / 20, 10, 0, 'summer', residents.agents);
    expect(sp.every((b) => b.frame === 'folded')).toBe(true);
    // night and heavy rain: under cover
    animals.update(1 / 20, 5, 22, 0, 'summer', residents.agents);
    expect(sp.every((b) => !b.root.visible)).toBe(true);
  });
});
