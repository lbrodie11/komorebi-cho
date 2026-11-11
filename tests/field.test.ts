import { describe, expect, it } from 'vitest';
import { butFor, placeScore, sunPressure, without, type FieldEnv } from '../src/sim/field';

/** Prompt 09b: the place field. The four combinations the prompt asks to emerge, and the reasons behind them. */
const env = (over: Partial<FieldEnv> = {}): FieldEnv => ({
  hour: 13,
  season: 'summer',
  rain: 0,
  trees: [],
  shelters: [],
  lights: [],
  water: [],
  food: [],
  bowls: [],
  ...over,
});
const open = { x: 0, z: 0, face: 0 },
  other = { x: 20, z: 0, face: 0 };

describe('the place field', () => {
  it('prefers a bench under a tree at summer noon, and a sunny one on a winter morning', () => {
    const trees = [{ x: 0.5, z: 0, r: 1.8, id: 'sakura-1' }];
    const noon = env({ trees });
    expect(placeScore(open, noon).score).toBeGreaterThan(placeScore(other, noon).score * 1.3);
    expect(placeScore(open, noon).because).toEqual(['sakura-1']); // the tree the player planted is why
    const winter = env({ trees, season: 'winter', hour: 10.5 });
    expect(placeScore(other, winter).score).toBeGreaterThan(placeScore(open, winter).score);
    expect(placeScore(open, winter).because).toEqual([]);
    // at dusk the sun doesn't matter either way
    expect(sunPressure(18.5, 'summer')).toBe(0);
    expect(placeScore(open, env({ trees, hour: 17.5 })).parts.shade).toBe(1);
  });

  it('prefers a bench by a lantern at dusk, and not by day', () => {
    const lights = [{ x: 1.5, z: 1, id: 'lantern-1' }];
    const dusk = env({ lights, hour: 19 });
    expect(placeScore(open, dusk).score).toBeCloseTo(placeScore(other, dusk).score * 1.5);
    expect(placeScore(open, dusk).because).toEqual(['lantern-1']);
    expect(placeScore(open, env({ lights, hour: 14 })).parts.light).toBe(1);
  });

  it('prefers a bench under an awning in the rain, and thinks nothing of it when dry', () => {
    const shelters = [{ x: 0.8, z: 0.5 }];
    const wet = env({ shelters, rain: 0.8, hour: 15, season: 'spring' });
    expect(placeScore(open, wet).score).toBeGreaterThan(placeScore(other, wet).score * 2);
    expect(placeScore(open, env({ shelters, hour: 15, season: 'spring' })).parts.shelter).toBe(1);
  });

  it('draws the cat people to a bench near the cat bowl, and nobody else', () => {
    const bowls = [{ x: 2, z: 1, id: 'bowl-1' }];
    const e = env({ bowls, hour: 16, season: 'spring' });
    expect(placeScore(open, e, true).score).toBeCloseTo(placeScore(other, e, true).score * 1.3);
    expect(placeScore(open, e, true).because).toEqual(['bowl-1']);
    expect(placeScore(open, e, false).score).toBe(placeScore(other, e, false).score);
  });

  it('likes something at your back and a view in front, water to watch and a drink nearby', () => {
    // a wall behind (z < -1), open ground ahead
    const isOpen = (_x: number, z: number) => z > -1;
    const e = env({ isOpen, hour: 16, season: 'spring', water: [{ x: 0, z: 3, r: 2 }], food: [{ x: 3, z: 0, id: 'vending-9' }] });
    const s = placeScore(open, e);
    expect(s.parts.refuge).toBeCloseTo(1.13);
    expect(s.parts.near).toBeCloseTo(1.14);
    expect(s.because).toEqual(['vending-9']);
    // facing the wall instead: no view, nothing behind
    expect(placeScore({ ...open, face: Math.PI }, e).parts.refuge).toBe(1);
  });

  it('stays a gentle multiplier: all of it together is under 2.6×, and nothing is ever below 0.8', () => {
    const everything = env({
      trees: [{ x: 0, z: 0, r: 2 }],
      lights: [{ x: 0, z: 1 }],
      water: [{ x: 0, z: 2, r: 1 }],
      food: [{ x: 1, z: 1 }],
      bowls: [{ x: 1, z: 0 }],
      isOpen: (_x, z) => z > -1,
    });
    for (let h = 0; h < 24; h += 0.5)
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
        const s = placeScore(open, { ...everything, hour: h, season }, true).score;
        expect(s).toBeLessThan(2.6);
        expect(placeScore(other, { ...env(), hour: h, season }).score).toBeGreaterThanOrEqual(0.8);
      }
  });

  it('names a placed thing as the cause only when the choice would have gone the other way without it', () => {
    const lights = [{ x: 1.5, z: 1, id: 'lantern-1' }];
    const dusk = env({ lights, hour: 19 });
    // the lantern lifts this bench from 1.0 to 1.5: it beat a rival at 1.2 only because of it
    expect(butFor(open, dusk, false, 1.5, 1.2)).toEqual(['lantern-1']);
    // against a rival at 0.9 it would have won anyway: the lantern helped, but didn't decide it
    expect(butFor(open, dusk, false, 1.5, 0.9)).toEqual([]);
    // two things that each made the difference are both causes; one that didn't matter isn't
    const both = env({ lights, hour: 19, bowls: [{ x: 1, z: 0, id: 'bowl-1' }], food: [{ x: 2, z: 0, id: 'vending-9' }] });
    const s = placeScore(open, both, true).score;
    expect(butFor(open, both, true, s, s / 1.25).sort()).toEqual(['bowl-1', 'lantern-1']); // the vending machine's 6% wasn't it
    // masking leaves everything else as it was
    expect(without(both, 'bowl-1').lights).toEqual(lights);
    expect(without(both, 'bowl-1').bowls).toEqual([]);
  });
});
