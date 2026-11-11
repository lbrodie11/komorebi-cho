import { describe, it, expect } from 'vitest';
import { crowdFactors, CROWD_RADIUS } from '../src/world/crowd';

describe('crowdFactors', () => {
  it('leaves an isolated light alone', () => {
    expect(crowdFactors([{ x: 0, z: 0 }])).toEqual([1]);
    expect(
      crowdFactors([
        { x: 0, z: 0 },
        { x: CROWD_RADIUS + 0.1, z: 0 },
      ]),
    ).toEqual([1, 1]);
  });

  it('makes n co-located lights sum to sqrt(n) of one', () => {
    for (const n of [2, 8, 20]) {
      const f = crowdFactors(Array.from({ length: n }, () => ({ x: 1, z: 1 })));
      const sum = f.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(Math.sqrt(n), 9);
    }
  });

  it('never brightens, and is order independent', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 0.7, z: 0.2 },
      { x: 2.4, z: -1 },
      { x: 9, z: 9 },
    ];
    const a = crowdFactors(pts);
    const b = crowdFactors([...pts].reverse()).reverse();
    a.forEach((v, i) => {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(b[i]!, 12);
    });
    expect(a[3]).toBe(1);
  });
});
