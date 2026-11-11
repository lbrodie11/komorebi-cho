import { describe, it, expect, beforeEach } from 'vitest';
import { load, SAVE_VERSION } from '../src/save/storage';

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

  it('rejects saves from the future', () => {
    mem.set('komorebi-cho/save', JSON.stringify({ ...v1('fine'), version: SAVE_VERSION + 1 }));
    expect(load()).toBeNull();
  });
});
