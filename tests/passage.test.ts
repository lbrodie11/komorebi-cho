import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_WAIT, Passage } from '../src/sim/passage';
import { BRIDGE } from '../src/world/layout';
import { installHeadlessDom, buildSim } from './helpers/headless';

beforeAll(() => installHeadlessDom());

const spec = { id: 'p', x0: 0, x1: 4, z0: -0.5, z1: 0.5, axis: 'x' as const };

describe('narrow passages take turns (prompt 07)', () => {
  it('lets one way in, holds the other way, and flips when it empties', () => {
    const p = new Passage(spec);
    expect(p.request('a', 1, 0)).toBe(true);
    expect(p.request('b', 1, 0)).toBe(true); // same way: follow on
    expect(p.request('c', -1, 0)).toBe(false); // the other way waits
    p.sync(new Map([['b', 1]]), new Set(['c'])); // a is across
    expect(p.request('c', -1, 1)).toBe(false);
    p.sync(new Map(), new Set(['c'])); // empty
    expect(p.request('c', -1, 2)).toBe(true);
    expect(p.dir).toBe(-1);
  });

  it('stops letting the same way in once someone has waited too long, so it drains', () => {
    const p = new Passage(spec);
    p.request('a', 1, 0);
    expect(p.request('w', -1, 0)).toBe(false);
    expect(p.request('w', -1, MAX_WAIT)).toBe(false); // waited long enough: draining now
    expect(p.request('late', 1, MAX_WAIT + 0.1)).toBe(false); // no more of the same way
    p.sync(new Map(), new Set(['w', 'late']));
    expect(p.request('w', -1, MAX_WAIT + 1)).toBe(true);
  });

  it('drains when someone sets off against the traffic from a viewing spot', () => {
    const p = new Passage(spec);
    expect(p.request('a', 1, 0)).toBe(true);
    p.sync(
      new Map<string, -1 | 1>([
        ['a', 1],
        ['viewer', -1],
      ]),
      new Set(),
    );
    expect(p.request('b', 1, 1)).toBe(false); // same way as the traffic, but it must clear first
    p.sync(new Map(), new Set(['b']));
    expect(p.request('b', 1, 2)).toBe(true);
  });

  it('never has two people crossing the bridge head-on, and both get across', async () => {
    const { residents } = await buildSim(6);
    for (const x of residents.agents) x.hidden = true;
    const [a, b] = residents.agents;
    const grid = (residents as unknown as { grid: import('../src/sim/grid').NavGrid }).grid;
    const west: [number, number] = [BRIDGE.x0 - 1.2, BRIDGE.z];
    const east: [number, number] = [BRIDGE.x1 + 1.2, BRIDGE.z];
    const go = (p: typeof a, from: [number, number], to: [number, number]) => {
      p!.hidden = false;
      p!.placeAt(from[0], from[1]);
      p!.task = { kind: 'wander', label: { key: 'task.stroll' }, goal: to, dwell: 60, pose: 'stand', interruptible: true };
      p!.arrived = false;
      p!.path = [from, to];
      p!.pathIdx = 1;
      p!.pathVersion = grid.version;
    };
    go(a, west, east);
    go(b, east, west);
    const onBridge = (p: typeof a) => p!.x >= BRIDGE.x0 && p!.x <= BRIDGE.x1 && Math.abs(p!.z - BRIDGE.z) < 0.7;
    let headOn = 0;
    let waited = 0;
    let aAcross = false,
      bAcross = false;
    for (let s = 0; s < 20 * 30; s++) {
      residents.update(1 / 20, 0.05, 10, 0, s / 20);
      if (onBridge(a) && onBridge(b) && !a!.arrived && !b!.arrived) headOn++;
      if (a!.waitingFor || b!.waitingFor) waited++;
      // (once across they find something else to do, which may bring them back)
      aAcross ||= a!.x > BRIDGE.x1;
      bAcross ||= b!.x < BRIDGE.x0;
    }
    expect(headOn).toBe(0);
    expect(waited).toBeGreaterThan(0); // one of them really did wait their turn
    expect(aAcross && bAcross).toBe(true);
  });
});
