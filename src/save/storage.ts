import { SEASONS, type Season } from '../core/clock';
import type { WeatherMode } from '../world/weather';
import type { PlaceableKind } from '../world/props';
import { DEFAULT_PIXEL, PIXEL_PRESETS, type PixelPreset } from '../render/pixelscale';
import { LEGACY_DIFFUSION_DEFAULT, sanitizeDiffusion } from '../render/diffusion';
import { isKey, type Msg, type Params } from '../i18n';
import { sanitizeStats, type Memory, type MemoryStats } from '../sim/memories';
import { sanitizeShops } from '../edit/shops';
import { SHOPS } from '../world/layout';
import type { SaveStamp } from './tabs';

export const SAVE_VERSION = 3;
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
  /** Camera rotation (radians). Optional: restored on return visits; zoom and pan always start at Fit. */
  yaw?: number;
  season: Season;
  weather: WeatherMode;
  placed: PlacedRecord[];
  /** Shop-houses the player moved or resized: their frontage (z0..z1) by id. Optional on disk. */
  shops?: Record<string, { z0: number; z1: number }>;
  memory: Record<string, string[]>;
  /** Each resident's diary: the last week of entries (prompt 08). Optional on disk. */
  diaries?: Record<string, { day: number; msg: Msg }[]>;
  /** What each resident knows of places: familiarity and favourites (prompt 08). Optional on disk. */
  places?: Record<string, unknown>;
  /** First-minutes hints already done ('place', 'react', 'meet'). */
  tutorial: string[];
  /** Journal memories (sim/memories.ts), oldest first. Optional on disk. */
  memories: Memory[];
  /** What's building toward a memory (use counts, rainy days), so it carries across sittings. Optional on disk. */
  memoryStats?: MemoryStats;
  /** The Notes panel: the last story lines, oldest first. */
  notes: { msg: Msg; day: number; minutes: number }[];
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
    effects: number;
    captions: boolean;
    /** HUD text scale: 1, 1.25 or 1.5. */
    textScale: number;
    /** How busy the neighbourhood's sounds get. Optional on disk. */
    density?: 'quiet' | 'balanced' | 'lively';
    /** The HUD's lettering: the pixel font or a plain one. Optional on disk. */
    font?: 'pixel' | 'plain';
  };
}

const TEXT_SCALES = [1, 1.25, 1.5, 2];
/** The shopping street as first laid out: saved shop extents are checked against it. */
const SHOP_ROW_BASE = SHOPS.map(({ id, z0, z1 }) => ({ id, z0, z1 }));
const MEMORY_KINDS = ['noticed', 'favorite', 'together', 'rainy', 'routine'];
const POSES = ['stand', 'sit', 'pray', 'crouch', 'sweep'];
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A saved memory, field by field; anything malformed drops just that memory. */
function sanitizeMemory(v: unknown): Memory | null {
  if (!isObj(v) || typeof v.id !== 'string' || !MEMORY_KINDS.includes(v.kind as string) || !strs(v.who) || !v.who.length) return null;
  if (typeof v.objectId !== 'string' || typeof v.objectKind !== 'string' || !isObj(v.snapshot)) return null;
  const s = v.snapshot;
  if (!finite(s.minutes) || !finite(s.rain) || !(SEASONS as readonly unknown[]).includes(s.season) || !isObj(s.focus)) return null;
  if (!finite(s.focus.x) || !finite(s.focus.z) || !Array.isArray(s.objects) || !Array.isArray(s.people)) return null;
  const objects = s.objects.filter(
    (o): o is { id: string; kind: string; x: number; z: number; ry: number } =>
      isObj(o) && typeof o.id === 'string' && typeof o.kind === 'string' && finite(o.x) && finite(o.z) && finite(o.ry),
  );
  const people = s.people
    .filter((p): p is { id: string; x: number; z: number; pose?: unknown; ry?: unknown } => isObj(p) && typeof p.id === 'string' && finite(p.x) && finite(p.z))
    .map(({ id, x, z, pose, ry }) => ({ id, x, z, ...(typeof pose === 'string' && POSES.includes(pose) ? { pose } : {}), ...(finite(ry) ? { ry } : {}) }));
  return {
    id: v.id,
    kind: v.kind as Memory['kind'],
    who: v.who,
    objectId: v.objectId,
    objectKind: v.objectKind,
    snapshot: {
      minutes: Math.max(0, s.minutes),
      season: s.season as Season,
      rain: Math.min(1, Math.max(0, s.rain)),
      focus: { x: s.focus.x, z: s.focus.z },
      objects,
      people,
    },
  };
}
const NOTES_MAX = 50;

/** A saved message: a known key and plain params (nested messages allowed, a few levels deep). */
function sanitizeMsg(v: unknown, depth = 0): Msg | null {
  if (!isObj(v) || typeof v.key !== 'string' || !isKey(v.key) || depth > 3) return null;
  if (v.params === undefined) return { key: v.key };
  if (!isObj(v.params)) return null;
  const params: Params = {};
  for (const [k, p] of Object.entries(v.params)) {
    if (typeof p === 'string' || finite(p)) params[k] = p;
    else {
      const m = sanitizeMsg(p, depth + 1);
      if (!m) return null;
      params[k] = m;
    }
  }
  return { key: v.key, params };
}

/** Forward-only migrations keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: three pixel presets. v1's 'fine' (the default) rendered ~266 px tall, which is
  // what 'classic' gives now; keep players' look rather than silently making it finer.
  1: (d) => {
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    return { ...d, version: 2, settings: { ...settings, pixel: settings.pixel === 'chunky' ? 'chunky' : 'classic' } };
  },
  // v2 → v3: Smooth became the default look (2026-11-11), and saves from before it existed were
  // migrated to Classic. Move everyone to Smooth once; Settings switches back in one click.
  2: (d) => {
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    return { ...d, version: 3, settings: { ...settings, pixel: 'smooth' } };
  },
};

const WEATHER_MODES: readonly WeatherMode[] = ['auto', 'clear', 'rain'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit = (v: unknown, fallback: number): number => (finite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Saved diaries: per resident, at most a week of entries, each a well-formed message. */
function sanitizeDiaries(v: unknown): Record<string, { day: number; msg: Msg }[]> {
  const out: Record<string, { day: number; msg: Msg }[]> = {};
  if (!isObj(v)) return out;
  for (const [who, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const ok: { day: number; msg: Msg }[] = [];
    for (const e of list.slice(-7)) {
      if (!isObj(e) || !finite(e.day)) continue;
      const m = sanitizeMsg(e.msg);
      if (m) ok.push({ day: Math.max(0, Math.floor(e.day)), msg: m });
    }
    if (ok.length) out[who] = ok;
  }
  return out;
}

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
  const memories: Memory[] = [];
  if (Array.isArray(d.memories))
    for (const m of d.memories.slice(-24)) {
      const ok = sanitizeMemory(m);
      if (ok) memories.push(ok);
    }
  const notes: SaveData['notes'] = [];
  if (Array.isArray(d.notes))
    for (const n of d.notes.slice(-NOTES_MAX)) {
      if (!isObj(n) || !finite(n.day) || !finite(n.minutes)) continue;
      const m = sanitizeMsg(n.msg);
      if (m) notes.push({ msg: m, day: Math.max(0, Math.floor(n.day)), minutes: Math.max(0, n.minutes) });
    }
  return {
    version: SAVE_VERSION,
    // which tab wrote it, and when (save/tabs.ts); optional, so no version bump
    ...(typeof d.writer === 'string' ? { writer: d.writer } : {}),
    ...(finite(d.savedAt) ? { savedAt: d.savedAt } : {}),
    minutes: finite(d.minutes) && d.minutes >= 0 ? d.minutes : DEFAULT_MINUTES,
    // one of the four quarter-turn views (π/4 + kπ/2), whatever was stored
    ...(finite(d.yaw) ? { yaw: Math.PI / 4 + (((Math.round((d.yaw - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4) * (Math.PI / 2) } : {}),
    season: (SEASONS as readonly unknown[]).includes(d.season) ? (d.season as Season) : 'spring',
    weather: (WEATHER_MODES as readonly unknown[]).includes(d.weather) ? (d.weather as WeatherMode) : 'auto',
    placed: placed.map(({ id, kind, x, z, ry }) => ({ id, kind, x, z, ry: ry % (Math.PI * 2) })),
    shops: sanitizeShops(d.shops, SHOP_ROW_BASE),
    memory,
    diaries: sanitizeDiaries(d.diaries),
    // per resident, per place: checked field by field when restored (sim/places.ts)
    places: isObj(d.places) ? d.places : {},
    // a save from before the hints existed belongs to a returning player: they never need them
    tutorial: Array.isArray(d.tutorial) ? d.tutorial.filter((x): x is string => typeof x === 'string') : ['meet', 'place', 'react'],
    notes,
    memories,
    memoryStats: sanitizeStats(d.memoryStats),
    settings: {
      // an unknown preset would break the canvas layout; fall back to the default look
      pixel: (PIXEL_PRESETS as readonly unknown[]).includes(settings.pixel) ? (settings.pixel as PixelPreset) : DEFAULT_PIXEL,
      music: unit(settings.music, 0.55),
      ambience: unit(settings.ambience, 0.6),
      reducedMotion: settings.reducedMotion === true,
      diffusion: sanitizeDiffusion(settings.diffusion, LEGACY_DIFFUSION_DEFAULT),
      effects: unit(settings.effects, 0.6),
      captions: settings.captions === true,
      textScale: TEXT_SCALES.includes(settings.textScale as number) ? (settings.textScale as number) : 1,
      density: settings.density === 'quiet' || settings.density === 'lively' ? settings.density : 'balanced',
      font: settings.font === 'plain' ? 'plain' : 'pixel',
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

/** Returns false when the browser won't store it (private mode, sandboxed frames, full): the game runs fine without. */
export function save(d: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
