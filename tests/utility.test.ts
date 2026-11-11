import { describe, expect, it } from 'vitest';
import { HYSTERESIS, curve, pick, score } from '../src/sim/utility';
import { Rng } from '../src/core/rng';

describe('utility scoring (prompt 08)', () => {
  it('shapes needs with response curves', () => {
    expect(curve.logistic(0.1, 8, 0.5)).toBeLessThan(0.05); // barely tired: hardly matters
    expect(curve.logistic(0.9, 8, 0.5)).toBeGreaterThan(0.95); // exhausted: matters a lot
    expect(curve.logistic(0.5, 8, 0.5)).toBeCloseTo(0.5);
    expect(curve.quadratic(0.5)).toBeCloseTo(0.25);
    expect(curve.step(0.4, 0.5)).toBe(0);
    expect(curve.step(0.5, 0.5)).toBe(1);
  });

  it("doesn't punish an option just for having more considerations (compensation)", () => {
    const one = score(1, [0.8]);
    const three = score(1, [0.8, 0.8, 0.8]);
    expect(one).toBeCloseTo(0.8);
    expect(three).toBeGreaterThan(0.8 ** 3 + 0.15); // raw product would be 0.512
    expect(three).toBeLessThan(one);
    expect(score(2, [])).toBe(2);
    expect(score(1, [0, 1])).toBe(0); // a zero still vetoes
  });

  it('never flip-flops between two near-equal options of a kind', () => {
    const rng = new Rng(4);
    const last = new Map<string, string>();
    let switches = 0,
      prev = '';
    for (let i = 0; i < 400; i++) {
      // two benches 3% apart, with a mood drawn each time (±25%)
      const opts = [
        { key: 'bench-a', kind: 'bench', score: 1.0 },
        { key: 'bench-b', kind: 'bench', score: 1.03 },
      ];
      const p = pick(opts, () => rng.range(0.75, 1.25), last)!;
      last.set(p.kind, p.key);
      if (prev && p.key !== prev) switches++;
      prev = p.key;
    }
    expect(switches).toBe(0);
  });

  it('still switches when a rival is clearly better, and the mood still varies the activity', () => {
    const last = new Map([['bench', 'bench-a']]);
    const better = pick(
      [
        { key: 'bench-a', kind: 'bench', score: 1 },
        { key: 'bench-b', kind: 'bench', score: HYSTERESIS + 0.05 },
      ],
      () => 1,
      last,
    );
    expect(better!.key).toBe('bench-b');
    // a bench or a stroll at near-equal scores: over many decisions, both happen
    const rng = new Rng(9);
    const seen = new Set<string>();
    const lastActivity = new Map<string, string>();
    for (let i = 0; i < 100; i++)
      seen.add(
        pick(
          [
            { key: 'bench-a', kind: 'bench', score: 1 },
            { key: 'wander', kind: 'wander', score: 1 },
          ],
          () => rng.range(0.75, 1.25),
          lastActivity,
        )!.kind,
      );
    expect(seen).toEqual(new Set(['bench', 'wander']));
  });

  it('gives no edge to a kind with nothing to flip-flop with (a stroll chosen once is not a habit)', () => {
    const last = new Map([
      ['wander', 'wander'],
      ['bench', 'bench-a'],
    ]);
    const opts = [
      { key: 'wander', kind: 'wander', score: 1 },
      { key: 'home', kind: 'home', score: 1.05 },
    ];
    // the stroll was chosen before, but it has no rival of its kind: the better option wins
    expect(pick(opts, () => 1, last)!.key).toBe('home');
    // a single bench left of its kind: no margin either
    expect(pick([{ key: 'bench-a', kind: 'bench', score: 1 }, ...opts], () => 1, last)!.key).toBe('home');
  });
});
