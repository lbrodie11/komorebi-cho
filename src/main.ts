import * as THREE from 'three';
import { EventBus, type GameEvents } from './core/events';
import { WorldClock, type Season } from './core/clock';
import { IsoCamera } from './render/camera';
import { canvasLayout, DEFAULT_PIXEL, usesPalette, type PixelPreset } from './render/pixelscale';
import { PostPass } from './render/post';
import { PALETTE } from './render/palette';
import { skyAt, type SkyState } from './render/sky';
import { World } from './world/world';
import { G, GROUND, OBSTACLES, PLINTH, TG } from './world/layout';
import { groundHeight, isWalkableSurface } from './world/terrain';
import { NavGrid } from './sim/grid';
import { SmartRegistry, registerStaticObjects } from './sim/smart';
import { Residents, type Agent } from './sim/residents';
import { Animals } from './sim/animals';
import { BuildTool, type ToolMode } from './ui/build';
import { Hud, TEXT_SCALES, type TextScale } from './ui/hud';
import { Tutorial } from './ui/tutorial';
import { MemoryRecorder, type Memory, type WorldView } from './sim/memories';
import { DebugOverlay } from './ui/debug';
import { Sound } from './audio/sound';
import { load, save, readStamp, SAVE_VERSION, DEFAULT_MINUTES } from './save/storage';
import { CHANNEL_NAME, SaveGuard, wroteElsewhere } from './save/tabs';
import { PLACEABLES, type PlaceableKind } from './world/props';
import { parseLaunchParams, warmupStart } from './core/params';
import { warmUp } from './sim/warmup';
import { DEFAULT_DIFFUSION, diffusionOutputSize } from './render/diffusion';
import { msg, t, type MsgKey } from './i18n';

// ── Boot ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const params = parseLaunchParams(location.search);
// Scripted (seeded) runs neither restore nor overwrite the player's save.
const saved = params.scripted ? null : load();
const WEBGL_RETRIES_KEY = 'komorebi-cho/webgl-retries';
/**
 * Browsers occasionally lose the WebGL context while it is being created (seen intermittently in
 * WebKit; it can also happen under memory pressure). three.js then throws and the page would stay
 * blank. Reload quietly up to twice, then say what happened instead of showing nothing.
 */
function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    let tries: number;
    try {
      tries = Number(sessionStorage.getItem(WEBGL_RETRIES_KEY) ?? 0);
      sessionStorage.setItem(WEBGL_RETRIES_KEY, String(tries + 1));
    } catch {
      tries = 2; // no storage: don't risk a reload loop
    }
    if (tries < 2) setTimeout(() => location.reload(), 300);
    else {
      const note = document.createElement('p');
      note.className = 'webgl-failed';
      note.textContent = t('error.webgl');
      document.getElementById('app')?.append(note);
    }
    throw err;
  }
}
const renderer = createRenderer();
// DPR is handled explicitly in resize(): the drawing buffer is the render target size (pixel ratio 1),
// and the canvas's CSS box is sized so the browser upscales by an exact integer in device pixels.
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
// One hard tap per pixel: shadow edges get their softness from the dither + palette snap, not PCF noise.
renderer.shadowMap.type = THREE.BasicShadowMap;
const debug = params.debug ? new DebugOverlay(document.getElementById('app') as HTMLElement, renderer) : null;

const bus = new EventBus<GameEvents>();
// 16:36: golden hour now, the evening bell (18:00) about 84 s in, blue hour (19:15) about 2.5 min in
const clock = new WorldClock(DEFAULT_MINUTES / 60);
const world = new World(params.seed);
const post = new PostPass(PALETTE, !params.lutOff);
const iso = new IsoCamera();
const sound = new Sound();

const grid = new NavGrid(
  { x0: GROUND.x0, z0: GROUND.z0, w: GROUND.x1 - GROUND.x0, d: GROUND.z1 - GROUND.z0, cell: 0.5 },
  { walkable: isWalkableSurface, height: groundHeight },
  OBSTACLES,
);
const smart = new SmartRegistry();
registerStaticObjects(smart);
const residents = new Residents(world.scene, grid, smart, bus, world.mats, params.seed);
const animals = new Animals(world.scene, world.mats, grid, smart, bus, world.chimneyTop, params.seed);
const build = new BuildTool(world.scene, world.mats, grid, smart, residents, bus, () => clock.hour, world.lightPool);

/** The player's look, as saved; new players start on Smooth. */
let pixelSetting: PixelPreset = DEFAULT_PIXEL;
/** What renders: the setting, unless the URL overrides it for this visit (?pixel=, never saved). */
let pixel: PixelPreset = params.pixel ?? pixelSetting;
/** The player's Film Diffusion setting (0..DIFFUSION_MAX), as saved. */
let diffusionSetting = DEFAULT_DIFFUSION;
/** What renders: the setting, unless the URL overrides it for this visit (?diffusion=, never saved). */
let diffusion = params.diffusion ?? diffusionSetting;
let photo = false;

// ── Persistence ───────────────────────────────────────────────────────────
let captions = false;
let textScale: TextScale = 1;
const tutorial = new Tutorial(params.scripted ? ['place', 'react', 'meet'] : (saved?.tutorial ?? []));
if (saved) {
  clock.minutes = saved.minutes;
  clock.season = saved.season;
  world.weather.setMode(saved.weather);
  // Residents are ignored here: one standing on yesterday's bench spot at boot must not delete the bench
  // (the next autosave would make the loss permanent). Unknown kinds (an older or newer build) are skipped.
  for (const r of saved.placed) if (r.kind in PLACEABLES && build.canPlace(r.kind, r.x, r.z, { ignoreResidents: true })) build.place(r, false);
  residents.restoreMemory(saved.memory);
  pixelSetting = saved.settings.pixel;
  pixel = params.pixel ?? pixelSetting;
  sound.musicVolume = saved.settings.music;
  sound.ambienceVolume = saved.settings.ambience;
  sound.effectsVolume = saved.settings.effects;
  captions = saved.settings.captions;
  textScale = (TEXT_SCALES as readonly number[]).includes(saved.settings.textScale) ? (saved.settings.textScale as TextScale) : 1;
  world.reducedMotion = saved.settings.reducedMotion;
  diffusionSetting = saved.settings.diffusion;
  diffusion = params.diffusion ?? diffusionSetting;
} else if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
  world.reducedMotion = true; // a new player who asked their OS for less motion gets it here too
}
let reducedMotion = world.reducedMotion;
build.reducedMotion = reducedMotion;
iso.instant = reducedMotion;
residents.guaranteeNext = tutorial.wantsReaction;

/** One tab saves at a time (save/tabs.ts). Scripted runs take no part: they never touch the save. */
const guard = params.scripted
  ? null
  : new SaveGuard({
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      locks: 'locks' in navigator ? navigator.locks : null,
      channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null,
      session: (() => {
        try {
          return sessionStorage;
        } catch {
          return null; // sandboxed frame
        }
      })(),
      reload: () => location.reload(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    });
/** The newest save this tab knows about: the one it loaded, or its own last write. */
let knownAt = saved?.savedAt ?? 0;
function persist(): void {
  if (!guard?.canSave) return;
  // Another tab wrote since we last knew (no Web Locks here, or mid hand-over): step back, don't overwrite.
  if (wroteElsewhere(readStamp(), guard.id, knownAt)) {
    guard.pause('moved');
    return;
  }
  const savedAt = Math.max(Date.now(), knownAt + 1);
  knownAt = savedAt;
  const ok = save({
    version: SAVE_VERSION,
    writer: guard.id,
    savedAt,
    minutes: clock.minutes,
    yaw: iso.yaw,
    season: clock.season,
    weather: world.weather.mode,
    placed: build.records(),
    memory: residents.memory(),
    tutorial: tutorial.flags,
    memories: [...memories.memories],
    notes: hud.noteList,
    settings: {
      pixel: pixelSetting,
      music: sound.musicVolume,
      ambience: sound.ambienceVolume,
      effects: sound.effectsVolume,
      reducedMotion,
      diffusion: diffusionSetting,
      captions,
      textScale,
    },
  });
  hud.setSaveStatus(ok ? 'ok' : 'notSaving');
}

// ── UI ────────────────────────────────────────────────────────────────────
const setTool = (m: ToolMode, k?: PlaceableKind) => {
  build.setMode(m, k);
  kbCursor = null;
  hud.setTool(m, build.kind);
  canvas.classList.toggle('building', m !== 'view');
};
const hud = new Hud(hudRoot, {
  toggleSound: () => sound.toggle(),
  setSpeed: (s) => {
    clock.paused = s === 0;
    if (s) clock.speed = s;
    hud.setSpeed(clock.speed, clock.paused);
  },
  jumpTo: (h) => clock.jumpTo(h),
  setWeather: (m) => {
    world.weather.setMode(m);
    hud.setWeather(m);
  },
  setSeason: (s: Season) => {
    clock.season = s;
    bus.emit('story', { msg: msg(`story.${s}` as MsgKey) });
  },
  setTool,
  rotateItem: () => build.rotate(),
  photo: (on) => {
    photo = on;
    if (on) {
      setTool('view');
      hud.closeCard();
    }
  },
  capture: () => {
    if (contextLost) return Promise.resolve(null); // nothing to render into until the context is back
    bus.emit('sfx', { name: 'shutter' });
    const aspect = parseFloat(canvas.style.width) / parseFloat(canvas.style.height) || 16 / 9;
    const url = captureFrame(Math.round(PHOTO_H * aspect), PHOTO_H);
    resize(); // back to the screen's layout
    return Promise.resolve(url);
  },
  setPixel: (p) => {
    pixelSetting = p;
    pixel = p;
    hud.setPixel(p);
    resize();
  },
  setVolumes: (m, a, fx) => {
    sound.musicVolume = m;
    sound.ambienceVolume = a;
    sound.effectsVolume = fx;
    sound.applyVolumes();
  },
  setReducedMotion: (v) => {
    reducedMotion = v;
    world.reducedMotion = v;
    build.reducedMotion = v;
    iso.instant = v;
  },
  setCaptions: (on) => {
    captions = on;
    hud.setCaptions(on);
  },
  setTextScale: (sc) => {
    textScale = sc;
    hud.setTextScale(sc);
  },
  zoom: (dir) => zoomStep(dir),
  fit: () => fitTown(),
  setZoom: (z) => {
    if (iso.continuous) iso.zoomTo(z);
    else if (Math.abs(z - iso.zoom) > 1e-3) cameraStep(() => iso.zoomTo(z));
  },
  meet: (id) => meet(id),
  showMe: (id) => {
    const a = residents.agents.find((g) => g.p.id === id);
    if (a && !a.hidden) {
      iso.targetGoal.set(a.x, iso.targetGoal.y, a.z);
      if (reducedMotion) iso.target.copy(iso.targetGoal);
    }
  },
  hintPressed: () => {
    setTool('build', 'bench');
    if (hintSpot) {
      kbCursor = { x: hintSpot.x, z: hintSpot.z };
      build.pointer(downRay(hintSpot.x, hintSpot.z));
    }
  },
  resetTutorial: () => {
    tutorial.reset();
    residents.guaranteeNext = true;
    hintSpot = null;
    persist();
  },
  setDiffusion: (s) => {
    diffusionSetting = s;
    setDiffusion(s);
  },
  reset: () => {
    setTool('view');
    for (const r of build.records()) build.remove(r.id);
    residents.restoreMemory({}); // removal already made everyone forget; this is belt and braces for orphans
    // Save the reset state now (settings included) rather than deleting the save: deleting it would also
    // throw away the player's look and volumes until the next autosave.
    persist();
    bus.emit('story', { msg: msg('story.reset') });
  },
});
if (guard) {
  guard.onChange = (reason) => hud.setSaveNote(reason, () => guard.takeOver());
  guard.beforeRelease = persist; // save the latest before the other tab takes over
  void guard.start();
}
hud.setSpeed(clock.speed, clock.paused);
hud.setVolumes(sound.musicVolume, sound.ambienceVolume, sound.effectsVolume);
hud.setCaptions(captions);
hud.setTextScale(textScale);
if (saved) hud.restoreNotes(saved.notes);
hud.setPeopleSource((id) => {
  const a = residents.agents.find((g) => g.p.id === id);
  return a ? residents.info(a) : null;
});
hud.setReducedMotion(reducedMotion);
hud.setSeason(clock.season);
hud.setWeather(world.weather.mode);
hud.setTool('view', build.kind);
hud.setPixel(pixel);
hud.setDiffusion(diffusion);

bus.on('story', ({ msg: m, fleeting }) => hud.story(m, clock.day, clock.minutes, fleeting));
// ── Memories (the journal) ────────────────────────────────────────────────
const memories = new MemoryRecorder(saved?.memories ?? []);
function worldView(): WorldView {
  return {
    minutes: clock.minutes,
    season: clock.season,
    rain: world.weather.rain,
    objects: build.records(),
    where: (id) => {
      const a = residents.agents.find((g) => g.p.id === id);
      return a && !a.hidden ? { x: a.x, z: a.z } : null;
    },
  };
}
/** A new memory gets one quiet line in the feed (no badge): the journal is where it lives. */
function announce(m: Memory | null): void {
  if (!m) return;
  const who = (id: string | undefined) => msg(`persona.${id ?? ''}.short` as MsgKey);
  const caption = msg(`memory.${m.kind}` as MsgKey, { who: who(m.who[0]), other: who(m.who[1]), thing: msg(`noun.${m.objectKind}` as MsgKey) });
  bus.emit('story', { msg: msg('story.memory', { caption }) });
}
bus.on('noticed', ({ who, id }) => {
  tutorial.noticed();
  if (!params.scripted) announce(memories.noticed(who, id, worldView()));
});
bus.on('used', ({ who, id, with: others }) => {
  if (!params.scripted) for (const m of memories.used({ who, objectId: id, with: others }, worldView())) announce(m);
});
bus.on('objectRemoved', ({ id }) => memories.removed(id));
hud.setMemorySource({ list: () => memories.memories, render: (m, cut) => renderMemory(m, cut) });
bus.on('objectPlaced', () => tutorial.placed());
sound.onCaption = (k) => {
  if (captions) hud.caption(t(`caption.${k}` as MsgKey));
};

/** Open a neighbour's card (a click on them, a long press, or the People list). */
function meet(id: string): void {
  const a = residents.agents.find((g) => g.p.id === id);
  if (!a) return;
  hud.openCard(id, () => residents.info(a));
  tutorial.met();
  bus.emit('sfx', { name: 'click' });
}
bus.on('sfx', ({ name, x }) => sound.sfx(name, x !== undefined ? x / 18 : 0));

// ── Sizing ────────────────────────────────────────────────────────────────
const app = document.getElementById('app') as HTMLElement;
/** Container size in device pixels. Exact when the browser reports device-pixel-content-box. */
let devW = Math.round(app.clientWidth * (window.devicePixelRatio || 1));
let devH = Math.round(app.clientHeight * (window.devicePixelRatio || 1));
let exactDeviceBox = false;

/**
 * Lay out the canvas. At 0% Film Diffusion the drawing buffer is the internal render
 * size and CSS enlarges it with `image-rendering: pixelated`. Above 0% the post pass
 * enlarges it in a shader, so the drawing buffer is the device-resolution budget instead.
 * Switching between the two changes the canvas size, so it happens here, not per frame.
 */
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const l = canvasLayout(devW, devH, dpr, pixel);
  Object.assign(canvas.style, { width: `${l.cssW}px`, height: `${l.cssH}px`, left: `${l.cssLeft}px`, top: `${l.cssTop}px` });
  post.setSize(l.rw, l.rh);
  post.setPalette(usesPalette(pixel));
  iso.setViewport(l.rw, l.rh);
  // Smooth zooms continuously; the palette looks keep to whole steps (a fractional zoom snaps to the nearest)
  const continuous = !usesPalette(pixel);
  if (continuous !== iso.continuous) {
    iso.continuous = continuous;
    if (!continuous) iso.zoomTo(iso.zoom);
  }
  const out = diffusionOutputSize(l.cssW, l.cssH, dpr);
  post.setOutputSize(out.w, out.h);
  const active = post.setDiffusion(renderer, diffusion, out.w / l.rw);
  canvas.classList.toggle('diffused', active);
  // Smooth's fractional enlargement is filtered; nearest-neighbour at 1.33× would make uneven pixel columns
  canvas.classList.toggle('smooth', !usesPalette(pixel));
  if (active) renderer.setSize(out.w, out.h, false);
  else renderer.setSize(l.rw, l.rh, false);
}

/** Photos are this tall whatever the display's DPR; the width follows the window, so the photo frames what you see. */
const PHOTO_H = 1080;

/**
 * Render one frame laid out for a w×h device-pixel screen at DPR 1, with the
 * current pixel preset and Film Diffusion, and return it as a PNG data URL. The HUD is DOM,
 * so it never appears. The caller restores the screen layout with resize().
 */
function captureFrame(w: number, h: number): string | null {
  const l = canvasLayout(w, h, 1, pixel);
  const outW = Math.round(l.rw * l.scale),
    outH = Math.round(l.rh * l.scale);
  post.setSize(l.rw, l.rh);
  iso.setViewport(l.rw, l.rh);
  post.setOutputSize(outW, outH);
  if (post.setDiffusion(renderer, diffusion, l.scale)) {
    renderer.setSize(outW, outH, false);
    renderFrame(0);
    return canvas.toDataURL('image/png'); // same task as the render: the drawing buffer is still intact
  }
  renderer.setSize(l.rw, l.rh, false);
  renderFrame(0);
  const up = document.createElement('canvas');
  up.width = outW;
  up.height = outH;
  const ctx = up.getContext('2d');
  if (!ctx) return null;
  // palette looks enlarge by a whole number with hard pixel edges; Smooth's fractional scale is filtered, as on screen
  ctx.imageSmoothingEnabled = !usesPalette(pixel);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, outW, outH);
  return up.toDataURL('image/png');
}

/** Live slider updates: only crossing 0 needs a new canvas size. */
function setDiffusion(s: number): void {
  const crossed = s > 0 !== diffusion > 0;
  diffusion = s;
  if (crossed || !post.diffusing) resize();
  else {
    const l = canvasLayout(devW, devH, window.devicePixelRatio || 1, pixel);
    post.setDiffusion(renderer, s, post.outputWidth / l.rw);
  }
}
const ro = new ResizeObserver(([entry]) => {
  const box = entry?.devicePixelContentBoxSize?.[0];
  const dpr = window.devicePixelRatio || 1;
  exactDeviceBox = !!box;
  devW = box ? box.inlineSize : Math.round(app.clientWidth * dpr);
  devH = box ? box.blockSize : Math.round(app.clientHeight * dpr);
  resize();
});
try {
  ro.observe(app, { box: 'device-pixel-content-box' });
} catch {
  ro.observe(app); // Safari: no device-pixel-content-box
}
// A DPR change with no CSS size change (window dragged to another monitor, browser zoom) only
// re-fires the observer where device-pixel-content-box is supported; cover the rest here.
(function watchDpr(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
    'change',
    () => {
      if (!exactDeviceBox) {
        const dpr = window.devicePixelRatio || 1;
        devW = Math.round(app.clientWidth * dpr);
        devH = Math.round(app.clientHeight * dpr);
        resize();
      }
      watchDpr();
    },
    { once: true },
  );
})();
/** What "the whole town" means for Fit: the plinth (top and bottom corners) and the chimney top. */
const FIT_POINTS = [GROUND.x0, GROUND.x1].flatMap((x) =>
  [GROUND.z0, GROUND.z1].flatMap((z) => [new THREE.Vector3(x, G, z), new THREE.Vector3(x, G - PLINTH.h, z)]),
);
FIT_POINTS.push(new THREE.Vector3(-14.9, TG + 13.05, -11.9));
const FIT_CENTRE = new THREE.Vector3(0, 3.9, 0);

iso.bounds = GROUND;
resize();
// Return visits keep their rotation only; zoom and pan always start from Fit (an old close-up is disorienting).
// Scripted runs keep the fixed 1× reference view their screenshots were made with.
if (!params.scripted) {
  if (saved?.yaw !== undefined) iso.yaw = saved.yaw;
  fitTown(false);
}

// ── Input ─────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
/** Fingers on the canvas, for pinch (zoom) and twist (rotate). */
const touches = new Map<number, { x: number; y: number }>();
/** Distance and angle between two fingers when the last zoom/rotate step fired. */
let gesture: { d: number; a: number } | null = null;
/** After a two-finger gesture, lifting the fingers must not count as a tap. */
let gestured = false;
/** Touch: pressing and holding on someone opens their card (a long press is not a tap). */
let longPress: { timer: number; fired: boolean } | null = null;
const LONG_PRESS_MS = 500;
/** Build or remove by keyboard: a cursor on the ground that the arrow keys move and Enter commits. */
let kbCursor: { x: number; z: number } | null = null;
/** Where the bench hint sparkles (chosen once per hint, on open grass). */
let hintSpot: { x: number; z: number } | null = null;
/** A ray straight down onto (x, z): how the keyboard cursor and the hint drive the build preview. */
function downRay(x: number, z: number): THREE.Ray {
  return new THREE.Ray(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
}
/** A screen point as normalised device coordinates of the canvas (-1..1, y up). */
function ndcOf(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
}
/** The last mouse or pen position over the canvas, to refresh the build preview when the camera moves under it. */
let lastPointer: { clientX: number; clientY: number } | null = null;
function setNdc(e: { clientX: number; clientY: number }): void {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, iso.camera);
}
function twoFingers(): { d: number; a: number; mid: { clientX: number; clientY: number } } | null {
  const [p, q] = [...touches.values()];
  if (!p || !q) return null;
  return { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x), mid: { clientX: (p.x + q.x) / 2, clientY: (p.y + q.y) / 2 } };
}
/** Palette looks zoom in discrete steps, so a pinch fires a step each time it passes a threshold (Smooth follows the fingers). */
const PINCH_STEP = 1.3;
const TWIST_STEP = 0.5; // radians, about 30°
function onGesture(): void {
  const g = twoFingers();
  if (!g || !gesture) return;
  if (iso.continuous) {
    // Smooth: the town follows the fingers, anchored between them
    iso.zoomBy(g.d / gesture.d, ndcOf(g.mid));
    gesture.d = g.d;
  } else if (g.d > gesture.d * PINCH_STEP || g.d < gesture.d / PINCH_STEP) {
    zoomStep(g.d > gesture.d ? 1 : -1, ndcOf(g.mid));
    gesture.d = g.d;
  }
  let da = g.a - gesture.a;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) > TWIST_STEP) {
    // a clockwise twist (screen angle grows, y down) turns the street clockwise, which is rotate(+1)
    cameraStep(() => iso.rotate(da > 0 ? 1 : -1));
    gesture.a = g.a;
  }
}
function cancelLongPress(): void {
  if (longPress) window.clearTimeout(longPress.timer);
  if (!longPress?.fired) longPress = null;
}
function endPointer(e: PointerEvent): void {
  if (longPress) window.clearTimeout(longPress.timer);
  touches.delete(e.pointerId);
  if (touches.size < 2) gesture = null;
  if (touches.size === 0) gestured = false;
  if (drag?.id === e.pointerId) {
    drag = null;
    canvas.classList.remove('dragging');
  }
}
canvas.addEventListener('pointerdown', (e) => {
  kbCursor = null; // the pointer takes over from the keyboard cursor
  if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) {
    cancelLongPress();
    // second finger: stop panning, start a pinch/twist
    const g = twoFingers()!;
    gesture = { d: Math.max(1, g.d), a: g.a };
    gestured = true;
    drag = null;
    canvas.classList.remove('dragging');
    return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  if (e.pointerType === 'touch' && build.mode === 'view' && !photo) {
    const at = { clientX: e.clientX, clientY: e.clientY };
    longPress = {
      fired: false,
      timer: window.setTimeout(() => {
        if (!drag || drag.moved || touches.size !== 1) return;
        setNdc(at);
        const a = pickAgent();
        if (a && longPress) {
          longPress.fired = true;
          meet(a.p.id);
        }
      }, LONG_PRESS_MS),
    };
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* the pointer already went away (very short taps on some touch screens) */
  }
});
// A cancelled pointer (system gesture, palm rejection, alert) never sends pointerup: without this the
// next hover would keep panning as if the button were still held.
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') lastPointer = { clientX: e.clientX, clientY: e.clientY };
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture) {
    onGesture();
    return;
  }
  setNdc(e);
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (drag.moved || Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      cancelLongPress();
      canvas.classList.add('dragging');
      iso.panScreen(dx, dy, canvas.clientHeight);
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
    return;
  }
  if (build.mode !== 'view') build.pointer(ray.ray);
  else canvas.classList.toggle('pointing', pickAgent() !== null);
});
canvas.addEventListener('pointerup', (e) => {
  const wasDrag = drag?.moved || gestured;
  const mine = drag?.id === e.pointerId; // a press that began on the HUD and was released here is not a click
  const held = longPress?.fired;
  endPointer(e);
  longPress = null;
  if (wasDrag || !mine || held) return;
  if (photo) return; // photo mode is for looking: no cards, no building
  setNdc(e);
  if (build.mode !== 'view') {
    // Touch has no hover, so the first tap previews (ghost and ring) and a second tap on the same
    // spot commits: the same preview → validate → commit as a mouse, and no accidental removals.
    const before = build.targetKey();
    build.pointer(ray.ray);
    if (e.pointerType === 'mouse' || (before !== null && before === build.targetKey())) build.click();
    return;
  }
  const a = pickAgent();
  if (a) meet(a.p.id);
  else hud.closeCard();
});
/**
 * Wheel and trackpad zoom. Deltas are normalised (lines and pages to pixels), and the point under
 * the cursor stays put. A trackpad pinch arrives as a wheel event with ctrlKey set (Chrome,
 * Firefox, Edge): it zooms the town, with its own finer sensitivity, instead of the page. Browser
 * zoom stays on Ctrl/Cmd + and −. Palette looks step: scrolling adds up, a step fires past a
 * threshold, at most one per 0.25 s (the dissolve), and the total resets after 0.2 s of quiet, so a
 * trackpad burst or macOS momentum scrolling can't race through every level.
 */
const WHEEL_STEP_PX = 60;
const WHEEL_COOLDOWN_MS = 250;
const WHEEL_IDLE_MS = 200;
let wheelSum = 0;
let wheelLast = 0;
let wheelStepAt = 0;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dy = e.deltaY * unit;
    const anchor = ndcOf(e);
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (iso.continuous) {
      iso.zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), anchor);
      return;
    }
    const now = performance.now();
    if (now - wheelLast > WHEEL_IDLE_MS) wheelSum = 0;
    wheelLast = now;
    wheelSum += e.ctrlKey ? dy * 6 : dy;
    if (Math.abs(wheelSum) < WHEEL_STEP_PX || now - wheelStepAt < WHEEL_COOLDOWN_MS) return;
    zoomStep(wheelSum < 0 ? 1 : -1, anchor);
    wheelSum = 0;
    wheelStepAt = now;
  },
  { passive: false },
);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** Rotation and zoom are instant; the post pass dissolves from the old view so no frame shows geometry mid-slide. */
function cameraStep(change: () => void): void {
  if (!contextLost && !reducedMotion) post.beginDissolve(renderer); // reduced motion: a plain cut, no dissolve
  change();
}
/** One zoom step in or out, anchored at a screen point (default the centre). Smooth eases; palette looks step and dissolve. */
function zoomStep(dir: 1 | -1, anchor?: { x: number; y: number }): void {
  if (iso.continuous) iso.zoomBy(dir > 0 ? 1.25 : 1 / 1.25, anchor);
  else if (iso.canStep(dir)) cameraStep(() => iso.step(dir, anchor));
  hud.setZoom(iso.zoomGoal);
}
/** Fit Town (F, Home, or the button): centre the town and zoom to show all of it, or as much as the screen allows. */
function fitTown(dissolve = true): void {
  if (dissolve) cameraStep(() => iso.fit(FIT_POINTS, FIT_CENTRE));
  else iso.fit(FIT_POINTS, FIT_CENTRE);
  hud.setZoom(iso.zoomGoal);
}

function pickAgent(): Agent | null {
  const hits = ray.intersectObjects(residents.bodies, false);
  for (const h of hits) {
    const a = h.object.userData.agent as Agent | undefined;
    if (a && !a.hidden) return a;
  }
  // forgiving pick: nearest visible agent to the ground hit within 0.9 m
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9), p)) return null;
  let best: Agent | null = null;
  let bd = 0.9;
  for (const a of residents.agents) {
    if (a.hidden) continue;
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  // Leave browser and OS shortcuts alone: Ctrl+P prints, Cmd+R reloads, Ctrl+E searches...
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // Esc must work with focus on a Settings slider or checkbox too; every other key belongs to the control
  const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  if (inField && k !== 'escape') return;
  // Enter places at the keyboard cursor even with focus still on the item's button (it was chosen with Enter)
  if (k === 'enter' && kbCursor && build.mode !== 'view' && !photo && !hud.modalOpen) {
    e.preventDefault();
    build.click();
    return;
  }
  // Space and Enter on a focused button press that button (keyboard users rely on it); they don't pause
  if (t.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;
  if (k === 'escape') {
    // one layer per press: preview, panel, card, then photo mode, then the build tool
    if (hud.closeTopmost()) return;
    if (photo) hud.togglePhoto(false);
    else setTool('view');
    return;
  }
  if (hud.modalOpen) return; // the photo preview is up: only Esc (and Tab, inside it) act
  // holding a toggle key would flicker it on and off at the key-repeat rate
  if (e.repeat && ['b', 'x', 'delete', 'p', 'm', 'h', '?', ' '].includes(k)) {
    if (k === ' ') e.preventDefault();
    return;
  }
  // the HUD is hidden in photo mode: no building, and no help it can't show
  if (photo && ['b', 'x', 'delete', 'r', 'h', '?', 'n', 'l', 'enter'].includes(k)) return;
  // Build or remove by keyboard: arrows move a cursor on the ground (screen-aligned), Enter commits
  if (build.mode !== 'view' && (k.startsWith('arrow') || k === 'enter')) {
    e.preventDefault();
    if (k === 'enter') {
      if (kbCursor) build.click();
      return;
    }
    if (!kbCursor) kbCursor = { x: Math.round(iso.target.x * 2) / 2, z: Math.round(iso.target.z * 2) / 2 };
    else {
      const step = 0.5;
      const sx = k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0;
      const sy = k === 'arrowup' ? 1 : k === 'arrowdown' ? -1 : 0;
      // screen right and screen up, flattened onto the ground for the current camera yaw
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(iso.camera.quaternion).setY(0).normalize();
      const up = new THREE.Vector3(0, 0, -1).applyQuaternion(iso.camera.quaternion).setY(0).normalize();
      kbCursor.x = Math.max(GROUND.x0, Math.min(GROUND.x1, kbCursor.x + (right.x * sx + up.x * sy) * step));
      kbCursor.z = Math.max(GROUND.z0, Math.min(GROUND.z1, kbCursor.z + (right.z * sx + up.z * sy) * step));
    }
    build.pointer(downRay(kbCursor.x, kbCursor.z));
    iso.targetGoal.set(kbCursor.x, iso.targetGoal.y, kbCursor.z); // keep the cursor in view
    return;
  }
  const pan = 40;
  if (k === 'q') cameraStep(() => iso.rotate(-1));
  else if (k === 'e') cameraStep(() => iso.rotate(1));
  else if (k === '=' || k === '+' || k === 'z') zoomStep(1);
  else if (k === '-' || k === 'c') zoomStep(-1);
  else if (k === 'f' || k === 'home') fitTown();
  else if (k === 'w' || k === 'arrowup') iso.panScreen(0, pan, canvas.clientHeight);
  else if (k === 's' || k === 'arrowdown') iso.panScreen(0, -pan, canvas.clientHeight);
  else if (k === 'a' || k === 'arrowleft') iso.panScreen(pan, 0, canvas.clientHeight);
  else if (k === 'd' || k === 'arrowright') iso.panScreen(-pan, 0, canvas.clientHeight);
  else if (k === ' ') {
    e.preventDefault();
    clock.paused = !clock.paused;
    hud.setSpeed(clock.speed, clock.paused);
  } else if (k >= '1' && k <= '4') clock.jumpTo([5.8, 12, 17.9, 21.5][Number(k) - 1]!);
  else if (k === 'b') setTool(build.mode === 'build' ? 'view' : 'build');
  else if (k === 'x' || k === 'delete') setTool(build.mode === 'remove' ? 'view' : 'remove');
  else if (k === 'r') build.rotate();
  else if (k === 'm') void hud.toggleSound();
  else if (k === 'p') hud.togglePhoto(!photo);
  else if (k === 'h' || k === '?') hud.toggleHelp();
  else if (k === 'n') hud.toggleNotes();
  else if (k === 'l') hud.togglePeople();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
  // a hidden tab goes quiet and stops all audio work; it comes back where it would be
  void sound.setHidden(document.hidden);
});
// a gesture is the browser's permission to restart audio it interrupted (a phone call, the OS)
window.addEventListener('pointerdown', () => sound.retry(), { passive: true });
window.addEventListener('pagehide', persist);

// ── Seeded start (?seed&hour&season&weather&freeze) ─────────────────────────
let time = 0;
if (params.season) clock.season = params.season;
if (params.weather) {
  world.weather.setMode(params.weather);
  world.weather.rain = world.weather.wetness = params.weather === 'rain' ? 1 : 0;
  hud.setWeather(params.weather);
}
if (params.scripted) {
  // every scripted run warms up, so lamp levels, weather and routines have settled even without &hour
  const hour = params.hour ?? clock.hour;
  const placed = () => build.placedSmart();
  time = warmUp({ clock, world, residents, animals, placed }, warmupStart(hour, 3), hour);
}
/** Frozen runs render the same frame forever: no sim, no animation time, no clock. */
let frozen = params.freeze;
if (frozen) {
  clock.paused = true;
  hud.setSpeed(clock.speed, clock.paused);
}

// ── Loop ──────────────────────────────────────────────────────────────────
let last = performance.now();
let frames = 0;
let slow = 0;
let saveTimer = 0;
let prevHour = clock.hour;
let wasRaining = world.weather.rain > 0.3;

function renderFrame(dt: number): void {
  iso.update(dt);
  post.render(renderer, world.scene, iso.camera, time, world.weather.wind, dt);
}

const lastCam = new THREE.Vector3();
let lastHalfH = 0;
function cameraMoved(): boolean {
  const moved = !lastCam.equals(iso.camera.position) || lastHalfH !== iso.halfH;
  lastCam.copy(iso.camera.position);
  lastHalfH = iso.halfH;
  return moved;
}

// ── First-minutes hints and the card's leader line ──────────────────────
/** Open grass near the pond where a first bench looks at home; the first that is free gets the sparkle. */
const HINT_SPOTS: [number, number][] = [
  [-2.5, 6.5],
  [1.5, 6.8],
  [-5, 4.5],
  [4.5, 5.5],
  [-1, -1.5],
  [3, -2],
];
let hintStep: 'bench' | 'meet' | null = null;
function updateHints(dt: number): void {
  const step = photo ? null : tutorial.update(dt);
  if (step === 'bench' && !hintSpot) {
    const free = HINT_SPOTS.find(([x, z]) => build.canPlace('bench', x, z, { ignoreResidents: true }));
    hintSpot = free ? { x: free[0], z: free[1] } : null;
  }
  if (step !== hintStep) {
    hintStep = step;
    hud.setHint(step);
    if (step === 'bench') residents.guaranteeNext = true;
  }
}
const tmpV = new THREE.Vector3();
/** World point → HUD pixels, or null when it is off the canvas. */
function toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
  tmpV.set(x, y, z).project(iso.camera);
  if (tmpV.z > 1 || Math.abs(tmpV.x) > 1 || Math.abs(tmpV.y) > 1) return null;
  const r = canvas.getBoundingClientRect(),
    h = hudRoot.getBoundingClientRect();
  return { x: r.left - h.left + ((tmpV.x + 1) / 2) * r.width, y: r.top - h.top + ((1 - tmpV.y) / 2) * r.height };
}
function placeOverlays(): void {
  if (hintStep === 'bench') hud.placeHint(hintSpot ? toScreen(hintSpot.x, groundHeight(hintSpot.x, hintSpot.z) + 0.2, hintSpot.z) : null);
  const id = hud.openCardId;
  if (id) {
    const a = residents.agents.find((g) => g.p.id === id);
    hud.placeCard(a && !a.hidden ? toScreen(a.x, a.root.position.y + 2.05, a.z) : null);
  }
}

/** The post pass's sky and atmosphere for a sky state (every frame, and for a memory's hour). */
function applySky(sky: SkyState, rain: number): void {
  post.set({
    bgTop: sky.top,
    bgBottom: sky.bottom,
    mistColor: sky.bottom,
    stars: sky.stars,
    moon: sky.isNight ? 1 - rain : 0,
    exposure: sky.exposure,
    cloudShadow: (0.3 + rain * 0.4) * Math.min(1, sky.sunI * 1.2),
    bgClouds: sky.clouds,
    mist: rain,
    glow: 0.6 + sky.lamp * 0.9,
  });
}

/** Memory panels: 3:2, small (the journal shows three side by side). */
const MEMORY_W = 360,
  MEMORY_H = 240;
/** Wide, closer, the moment: magnification, look-at height, and a quarter turn for the close-up. */
const MEMORY_CUTS = [
  { mag: 1, y: 3.9, turn: 0 },
  { mag: 2, y: 2, turn: 0 },
  { mag: 3, y: 1, turn: 1 },
] as const;

/**
 * Render one cut of a memory from its snapshot: the world is put into the memory's hour, weather
 * and season, with the objects that were there and only the residents involved, where they stood;
 * rendered offscreen; then put back, all inside this call, so no frame of it is ever shown (nobody
 * visible moves). The panel matches the player's current look and Film Diffusion.
 */
function renderMemory(m: Memory, cut: 0 | 1 | 2): string | null {
  if (contextLost) return null;
  const snap = m.snapshot;
  const c = MEMORY_CUTS[cut];
  const cam = { yaw: iso.yaw, zoom: iso.zoom, goal: iso.zoomGoal, t: iso.target.clone(), tg: iso.targetGoal.clone(), bounds: iso.bounds };
  const weather = { rain: world.weather.rain, wet: world.weather.wetness, lamp: world.lampLevel };
  const people = residents.agents.map((a) => ({ a, visible: a.root.visible, pos: a.root.position.clone() }));
  const hidden: THREE.Object3D[] = [];
  const unstage: (() => void)[] = [];
  let url: string | null;
  try {
    build.clearPreview();
    const ids = new Set(snap.objects.map((o) => o.id));
    for (const p of build.placed.values())
      if (!ids.has(p.id) && p.object.visible) {
        p.object.visible = false; // placed after the memory: it wasn't there
        hidden.push(p.object);
      }
    for (const o of snap.objects) if (!build.placed.has(o.id) && o.kind in PLACEABLES) unstage.push(build.stage({ ...o, kind: o.kind as PlaceableKind }));
    for (const { a } of people) a.root.visible = false;
    for (const p of snap.people) {
      const a = residents.agents.find((g) => g.p.id === p.id);
      if (!a) continue;
      a.root.visible = true;
      a.root.position.set(p.x, groundHeight(p.x, p.z), p.z);
    }
    const then = new WorldClock(0);
    then.minutes = snap.minutes;
    then.season = snap.season;
    world.weather.rain = world.weather.wetness = snap.rain;
    const sky = skyAt(then.hour, snap.rain, snap.season);
    world.lampLevel = sky.lamp;
    world.update(0, time, then, sky, 0);
    applySky(sky, snap.rain);
    iso.bounds = null;
    for (let i = 0; i < c.turn; i++) iso.rotate(1);
    iso.setZoomNow(c.mag);
    iso.target.set(snap.focus.x, c.y, snap.focus.z);
    iso.targetGoal.copy(iso.target);
    url = captureFrame(MEMORY_W, MEMORY_H);
  } finally {
    for (const o of hidden) o.visible = true;
    for (const f of unstage) f();
    for (const { a, visible, pos } of people) {
      a.root.visible = visible;
      a.root.position.copy(pos);
    }
    world.weather.rain = weather.rain;
    world.weather.wetness = weather.wet;
    world.lampLevel = weather.lamp;
    iso.yaw = cam.yaw;
    iso.bounds = cam.bounds;
    iso.setZoomNow(cam.zoom);
    iso.zoomGoal = cam.goal;
    iso.target.copy(cam.t);
    iso.targetGoal.copy(cam.tg);
    resize(); // the screen's layout again; the next frame puts back the real hour, sky and season
  }
  return url;
}

// ── Context loss ──────────────────────────────────────────────────────────
// Pause on loss (preventDefault lets the browser restore), rebuild GPU-side state on restore, resume.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  persist();
});
canvas.addEventListener('webglcontextrestored', () => {
  post.rebuildAfterContextLoss(renderer);
  // dropped, not disposed (its GL objects died with the old context); three allocates a fresh one
  world.sun.shadow.map = null;
  contextLost = false;
  last = performance.now();
  schedule();
});

/** One loop only: a restore that lands while a pre-loss frame is still queued must not start a second. */
let rafId = 0;
function schedule(): void {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function frame(now: number): void {
  rafId = 0;
  if (contextLost) return; // the restore handler restarts the loop
  const t0 = performance.now();
  debug?.beginFrame();
  const realDt = Math.min((now - last) / 1000, 0.05);
  const dt = frozen ? 0 : realDt;
  last = now;
  time += dt;
  const gm = clock.tick(dt);
  const hour = clock.hour;
  const rain = world.weather.rain;
  const sky = skyAt(hour, rain, clock.season);
  world.update(dt, time, clock, sky, gm);
  const s0 = performance.now();
  if (!frozen) {
    residents.update(dt, gm, hour, rain, time);
    animals.update(dt, time, hour, rain, clock.season, residents.agents);
  }
  let simMs = performance.now() - s0;

  applySky(sky, rain);

  // once-a-second systems
  slow += realDt;
  if (slow > 1) {
    slow = 0;
    const n0 = performance.now();
    if (!frozen) residents.noticePass(build.placedSmart(), hour);
    simMs += performance.now() - n0;
    sound.update(hour, rain, clock.season);
    hud.setClock(clock.label(), clock.day, clock.season);
    hud.refreshCard();
    hud.renderPeople();
    if (photo) hud.setZoom(iso.zoomGoal); // the photo slider follows wheel and pinch zoom too
    const raining = rain > 0.3;
    if (raining !== wasRaining) {
      wasRaining = raining;
      const snow = clock.season === 'winter';
      bus.emit('story', { msg: msg(raining ? (snow ? 'story.snowStart' : 'story.rainStart') : snow ? 'story.snowStop' : 'story.rainStop') });
    }
  }
  // temple bell at 6:00 and 18:00
  for (const h of [6, 18]) {
    if (prevHour < h && hour >= h && hour - prevHour < 1) {
      sound.bell();
      bus.emit('story', { msg: msg(h === 6 ? 'story.bellMorning' : 'story.bellEvening') });
    }
  }
  prevHour = hour;
  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    persist();
  }
  if (!frozen) updateHints(realDt);
  renderFrame(realDt);
  // the camera moved under a still mouse (a smooth zoom, a pan settling): keep the build preview under the cursor
  if (build.mode !== 'view' && lastPointer && !kbCursor && !photo && cameraMoved()) {
    setNdc(lastPointer);
    build.pointer(ray.ray);
  }
  placeOverlays();
  frames++;
  debug?.endFrame(now, performance.now() - t0, simMs, iso.camera, residents.agents);
  schedule();
}
hud.setClock(clock.label(), clock.day, clock.season);
schedule();
// started cleanly: a later failure gets its own fresh retries
try {
  sessionStorage.removeItem(WEBGL_RETRIES_KEY);
} catch {
  /* storage unavailable */
}
if (!params.scripted) {
  const h = clock.hour;
  const when = h < 5 || h >= 21 ? 'night' : h < 7 ? 'dawn' : h < 11 ? 'morning' : h < 15 ? 'day' : h < 18.5 ? 'afternoon' : 'evening';
  bus.emit('story', { msg: msg(`story.start.${when}` as MsgKey), fleeting: true });
}

/** What `__komorebi.freeze()` can pin. Anything left out keeps its current value. */
interface FreezeSpec {
  hour?: number;
  season?: Season;
  weather?: 'clear' | 'rain';
  /** Shader and animation time, seconds (drives water ripples, cloud drift, sway phase). */
  time?: number;
  /** Camera look-at point, world units. */
  target?: [number, number, number];
  /** Legacy magnification index: 0 = 1×, 1 = 2×, 2 = 3×. */
  zoom?: number;
  /** Magnification, 0.8–3 (any value; the palette looks normally use ZOOM_STEPS). */
  mag?: number;
  /** Camera yaw, radians (π/4 is the default view). */
  yaw?: number;
}

/**
 * Pin everything that moves so a frame reproduces exactly: the clock, residents,
 * animals and weather particles stop, and shader time and cloud drift are fixed.
 * Changing hour/season/weather here does not re-run the warm-up, so for settled lamps
 * and routines load the seeded URL at the same hour first (docs/CONTRIBUTING.md).
 */
function freeze(o: FreezeSpec = {}): void {
  frozen = true;
  clock.paused = true;
  hud.setSpeed(clock.speed, clock.paused);
  if (o.season) clock.season = o.season;
  if (o.hour !== undefined) clock.setHour(o.hour);
  if (o.weather) {
    world.weather.setMode(o.weather);
    world.weather.rain = world.weather.wetness = o.weather === 'rain' ? 1 : 0;
    hud.setWeather(o.weather);
  }
  if (o.time !== undefined) time = o.time;
  if (o.yaw !== undefined) iso.yaw = o.yaw;
  if (o.zoom !== undefined) iso.setZoomIndex(o.zoom);
  if (o.mag !== undefined) iso.setZoomNow(o.mag);
  if (o.target) {
    iso.target.set(...o.target);
    iso.targetGoal.set(...o.target);
  }
}

// handy for debugging and for automated visual tests
Object.assign(window, {
  __komorebi: {
    freeze,
    setDiffusion,
    /** Switch the pixel preset (as the Settings buttons do), for scripted screenshots. */
    setPixel: (p: PixelPreset) => {
      pixel = p;
      hud.setPixel(p);
      resize();
    },
    clock,
    world,
    residents,
    build,
    sound,
    tutorial,
    memories,
    bus,
    iso,
    grid,
    renderer,
    post,
    debug,
    params,
    get frames() {
      return frames;
    },
  },
});
