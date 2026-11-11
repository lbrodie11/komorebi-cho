import * as THREE from 'three';
import { EventBus, type GameEvents } from './core/events';
import { WorldClock, type Season } from './core/clock';
import { IsoCamera } from './render/camera';
import { canvasLayout, type PixelPreset } from './render/pixelscale';
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
import { load, save, clearSave, SAVE_VERSION } from './save/storage';
import type { PlaceableKind } from './world/props';
import { parseLaunchParams, warmupStart } from './core/params';
import { warmUp } from './sim/warmup';

// ── Boot ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// DPR is handled explicitly in resize(): the drawing buffer is the render target size (pixel ratio 1),
// and the canvas's CSS box is sized so the browser upscales by an exact integer in device pixels.
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
// One hard tap per pixel: shadow edges get their softness from the dither + palette snap, not PCF noise.
renderer.shadowMap.type = THREE.BasicShadowMap;
const params = parseLaunchParams(location.search);
const debug = params.debug ? new DebugOverlay(document.getElementById('app') as HTMLElement, renderer) : null;

const bus = new EventBus<GameEvents>();
const clock = new WorldClock(16.6);
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

let pixel: PixelPreset = 'classic';
let photo = false;

// ── Persistence ───────────────────────────────────────────────────────────
// Scripted (seeded) runs neither restore nor overwrite the player's save.
const saved = params.scripted ? null : load();
if (saved) {
  clock.minutes = saved.minutes;
  clock.season = saved.season;
  world.weather.setMode(saved.weather);
  for (const r of saved.placed) if (build.canPlace(r.kind, r.x, r.z)) build.place(r, false);
  residents.restoreMemory(saved.memory);
  pixel = saved.settings.pixel;
  sound.musicVolume = saved.settings.music;
  sound.ambienceVolume = saved.settings.ambience;
  world.reducedMotion = saved.settings.reducedMotion;
}
let reducedMotion = world.reducedMotion;
function persist(): void {
  if (params.scripted) return;
  save({
    version: SAVE_VERSION,
    minutes: clock.minutes,
    season: clock.season,
    weather: world.weather.mode,
    placed: build.records(),
    memory: residents.memory(),
    settings: { pixel, music: sound.musicVolume, ambience: sound.ambienceVolume, reducedMotion },
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
  photo: (on) => {
    photo = on;
    if (on) setTool('view');
  },
  capture: () => {
    bus.emit('sfx', { name: 'shutter' });
    renderFrame(0);
    const up = document.createElement('canvas');
    const k = 4;
    up.width = canvas.width * k;
    up.height = canvas.height * k;
    const ctx = up.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, up.width, up.height);
    return Promise.resolve(up.toDataURL('image/png'));
  },
  setPixel: (p) => {
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
  },
  reset: () => {
    for (const r of build.records()) build.remove(r.id);
    clearSave();
    bus.emit('story', { text: 'The neighbourhood is as it was.' });
  },
});
hud.setSpeed(clock.speed, clock.paused);
hud.setWeather(world.weather.mode);
hud.setTool('view', build.kind);
hud.setPixel(pixel);

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

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const l = canvasLayout(devW, devH, dpr, pixel);
  Object.assign(canvas.style, { width: `${l.cssW}px`, height: `${l.cssH}px`, left: `${l.cssLeft}px`, top: `${l.cssTop}px` });
  renderer.setSize(l.rw, l.rh, false);
  post.setSize(l.rw, l.rh);
  iso.setViewport(l.rw, l.rh);
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
function setNdc(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, iso.camera);
}
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  setNdc(e);
  if (drag) {
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
  const wasDrag = drag?.moved;
  drag = null;
  canvas.classList.remove('dragging');
  if (wasDrag) return;
  setNdc(e);
  if (build.mode !== 'view') {
    build.pointer(ray.ray);
    build.click();
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
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
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
  else if (k === 'm') void sound.toggle();
  else if (k === 'p') hud.togglePhoto(!photo);
  else if (k === 'escape') {
    if (photo) hud.togglePhoto(false);
    setTool('view');
    hud.closeCard();
  }
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
const frozen = params.freeze;
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
  post.rebuildAfterContextLoss();
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
if (!params.scripted) bus.emit('story', { text: 'Late afternoon in Komorebi-chō.' });

// handy for debugging and for automated visual tests
Object.assign(window, {
  __komorebi: {
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
