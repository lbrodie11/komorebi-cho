import { describe, it, expect, beforeEach } from 'vitest';
import { load, save, SAVE_VERSION, type SaveData } from '../src/save/storage';
import { DIFFUSION_MAX, LEGACY_DIFFUSION_DEFAULT, sanitizeDiffusion } from '../src/render/diffusion';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
});

const v1 = (pixel: string) => ({
  version: 1,
  minutes: 1000,
  season: 'spring',
  weather: 'auto',
  placed: [],
  memory: {},
  settings: { pixel, music: 0.5, ambience: 0.5, reducedMotion: false },
});

describe('save migrations', () => {
  it('moves v1 and v2 saves to Smooth once (the default since 2026-11-11), keeping everything else', () => {
    for (const old of [v1('fine'), v1('chunky'), { ...v1('classic'), version: 2 }]) {
      mem.set('komorebi-cho/save', JSON.stringify(old));
      const d = load();
      expect(d?.version).toBe(SAVE_VERSION);
      expect(d?.settings.pixel).toBe('smooth');
      expect(d?.minutes).toBe(1000);
    }
  });

  it('keeps a version 3 player’s chosen look, and replaces an unknown one with the default (Smooth)', () => {
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('classic'), version: 3 }));
    expect(load()?.settings.pixel).toBe('classic');
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('chunky'), version: 3 }));
    expect(load()?.settings.pixel).toBe('chunky');
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('blurry'), version: 3 }));
    expect(load()?.settings.pixel).toBe('smooth');
  });

  it('rejects saves from the future', () => {
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('fine'), version: SAVE_VERSION + 1 }));
    expect(load()).toBeNull();
  });
});

describe('Film Diffusion setting', () => {
  const v2 = (diffusion?: unknown) => ({
    ...v1('classic'),
    version: 2,
    settings: { ...v1('classic').settings, ...(diffusion === undefined ? {} : { diffusion }) },
  });
  const loaded = (raw: string) => {
    mem.set('komorebi-cho/save', raw);
    return load()?.settings.diffusion;
  };

  it('saves from before the setting get the legacy default', () => {
    expect(loaded(JSON.stringify(v2()))).toBe(LEGACY_DIFFUSION_DEFAULT);
    expect(loaded(JSON.stringify(v1('fine')))).toBe(LEGACY_DIFFUSION_DEFAULT);
  });

  it('keeps valid values and clamps out-of-range ones', () => {
    expect(loaded(JSON.stringify(v2(0)))).toBe(0);
    expect(loaded(JSON.stringify(v2(0.125)))).toBe(0.125);
    expect(loaded(JSON.stringify(v2(-1)))).toBe(0);
    expect(loaded(JSON.stringify(v2(5)))).toBe(DIFFUSION_MAX);
  });

  it('rejects non-numbers and non-finite values', () => {
    expect(loaded(JSON.stringify(v2('x')))).toBe(LEGACY_DIFFUSION_DEFAULT);
    expect(loaded(JSON.stringify(v2(null)))).toBe(LEGACY_DIFFUSION_DEFAULT);
    // JSON can't hold NaN/Infinity, but a hand-edited save can say so
    expect(loaded(JSON.stringify(v2(0)).replace('"diffusion":0', '"diffusion":"NaN"'))).toBe(LEGACY_DIFFUSION_DEFAULT);
    expect(sanitizeDiffusion(NaN)).toBe(LEGACY_DIFFUSION_DEFAULT);
    expect(sanitizeDiffusion(Infinity)).toBe(LEGACY_DIFFUSION_DEFAULT);
  });

  it('round-trips through save()', () => {
    const d = { ...v2(0.075), settings: { ...v2(0.075).settings, diffusion: 0.075 } } as unknown as SaveData;
    save(d);
    expect(load()?.settings.diffusion).toBe(0.075);
  });
});

describe('corrupt saves', () => {
  const good = { ...v1('classic'), version: 2, placed: [{ id: 'a', kind: 'bench', x: 1, z: 2, ry: 0 }], memory: { haru: ['a'] } };
  const loadRaw = (d: unknown) => {
    mem.set('komorebi-cho/save', JSON.stringify(d));
    return load();
  };

  it('a well-formed save passes through unchanged', () => {
    const d = loadRaw(good)!;
    expect(d.placed).toEqual(good.placed);
    expect(d.memory).toEqual(good.memory);
    expect(d.settings.music).toBe(0.5);
  });

  it('non-object JSON is treated as no save', () => {
    for (const raw of ['null', '42', '"save"', '[]']) {
      mem.set('komorebi-cho/save', raw);
      expect(load()).toBeNull();
    }
  });

  it('bad fields fall back one by one instead of crashing boot', () => {
    const d = loadRaw({
      ...good,
      minutes: 'x',
      season: 'monsoon',
      weather: 'snow',
      memory: null,
      settings: { music: 'loud', ambience: 7, reducedMotion: 'yes' },
    })!;
    expect(Number.isFinite(d.minutes)).toBe(true);
    expect(d.season).toBe('spring');
    expect(d.weather).toBe('auto');
    expect(d.memory).toEqual({});
    expect(d.settings.music).toBe(0.55);
    expect(d.settings.ambience).toBe(1);
    expect(d.settings.reducedMotion).toBe(false);
    expect(d.placed).toHaveLength(1); // the good placement survives its neighbours' corruption
  });

  it('drops malformed placements and memories but keeps the rest', () => {
    const d = loadRaw({
      ...good,
      placed: [good.placed[0], 'oops', { id: 'b', kind: 'bench', x: 'NaN', z: 0, ry: 0 }, { id: 'c', kind: 'sakura', x: 0, z: 0, ry: 13 }],
      memory: { haru: ['a', 3, null], rin: 'nope' },
    })!;
    expect(d.placed.map((p) => p.id)).toEqual(['a', 'c']);
    expect(d.placed[1]!.ry).toBeLessThan(Math.PI * 2);
    expect(d.memory).toEqual({ haru: ['a'] });
  });

  it('a non-array placed list becomes empty', () => {
    expect(loadRaw({ ...good, placed: 'oops' })!.placed).toEqual([]);
  });
});

describe('saves: hints, Notes and the newer settings', () => {
  const base = { version: 2, minutes: 600, season: 'spring', weather: 'auto', placed: [], memory: {}, settings: {} };
  const loadRaw = (d: unknown) => {
    mem.set('komorebi-cho/save', JSON.stringify(d));
    return load()!;
  };

  it('treats a save from before the hints as a returning player', () => {
    expect(loadRaw(base).tutorial).toEqual(['meet', 'place', 'react']);
    expect(loadRaw({ ...base, tutorial: [] }).tutorial).toEqual([]);
    expect(loadRaw({ ...base, tutorial: ['place', 7] }).tutorial).toEqual(['place']);
  });

  it('keeps well-formed Notes, drops unknown keys and bad params, and keeps at most 50', () => {
    const good = { msg: { key: 'story.useBench', params: { who: { key: 'persona.rin.short' } } }, day: 2, minutes: 900 };
    const notes = [good, { msg: { key: 'story.nope' }, day: 1, minutes: 1 }, { msg: { key: 'story.reset', params: { x: [1] } }, day: 1, minutes: 1 }, 'junk'];
    expect(loadRaw({ ...base, notes }).notes).toEqual([good]);
    const many = Array.from({ length: 80 }, (_, i) => ({ msg: { key: 'story.reset' }, day: i, minutes: 0 }));
    const kept = loadRaw({ ...base, notes: many }).notes;
    expect(kept).toHaveLength(50);
    expect(kept[0]!.day).toBe(30);
  });

  it('keeps moved shops that still fit the row, and drops the rest', () => {
    expect(loadRaw(base).shops).toEqual({});
    const shops = { bakery: { z0: -0.2, z1: 2.2 }, florist: { z0: 2.4, z1: 5 }, books: { z0: 0, z1: 1 }, nowhere: { z0: 0, z1: 3 } };
    expect(loadRaw({ ...base, shops }).shops).toEqual({ bakery: { z0: -0.2, z1: 2.2 }, florist: { z0: 2.4, z1: 5 } });
    expect(loadRaw({ ...base, shops: 'junk' }).shops).toEqual({});
  });

  it('validates effects volume, captions and text size', () => {
    const s = loadRaw({ ...base, settings: { effects: 2, captions: 'yes', textScale: 3 } }).settings;
    expect(s.effects).toBe(1);
    expect(s.captions).toBe(false);
    expect(s.textScale).toBe(1);
    const ok = loadRaw({ ...base, settings: { effects: 0.2, captions: true, textScale: 1.25 } }).settings;
    expect([ok.effects, ok.captions, ok.textScale]).toEqual([0.2, true, 1.25]);
  });
});
