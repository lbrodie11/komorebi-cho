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
  it('v1 "fine" (the old default, ~266 px tall) becomes "classic"', () => {
    mem.set('komorebi-cho/save', JSON.stringify(v1('fine')));
    const d = load();
    expect(d?.version).toBe(SAVE_VERSION);
    expect(d?.settings.pixel).toBe('classic');
    expect(d?.minutes).toBe(1000);
  });

  it('v1 "chunky" stays chunky', () => {
    mem.set('komorebi-cho/save', JSON.stringify(v1('chunky')));
    expect(load()?.settings.pixel).toBe('chunky');
  });

  it('keeps a valid look, and replaces an unknown one with the default (Smooth)', () => {
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('classic'), version: 2, settings: { ...v1('classic').settings, pixel: 'smooth' } }));
    expect(load()?.settings.pixel).toBe('smooth');
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('classic'), version: 2, settings: { ...v1('classic').settings, pixel: 'blurry' } }));
    expect(load()?.settings.pixel).toBe('smooth');
    // saves from before Smooth keep the look their players had
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('classic'), version: 2 }));
    expect(load()?.settings.pixel).toBe('classic');
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
