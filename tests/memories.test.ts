import { describe, it, expect } from 'vitest';
import { MemoryRecorder, MEMORIES_MAX, MEMORIES_PER_DAY, sanitizeStats, type WorldView } from '../src/sim/memories';

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

  it('remembers a rainy-day regular: the same placed thing used in the rain on three days', () => {
    const r = new MemoryRecorder();
    const wet = (minutes: number): WorldView => ({ ...view(minutes), rain: 0.8 });
    // (the favorite rule fires along the way: only the rainy one is checked here)
    const kinds = (day: number) => r.used({ who: 'kenta', objectId: 'b1', with: [] }, wet(day * DAY + 900)).map((m) => m.kind);
    expect(kinds(0)).not.toContain('rainy');
    expect(kinds(1)).not.toContain('rainy');
    expect(kinds(2)).toContain('rainy');
    // a dry day doesn't count
    const r2 = new MemoryRecorder();
    for (const d of [0, 1]) r2.used({ who: 'kenta', objectId: 'b1', with: [] }, wet(d * DAY + 900));
    expect(r2.used({ who: 'kenta', objectId: 'b1', with: [] }, view(2 * DAY + 900)).map((m) => m.kind)).not.toContain('rainy');
  });

  it('remembers a new routine once, and keeps how people were (sitting, which way they faced)', () => {
    const r = new MemoryRecorder();
    const seated: WorldView = { ...view(900), where: () => ({ x: 1, z: 2, pose: 'sit', ry: 1.5 }) };
    const m = r.routine('mitsuko', 'b1', seated)!;
    expect(m.kind).toBe('routine');
    expect(m.snapshot.people).toEqual([{ id: 'mitsuko', x: 1, z: 2, pose: 'sit', ry: 1.5 }]);
    expect(r.routine('mitsuko', 'b1', seated)).toBeNull();
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

  it('carries what builds toward a memory across a reload (two rainy days today, the third next time)', () => {
    const wet = (m: number): WorldView => ({ ...view(m), rain: 0.8 });
    const a = new MemoryRecorder();
    a.used({ who: 'nana', objectId: 'b1', with: [] }, wet(600));
    a.used({ who: 'nana', objectId: 'b1', with: [] }, wet(DAY + 600));
    // through the save (JSON and the sanitizer), into a fresh recorder
    const stats = sanitizeStats(JSON.parse(JSON.stringify(a.stats())));
    const b = new MemoryRecorder(a.memories, stats);
    const out = b.used({ who: 'nana', objectId: 'b1', with: [] }, wet(2 * DAY + 600)).map((m) => m.kind);
    expect(out).toContain('rainy');
    expect(out).toContain('favorite'); // 3 uses on 3 days, also counted across the reload
    // removing the thing forgets the rainy days too
    b.removed('b1');
    expect(b.stats()).toEqual({ uses: {}, rainy: {} });
  });

  it('drops malformed saved stats field by field', () => {
    const s = sanitizeStats({
      uses: { 'nana|b1': { n: 2, days: [1, 'x', -1, 2.5, 3] }, bad: { n: 1, days: [] }, 'a|b': { n: -1, days: [] } },
      rainy: { 'nana|b1': [4, null] },
    });
    expect(s).toEqual({ uses: { 'nana|b1': { n: 2, days: [1, 3] } }, rainy: { 'nana|b1': [4] } });
    expect(sanitizeStats(null)).toEqual({ uses: {}, rainy: {} });
  });

  it('remembers a bond a placed thing made possible, once per pair and thing', () => {
    const r = new MemoryRecorder();
    const m = r.bond('nana', 'genzo', 'b1', view(600));
    expect(m).toMatchObject({ kind: 'bond', who: ['genzo', 'nana'], objectId: 'b1' });
    expect(r.bond('genzo', 'nana', 'b1', view(DAY + 600))).toBeNull(); // told once, whichever way round
    expect(r.bond('nana', 'genzo', 'gone', view(700))).toBeNull(); // nothing to show for a thing that isn't there
  });

  it('words a bond whose thing has since been removed as outliving it', async () => {
    const { memoryWords } = await import('../src/ui/hud');
    const r = new MemoryRecorder();
    const m = r.bond('nana', 'genzo', 'b1', view(600))!;
    expect(memoryWords(m).caption).toBe('Genzo and Nana got to know each other at the bench you placed.');
    expect(memoryWords(m, true).caption).toMatch(/at a bench you placed\. It is gone now; they still stop for each other\.$/);
    expect(memoryWords(m).title).toBe('Because of you');
  });
});
