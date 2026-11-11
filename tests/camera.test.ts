import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { IsoCamera, MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS } from '../src/render/camera';
import { G, GROUND, PLINTH } from '../src/world/layout';

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

describe('camera zoom', () => {
  it('steps through 0.65×, 0.8×, 1×, 1.5×, 2×, 3× in the palette looks, and stops at the ends', () => {
    const c = make();
    c.setZoomNow(MIN_ZOOM);
    const seen = [c.zoom];
    while (c.canStep(1)) {
      c.step(1);
      seen.push(c.zoom);
    }
    expect(seen).toEqual([...ZOOM_STEPS]);
    expect(c.canStep(1)).toBe(false);
    c.setZoomNow(MIN_ZOOM);
    expect(c.canStep(-1)).toBe(false);
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
  });
});

describe('camera framing', () => {
  it('keeps the town centred when zoomed out, and lets you reach the edges when zoomed in', () => {
    const c = make();
    c.bounds = GROUND;
    c.setZoomNow(0.8);
    c.panScreen(-4000, -4000, 540);
    expect(Math.hypot(c.targetGoal.x, c.targetGoal.z)).toBeLessThan(3);
    c.setZoomNow(3);
    c.panScreen(-4000, 0, 540);
    expect(Math.hypot(c.targetGoal.x, c.targetGoal.z)).toBeGreaterThan(10);
  });

  it('limits panning per screen axis after a quarter turn (the plinth is not square)', () => {
    const c = make();
    c.bounds = GROUND;
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

  it('fits the whole town on a wide screen, and gives a portrait phone the widest view instead of a tiny town', () => {
    const wide = make(16 / 9, true);
    const z = wide.fitZoom(FIT, CENTRE);
    expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(z).toBeLessThan(1.3);
    const phone = make(0.46, true);
    expect(phone.fitZoom(FIT, CENTRE)).toBe(MIN_ZOOM);
    const stepped = make(16 / 9, false);
    expect(ZOOM_STEPS as readonly number[]).toContain(stepped.fitZoom(FIT, CENTRE));
  });
});
