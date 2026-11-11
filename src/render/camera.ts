import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/**
 * Orthographic 2:1 dimetric camera (pitch = atan(1/2), classic pixel-art
 * isometric) with 90-degree rotation steps, a zoom range of 0.65× to 3×, and texel snapping.
 *
 * Nothing ever crawls:
 * - Texel snapping: the camera position is rounded to whole render-target
 *   pixels along its own right/up axes every frame, so panning moves the whole
 *   image by whole pixels.
 * - Rotation is an instant step (the post pass Bayer-dissolves between views).
 * - Zoom depends on the look. The palette looks (Fine, Classic, Chunky) zoom in discrete
 *   steps (ZOOM_STEPS) with the same dissolve, so no frame shows geometry sliding across
 *   the pixel grid. The steps are deliberately not all whole multiples: 1× → 2× felt like a
 *   jump, so 1.5× sits between. Each step is still static and snapped, which is what keeps
 *   pixels stable; don't "fix" them back to integers. Smooth (full colour, filtered) zooms
 *   continuously, easing in log space so zooming in and out feel the same speed.
 * - Zoom keeps the point under the cursor where it is (anchor), as maps do.
 */
/**
 * Half-height of the view at 1× magnification, world units. Sized so the whole
 * plinth, the chimney top and some sky margin fit a 16:9 view.
 */
export const BASE_HALF_H = 20;
export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 3;
/** Discrete zoom levels for the palette looks (0.65× is the wide "postcard" view). */
export const ZOOM_STEPS = [0.65, 0.8, 1, 1.5, 2, 3] as const;
/** Smooth zoom easing rate: settles in about 200 ms. */
const ZOOM_RATE = 15;
/** The legacy scripted zoom indices (freeze({ zoom })) mean 1×, 2×, 3×. */
const LEGACY_ZOOMS = [1, 2, 3] as const;

/** A rectangle on the ground (world x/z) that the view should stay over. */
export interface GroundRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  readonly pitch = Math.atan(0.5);
  readonly baseHalfH = BASE_HALF_H;
  /** Displayed magnification. */
  zoom = 1;
  /** Where a smooth zoom is heading. */
  zoomGoal = 1;
  /** Smooth look: continuous zoom. Otherwise discrete ZOOM_STEPS. */
  continuous = false;
  yaw = Math.PI / 4;
  halfH = this.baseHalfH;
  readonly target = new THREE.Vector3(0, 3.9, 0);
  readonly targetGoal = new THREE.Vector3(0, 3.9, 0);
  /** Reduced motion: pans and zooms jump straight to their goal instead of gliding. */
  instant = false;
  /** The ground the view stays over (set from the plinth); panning is limited by what is visible. */
  bounds: GroundRect | null = null;
  private aspect = 1;
  private rtHeight = 220;
  /** Screen point (NDC) a smooth zoom is anchored to, until it settles. */
  private anchor: { x: number; y: number } | null = null;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  setViewport(rtWidth: number, rtHeight: number): void {
    this.aspect = rtWidth / rtHeight;
    this.rtHeight = rtHeight;
    this.updateProjection();
    this.clampTarget();
  }

  get viewAspect(): number {
    return this.aspect;
  }

  rotate(dir: 1 | -1): void {
    // keep yaw bounded so it never accumulates float error over many turns
    this.yaw = (((this.yaw + (dir * Math.PI) / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    this.clampTarget(); // the plinth is not square: what's visible along each axis changes
  }

  /** The discrete step the current zoom is at (or just below). */
  private stepIndex(): number {
    let i = 0;
    for (let k = 0; k < ZOOM_STEPS.length; k++) if (this.zoom >= ZOOM_STEPS[k]! - 1e-6) i = k;
    return i;
  }

  /** Would a discrete step in `dir` change anything? (Lets the caller skip a pointless dissolve.) */
  canStep(dir: 1 | -1): boolean {
    const i = this.stepIndex();
    if (dir < 0 && Math.abs(this.zoom - ZOOM_STEPS[i]!) > 1e-6) return true; // between steps: down to i
    return clamp(i + dir, 0, ZOOM_STEPS.length - 1) !== i;
  }

  /** One discrete step in or out, keeping the point under `anchor` (NDC; default the centre) in place. Instant. */
  step(dir: 1 | -1, anchor?: { x: number; y: number }): void {
    if (!this.canStep(dir)) return;
    const i = this.stepIndex();
    const between = Math.abs(this.zoom - ZOOM_STEPS[i]!) > 1e-6;
    const next = dir < 0 && between ? i : clamp(i + dir, 0, ZOOM_STEPS.length - 1);
    this.setZoomNow(ZOOM_STEPS[next]!, anchor);
  }

  /** Multiply the zoom by `factor`. Continuous: eases there (instant under reduced motion). */
  zoomBy(factor: number, anchor?: { x: number; y: number }): void {
    this.zoomTo(this.zoomGoal * factor, anchor);
  }

  /** Zoom to `z` (clamped), anchored. Continuous looks ease there; palette looks snap to the nearest step. */
  zoomTo(z: number, anchor?: { x: number; y: number }): void {
    const goal = clamp(z, MIN_ZOOM, MAX_ZOOM);
    if (!this.continuous) {
      const near = ZOOM_STEPS.reduce((a, b) => (Math.abs(Math.log(b / goal)) < Math.abs(Math.log(a / goal)) ? b : a));
      this.setZoomNow(near, anchor);
      return;
    }
    this.zoomGoal = goal;
    this.anchor = anchor ?? { x: 0, y: 0 };
    if (this.instant) this.applyZoom(goal);
  }

  /** Set the zoom immediately (no easing), anchored. */
  setZoomNow(z: number, anchor?: { x: number; y: number }): void {
    this.anchor = anchor ?? { x: 0, y: 0 };
    this.zoomGoal = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.applyZoom(this.zoomGoal);
    this.anchor = null;
  }

  /** Jump straight to a legacy magnification index (0 = 1×, 1 = 2×, 2 = 3×), for scripted views. */
  setZoomIndex(i: number): void {
    const z = LEGACY_ZOOMS[clamp(Math.round(i), 0, LEGACY_ZOOMS.length - 1)]!;
    this.zoom = this.zoomGoal = z;
    this.anchor = null;
    this.halfH = this.baseHalfH / z;
    this.updateProjection();
  }

  /**
   * Change the displayed zoom, keeping the point under the anchor fixed on screen. The camera is
   * orthographic, so every point on the anchor's line of sight stays put: shift the target by the
   * anchor's offset times the change in view size (no raycast, rooftops and ground alike).
   */
  private applyZoom(z: number): void {
    const prev = this.halfH;
    this.zoom = z;
    this.halfH = this.baseHalfH / z;
    this.updateProjection();
    const a = this.anchor;
    if (a) {
      const dh = prev - this.halfH; // camera-plane units
      this.shiftView(a.x * dh * this.aspect, a.y * dh, true);
    }
    this.clampTarget();
  }

  /** Move the view by (dx, dy) camera-plane units (right, up), sliding the target along the ground. */
  private shiftView(dx: number, dy: number, both: boolean): void {
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const fwd = new THREE.Vector3(this.up.x, 0, this.up.z).normalize();
    const move = this.right.multiplyScalar(dx).addScaledVector(fwd, dy / Math.sin(this.pitch));
    this.targetGoal.add(move);
    if (both) this.target.add(move);
  }

  /** Pan in screen space (pixels of the CSS canvas). */
  panScreen(dxPx: number, dyPx: number, cssHeight: number): void {
    const worldPerPx = (2 * this.halfH) / cssHeight;
    this.shiftView(-dxPx * worldPerPx, dyPx * worldPerPx, false);
    this.clampTarget();
  }

  /**
   * Keep the view over the plinth, per screen axis, from what is actually visible at this zoom
   * and rotation: zoomed out, the plinth stays centred; zoomed in, you can reach every edge.
   */
  clampTarget(): void {
    const b = this.bounds;
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2,
      cz = (b.z0 + b.z1) / 2;
    const hx = (b.x1 - b.x0) / 2,
      hz = (b.z1 - b.z0) / 2;
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; // screen right on the ground
    const f = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; // screen up on the ground (away from the camera)
    const extR = hx * Math.abs(r.x) + hz * Math.abs(r.z);
    const extF = hx * Math.abs(f.x) + hz * Math.abs(f.z);
    const visR = this.halfH * this.aspect;
    const visF = this.halfH / Math.sin(this.pitch);
    const slack = 1.5; // a little room past the edge, so the plinth's rim can be framed
    const limR = Math.max(0, extR - visR) + slack;
    const limF = Math.max(0, extF - visF) + slack;
    for (const v of [this.targetGoal, this.target]) {
      const dx = v.x - cx,
        dz = v.z - cz;
      const a = dx * r.x + dz * r.z,
        c = dx * f.x + dz * f.z;
      const a2 = clamp(a, -limR, limR),
        c2 = clamp(c, -limF, limF);
      v.x = cx + a2 * r.x + c2 * f.x;
      v.z = cz + a2 * r.z + c2 * f.z;
    }
  }

  /** The town's projected extent around `centre`: half-sizes and the offset of its middle, camera-plane units. */
  private extent(points: readonly THREE.Vector3[], centre: THREE.Vector3): { w: number; h: number; mx: number; my: number } {
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const upv = new THREE.Vector3(-Math.sin(this.yaw) * Math.sin(this.pitch), Math.cos(this.pitch), -Math.cos(this.yaw) * Math.sin(this.pitch));
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of points) {
      const d = p.clone().sub(centre);
      const a = d.dot(r),
        b = d.dot(upv);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    }
    return { w: (x1 - x0) / 2, h: (y1 - y0) / 2, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
  }

  /**
   * The zoom that frames the whole town (plinth and chimney) with room for the HUD, or the
   * closest allowed to it: a portrait phone can't fit the whole town without everything going
   * tiny, so it gets the widest view (0.65×) centred on the street instead.
   */
  fitZoom(points: readonly THREE.Vector3[], centre: THREE.Vector3): number {
    const e = this.extent(points, centre);
    const zx = (this.baseHalfH * this.aspect * 0.94) / Math.max(e.w, 1e-3); // 6% side margin
    const zy = (this.baseHalfH * 0.84) / Math.max(e.h, 1e-3); // room for the top bar and the dock
    const z = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM);
    if (this.continuous) return z;
    // palette looks: the largest step that still fits
    return [...ZOOM_STEPS].reverse().find((s) => s <= z + 1e-6) ?? MIN_ZOOM;
  }

  /** Frame the whole town: centre on its projected middle and zoom to fit. Instant (the caller dissolves). */
  fit(points: readonly THREE.Vector3[], centre: THREE.Vector3): void {
    const z = this.fitZoom(points, centre);
    this.zoom = this.zoomGoal = z;
    this.anchor = null;
    this.halfH = this.baseHalfH / z;
    this.updateProjection();
    this.targetGoal.copy(centre);
    this.target.copy(centre);
    this.update(0); // matrices for this yaw before shifting along them
    const e = this.extent(points, centre);
    this.shiftView(e.mx, e.my, true);
    this.clampTarget();
  }

  /** Is a smooth zoom still easing? (The caller refreshes the build preview while it does.) */
  get zooming(): boolean {
    return Math.abs(Math.log(this.zoomGoal / this.zoom)) > 1e-4;
  }

  update(dt: number): void {
    if (this.zooming) {
      // ease in log space: the same feel zooming in and out
      const l = this.instant ? Math.log(this.zoomGoal) : damp(Math.log(this.zoom), Math.log(this.zoomGoal), ZOOM_RATE, dt);
      this.applyZoom(Math.abs(l - Math.log(this.zoomGoal)) < 1e-4 ? this.zoomGoal : Math.exp(l));
      if (!this.zooming) this.anchor = null;
    }
    if (this.instant) this.target.copy(this.targetGoal);
    else {
      this.target.x = damp(this.target.x, this.targetGoal.x, 8, dt);
      this.target.y = damp(this.target.y, this.targetGoal.y, 8, dt);
      this.target.z = damp(this.target.z, this.targetGoal.z, 8, dt);
    }

    const r = 160;
    const c = this.camera;
    c.position.set(
      this.target.x + r * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target.y + r * Math.sin(this.pitch),
      this.target.z + r * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    c.lookAt(this.target);
    c.updateMatrixWorld();
    // texel snap
    const px = (2 * this.halfH) / this.rtHeight;
    this.right.setFromMatrixColumn(c.matrixWorld, 0);
    this.up.setFromMatrixColumn(c.matrixWorld, 1);
    const dx = c.position.dot(this.right);
    const dy = c.position.dot(this.up);
    c.position.addScaledVector(this.right, Math.round(dx / px) * px - dx);
    c.position.addScaledVector(this.up, Math.round(dy / px) * px - dy);
    c.updateMatrixWorld();
  }

  private updateProjection(): void {
    const c = this.camera;
    c.left = -this.halfH * this.aspect;
    c.right = this.halfH * this.aspect;
    c.top = this.halfH;
    c.bottom = -this.halfH;
    c.updateProjectionMatrix();
  }
}
