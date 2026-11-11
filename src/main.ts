import * as THREE from 'three';
import { EventBus, type GameEvents } from './core/events';
import { WorldClock, type Season } from './core/clock';
import { IsoCamera } from './render/camera';
import { canvasLayout, DEFAULT_PIXEL, usesPalette, type PixelPreset } from './render/pixelscale';
import { PostPass } from './render/post';
import { PALETTE } from './render/palette';
import { skyAt } from './render/sky';
import { World } from './world/world';
import { GROUND, OBSTACLES } from './world/layout';
import { groundHeight, isWalkableSurface } from './world/terrain';
import { NavGrid } from './sim/grid';
import { SmartRegistry, registerStaticObjects } from './sim/smart';
import { Residents, type Agent } from './sim/residents';
import { Animals } from './sim/animals';
import { BuildTool, type ToolMode } from './ui/build';
import { Hud } from './ui/hud';
import { DebugOverlay } from './ui/debug';
import { Sound } from './audio/sound';
import { load, save, SAVE_VERSION, DEFAULT_MINUTES } from './save/storage';
import { PLACEABLES, type PlaceableKind } from './world/props';
import { parseLaunchParams, warmupStart } from './core/params';
import { warmUp } from './sim/warmup';
import { DEFAULT_DIFFUSION, diffusionOutputSize } from './render/diffusion';

// ── Boot ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
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
      const msg = document.createElement('p');
      msg.className = 'webgl-failed';
      msg.textContent = 'Komorebi-chō couldn’t start 3D graphics in this browser. Try reloading, or another browser.';
      document.getElementById('app')?.append(msg);
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
const params = parseLaunchParams(location.search);
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
// Scripted (seeded) runs neither restore nor overwrite the player's save.
const saved = params.scripted ? null : load();
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
  world.reducedMotion = saved.settings.reducedMotion;
  diffusionSetting = saved.settings.diffusion;
  diffusion = params.diffusion ?? diffusionSetting;
} else if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
  world.reducedMotion = true; // a new player who asked their OS for less motion gets it here too
}
let reducedMotion = world.reducedMotion;
build.reducedMotion = reducedMotion;
function persist(): void {
  if (params.scripted) return;
  save({
    version: SAVE_VERSION,
    minutes: clock.minutes,
    season: clock.season,
    weather: world.weather.mode,
    placed: build.records(),
    memory: residents.memory(),
    settings: { pixel: pixelSetting, music: sound.musicVolume, ambience: sound.ambienceVolume, reducedMotion, diffusion: diffusionSetting },
  });
}

// ── UI ────────────────────────────────────────────────────────────────────
const setTool = (m: ToolMode, k?: PlaceableKind) => {
  build.setMode(m, k);
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
    bus.emit('story', { text: seasonLine(s) });
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
  setVolumes: (m, a) => {
    sound.musicVolume = m;
    sound.ambienceVolume = a;
    sound.applyVolumes();
  },
  setReducedMotion: (v) => {
    reducedMotion = v;
    world.reducedMotion = v;
    build.reducedMotion = v;
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
    bus.emit('story', { text: 'The neighbourhood is as it was.' });
  },
});
hud.setSpeed(clock.speed, clock.paused);
hud.setVolumes(sound.musicVolume, sound.ambienceVolume);
hud.setReducedMotion(reducedMotion);
hud.setSeason(clock.season);
hud.setWeather(world.weather.mode);
hud.setTool('view', build.kind);
hud.setPixel(pixel);
hud.setDiffusion(diffusion);

function seasonLine(s: Season): string {
  return {
    spring: 'Sakura season. Petals in the gutters.',
    summer: 'Summer. The cicadas have opinions.',
    autumn: 'Autumn. The maples are showing off.',
    winter: 'Winter. Quiet, and the bath smoke hangs low.',
  }[s];
}

bus.on('story', ({ text }) => hud.story(text));
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
resize();

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
/** Zoom and rotation are discrete steps, so gestures fire a step each time they pass a threshold. */
const PINCH_STEP = 1.3;
const TWIST_STEP = 0.5; // radians, about 30°
function onGesture(): void {
  const g = twoFingers();
  if (!g || !gesture) return;
  if (g.d > gesture.d * PINCH_STEP || g.d < gesture.d / PINCH_STEP) {
    setNdc(g.mid);
    const hit = new THREE.Vector3();
    const focus = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1), hit) ? hit : undefined;
    zoomStep(g.d > gesture.d ? 1 : -1, focus);
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
function endPointer(e: PointerEvent): void {
  touches.delete(e.pointerId);
  if (touches.size < 2) gesture = null;
  if (touches.size === 0) gestured = false;
  if (drag?.id === e.pointerId) {
    drag = null;
    canvas.classList.remove('dragging');
  }
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) {
    // second finger: stop panning, start a pinch/twist
    const g = twoFingers()!;
    gesture = { d: Math.max(1, g.d), a: g.a };
    gestured = true;
    drag = null;
    canvas.classList.remove('dragging');
    return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
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
  endPointer(e);
  if (wasDrag || !mine) return;
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
  if (a) {
    hud.openCard(() => residents.info(a));
    bus.emit('sfx', { name: 'click' });
  } else hud.closeCard();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
    const hit = new THREE.Vector3();
    ray.ray.intersectPlane(plane, hit);
    zoomStep(e.deltaY < 0 ? 1 : -1, hit);
  },
  { passive: false },
);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** Rotation and zoom are instant; the post pass dissolves from the old view so no frame shows geometry mid-slide. */
function cameraStep(change: () => void): void {
  if (!contextLost) post.beginDissolve(renderer);
  change();
}
function zoomStep(dir: 1 | -1, focus?: THREE.Vector3): void {
  if (iso.canZoom(dir)) cameraStep(() => iso.zoom(dir, focus));
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
  if (photo && ['b', 'x', 'delete', 'r', 'h', '?'].includes(k)) return;
  const pan = 40;
  if (k === 'q') cameraStep(() => iso.rotate(-1));
  else if (k === 'e') cameraStep(() => iso.rotate(1));
  else if (k === '=' || k === '+' || k === 'z') zoomStep(1);
  else if (k === '-' || k === 'c') zoomStep(-1);
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
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});
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
    const raining = rain > 0.3;
    if (raining !== wasRaining) {
      wasRaining = raining;
      const snow = clock.season === 'winter';
      bus.emit('story', {
        text: raining
          ? snow
            ? 'Snow begins to fall.'
            : 'It starts to rain. Umbrellas bloom.'
          : snow
            ? 'The snow eases off.'
            : 'The rain stops. Everything shines.',
      });
    }
  }
  // temple bell at 6:00 and 18:00
  for (const h of [6, 18]) {
    if (prevHour < h && hour >= h && hour - prevHour < 1) {
      sound.bell();
      bus.emit('story', { text: h === 6 ? 'The temple bell rings in the morning.' : 'The evening bell. Time to head home.' });
    }
  }
  prevHour = hour;
  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    persist();
  }
  renderFrame(realDt);
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
if (!params.scripted) bus.emit('story', { text: 'Late afternoon in Komorebi-chō.' });

/** What `__komorebi.freeze()` can pin. Anything left out keeps its current value. */
interface FreezeSpec {
  hour?: number;
  season?: Season;
  weather?: 'clear' | 'rain';
  /** Shader and animation time, seconds (drives water ripples, cloud drift, sway phase). */
  time?: number;
  /** Camera look-at point, world units. */
  target?: [number, number, number];
  /** Magnification index: 0 = 1×, 1 = 2×, 2 = 3×. */
  zoom?: number;
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
