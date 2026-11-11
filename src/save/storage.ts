import { SEASONS, type Season } from '../core/clock';
import type { WeatherMode } from '../world/weather';
import type { PlaceableKind } from '../world/props';
import { DEFAULT_PIXEL, PIXEL_PRESETS, type PixelPreset } from '../render/pixelscale';
import { LEGACY_DIFFUSION_DEFAULT, sanitizeDiffusion } from '../render/diffusion';
import type { SaveStamp } from './tabs';

export const SAVE_VERSION = 2;
const KEY = 'komorebi-cho/save';

export interface PlacedRecord {
  id: string;
  kind: PlaceableKind;
  x: number;
  z: number;
  ry: number;
}

export interface SaveData extends SaveStamp {
  version: number;
  minutes: number;
  season: Season;
  weather: WeatherMode;
  placed: PlacedRecord[];
  memory: Record<string, string[]>;
  settings: {
    pixel: PixelPreset;
    music: number;
    ambience: number;
    reducedMotion: boolean;
    /**
     * Film Diffusion, 0..0.2. Optional on disk (saves before it existed lack it), always
     * present after `load()`: missing or invalid values become LEGACY_DIFFUSION_DEFAULT,
     * the rest clamp to range. An optional field needs no version bump.
     */
    diffusion: number;
  };
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

const WEATHER_MODES: readonly WeatherMode[] = ['auto', 'clear', 'rain'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit = (v: unknown, fallback: number): number => (finite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/**
 * Shape-check a migrated save. Anything malformed falls back field by field rather than
 * discarding the whole save, so one bad value never costs a player their neighbourhood,
 * and nothing malformed reaches boot (a throw there would leave a blank page on every visit).
 * Placeable kinds are checked by the caller, which knows the catalogue.
 */
export function sanitize(d: Record<string, unknown>): SaveData {
  const settings = isObj(d.settings) ? d.settings : {};
  const placed = Array.isArray(d.placed)
    ? d.placed.filter(
        (r): r is PlacedRecord => isObj(r) && typeof r.id === 'string' && typeof r.kind === 'string' && finite(r.x) && finite(r.z) && finite(r.ry),
      )
    : [];
  const memory: Record<string, string[]> = {};
  if (isObj(d.memory)) {
    for (const [who, ids] of Object.entries(d.memory)) if (Array.isArray(ids)) memory[who] = ids.filter((x): x is string => typeof x === 'string');
  }
  return {
    version: SAVE_VERSION,
    // which tab wrote it, and when (save/tabs.ts); optional, so no version bump
    ...(typeof d.writer === 'string' ? { writer: d.writer } : {}),
    ...(finite(d.savedAt) ? { savedAt: d.savedAt } : {}),
    minutes: finite(d.minutes) && d.minutes >= 0 ? d.minutes : DEFAULT_MINUTES,
    season: (SEASONS as readonly unknown[]).includes(d.season) ? (d.season as Season) : 'spring',
    weather: (WEATHER_MODES as readonly unknown[]).includes(d.weather) ? (d.weather as WeatherMode) : 'auto',
    placed: placed.map(({ id, kind, x, z, ry }) => ({ id, kind, x, z, ry: ry % (Math.PI * 2) })),
    memory,
    settings: {
      // an unknown preset would break the canvas layout; fall back to the default look
      pixel: (PIXEL_PRESETS as readonly unknown[]).includes(settings.pixel) ? (settings.pixel as PixelPreset) : DEFAULT_PIXEL,
      music: unit(settings.music, 0.55),
      ambience: unit(settings.ambience, 0.6),
      reducedMotion: settings.reducedMotion === true,
      diffusion: sanitizeDiffusion(settings.diffusion, LEGACY_DIFFUSION_DEFAULT),
    },
  };
}

/** A new player's clock, in minutes since day 0 (see main.ts). Also the fallback for a corrupt one. */
export const DEFAULT_MINUTES = 16.6 * 60;

export function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed)) return null;
    let d = parsed;
    let v = Number(d.version ?? 0);
    while (v < SAVE_VERSION && MIGRATIONS[v]) {
      d = MIGRATIONS[v]!(d);
      v++;
    }
    if (v !== SAVE_VERSION) return null;
    return sanitize(d);
  } catch {
    return null;
  }
}

/** Just the stamp of what's on disk, for the pre-write check in save/tabs.ts (no migration, no sanitising). */
export function readStamp(): SaveStamp | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (!isObj(d)) return null;
    return { writer: typeof d.writer === 'string' ? d.writer : undefined, savedAt: finite(d.savedAt) ? d.savedAt : undefined };
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
