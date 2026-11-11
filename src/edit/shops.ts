/**
 * The shopping street's hard rules for moving and resizing a shop-house (prompt 06 phase C).
 * The row runs along the west side of the lane (x < -10.5); a shop keeps its depth and height,
 * only its frontage (z0..z1) changes. Pure: no three.js, no DOM.
 */
export interface ShopExtent {
  id: string;
  z0: number;
  z1: number;
}

export const SHOP_ROW = {
  /** Where the row may run: from the north lane's corner to the shotengai arch. */
  zMin: -3.8,
  zMax: 9.3,
  /** A frontage narrower than this has no room for a door and a window; wider, the grammar's bays thin out. */
  minFront: 2,
  maxFront: 6,
  /** The narrowest gap between neighbours (a downpipe's width; the seams fill it). */
  gap: 0.2,
  /** The plan the row occupies across the street axis (front line and back wall). */
  x0: -16.2,
  x1: -10.5,
  /** `[` and `]` change a frontage by this much. */
  resizeStep: 0.5,
} as const;

/** Why a shop can't take an extent (the words are `reason.<key>` in en.ts). */
export type ShopReason = 'shopNarrow' | 'shopWide' | 'shopEnd' | 'shopOverlap';

const EPS = 1e-6;

/** Why shop `id` can't run from z0 to z1 along `row` (the street as it stands), or null if it can. */
export function shopCheck(row: readonly ShopExtent[], id: string, z0: number, z1: number): ShopReason | null {
  const front = z1 - z0;
  if (front < SHOP_ROW.minFront - EPS) return 'shopNarrow';
  if (front > SHOP_ROW.maxFront + EPS) return 'shopWide';
  if (z0 < SHOP_ROW.zMin - EPS || z1 > SHOP_ROW.zMax + EPS) return 'shopEnd';
  for (const o of row) {
    if (o.id === id) continue;
    if (z1 + SHOP_ROW.gap <= o.z0 + EPS || o.z1 + SHOP_ROW.gap <= z0 + EPS) continue;
    return 'shopOverlap';
  }
  return null;
}

/** The shop whose frontage is under a ground point (x, z), if any. */
export function shopAt(row: readonly ShopExtent[], x: number, z: number): ShopExtent | null {
  if (x < SHOP_ROW.x0 || x > SHOP_ROW.x1 + 0.4) return null;
  return row.find((s) => z >= s.z0 && z <= s.z1) ?? null;
}

/**
 * Saved shop extents, checked against the street as first laid out: unknown ids, bad numbers
 * and any extent that breaks the row's rules (with the others applied) are dropped.
 */
export function sanitizeShops(v: unknown, base: readonly ShopExtent[]): Record<string, { z0: number; z1: number }> {
  const out: Record<string, { z0: number; z1: number }> = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  const row = base.map((s) => ({ ...s }));
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    const s = row.find((r) => r.id === id);
    if (!s || typeof e !== 'object' || e === null) continue;
    const { z0, z1 } = e as { z0?: unknown; z1?: unknown };
    if (typeof z0 !== 'number' || typeof z1 !== 'number' || !Number.isFinite(z0) || !Number.isFinite(z1)) continue;
    // the others as saved so far, this one where it was: does the saved extent still fit?
    if (shopCheck(row, id, z0, z1)) continue;
    s.z0 = z0;
    s.z1 = z1;
    out[id] = { z0, z1 };
  }
  return out;
}
