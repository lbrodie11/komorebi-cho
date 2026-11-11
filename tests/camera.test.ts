import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { IsoCamera, MAX_ZOOM, MIN_ZOOM, PHONE_MIN_ZOOM, ZOOM_STEPS, minZoomFor, viewRange } from '../src/render/camera';
import { canvasLayout, presentOffset, type CanvasLayout } from '../src/render/pixelscale';
import { G, GROUND, PLINTH } from '../src/world/layout';
import { townOutline } from '../src/world/world';

/** The ground point (y = 0) under a screen point, after the camera settles. */
function groundUnder(cam: IsoCamera, ndc: { x: number; y: number }): THREE.Vector3 {
  cam.update(0);
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam.camera);
  const p = new THREE.Vector3();
  r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
  return p;
}
function make(aspect = 16 / 9, continuous = false): IsoCamera {
  const c = new IsoCamera();
  c.setViewport(Math.round(540 * aspect), 540);
  c.continuous = continuous;
  c.instant = true; // no easing in tests unless asked
  c.update(0);
  return c;
}
const FIT = [GROUND.x0, GROUND.x1].flatMap((x) => [GROUND.z0, GROUND.z1].flatMap((z) => [new THREE.Vector3(x, G, z), new THREE.Vector3(x, G - PLINTH.h, z)]));
FIT.push(new THREE.Vector3(-14.9, 14.8, -11.9));
const CENTRE = new THREE.Vector3(0, 3.9, 0);
/** The town for the pan bounds: the plinth and its tallest point (the bathhouse chimney at the back). */
const OUTLINE = FIT;

/** Where a world point is displayed, device px: the snapped render, upscaled, shifted by the presentation offset. */
function displayed(c: IsoCamera, l: CanvasLayout, dpr: number, p: THREE.Vector3): { x: number; y: number } {
  const v = p.clone().project(c.camera);
  const o = presentOffset(c.subpixel, l, dpr);
  return { x: ((v.x + 1) / 2) * l.bw * l.sx + o.x * dpr, y: ((1 - v.y) / 2) * l.bh * l.sy + o.y * dpr };
}
/** A Retina laptop (1440×900 CSS at 2×) in the given look, with the one-pixel overscan. */
function laptop(look: 'smooth' | 'classic'): { c: IsoCamera; l: CanvasLayout } {
  const l = canvasLayout(2880, 1800, 2, look, 1);
  const c = new IsoCamera();
  c.setViewport(l.rw, l.rh, l.margin);
  c.continuous = look === 'smooth';
  c.update(0);
  return { c, l };
}
/** The world point under an NDC point of the whole (overscanned) canvas, on a plane at y = 0.2. */
function pointAt(c: IsoCamera, ndc: { x: number; y: number }): THREE.Vector3 {
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), c.camera);
  const p = new THREE.Vector3();
  r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2), p);
  return p;
}

describe('camera zoom', () => {
  it('steps through 0.65×, 0.8×, 1×, 1.5×, 2×, 3× in the palette looks, and stops at the ends', () => {
    const c = make();
    c.setZoomNow(MIN_ZOOM);
    const seen = [c.zoom];
    while (c.canStep(1)) {
      c.step(1);
      seen.push(c.zoom);
    }
    expect(seen).toEqual(ZOOM_STEPS.filter((z) => z >= MIN_ZOOM)); // 0.5× is for narrow screens only
    expect(c.canStep(1)).toBe(false);
    c.setZoomNow(MIN_ZOOM);
    expect(c.canStep(-1)).toBe(false);
  });

  it('lets a portrait phone zoom out further than a landscape screen, and comes back in when it turns', () => {
    expect(minZoomFor(16 / 9)).toBe(MIN_ZOOM);
    expect(minZoomFor(1)).toBe(MIN_ZOOM);
    expect(minZoomFor(390 / 844)).toBe(PHONE_MIN_ZOOM);
    expect(minZoomFor(0.8)).toBeLessThan(MIN_ZOOM);
    for (const continuous of [false, true]) {
      const phone = make(390 / 844, continuous);
      phone.setZoomNow(0.01);
      expect(phone.zoom).toBe(PHONE_MIN_ZOOM);
      if (!continuous) expect(phone.steps[0]).toBe(0.5);
      // Fit on a phone: the town never fits, so its widest view
      expect(phone.fitZoom(FIT, CENTRE)).toBe(PHONE_MIN_ZOOM);
      // turned to landscape: it comes in to that screen's widest
      phone.setViewport(960, 540);
      expect(phone.zoom).toBe(PHONE_MIN_ZOOM); // a capture at another size leaves it alone...
      phone.fitZoomRange(); // ...the screen itself turning doesn't
      expect(phone.zoom).toBe(MIN_ZOOM);
      expect(phone.zoomGoal).toBe(MIN_ZOOM);
    }
  });

  it('keeps the point under the cursor in place, zooming in and out (stepped and smooth)', () => {
    for (const continuous of [false, true]) {
      const c = make(16 / 9, continuous);
      const a = { x: 0.5, y: -0.3 };
      const before = groundUnder(c, a);
      if (continuous) c.zoomBy(1.7, a);
      else c.step(1, a);
      c.update(0);
      expect(groundUnder(c, a).distanceTo(before)).toBeLessThan(0.15);
      const mid = groundUnder(c, a);
      if (continuous) c.zoomBy(1 / 1.7, a);
      else c.step(-1, a);
      expect(groundUnder(c, a).distanceTo(mid)).toBeLessThan(0.15);
    }
  });

  it('never recentres just because it zoomed back out to 1×', () => {
    const c = make();
    c.step(1, { x: 0.6, y: 0.2 });
    const t = c.targetGoal.clone();
    c.step(-1); // centre-anchored: no shift
    expect(c.targetGoal.distanceTo(t)).toBeLessThan(1e-6);
  });

  it('eases smooth zoom in log space, settling in about 200 ms whichever way it goes', () => {
    for (const goal of [3, 0.8]) {
      const c = make(16 / 9, true);
      c.instant = false;
      c.zoomTo(goal);
      for (let i = 0; i < 12; i++) c.update(1 / 60); // 0.2 s
      expect(Math.abs(Math.log(c.zoom / goal))).toBeLessThan(0.05 * Math.abs(Math.log(goal)));
    }
  });

  it('clamps to 0.65×..3×', () => {
    const c = make(16 / 9, true);
    c.zoomTo(50);
    expect(c.zoomGoal).toBe(MAX_ZOOM);
    c.zoomTo(0.01);
    expect(c.zoomGoal).toBe(MIN_ZOOM);
    c.pinchBy(100, { x: 0, y: 0 });
    expect(c.zoom).toBe(MAX_ZOOM);
  });

  it('pinches at once: no easing lag behind the fingers, the point between them held', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    const a = { x: -0.4, y: 0.35 };
    const before = groundUnder(c, a);
    for (let i = 0; i < 20; i++) c.pinchBy(1.04, a);
    expect(c.zooming).toBe(false); // nothing left to ease: the zoom is already where the fingers put it
    expect(c.zoom).toBeCloseTo(1.04 ** 20, 9);
    expect(groundUnder(c, a).distanceTo(before)).toBeLessThan(0.1);
  });
});

describe('sub-pixel presentation (no pixel jumping)', () => {
  it('shows every point exactly where the unsnapped camera would, to a device pixel, at any pan and zoom', () => {
    for (const look of ['smooth', 'classic'] as const) {
      const { c, l } = laptop(look);
      const ideal = new IsoCamera();
      ideal.setViewport(l.rw, l.rh, l.margin);
      const p = new THREE.Vector3(3.3, 1.2, -2.7);
      let worst = 0;
      for (let i = 0; i < 400; i++) {
        const z = MIN_ZOOM + ((i * 0.618) % 1) * (MAX_ZOOM - MIN_ZOOM);
        c.continuous = true;
        c.setZoomNow(z);
        c.target.set(Math.sin(i) * 6, 3.9, Math.cos(i * 1.3) * 5);
        c.targetGoal.copy(c.target);
        c.update(0);
        // the same view without the snap: what the player should see
        ideal.setZoomNow(z);
        ideal.target.copy(c.target);
        ideal.targetGoal.copy(c.target);
        ideal.update(0);
        ideal.camera.position.set(
          c.target.x + 160 * Math.cos(c.pitch) * Math.sin(c.yaw),
          c.target.y + 160 * Math.sin(c.pitch),
          c.target.z + 160 * Math.cos(c.pitch) * Math.cos(c.yaw),
        );
        ideal.camera.lookAt(c.target);
        ideal.camera.updateMatrixWorld();
        const v = p.clone().project(ideal.camera);
        const want = { x: ((v.x + 1) / 2) * l.bw * l.sx, y: ((1 - v.y) / 2) * l.bh * l.sy };
        const got = displayed(c, l, 2, p);
        worst = Math.max(worst, Math.abs(got.x - want.x), Math.abs(got.y - want.y));
        expect(Math.abs(c.subpixel.x)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(c.subpixel.y)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
      expect(worst, look).toBeLessThanOrEqual(0.5 + 1e-6); // only the rounding to whole device pixels
    }
  });

  it('holds the point under the cursor through a stream of wheel ticks without wobbling', () => {
    const { c, l } = laptop('smooth');
    let worst = 0,
      reversals = 0;
    for (let trial = 0; trial < 60; trial++) {
      c.setZoomNow(1);
      c.target.set(0, 3.9, 0);
      c.targetGoal.copy(c.target);
      c.update(0);
      const a = { x: Math.sin(trial * 1.7) * 0.6, y: Math.cos(trial * 2.3) * 0.5 };
      const p = pointAt(c, a);
      const want = displayed(c, l, 2, p);
      let prev = 0;
      for (let f = 0; f < 60; f++) {
        if (f % 6 === 0 && f < 40) c.zoomBy(trial % 2 ? 1.1 : 1 / 1.1, a);
        c.update(1 / 60);
        const s = displayed(c, l, 2, p);
        worst = Math.max(worst, Math.hypot(s.x - want.x, s.y - want.y));
        const dx = s.x - want.x;
        if (Math.sign(dx) !== Math.sign(prev) && Math.abs(dx - prev) > 1) reversals++;
        prev = dx;
      }
    }
    // before the fix: ±½ render pixel (1.7 device px) of wobble, reversing on a quarter of all frames
    expect(worst).toBeLessThan(1.5);
    expect(reversals).toBe(0);
  });

  it('glides in device pixels: no frame of a moving pan stands still', () => {
    for (const look of ['smooth', 'classic'] as const) {
      const { c, l } = laptop(look);
      c.setZoomNow(1.5);
      c.update(0);
      const p = new THREE.Vector3(0, 0, 0);
      let frozen = 0;
      for (let trial = 0; trial < 20; trial++) {
        c.panScreen(trial % 2 ? 300 : -300, trial % 3 ? 120 : -120, l.viewCssH);
        let prev = displayed(c, l, 2, p);
        for (let f = 0; f < 60; f++) {
          const before = c.target.clone();
          c.update(1 / 60);
          const s = displayed(c, l, 2, p);
          // the true view moved by more than a device pixel this frame, so the image must have too
          const movedPx = (c.target.distanceTo(before) / ((2 * c.halfH) / l.rh)) * l.sy * Math.sin(c.pitch);
          if (movedPx > 1.5 && Math.hypot(s.x - prev.x, s.y - prev.y) < 0.01) frozen++;
          prev = s;
        }
      }
      expect(frozen, look).toBe(0);
    }
  });
});

describe('dragging and flinging', () => {
  it('keeps the grabbed point under the pointer', () => {
    const { c, l } = laptop('smooth');
    c.instant = false;
    c.setZoomNow(1.5);
    c.update(0);
    const p = pointAt(c, { x: 0, y: 0 });
    const start = displayed(c, l, 2, p);
    c.grab();
    let worst = 0;
    for (let f = 1; f <= 40; f++) {
      c.drag(5, -3, l.viewCssH); // CSS px; 2 device px each
      c.update(1 / 60);
      const s = displayed(c, l, 2, p);
      worst = Math.max(worst, Math.abs(s.x - start.x - f * 10), Math.abs(s.y - start.y + f * 6));
    }
    expect(worst).toBeLessThanOrEqual(1); // was a 100-device-px lag: the view glided after the pointer
  });

  it('coasts after a flick, slows down and stops; a grab stops it at once', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.grab();
    c.release(1200, 0, 540);
    const t0 = c.target.clone();
    let prevStep = Infinity;
    for (let f = 0; f < 30; f++) {
      const b = c.target.clone();
      c.update(1 / 60);
      const step = c.target.distanceTo(b);
      expect(step).toBeLessThanOrEqual(prevStep + 1e-9); // always slowing
      prevStep = step;
    }
    expect(c.target.distanceTo(t0)).toBeGreaterThan(3);
    for (let f = 0; f < 240; f++) c.update(1 / 60);
    expect(c.coasting).toBe(false);
    c.release(1200, 0, 540);
    c.update(1 / 60);
    const held = c.target.clone();
    c.grab();
    for (let f = 0; f < 10; f++) c.update(1 / 60);
    expect(c.target.distanceTo(held)).toBeLessThan(1e-9);
  });

  it('a fling under reduced motion does nothing (no unrequested movement)', () => {
    const c = make(16 / 9, true);
    c.release(1500, 900, 540);
    expect(c.coasting).toBe(false);
  });

  it('a diagonal flick along an edge slides along it instead of stopping dead', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.bounds = OUTLINE;
    c.setZoomNow(3);
    c.panScreen(0, 8000, 540); // up against the top bound
    for (let f = 0; f < 90; f++) c.update(1 / 60);
    c.grab();
    const start = c.target.clone();
    const across = () => (c.target.x - start.x) * Math.cos(c.yaw) - (c.target.z - start.z) * Math.sin(c.yaw);
    c.release(-900, 900, 540); // up (into the bound) and to the right
    for (let f = 0; f < 60; f++) c.update(1 / 60);
    expect(across()).toBeGreaterThan(2); // the sideways part of the flick carried on
  });

  it('stops a drag or a fling at the bounds without ever jumping the view', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.bounds = OUTLINE;
    c.setZoomNow(3);
    c.grab();
    let prev = c.target.clone();
    for (let f = 0; f < 200; f++) {
      c.drag(-40, 0, 540);
      c.update(1 / 60);
      expect(c.target.distanceTo(prev)).toBeLessThan(2.5); // never more than one drag step
      prev = c.target.clone();
    }
    const edge = c.target.clone();
    c.release(-4000, 0, 540);
    for (let f = 0; f < 60; f++) c.update(1 / 60);
    expect(c.target.distanceTo(edge)).toBeLessThan(1e-6);
  });
});

describe('camera framing', () => {
  /** The view centre in camera-plane units along screen right (a) and up (u), from the world origin. */
  function onScreen(c: IsoCamera, v: THREE.Vector3): { a: number; u: number } {
    const a = v.x * Math.cos(c.yaw) - v.z * Math.sin(c.yaw);
    const u = (-v.x * Math.sin(c.yaw) - v.z * Math.cos(c.yaw)) * Math.sin(c.pitch);
    return { a, u };
  }

  it('keeps the town centred at the widest zoom, and lets you reach the edges when zoomed in', () => {
    const c = make();
    c.bounds = OUTLINE;
    c.setZoomNow(MIN_ZOOM);
    c.panScreen(-4000, -4000, 540);
    const p1 = onScreen(c, c.targetGoal);
    c.panScreen(8000, 8000, 540);
    const p2 = onScreen(c, c.targetGoal);
    // only the slack either way (1.5 across, 2 up and down), in camera-plane units
    expect(Math.abs(p1.a - p2.a)).toBeLessThanOrEqual(3 + 1e-6);
    expect(Math.abs(p1.u - p2.u)).toBeLessThanOrEqual(4 + 1e-6);
    c.setZoomNow(3);
    c.panScreen(-4000, 0, 540);
    expect(Math.hypot(c.targetGoal.x, c.targetGoal.z)).toBeGreaterThan(10);
  });

  it('reaches the tallest roof when zoomed in (the bounds count heights, not just the ground)', () => {
    for (const z of [1.5, 2, 3]) {
      const c = make();
      c.bounds = OUTLINE;
      c.setZoomNow(z);
      c.panScreen(0, 8000, 540); // drag the view all the way up
      c.target.copy(c.targetGoal);
      c.update(0);
      const top = OUTLINE[OUTLINE.length - 1]!.clone().project(c.camera);
      expect(top.y, `${z}×`).toBeLessThan(1); // the chimney top is on screen
      // and not loose either: at most half a view of sky above the tallest point (plus the slack)
      expect(top.y, `${z}×`).toBeGreaterThanOrEqual(0.5 - 2 / c.halfH - 2 / 540);
    }
  });

  it('leaves Fit where Fit put it (the bounds agree with its centring)', () => {
    for (const aspect of [16 / 9, 1.6, 4 / 3]) {
      const free = make(aspect, true);
      free.fit(FIT, CENTRE);
      const bound = make(aspect, true);
      bound.bounds = OUTLINE;
      bound.fit(FIT, CENTRE);
      expect(bound.target.distanceTo(free.target), `${aspect}`).toBeLessThan(1e-6);
    }
  });

  it('limits panning per screen axis after a quarter turn (the plinth is not square)', () => {
    const c = make();
    c.bounds = OUTLINE;
    c.setZoomNow(3);
    c.panScreen(-4000, 0, 540);
    const reach0 = Math.hypot(c.targetGoal.x, c.targetGoal.z);
    c.rotate(1);
    c.targetGoal.set(0, 3.9, 0);
    c.panScreen(-4000, 0, 540);
    const reach1 = Math.hypot(c.targetGoal.x, c.targetGoal.z);
    expect(reach0).toBeGreaterThan(5);
    expect(reach1).toBeGreaterThan(5);
    // at the default 45° view, right and up mix both plinth axes; turning changes which side is long
    expect(Math.abs(reach0 - reach1)).toBeLessThan(6);
  });

  it('lets a smooth zoom in hold its anchor, then eases the view back inside the bounds', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.bounds = OUTLINE;
    c.setZoomNow(1);
    const a = { x: 0.85, y: 0.6 }; // near the corner, where the bounds bite
    const p = groundUnder(c, a);
    c.zoomTo(3, a);
    let worst = 0;
    for (let f = 0; f < 14; f++) {
      c.update(1 / 60);
      worst = Math.max(worst, groundUnder(c, a).distanceTo(p));
    }
    expect(worst).toBeLessThan(0.1); // held while zooming (was pulled away as it zoomed)
    for (let f = 0; f < 120; f++) c.update(1 / 60);
    const settled = c.target.clone();
    const inside = settled.clone();
    c.clampTarget('hard');
    expect(c.target.distanceTo(inside)).toBeLessThan(1e-3); // and now within the bounds
    // the ease back gathers speed instead of starting at full tilt (a spring, not a jolt)
    const d = new IsoCamera();
    d.setViewport(960, 540);
    d.continuous = true;
    d.bounds = OUTLINE;
    d.setZoomNow(1);
    d.zoomTo(3, a);
    for (let f = 0; f < 30 && d.zooming; f++) d.update(1 / 60);
    const steps: number[] = [];
    let prev = d.target.clone();
    for (let f = 0; f < 90; f++) {
      d.update(1 / 60);
      steps.push(d.target.distanceTo(prev));
      prev = d.target.clone();
    }
    const first = steps.findIndex((s) => s > 1e-6);
    const peak = Math.max(...steps);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(steps[first]!).toBeLessThan(0.3 * peak);
  });

  it('allows a range that changes continuously as the content stops fitting (no jump at the switch)', () => {
    for (const v of [9.99, 10, 10.01]) {
      const [lo, hi] = viewRange(-10, 10, v, 1.5);
      expect(lo).toBeCloseTo(-1.5, 1);
      expect(hi).toBeCloseTo(1.5, 1);
    }
    expect(viewRange(-10, 30, 5, 1)).toEqual([-6, 26]);
    expect(viewRange(-10, 30, 50, 1)).toEqual([9, 11]);
    // continuous across the switch whatever the inset and freedom, with room there (no pinch point)
    for (const free of [0, 0.5, 1]) {
      const below = viewRange(-9.999, 9.999, 10, 1.5, 2, free),
        above = viewRange(-10.001, 10.001, 10, 1.5, 2, free);
      expect(Math.abs(below[0] - above[0]) + Math.abs(below[1] - above[1]), `${free}`).toBeLessThan(0.01);
      expect(above[1], `${free}`).toBeCloseTo(1.5 + (free * 10) / 4, 2);
    }
    const a = viewRange(-10, 30, 50, 1, 5, 0.3),
      b = viewRange(-10, 30, 50, 1, 5, 0.3001);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThan(0.01);
  });

  it('lets a town that fits move about, but never loses it (maps, not image viewers)', () => {
    for (const aspect of [16 / 9, 1.6, 4 / 3]) {
      const c = make(aspect, true);
      c.bounds = OUTLINE;
      c.setZoomNow(c.fitZoom(OUTLINE, CENTRE)); // the town fills Fit's frame on one axis and fits the other
      let roam = 0;
      for (const [dx, dy] of [
        [4000, 0],
        [-4000, 0],
        [0, 4000],
        [0, -4000],
        [4000, 4000],
        [-4000, -4000],
      ] as const) {
        c.targetGoal.copy(CENTRE);
        c.panScreen(dx, dy, 540);
        c.target.copy(c.targetGoal);
        c.update(0);
        roam = Math.max(roam, Math.hypot(c.target.x - CENTRE.x, c.target.z - CENTRE.z));
        // no part of the town goes further than a quarter of the view past the screen edge across, or past
        // the HUD's edge (Fit's 84%) up and down, give or take the slack
        const vr = c.halfH * c.viewAspect,
          vu = c.halfH;
        for (const p of OUTLINE) {
          const v = p.clone().project(c.camera); // no overscan here: NDC ±1 is the screen edge
          const px = 2 / 540; // the texel snap moves the camera by up to half a render pixel
          expect(Math.abs(v.x), `${aspect} x`).toBeLessThanOrEqual(1.25 + 1.5 / vr + px);
          expect(Math.abs(v.y), `${aspect} y`).toBeLessThanOrEqual(0.84 + 0.25 + 2 / vu + px);
        }
      }
      expect(roam, `${aspect}`).toBeGreaterThan(3); // it really moves: it is not held centred
    }
  });

  it('lands every palette zoom step on the spot under the cursor, and the spot stays there', () => {
    let landed = 0,
      stayed = 0,
      tried = 0;
    // 16:10 and 4:3 too: each has its own zoom where the town just fits across, which is where a pinch point would bite
    for (const aspect of [16 / 9, 1.6, 4 / 3])
      for (let ax = -0.6; ax <= 0.6 + 1e-9; ax += 0.1)
        for (let ay = -0.5; ay <= 0.5 + 1e-9; ay += 0.1) {
          const c = make(aspect, false);
          c.instant = false;
          c.bounds = OUTLINE;
          c.fit(OUTLINE, CENTRE);
          const a = { x: ax, y: ay };
          const p0 = groundUnder(c, a);
          if (p0.x < GROUND.x0 || p0.x > GROUND.x1 || p0.z < GROUND.z0 || p0.z > GROUND.z1) continue; // aim at the town
          tried++;
          while (c.canStep(1)) {
            const p = groundUnder(c, a);
            c.step(1, a);
            landed = Math.max(landed, groundUnder(c, a).distanceTo(p)); // the step itself: exactly on the spot
            for (let f = 0; f < 60; f++) c.update(1 / 60); // then a full second for the bounds
            // across the middle 80% of the screen the rules have room for any spot on the town, so nothing eases at all
            if (Math.abs(ax) <= 0.4 + 1e-9 && Math.abs(ay) <= 0.4 + 1e-9) stayed = Math.max(stayed, groundUnder(c, a).distanceTo(p0));
          }
        }
    expect(tried).toBeGreaterThan(40);
    expect(landed).toBeLessThan(0.15);
    // before: a step landed recentred, up to several world units from where it was aimed
    expect(stayed).toBeLessThan(0.2);
  });

  it('eases the town home as it zooms out past Fit, with no jump', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.bounds = OUTLINE;
    c.setZoomNow(c.fitZoom(OUTLINE, CENTRE));
    c.panScreen(4000, 2000, 540); // to the edge of the room it has
    for (let f = 0; f < 60; f++) c.update(1 / 60);
    const off = Math.hypot(c.target.x, c.target.z);
    expect(off).toBeGreaterThan(3);
    c.zoomTo(MIN_ZOOM);
    let prev = c.target.clone(),
      step = 0;
    for (let f = 0; f < 120; f++) {
      c.update(1 / 60);
      step = Math.max(step, c.target.distanceTo(prev));
      prev = c.target.clone();
    }
    expect(step).toBeLessThan(0.15 * off); // a glide over many frames, not a cut
    const home = c.target.clone();
    c.clampTarget('hard');
    expect(c.target.distanceTo(home)).toBeLessThan(1e-3); // and it ends inside the (centred) bounds
  });

  it('under reduced motion, a zoom lands inside the bounds in the same cut (no delayed jump)', () => {
    for (const continuous of [true, false]) {
      const c = make(16 / 9, continuous);
      c.bounds = OUTLINE;
      c.setZoomNow(1);
      const a = { x: 0.95, y: 0.9 }; // the sky in a corner: the bounds must move the view
      if (continuous) c.zoomTo(3, a);
      else c.step(1, a);
      const after = c.target.clone();
      for (let f = 0; f < 30; f++) c.update(1 / 60);
      expect(c.target.distanceTo(after), `${continuous}`).toBeLessThan(1e-9);
    }
  });

  it('fits the whole town on a wide screen, and gives a portrait phone the widest view instead of a tiny town', () => {
    const wide = make(16 / 9, true);
    const z = wide.fitZoom(FIT, CENTRE);
    expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(z).toBeLessThan(1.3);
    const phone = make(0.46, true);
    expect(phone.fitZoom(FIT, CENTRE)).toBe(PHONE_MIN_ZOOM);
    const stepped = make(16 / 9, false);
    expect(ZOOM_STEPS as readonly number[]).toContain(stepped.fitZoom(FIT, CENTRE));
  });
});

describe('town outline', () => {
  it('has the plinth corners and each grid cell at the height of its tallest thing', () => {
    const root = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1));
    tower.position.set(GROUND.x0 + 1, 5, GROUND.z0 + 1); // back-left corner, 10 m tall
    const hut = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    hut.position.set(GROUND.x1 - 1, 1, GROUND.z1 - 1); // front-right corner, 2 m
    root.add(tower, hut);
    const pts = townOutline(root);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(G - PLINTH.h, 9);
    expect(Math.max(...ys)).toBeCloseTo(10, 9);
    const nearHut = pts.filter((p) => p.x > GROUND.x1 - 5 && p.z > GROUND.z1 - 5 && p.y > G);
    expect(Math.max(...nearHut.map((p) => p.y))).toBeCloseTo(2, 9); // the front corner is not raised to the tower's height
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(GROUND.x0 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(GROUND.x1 + 1e-9);
    }
  });

  it('ignores anything that is not shown, including meshes inside a hidden group', () => {
    const root = new THREE.Group();
    const hidden = new THREE.Group();
    hidden.visible = false;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1, 30, 1));
    mast.position.set(0, 15, 0);
    hidden.add(mast);
    root.add(hidden);
    expect(Math.max(...townOutline(root).map((p) => p.y))).toBeCloseTo(G, 9);
  });
});

describe('relayouts mid-ease', () => {
  it('a resize, photo or journal capture never cuts a view that is easing back into the bounds', () => {
    const c = make(16 / 9, true);
    c.instant = false;
    c.bounds = OUTLINE;
    c.setZoomNow(1);
    c.zoomTo(3, { x: 0.95, y: 0.9 }); // into the sky in a corner: the bounds will want the view back
    for (let f = 0; f < 20; f++) c.update(1 / 60);
    const before = c.target.clone();
    c.setViewport(1920, 1080); // what captureFrame and every resize do
    expect(c.target.distanceTo(before)).toBeLessThan(1e-9); // the view on screen didn't move
    c.setViewport(960, 540);
    expect(c.target.distanceTo(before)).toBeLessThan(1e-9);
    let prev = c.target.clone(),
      step = 0;
    for (let f = 0; f < 120; f++) {
      c.update(1 / 60);
      step = Math.max(step, c.target.distanceTo(prev));
      prev = c.target.clone();
    }
    const end = c.target.clone();
    c.clampTarget('hard');
    expect(c.target.distanceTo(end)).toBeLessThan(1e-3); // it still eased back inside
    expect(step).toBeLessThan(0.5); // gradually
  });
});
