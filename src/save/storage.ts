import type { Season } from '../core/clock';
import type { WeatherMode } from '../world/weather';
import type { PlaceableKind } from '../world/props';
import type { PixelPreset } from '../render/pixelscale';

export const SAVE_VERSION = 2;
const KEY = 'komorebi-cho/save';

export interface PlacedRecord {
  id: string;
  kind: PlaceableKind;
  x: number;
  z: number;
  ry: number;
}

export interface SaveData {
  version: number;
  minutes: number;
  season: Season;
  weather: WeatherMode;
  placed: PlacedRecord[];
  memory: Record<string, string[]>;
  settings: { pixel: PixelPreset; music: number; ambience: number; reducedMotion: boolean };
}

/** Forward-only migrations keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: three pixel presets. v1's 'fine' (the default) rendered ~266 px tall, which is
  // what 'classic' gives now; keep players' look rather than silently making it finer.
  1: (d) => {
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    return { ...d, version: 2, settings: { ...settings, pixel: settings.pixel === 'chunky' ? 'chunky' : 'classic' } };
  },
};

export function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    let d = JSON.parse(raw) as Record<string, unknown>;
    let v = Number(d.version ?? 0);
    while (v < SAVE_VERSION && MIGRATIONS[v]) {
      d = MIGRATIONS[v]!(d);
      v++;
    }
    if (v !== SAVE_VERSION) return null;
    return d as unknown as SaveData;
  } catch {
    return null;
  }
}

export function save(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage may be unavailable (private mode, sandboxed frames): the game runs fine without it */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
