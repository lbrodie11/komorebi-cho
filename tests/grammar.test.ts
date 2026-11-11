import { describe, it, expect } from 'vitest';
import { GROUND, SHOPS } from '../src/world/layout';
import { BAY_M, planShopHouse, shopFootprint } from '../src/world/grammar/shophouse';
import { classifyGap, planSeam } from '../src/world/grammar/seams';
import type { Footprint, Part, ShopHouseSpec } from '../src/world/grammar/types';
import { Rng } from '../src/core/rng';

const flat = (parts: readonly Part[]): Part[] => parts.flatMap((p) => (p.op === 'scope' ? flat(p.parts) : [p]));
const shopWindows = (parts: readonly Part[]) => flat(parts).filter((p): p is Extract<Part, { op: 'win' }> => p.op === 'win' && p.kind === 'shop');
const base: ShopHouseSpec = { ...SHOPS[1]!, id: 'test', z0: 0, z1: 4, height: 5 };

describe('shop-house grammar', () => {
  it('is deterministic: the same spec plans the same parts', () => {
    for (const s of SHOPS) expect(JSON.stringify(planShopHouse(s))).toBe(JSON.stringify(planShopHouse(s)));
  });

  it('widening a shop from 4 m to 6 m adds a bay and moves the sign, and stretches nothing', () => {
    const four = planShopHouse(base);
    const six = planShopHouse({ ...base, z1: 6 });
    expect(shopWindows(four)).toHaveLength(1);
    expect(shopWindows(six)).toHaveLength(2);
    const signZ = (ps: Part[]) => flat(ps).find((p): p is Extract<Part, { op: 'sign' }> => p.op === 'sign' && p.sign === base.sign!.spec)!.z;
    expect(signZ(four)).toBeCloseTo(2);
    expect(signZ(six)).toBeCloseTo(3);
    // shop windows stay a sensible bay width (re-planned, not scaled with the frontage)
    for (const w of shopWindows(six)) expect(w.w).toBeLessThanOrEqual(BAY_M * 0.72 + 1e-9);
    // upper windows keep their size and gain a sibling instead
    const upper = (ps: Part[]) => flat(ps).filter((p) => p.op === 'win' && p.kind === 'home') as Extract<Part, { op: 'win' }>[];
    expect(new Set(upper(six).map((w) => w.w))).toEqual(new Set([0.9]));
    expect(upper(six).length).toBeGreaterThan(upper(four).length);
  });

  it('keeps every part of the street on the plinth', () => {
    const row = [...SHOPS].sort((a, b) => a.z0 - b.z0);
    const parts = SHOPS.flatMap((s) => flat(planShopHouse(s)));
    for (let i = 0; i + 1 < row.length; i++) {
      const a = shopFootprint(row[i]!),
        b = shopFootprint(row[i + 1]!);
      parts.push(...flat(planSeam(classifyGap(a, b), a, b, row[i]!.frontX)));
    }
    for (const p of parts)
      if ('x' in p && 'z' in p) {
        expect(p.x).toBeGreaterThanOrEqual(GROUND.x0);
        expect(p.x).toBeLessThanOrEqual(GROUND.x1);
        expect(p.z).toBeGreaterThanOrEqual(GROUND.z0);
        expect(p.z).toBeLessThanOrEqual(GROUND.z1);
      }
  });
});

describe('seam grammar', () => {
  const fp = (id: string, z0: number, z1: number, use: Footprint['use'] = 'shop', front: Footprint['front'] = 'x1'): Footprint => ({
    id,
    use,
    x0: -16.2,
    x1: -10.5,
    z0,
    z1,
    height: 4.4,
    front,
  });
  const kinds = (parts: Part[]) => parts.map((p) => (p.op === 'cyl' && 'named' in p.mat ? p.mat.named : p.op));

  it('classifies gaps by width and use', () => {
    expect(classifyGap(fp('a', 0, 4), fp('b', 4.2, 8)).kind).toBe('utility');
    expect(classifyGap(fp('a', 0, 4), fp('b', 4.8, 8)).kind).toBe('service');
    expect(classifyGap(fp('a', 0, 4), fp('b', 5.4, 8)).kind).toBe('yokocho');
    expect(classifyGap(fp('a', 0, 4, 'food'), fp('b', 5.4, 8, 'food')).kind).toBe('awning');
    expect(classifyGap(fp('a', 0, 4, 'home', 'z0'), fp('b', 5, 8, 'home', 'z1')).kind).toBe('laundry');
    expect(classifyGap(fp('a', 0, 4), fp('b', 7, 9)).kind).toBe('none');
    expect(classifyGap(fp('a', 0, 4), fp('b', 3, 8)).kind).toBe('none'); // overlapping
  });

  it('puts lanterns in a 1.4 m alley, and a pipe and an AC unit in a 0.5 m gap', () => {
    const a = fp('a', 0, 4),
      wide = fp('b', 5.4, 8),
      tight = fp('b', 4.5, 8);
    expect(kinds(planSeam(classifyGap(a, wide), a, wide, -10.5)).filter((k) => k === 'lantern')).toHaveLength(3);
    const t = planSeam(classifyGap(a, tight), a, tight, -10.5);
    expect(t.some((p) => p.op === 'cyl')).toBe(true);
    expect(t.some((p) => p.op === 'ac')).toBe(true);
  });

  it('is the same seam whichever way round it is asked', () => {
    const a = fp('a', 0, 4),
      b = fp('b', 5.4, 8);
    expect(classifyGap(a, b)).toEqual(classifyGap(b, a));
  });

  it('leaves untouched neighbours alone through 1,000 random edits elsewhere', () => {
    const rng = new Rng(7);
    const c = fp('c', 20, 24),
      d = fp('d', 25.3, 29);
    const seamCD = JSON.stringify(planSeam(classifyGap(c, d), c, d, -10.5));
    const shopD = JSON.stringify(planShopHouse({ ...base, id: 'd', z0: 25.3, z1: 29 }));
    for (let i = 0; i < 1000; i++) {
      // edit a and b (width, position, use); c and d are never touched
      const az0 = rng.range(-10, 0);
      const a = fp('a', az0, az0 + rng.range(2, 6), rng.pick(['food', 'shop', 'home'] as const));
      const bz0 = a.z1 + rng.range(0, 2.5);
      const b = fp('b', bz0, bz0 + rng.range(2, 6));
      planSeam(classifyGap(a, b), a, b, -10.5);
      planShopHouse({ ...base, id: 'a', z0: a.z0, z1: a.z1 });
      expect(JSON.stringify(planSeam(classifyGap(c, d), c, d, -10.5))).toBe(seamCD);
    }
    expect(JSON.stringify(planShopHouse({ ...base, id: 'd', z0: 25.3, z1: 29 }))).toBe(shopD);
  });
});
