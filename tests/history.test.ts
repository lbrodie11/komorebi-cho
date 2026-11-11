import { describe, it, expect } from 'vitest';
import { History, HISTORY_MAX, inverse, type Command, type EditTarget, type Placement } from '../src/edit/history';
import { Rng } from '../src/core/rng';
import { shopCheck } from '../src/edit/shops';
import { SHOPS } from '../src/world/layout';

/** A town as a map of placements and the shop row; its hash is both, byte for byte. */
function town() {
  const items = new Map<string, Placement>();
  const shops = SHOPS.map(({ id, z0, z1 }) => ({ id, z0, z1 }));
  const target: EditTarget = {
    place: (r) => void items.set(r.id, { ...r }),
    remove: (id) => void items.delete(id),
    move: (id, x, z, ry) => void items.set(id, { ...items.get(id)!, x, z, ry }),
    shop: (id, z0, z1) =>
      void Object.assign(
        shops.find((s) => s.id === id)!,
        { z0, z1 },
      ),
  };
  const hash = () => JSON.stringify({ placed: [...items.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), shops });
  return { items, shops, target, hash };
}

/** A shop slid or resized by whole quarter metres, within the row's rules (null if none fit this time). */
function randomShopEdit(rng: Rng, shops: { id: string; z0: number; z1: number }[]): Command | null {
  const s = rng.pick(shops);
  const z0 = s.z0 + rng.int(-4, 4) * 0.25;
  const z1 = z0 + (s.z1 - s.z0) + rng.int(-2, 2) * 0.5;
  if (shopCheck(shops, s.id, z0, z1)) return null;
  return { op: 'shop', id: s.id, from: { z0: s.z0, z1: s.z1 }, to: { z0, z1 } };
}

/** A random edit that makes sense for the current town (place, remove or move). */
function randomEdit(rng: Rng, items: Map<string, Placement>, n: number): Command {
  const ids = [...items.keys()].sort();
  const pick = rng.next();
  if (!ids.length || pick < 0.45)
    return {
      op: 'place',
      rec: { id: `p${n}`, kind: rng.pick(['bench', 'sakura', 'lantern']), x: rng.int(-20, 20) / 4, z: rng.int(-20, 20) / 4, ry: rng.int(0, 7) * (Math.PI / 4) },
    };
  const id = rng.pick(ids);
  const r = items.get(id)!;
  if (pick < 0.7) return { op: 'remove', rec: r };
  return { op: 'move', id, from: { x: r.x, z: r.z, ry: r.ry }, to: { x: rng.int(-20, 20) / 4, z: rng.int(-20, 20) / 4, ry: rng.int(0, 7) * (Math.PI / 4) } };
}

describe('edit history', () => {
  it('undoes 50 mixed edits back to a byte-identical town, and redoes them to the same end', () => {
    const t = town();
    const h = new History(t.target);
    const rng = new Rng(3);
    const start = t.hash();
    for (let i = 0; i < 50; i++) h.perform((rng.chance(0.25) && randomShopEdit(rng, t.shops)) || randomEdit(rng, t.items, i));
    expect(h.log.some((c) => c.op === 'shop')).toBe(true);
    const end = t.hash();
    while (h.canUndo) h.undo();
    expect(t.hash()).toBe(start);
    while (h.canRedo) h.redo();
    expect(t.hash()).toBe(end);
  });

  it('discards the redo branch when a new edit is made after undo', () => {
    const t = town();
    const h = new History(t.target);
    h.perform({ op: 'place', rec: { id: 'a', kind: 'bench', x: 0, z: 0, ry: 0 } });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.perform({ op: 'place', rec: { id: 'b', kind: 'bench', x: 1, z: 0, ry: 0 } });
    expect(h.canRedo).toBe(false);
    expect([...t.items.keys()]).toEqual(['b']);
  });

  it('inverts every command, twice round is the identity', () => {
    const cmds: Command[] = [
      { op: 'place', rec: { id: 'a', kind: 'bench', x: 1, z: 2, ry: 0 } },
      { op: 'remove', rec: { id: 'a', kind: 'bench', x: 1, z: 2, ry: 0 } },
      { op: 'move', id: 'a', from: { x: 1, z: 2, ry: 0 }, to: { x: 3, z: 4, ry: 1 } },
      { op: 'shop', id: 'bakery', from: { z0: -0.2, z1: 3.2 }, to: { z0: -0.2, z1: 2.2 } },
    ];
    for (const c of cmds) expect(inverse(inverse(c))).toEqual(c);
  });

  it('remembers at most HISTORY_MAX edits, and is serialisable as a replay log', () => {
    const t = town();
    const h = new History(t.target);
    for (let i = 0; i < HISTORY_MAX + 20; i++) h.perform({ op: 'place', rec: { id: `p${i}`, kind: 'bench', x: i, z: 0, ry: 0 } });
    expect(h.log).toHaveLength(HISTORY_MAX);
    expect(JSON.parse(JSON.stringify(h.log))).toEqual(h.log);
  });
});
