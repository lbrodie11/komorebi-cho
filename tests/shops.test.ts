import { describe, expect, it } from 'vitest';
import { SHOP_ROW, sanitizeShops, shopAt, shopCheck, type ShopExtent } from '../src/edit/shops';
import { SHOPS } from '../src/world/layout';

const row: ShopExtent[] = SHOPS.map(({ id, z0, z1 }) => ({ id, z0, z1 }));

describe('shop row rules', () => {
  it('accepts the street as laid out', () => {
    for (const s of row) expect(shopCheck(row, s.id, s.z0, s.z1)).toBeNull();
  });

  it('keeps frontages between the narrowest and widest a shop can be', () => {
    expect(shopCheck(row, 'ramen', -3.6, -3.6 + SHOP_ROW.minFront - 0.25)).toBe('shopNarrow');
    expect(shopCheck(row, 'ramen', -3.6, -3.6 + SHOP_ROW.minFront)).toBeNull();
    const wide = row.map((s) => (s.id === 'books' ? s : { ...s, z0: -10, z1: -9 }));
    expect(shopCheck(wide, 'books', 2, 2 + SHOP_ROW.maxFront + 0.5)).toBe('shopWide');
  });

  it('stays within the row and clear of its neighbours by a downpipe gap', () => {
    expect(shopCheck(row, 'ramen', -4.1, -0.9)).toBe('shopEnd');
    expect(shopCheck(row, 'books', 6.6, 9.4)).toBe('shopEnd');
    expect(shopCheck(row, 'ramen', -3.6, -0.3)).toBe('shopOverlap'); // 0.1 m from the bakery
    expect(shopCheck(row, 'bakery', 0, 3.4)).toBe('shopOverlap');
  });

  it('lets a shop slide into room a neighbour gave up', () => {
    const narrowed = row.map((s) => (s.id === 'bakery' ? { ...s, z1: 2.2 } : s));
    expect(shopCheck(row, 'florist', 2.4, 5)).toBe('shopOverlap');
    expect(shopCheck(narrowed, 'florist', 2.4, 5)).toBeNull();
  });

  it('finds the shop under a point on its plan', () => {
    expect(shopAt(row, -12, 1)?.id).toBe('bakery');
    expect(shopAt(row, -12, -0.3)).toBeNull(); // the gap
    expect(shopAt(row, -5, 1)).toBeNull(); // across the lane
  });

  it('drops saved extents that no longer fit, keeps the rest', () => {
    const ok = sanitizeShops({ bakery: { z0: -0.2, z1: 2.2 }, florist: { z0: 2.4, z1: 5 } }, row);
    expect(ok).toEqual({ bakery: { z0: -0.2, z1: 2.2 }, florist: { z0: 2.4, z1: 5 } });
    // florist first: the bakery hasn't made room yet, so it can't fit
    expect(sanitizeShops({ florist: { z0: 2.4, z1: 5 } }, row)).toEqual({});
    expect(sanitizeShops({ nope: { z0: 0, z1: 3 }, ramen: { z0: 'x', z1: 1 } }, row)).toEqual({});
    expect(sanitizeShops([1, 2], row)).toEqual({});
  });

  it('accepts a saved street as a whole, whatever order the shops were saved in', () => {
    // the ramen shop grew into room the bakery gave up; saved ramen first
    const saved = { ramen: { z0: -3.6, z1: 0.6 }, bakery: { z0: 0.8, z1: 3.2 } };
    expect(sanitizeShops(saved, row)).toEqual(saved);
    // a shop that breaks the final row goes back where it was; the rest stay
    expect(sanitizeShops({ ramen: { z0: -3.6, z1: 0.6 } }, row)).toEqual({});
  });
});
