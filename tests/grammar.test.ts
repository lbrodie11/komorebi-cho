import { describe, it, expect } from 'vitest';
import { APATO, CAFE, DROPS, G, GROUND, MICRO_HOME, POLES, SHOPS, SIGNS } from '../src/world/layout';
import { EAVE, setback, streetContext } from '../src/world/grammar/street';
import { townRoofs } from '../src/world/grammar/footprints';
import { planApato, planCafe, planMicroHome } from '../src/world/grammar/archetypes/landmarks';
import { dropPoles, poleSpans, routeDrop } from '../src/world/grammar/wires';
import { BAY_M, planShopHouse, shopFootprint } from '../src/world/grammar/archetypes/shophouse';
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

describe('utility wires', () => {
  it('spans the poles with a minimum spanning tree: today that is exactly the hand-placed network', () => {
    expect(poleSpans(POLES)).toEqual([
      [0, 1],
      [0, 3],
      [1, 2],
      [3, 4],
    ]);
  });

  it('hangs each drop from its nearest pole (the same poles as before)', () => {
    expect(
      dropPoles(
        DROPS.map((d) => [d.x, d.z] as const),
        POLES,
      ),
    ).toEqual([0, 1, 1, 2, 3, 0, 4, 4]);
  });

  it('never spans further than the limit, and connects what it can', () => {
    const poles = [
      [0, 0],
      [10, 0],
      [50, 0],
    ] as const;
    expect(poleSpans(poles)).toEqual([[0, 1]]); // 40 m to the third pole: out of reach
    expect(dropPoles([[60, 0]], poles)).toEqual([2]);
    expect(dropPoles([[200, 0]], poles)).toEqual([-1]);
  });

  it('moving a pole re-solves the network deterministically', () => {
    const moved = POLES.map((p, i) => (i === 3 ? ([-2, -3.65] as const) : p));
    expect(poleSpans(moved)).toEqual(poleSpans(moved));
    expect(poleSpans(moved)).toHaveLength(POLES.length - 1);
  });
});

describe('landmark archetypes', () => {
  const wins = (parts: readonly Part[]) => flat(parts).filter((p) => p.op === 'win');
  it('give the micro-home a window pair on every floor (no floor lost to floating-point rounding)', () => {
    expect(wins(planMicroHome(MICRO_HOME))).toHaveLength(6); // 3 floors × 2
  });
  it('derive repeated features from size: apāto units and café mullions', () => {
    expect(wins(planApato(APATO))).toHaveLength(6); // 3 units × 2 floors
    expect(wins(planApato({ ...APATO, w: 9.2 }))).toHaveLength(8); // a wider block gains a unit
    const mullions = (ps: Part[]) => flat(ps).filter((p) => p.op === 'box' && p.w === 0.14 && p.h === 1.9);
    expect(mullions(planCafe(CAFE))).toHaveLength(3);
  });
});

describe('priority layers and setbacks', () => {
  const shop = (id: string, z0: number, z1: number, extra: Partial<ShopHouseSpec> = {}): ShopHouseSpec => ({ ...SHOPS[1]!, id, z0, z1, ...extra });
  const gable = (ps: Part[]) => flat(ps).find((p): p is Extract<Part, { op: 'gableZ' }> => p.op === 'gableZ')!;

  it('trims eaves 2 cm short of a neighbour, and keeps them full where there is room', () => {
    const ctx = streetContext([shop('a', 0, 4, { roof: 'flat' }), shop('b', 4.1, 8), shop('c', 12, 16, { roof: 'flat' })]);
    const b = ctx.get('b')!;
    expect(b.eaveBefore).toBeCloseTo(0.08); // 0.1 m gap − 2 cm
    expect(b.eaveAfter).toBe(EAVE); // 4 m to the next shop
    const g = gable(planShopHouse(shop('b', 4.1, 8), b));
    expect(g.z - g.w / 2).toBeCloseTo(4.1 - 0.08); // stops short of a's wall at z = 4
  });

  it('slides a shop board to the nearest spot that clears a neighbour’s, or drops it to an A-frame', () => {
    const wide = { spec: SIGNS.florist, y: 3 }; // FLORIST is 3.125 m wide: on a 2 m shop it overhangs to z = 2.56
    const slide = streetContext([shop('a', 0, 2, { sign: wide }), shop('b', 2.1, 6, { sign: wide })]);
    expect(slide.get('b')!.sign!.aframe).toBe(false);
    expect(slide.get('b')!.sign!.z).toBeCloseTo(1 + 3.125 / 2 + 0.02 + 3.125 / 2); // just clear of a's board
    const drop = streetContext([shop('a', 0, 2, { sign: wide }), shop('b', 2.1, 4.9, { sign: wide })]);
    expect(drop.get('b')!.sign!.aframe).toBe(true);
    const parts = flat(planShopHouse(shop('b', 2.1, 4.9, { sign: wide }), drop.get('b')));
    const board = parts.find((p): p is Extract<Part, { op: 'sign' }> => p.op === 'sign' && p.sign === SIGNS.florist)!;
    expect(board.y).toBeLessThan(2); // down on the pavement
  });

  it('keeps today’s boards on the facades: only BOOKS moves, 6 cm, off a 4 cm overlap with FLORIST', () => {
    const ctx = streetContext(SHOPS);
    expect(ctx.get('bakery')!.sign).toEqual({ z: 1.5, aframe: false });
    expect(ctx.get('florist')!.sign).toEqual({ z: 4.7, aframe: false });
    const books = ctx.get('books')!.sign!;
    expect(books.aframe).toBe(false);
    expect(books.z - 7.6).toBeGreaterThan(0.03);
    expect(books.z - 7.6).toBeLessThan(0.07);
  });

  it('steps a rebuilt shop back to 2 m from the centre of a lane under 4 m, and only then', () => {
    expect(setback(shop('a', 0, 4, { rebuilt: true, lane: 3 }))).toBeCloseTo(0.5);
    expect(setback(shop('a', 0, 4, { rebuilt: false, lane: 3 }))).toBe(0);
    expect(setback(shop('a', 0, 4, { rebuilt: true, lane: 5 }))).toBe(0);
    const ctx = streetContext([shop('a', 0, 4, { rebuilt: true, lane: 3 })]);
    expect(ctx.get('a')!.frontX).toBeCloseTo(SHOPS[1]!.frontX - 0.5);
  });

  it('gives a rebuilt neighbour a fresh seam seed, and leaves revision 0 seeds as they were', () => {
    const fp = (id: string, z0: number, z1: number, revision = 0): Footprint => ({
      id,
      use: 'shop',
      revision,
      x0: -16,
      x1: -10,
      z0,
      z1,
      height: 4,
      front: 'x1',
    });
    const before = classifyGap(fp('a', 0, 4), fp('b', 4.2, 8)).seed;
    expect(classifyGap(fp('a', 0, 4, 0), fp('b', 4.2, 8, 0)).seed).toBe(before);
    expect(classifyGap(fp('a', 0, 4, 1), fp('b', 4.2, 8)).seed).not.toBe(before);
  });
});

describe('wire anchors', () => {
  it('holds a drop up with an anchor where it would pass through a roof', () => {
    const roof = { x0: -2, x1: 2, z0: -2, z1: 2, top: 6 };
    const r = routeDrop([-6, 7.5, 0], [6, 4, 0], [roof]);
    expect(r).toHaveLength(3);
    expect(r[1]![1]).toBeGreaterThan(roof.top);
    expect(routeDrop([-6, 9, 0], [6, 9, 0], [roof])).toHaveLength(2); // clears it: no anchor
  });

  it('never treats the building being fed as an obstacle, and leaves today’s drops straight', () => {
    const roof = { x0: -2, x1: 2, z0: -2, z1: 2, top: 6 };
    expect(routeDrop([-6, 7.5, 0], [0, 4, 2.2], [roof])).toHaveLength(2);
    const owners = dropPoles(
      DROPS.map((d) => [d.x, d.z] as const),
      POLES,
    );
    DROPS.forEach((d, i) => {
      const p = POLES[owners[i]!]!;
      expect(routeDrop([p[0], G + 7.2, p[1]], [d.x, d.y, d.z], townRoofs()), `drop ${i}`).toHaveLength(2);
    });
  });
});

describe('edit locality', () => {
  it('re-plans only the edited shop and its neighbour through 1,000 random edits (the rest hash the same)', () => {
    const rng = new Rng(11);
    const base = (i: number): ShopHouseSpec => ({ ...SHOPS[i % 4]!, id: `s${i}`, z0: i * 3.2, z1: i * 3.2 + 3 });
    const street = Array.from({ length: 6 }, (_, i) => base(i));
    const hash = (specs: ShopHouseSpec[], id: string) => {
      const ctx = streetContext(specs);
      return JSON.stringify(
        planShopHouse(
          specs.find((s) => s.id === id)!,
          ctx.get(id),
        ),
      );
    };
    const untouched = ['s2', 's3', 's4', 's5'].map((id) => hash(street, id));
    for (let i = 0; i < 1000; i++) {
      // the first shop changes width, height, roof and board; it always keeps clear of s1's frontage
      const z1 = rng.range(1.5, 3.1);
      const edited = { ...street[0]!, z0: rng.range(-3, 0), z1, height: rng.range(3.4, 5.6), roof: rng.pick(['flat', 'gable', 'shed'] as const) };
      const specs = [edited, ...street.slice(1)];
      expect(['s2', 's3', 's4', 's5'].map((id) => hash(specs, id))).toEqual(untouched);
    }
  });
});
