import { describe, expect, it } from 'vitest';
import { Bonds, FADE_DAYS, NEEDS, RUNGS, pairKey } from '../src/sim/bonds';

/** Prompt 09b: the bond ladder. */
describe('the bond ladder', () => {
  it('makes familiar faces of people who share a place on three different days, however often in one day', () => {
    const b = new Bonds();
    for (let i = 0; i < 20; i++) expect(b.together('haru', 'nana', 0.1 + i * 0.01)).toBeNull(); // one day, many times
    expect(b.rung('haru', 'nana')).toBe('unseen');
    b.together('nana', 'haru', 1.2);
    const p = b.together('haru', 'nana', 2.5);
    expect(p).toMatchObject({ a: 'haru', b: 'nana', from: 'unseen', to: 'familiar', credited: [] });
    expect(b.rung('nana', 'haru')).toBe('familiar'); // either way round
    expect(pairKey('nana', 'haru')).toBe(pairKey('haru', 'nana'));
  });

  it('lets passing alone reach a nod and no further: anything warmer needs shared moments', () => {
    const b = new Bonds();
    for (let d = 0; d < 40; d++) b.together('haru', 'nana', d + 0.5);
    expect(b.rung('haru', 'nana')).toBe('nod');
    // moments on top of all those days: now they climb, one rung a day at most
    const seen: string[] = [];
    let last = -1;
    for (let d = 40; d < 60; d++) {
      const p = b.moment('haru', 'nana', d + 0.5);
      if (!p) continue;
      seen.push(p.to);
      expect(p.day).toBeGreaterThan(last);
      last = p.day;
      expect(b.moment('haru', 'nana', d + 0.7)).toBeNull(); // already climbed today
    }
    expect(seen).toEqual(['greeting', 'chat', 'friends']);
  });

  it('credits the edit behind most of the moments, and nobody when no edit was', () => {
    const b = new Bonds();
    for (let d = 0; d < 6; d++) b.together('mitsuko', 'genzo', d);
    expect(b.rung('mitsuko', 'genzo')).toBe('nod');
    // three moments, two of them at the wind chime the player hung
    expect(b.moment('mitsuko', 'genzo', 6.2, { chime1: 1 })).toBeNull();
    expect(b.moment('mitsuko', 'genzo', 6.8)).toBeNull(); // moments fade a little: two aren't quite enough a day apart
    const p = b.moment('mitsuko', 'genzo', 7.2, { chime1: 1 });
    expect(p).toMatchObject({ to: 'greeting', credited: ['chime1'] });
    // the next rung is built mostly on moments nobody placed anything for: no credit
    b.moment('mitsuko', 'genzo', 8.2, { chime1: 0.2 });
    let q = null;
    for (let d = 9; d < 14 && !q; d++) q = b.moment('mitsuko', 'genzo', d + 0.2);
    expect(q).toMatchObject({ to: 'chat', credited: [] });
    // a third of the moments at a lantern, the rest nobody's doing: it helped, it didn't make it
    const h = new Bonds();
    for (let d = 0; d < 6; d++) h.together('a', 'b', d);
    h.moment('a', 'b', 6, { lantern: 1 });
    h.moment('a', 'b', 6.4);
    expect(h.moment('a', 'b', 6.8)).toMatchObject({ to: 'greeting', credited: [], helped: ['lantern'] });
    // two edits that each did half: both made it possible
    const c = new Bonds();
    for (let d = 0; d < 6; d++) c.together('a', 'b', d);
    c.moment('a', 'b', 6, { bench: 0.5, lantern: 0.5 });
    c.moment('a', 'b', 6.5, { bench: 0.5, lantern: 0.5 });
    expect(c.moment('a', 'b', 7, { bench: 0.5, lantern: 0.5 })!.credited.sort()).toEqual(['bench', 'lantern']);
    // removed since: the credit stands, marked
    b.removed('chime1');
    expect(b.isGone('chime1')).toBe(true);
    expect(b.rung('mitsuko', 'genzo')).toBe('chat');
    b.restored('chime1');
    expect(b.isGone('chime1')).toBe(false);
  });

  it('warms faster between people with an affinity, and starts authored pairs part-way up', () => {
    const cold = new Bonds(),
      warm = new Bonds();
    warm.setAffinity('rin', 'sora', 1);
    for (const b of [cold, warm]) {
      for (let d = 0; d < 6; d++) b.together('rin', 'sora', d);
      b.moment('rin', 'sora', 6);
    }
    expect(cold.rung('rin', 'sora')).toBe('nod');
    expect(warm.rung('rin', 'sora')).toBe('greeting'); // one moment counted double
    const s = new Bonds();
    s.seed('rin', 'sora', 'friends', 0);
    expect(s.rung('sora', 'rin')).toBe('friends');
    expect(s.get('rin', 'sora')!.days.length).toBe(NEEDS.friends.days);
    expect(s.known('rin')).toEqual([{ other: 'sora', rung: 'friends' }]);
  });

  it('fades gently: a rung a week without contact, friends never below a greeting, a face never forgotten', () => {
    const b = new Bonds();
    b.seed('haru', 'aiko', 'friends', 0);
    b.seed('taro', 'emi', 'nod', 0);
    const rungs: string[] = [];
    for (let d = 1; d <= 60; d++) {
      b.newDay(d);
      rungs.push(b.rung('haru', 'aiko'));
    }
    expect(rungs[FADE_DAYS - 2]).toBe('friends'); // not yet
    expect(rungs[FADE_DAYS - 1]).toBe('chat'); // one rung
    expect(rungs[2 * FADE_DAYS - 2]).toBe('chat'); // and no faster than one a week
    expect(rungs[59]).toBe('greeting'); // the floor for old friends
    expect(b.rung('taro', 'emi')).toBe('familiar');
    // seeing each other again stops the slide, and moments bring them back up
    b.together('haru', 'aiko', 61);
    b.newDay(62);
    expect(b.rung('haru', 'aiko')).toBe('greeting');
  });

  it('is deterministic, and survives a save (JSON) with anything malformed dropped', () => {
    const run = () => {
      const b = new Bonds();
      for (let d = 0; d < 12; d++) {
        b.together('haru', 'nana', d);
        if (d % 2) b.moment('haru', 'nana', d + 0.3, { bench: 1 });
        b.newDay(d + 1);
      }
      return b;
    };
    expect(run().hash()).toBe(run().hash());
    const saved = JSON.parse(JSON.stringify(run().toJSON())) as Record<string, unknown>;
    saved['nana|haru'] = saved['haru|nana']; // wrong order
    saved['haru|ghost'] = saved['haru|nana']; // not a neighbour
    saved['aiko|haru'] = { rung: 'best friends' };
    const back = Bonds.from(saved, ['haru', 'nana', 'aiko']);
    expect(back.hash()).toBe(run().hash());
    expect(back.rung('haru', 'aiko')).toBe('unseen');
    expect(RUNGS.includes(back.rung('haru', 'nana'))).toBe(true);
    expect(Bonds.from(null, []).hash()).toBe('');
  });
});
