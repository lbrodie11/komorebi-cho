import { describe, it, expect } from 'vitest';
import { PLACEABLES } from '../src/world/props';
import { CATALOGUE, CATEGORIES, iconCells } from '../src/world/catalogue';

describe('placeables catalogue', () => {
  const all = Object.values(PLACEABLES);

  it('offers at least 30 things to place, in every category', () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const c of CATEGORIES) expect(all.filter((d) => d.category === c).length, c).toBeGreaterThanOrEqual(3);
  });

  it('describes each one sensibly: a footprint, novelty, at least one use', () => {
    for (const d of all) {
      expect(d.radius, d.kind).toBeGreaterThan(0);
      expect(d.radius, d.kind).toBeLessThan(1.2);
      expect(d.novelty, d.kind).toBeGreaterThan(0);
      expect(d.novelty, d.kind).toBeLessThanOrEqual(1);
      expect(d.affords.length, d.kind).toBeGreaterThan(0);
    }
  });

  it('builds every catalogue item from well-formed shapes', () => {
    for (const [kind, item] of Object.entries(CATALOGUE)) {
      expect(item.shapes.length, kind).toBeGreaterThan(0);
      for (const sh of item.shapes) {
        expect(
          sh.size.every((v) => Number.isFinite(v) && v > 0),
          `${kind} ${sh.s}`,
        ).toBe(true);
        expect(
          sh.at.every((v) => Number.isFinite(v)),
          kind,
        ).toBe(true);
        expect(sh.at[1], `${kind} sits on the ground`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('draws a readable palette icon from each item’s shapes', () => {
    for (const [kind, item] of Object.entries(CATALOGUE)) {
      const cells = iconCells(item.shapes, 8);
      expect(cells).toHaveLength(64);
      const filled = cells.filter((c) => c !== null).length;
      expect(filled, kind).toBeGreaterThanOrEqual(6); // something to see
      expect(filled, kind).toBeLessThan(64); // not a solid block
    }
  });

  it('gives lights a glow and only lights glow', () => {
    for (const d of all) if (d.glow) expect(d.category === 'light' || d.affords.includes('drink'), d.kind).toBe(true);
    expect(all.filter((d) => d.category === 'light').every((d) => d.glow)).toBe(true);
  });
});
