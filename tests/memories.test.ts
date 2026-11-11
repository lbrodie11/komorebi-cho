import { describe, it, expect } from 'vitest';
import { MemoryRecorder, MEMORIES_MAX, MEMORIES_PER_DAY, type WorldView } from '../src/sim/memories';

const view = (minutes: number, objects = [{ id: 'b1', kind: 'bench', x: 1, z: 2, ry: 0 }]): WorldView => ({
  minutes,
  season: 'spring',
  rain: 0,
  objects,
  where: (id) => ({ x: id.length, z: 0 }),
});
const DAY = 1440;

describe('neighborhood memories', () => {
  it('remembers the first resident to notice a placed object, once', () => {
    const r = new MemoryRecorder();
    expect(r.noticed('mitsuko', 'b1', view(600))?.kind).toBe('noticed');
    expect(r.noticed('haru', 'b1', view(610))).toBeNull();
    expect(r.memories).toHaveLength(1);
    expect(r.memories[0]!.snapshot.objects[0]!.kind).toBe('bench');
    expect(r.memories[0]!.snapshot.people).toEqual([{ id: 'mitsuko', x: 7, z: 0 }]);
  });

  it('only calls a spot a favorite after 3 uses on 2 different days', () => {
    const r = new MemoryRecorder();
    expect(r.used({ who: 'mitsuko', objectId: 'b1', with: [] }, view(600))).toEqual([]);
    expect(r.used({ who: 'mitsuko', objectId: 'b1', with: [] }, view(700))).toEqual([]);
    expect(r.used({ who: 'mitsuko', objectId: 'b1', with: [] }, view(800))).toEqual([]); // 3 uses, 1 day: not yet
    const m = r.used({ who: 'mitsuko', objectId: 'b1', with: [] }, view(DAY + 600));
    expect(m.map((x) => x.kind)).toEqual(['favorite']);
    expect(r.used({ who: 'mitsuko', objectId: 'b1', with: [] }, view(2 * DAY + 600))).toEqual([]); // told once
  });

  it('remembers two people sharing a placed object, once per pair', () => {
    const r = new MemoryRecorder();
    expect(r.used({ who: 'rin', objectId: 'b1', with: ['sora'] }, view(600)).map((m) => m.who)).toEqual([['rin', 'sora']]);
    expect(r.used({ who: 'sora', objectId: 'b1', with: ['rin'] }, view(DAY + 600))).toEqual([]);
  });

  it('caps memories per in-game day, so fast-forward cannot flood the journal', () => {
    const r = new MemoryRecorder();
    const objs = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, kind: 'bench', x: i * 20, z: 0, ry: 0 }));
    for (let i = 0; i < 10; i++) r.noticed('haru', `o${i}`, view(600 + i, objs));
    expect(r.memories).toHaveLength(MEMORIES_PER_DAY);
    r.noticed('haru', 'o9', view(DAY + 600, objs));
    expect(r.memories).toHaveLength(MEMORIES_PER_DAY + 1);
  });

  it('keeps only nearby objects in a snapshot, keeps the newest memories, and never repeats saved ones', () => {
    const objs = [
      { id: 'b1', kind: 'bench', x: 0, z: 0, ry: 0 },
      { id: 'far', kind: 'sakura', x: 30, z: 0, ry: 0 },
    ];
    const r = new MemoryRecorder();
    r.noticed('haru', 'b1', view(600, objs));
    expect(r.memories[0]!.snapshot.objects.map((o) => o.id)).toEqual(['b1']);
    const again = new MemoryRecorder(r.memories);
    expect(again.noticed('rin', 'b1', view(DAY * 5, objs))).toBeNull();
    const many = new MemoryRecorder();
    const lots = Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, kind: 'bench', x: i * 20, z: 0, ry: 0 }));
    for (let i = 0; i < 40; i++) many.noticed('haru', `o${i}`, view(i * DAY, lots));
    expect(many.memories).toHaveLength(MEMORIES_MAX);
    expect(many.memories.at(-1)!.objectId).toBe('o39');
  });

  it('ignores facts about objects it cannot see (already removed)', () => {
    const r = new MemoryRecorder();
    expect(r.noticed('haru', 'gone', view(600))).toBeNull();
  });
});
