import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/**
 * Orthographic 2:1 dimetric camera (pitch = atan(1/2), classic pixel-art
 * isometric) with 90-degree rotation steps, a zoom range of 0.65× (0.5× on a portrait phone) to 3×, and texel snapping.
 *
 * Nothing ever crawls, and nothing ever jumps:
 * - Texel snapping: the camera that renders is rounded to whole render-target pixels along its
 *   own right/up axes every frame, so the scene is always rasterised on the same grid and art
 *   pixels never shimmer.
 * - Sub-pixel presentation: the rounding error is handed back as `subpixel`, and the caller shifts
 *   the finished canvas by it (in whole device pixels, into a one-pixel overscan margin), so the
 *   image on screen sits where the unsnapped camera would put it. Pans, glides and smooth zooms
 *   move in device pixels instead of whole art pixels, and the point under the cursor stays put
 *   while zooming instead of wobbling by up to half an art pixel each frame.
 * - Rotation is an instant step (the post pass Bayer-dissolves between views).
 * - Zoom depends on the look. The palette looks (Fine, Classic, Chunky) zoom in discrete
 *   steps (ZOOM_STEPS) with the same dissolve, so no frame shows geometry sliding across
 *   the pixel grid. The steps are deliberately not all whole multiples: 1× → 2× felt like a
 *   jump, so 1.5× sits between. Each step is still static and snapped, which is what keeps
 *   pixels stable; don't "fix" them back to integers. Smooth (full colour, filtered) zooms
 *   continuously, easing in log space so zooming in and out feel the same speed.
 * - Zoom keeps the point under the cursor where it is (anchor), as maps do. Zooming in, the pan
 *   bounds wait until the zoom settles and then ease the view back, rather than dragging the
 *   anchor away mid-zoom.
 * - Dragging is direct (the grabbed point stays under the pointer) and a release with speed
 *   flings the view, which coasts to a stop.
 */
/**
 * Half-height of the view at 1× magnification, world units. Sized so the whole
 * plinth, the chimney top and some sky margin fit a 16:9 view.
 */
export const BASE_HALF_H = 20;
export const MIN_ZOOM = 0.65;
/** How far a portrait phone may zoom out: the narrow view would otherwise show only a slice of the street. */
export const PHONE_MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
/** Discrete zoom levels for the palette looks (the widest is the "postcard" view; 0.5× only on narrow screens). */
export const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.5, 2, 3] as const;

/**
 * The widest zoom for a view of this aspect (width / height): MIN_ZOOM on a landscape screen,
 * easing down to PHONE_MIN_ZOOM by a portrait phone's 0.6 (a 390×844 phone is 0.46).
 */
export function minZoomFor(aspect: number): number {
  const k = clamp((1 - aspect) / 0.4, 0, 1);
  return MIN_ZOOM + (PHONE_MIN_ZOOM - MIN_ZOOM) * k;
}
/** Smooth zoom easing rate: settles in about 200 ms. */
const ZOOM_RATE = 15;
/**
 * Pan glide stiffness, 1/s (keyboard pans, the bounds settling, Show me): a critically damped
 * spring that is 95% of the way in about 0.4 s, like the old exponential glide at rate 8.
 */
const PAN_OMEGA = 12;
/** Fling friction, 1/s: a flick coasts for about half a second. */
const FLING_FRICTION = 5;
/** A fling slower than this (camera-plane units per second) has stopped. */
const FLING_STOP = 0.05;
/** After zooming in, the bounds wait this long (s) for more zoom before easing the view back. */
const BOUNDS_SETTLE_S = 0.15;
/** How far past the town's outline the view may go, camera-plane units (right, up). */
const SLACK_R = 1.5;
const SLACK_U = 2;
/**
 * How much of the view Fit lets the town fill, across and up: 6% side margins, and room for the
 * top bar and the dock. The pan bounds measure from the same top and bottom edges (see viewRange).
 */
const FIT_FILL_R = 0.94;
const FIT_FILL_U = 0.84;
/** The legacy scripted zoom indices (freeze({ zoom })) mean 1×, 2×, 3×. */
const LEGACY_ZOOMS = [1, 2, 3] as const;

/** The town's outline: points whose projection is everything worth looking at (plinth corners, rooftops). */
export type Outline = readonly THREE.Vector3[];

/** The outline's extent along screen right (r) and screen up (u), camera-plane units. */
type Span = { r0: number; r1: number; u0: number; u1: number };

/**
 * The allowed range for the view centre along one screen axis: content `lo..hi` seen through a
 * window `v` either side of the centre, as maps and canvas apps bound a view ("don't lose the
 * content"), not as image viewers do ("centre it while it fits"), so a zoom can always keep the
 * point under the cursor still.
 * - Smaller: it can move about until its edge reaches the window's edge less `inset` (the HUD's
 *   room), and a quarter of a window past that.
 * - Bigger: every part reachable, `slack` past its ends, and a quarter of a window of empty space
 *   past its furthest point, growing to half a window as it overflows further. The town is a
 *   diamond on screen, so a zoom toward a spot near a side corner needs that room.
 * The quarter window is what lets a zoom keep the spot under the cursor where the content just
 * fills the window: with none, the two cases would meet with no room at all, a pinch point where
 * every off-centre zoom gets pulled back. The content is never lost: at most a quarter of the
 * window's worth of it is ever off screen. `freedom` scales all of it (0 holds the content
 * centred, ± slack). The range is continuous in zoom and in `freedom`, so it never makes the
 * view jump.
 */
export function viewRange(lo: number, hi: number, v: number, slack: number, inset = 0, freedom = 0): [number, number] {
  const half = (hi - lo) / 2,
    mid = (lo + hi) / 2,
    k = clamp(freedom, 0, 1);
  if (half >= v) {
    const extra = k * Math.max(v / 4, Math.min(2 * (half - v), v / 2));
    return [lo + v - slack - extra, hi - v + slack + extra];
  }
  const free = k * (Math.max(0, v - inset - half) + v / 4);
  return [mid - slack - free, mid + slack + free];
}

/** How a clamp treats the view: both targets to the bounds, only the goal (the view eases after it), or never further out. */
type ClampMode = 'hard' | 'goal' | 'follow';

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
  /** Half-height of the visible view (the overscan margin is extra), world units. */
  halfH = this.baseHalfH;
  readonly target = new THREE.Vector3(0, 3.9, 0);
  readonly targetGoal = new THREE.Vector3(0, 3.9, 0);
  /** Reduced motion: pans and zooms jump straight to their goal instead of gliding. */
  instant = false;
  /** The town's outline (see Outline); panning is limited by what of it is visible. */
  bounds: Outline | null = null;
  /** Fingers are on the screen (a pinch): the bounds wait until they lift. */
  hold = false;
  /**
   * Render pixels (x right, y down) to shift the finished image by, so it shows the unsnapped view.
   * Always within ±½; the canvas has an overscan margin of at least one pixel to absorb it.
   */
  readonly subpixel = { x: 0, y: 0 };
  private aspect = 1;
  private rtHeight = 220;
  /** Render pixels rendered beyond each edge of the visible view. */
  private margin = 0;
  /** Screen point (NDC of the whole canvas) a smooth zoom is anchored to, until it settles. */
  private anchor: { x: number; y: number } | null = null;
  /** Seconds since the last zoom in (the bounds wait for it to settle). */
  private sinceZoomIn = Infinity;
  /** Fling velocity, camera-plane units per second (right, up). */
  private readonly fling = new THREE.Vector2();
  /** The glide's velocity (world units per second): the spring that carries `target` to `targetGoal`. */
  private readonly glide = new THREE.Vector3();
  private spanCache: { yaw: number; y: number; bounds: Outline; span: Span } | null = null;
  /** Where the view and its goal were before a drag or fling step (for the 'follow' clamp). */
  private readonly prevGoal = new THREE.Vector3();
  private readonly prevTarget = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /** The visible render size, plus `margin` render pixels of overscan on every side. */
  setViewport(rtWidth: number, rtHeight: number, margin = 0): void {
    this.aspect = rtWidth / rtHeight;
    this.rtHeight = rtHeight;
    this.margin = margin;
    this.updateProjection();
    // only the goal: a resize, a photo or a journal capture must not cut a view that is easing
    this.clampTarget('goal');
  }

  get viewAspect(): number {
    return this.aspect;
  }

  /** The widest zoom this view allows (wider on a portrait phone; see minZoomFor). */
  get minZoom(): number {
    return minZoomFor(this.aspect);
  }

  /**
   * The screen changed shape (a phone turned from portrait to landscape): if the view is wider
   * than this one allows, come in to its widest. Only for the screen: a photo or a Journal capture
   * borrows the camera at another size and must leave the player's zoom alone.
   */
  fitZoomRange(): void {
    if (this.zoom < this.minZoom - 1e-6) {
      this.zoom = this.zoomGoal = this.continuous ? this.minZoom : this.steps[0]!;
      this.halfH = this.baseHalfH / this.zoom;
      this.updateProjection();
      this.clampTarget('hard');
    } else if (this.zoomGoal < this.minZoom) this.zoomGoal = this.minZoom;
  }

  /** The discrete steps this view allows (the palette looks). */
  get steps(): readonly number[] {
    const min = this.minZoom;
    return ZOOM_STEPS.filter((s) => s >= min - 1e-6);
  }

  rotate(dir: 1 | -1): void {
    // keep yaw bounded so it never accumulates float error over many turns
    this.yaw = (((this.yaw + (dir * Math.PI) / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    this.fling.set(0, 0);
    this.clampTarget('hard'); // the town is not square: what's visible along each axis changes
  }

  /** The discrete step the current zoom is at (or just below). */
  private stepIndex(): number {
    const steps = this.steps;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (this.zoom >= steps[k]! - 1e-6) i = k;
    return i;
  }

  /** Would a discrete step in `dir` change anything? (Lets the caller skip a pointless dissolve.) */
  canStep(dir: 1 | -1): boolean {
    const i = this.stepIndex(),
      steps = this.steps;
    if (dir < 0 && Math.abs(this.zoom - steps[i]!) > 1e-6) return true; // between steps: down to i
    return clamp(i + dir, 0, steps.length - 1) !== i;
  }

  /**
   * One discrete step in or out, keeping the point under `anchor` (NDC; default the centre) in
   * place. Instant (the caller dissolves). Like a smooth zoom, it lands exactly on the anchor and
   * the view then eases inside the bounds if it has to, rather than landing somewhere else.
   */
  step(dir: 1 | -1, anchor?: { x: number; y: number }): void {
    if (!this.canStep(dir)) return;
    const i = this.stepIndex(),
      steps = this.steps;
    const between = Math.abs(this.zoom - steps[i]!) > 1e-6;
    const next = dir < 0 && between ? i : clamp(i + dir, 0, steps.length - 1);
    this.zoomNow(steps[next]!, anchor ?? { x: 0, y: 0 });
  }

  /** Jump the zoom to `z` (clamped) about `anchor`, and leave the bounds to ease the view (see applyZoom). */
  private zoomNow(z: number, anchor: { x: number; y: number }): void {
    this.anchor = anchor;
    this.zoomGoal = clamp(z, this.minZoom, MAX_ZOOM);
    this.applyZoom(this.zoomGoal);
    this.anchor = null;
  }

  /** Multiply the zoom by `factor`. Continuous: eases there (instant under reduced motion). */
  zoomBy(factor: number, anchor?: { x: number; y: number }): void {
    this.zoomTo(this.zoomGoal * factor, anchor);
  }

  /**
   * Multiply the zoom by `factor` this instant, anchored: direct manipulation for pinches, where
   * the fingers already move smoothly and an ease on top would only make the town lag them.
   */
  pinchBy(factor: number, anchor: { x: number; y: number }): void {
    if (!this.continuous) {
      this.zoomBy(factor, anchor);
      return;
    }
    // a pinch takes over from any easing still running: start from what is on screen
    this.zoomNow(this.zoom * factor, anchor);
  }

  /** Zoom to `z` (clamped), anchored. Continuous looks ease there; palette looks snap to the nearest step. */
  zoomTo(z: number, anchor?: { x: number; y: number }): void {
    const goal = clamp(z, this.minZoom, MAX_ZOOM);
    if (!this.continuous) {
      const near = this.steps.reduce((a, b) => (Math.abs(Math.log(b / goal)) < Math.abs(Math.log(a / goal)) ? b : a));
      this.setZoomNow(near, anchor);
      return;
    }
    this.zoomGoal = goal;
    this.anchor = anchor ?? { x: 0, y: 0 };
    if (goal > this.zoom) this.sinceZoomIn = 0;
    if (this.instant) this.applyZoom(goal);
  }

  /** Set the zoom immediately (no easing), anchored. The view lands inside the bounds (callers dissolve). */
  setZoomNow(z: number, anchor?: { x: number; y: number }): void {
    this.anchor = anchor ?? { x: 0, y: 0 };
    this.zoomGoal = clamp(z, this.minZoom, MAX_ZOOM);
    this.applyZoom(this.zoomGoal);
    this.anchor = null;
    this.clampTarget('hard');
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
   * Zooming in, the bounds wait (see update); zooming out, they tighten and the view eases inside.
   * Under reduced motion nothing eases, so the view goes inside at once, in the same cut as the
   * zoom, rather than jumping a moment later.
   */
  private applyZoom(z: number): void {
    const c = this.camera;
    const prevR = c.right,
      prevT = c.top,
      prevZ = this.zoom;
    this.zoom = z;
    this.halfH = this.baseHalfH / z;
    this.updateProjection();
    const a = this.anchor;
    if (a) this.shiftView(a.x * (prevR - c.right), a.y * (prevT - c.top), true);
    if (this.instant) this.clampTarget('hard');
    // pinching on against the 3× limit still counts as zooming in: the bounds keep waiting
    else if (z > prevZ + 1e-9 || (z >= MAX_ZOOM && a)) this.sinceZoomIn = 0;
    else if (z < prevZ - 1e-9) this.clampTarget('goal');
  }

  /**
   * Move the view by (dx, dy) camera-plane units (right, up), sliding the target along the ground.
   * The axes come from the yaw, not the camera's matrix, which is stale between a rotate and the next frame.
   */
  private shiftView(dx: number, dy: number, both: boolean): void {
    const s = Math.sin(this.yaw),
      c = Math.cos(this.yaw);
    const f = dy / Math.sin(this.pitch); // screen up is the ground's forward, foreshortened
    const mx = c * dx - s * f,
      mz = -s * dx - c * f;
    this.targetGoal.x += mx;
    this.targetGoal.z += mz;
    if (both) {
      this.target.x += mx;
      this.target.z += mz;
    }
  }

  /** World units per CSS pixel, for a visible view `cssHeight` CSS pixels tall. */
  private worldPerPx(cssHeight: number): number {
    return (2 * this.halfH) / Math.max(1, cssHeight);
  }

  /** Pan in screen space (CSS pixels; `cssHeight` is the visible view's height). The view glides there. */
  panScreen(dxPx: number, dyPx: number, cssHeight: number): void {
    const w = this.worldPerPx(cssHeight);
    this.shiftView(-dxPx * w, dyPx * w, false);
    this.clampTarget('goal');
  }

  /** Grab the view (pointer down): stop any glide or fling where it is on screen now. */
  grab(): void {
    this.fling.set(0, 0);
    this.glide.set(0, 0, 0);
    this.targetGoal.copy(this.target);
  }

  /** Drag by (dx, dy) CSS pixels: the grabbed point follows the pointer exactly, stopping at the bounds. */
  drag(dxPx: number, dyPx: number, cssHeight: number): void {
    const w = this.worldPerPx(cssHeight);
    this.prevGoal.copy(this.targetGoal);
    this.prevTarget.copy(this.target);
    this.shiftView(-dxPx * w, dyPx * w, true);
    this.clampTarget('follow');
  }

  /** Let go with a velocity (CSS pixels per second): the view coasts on and slows to a stop. */
  release(vxPx: number, vyPx: number, cssHeight: number): void {
    if (this.instant) return;
    const w = this.worldPerPx(cssHeight);
    this.fling.set(-vxPx * w, vyPx * w);
  }

  /** The outline's extent along screen right and up (camera-plane units), around (0, y, 0). Cached per view direction. */
  private span(points: Outline, y: number): Span {
    const k = this.spanCache;
    if (k && k.yaw === this.yaw && k.y === y && k.bounds === points) return k.span;
    const s = Math.sin(this.pitch),
      co = Math.cos(this.pitch);
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const u = new THREE.Vector3(-Math.sin(this.yaw) * s, co, -Math.cos(this.yaw) * s);
    const span = { r0: Infinity, r1: -Infinity, u0: Infinity, u1: -Infinity };
    const d = new THREE.Vector3();
    for (const p of points) {
      d.set(p.x, p.y - y, p.z);
      const a = d.dot(r),
        b = d.dot(u);
      span.r0 = Math.min(span.r0, a);
      span.r1 = Math.max(span.r1, a);
      span.u0 = Math.min(span.u0, b);
      span.u1 = Math.max(span.u1, b);
    }
    this.spanCache = { yaw: this.yaw, y, bounds: points, span };
    return span;
  }

  /**
   * How freely a town that fits the view may move off centre (viewRange's `freedom`): none at the
   * widest zoom, where it sits centred like a postcard, rising to full at the zoom where it just
   * fills Fit's frame. Continuous in zoom, so zooming out past that point eases the town home
   * instead of snapping it there.
   */
  private freedom(sp: Span): number {
    const zFit = Math.min(
      (this.baseHalfH * this.aspect * FIT_FILL_R) / Math.max((sp.r1 - sp.r0) / 2, 1e-3),
      (this.baseHalfH * FIT_FILL_U) / Math.max((sp.u1 - sp.u0) / 2, 1e-3),
    );
    const min = this.minZoom;
    if (zFit <= min + 1e-6) return 1; // it never fits (a portrait phone): nothing to hold centred
    return clamp((this.zoom - min) / (zFit - min), 0, 1);
  }

  /**
   * Keep the town in view, per screen axis, from what of its outline is visible at this zoom and
   * rotation (rooftops included, so a zoomed-in view can reach the tallest chimney). Zoomed in, you
   * can reach every edge; while it fits, it can move about but is never lost (at most a quarter of
   * a view of it off screen); at the widest zoom it is centred (see viewRange, freedom). Returns
   * whether it moved anything.
   * - 'hard' puts both the view and its goal inside (rotation, steps, resize: the caller dissolves or relayouts);
   * - 'goal' moves only the goal, and the view eases after it;
   * - 'follow' (dragging, flinging) stops each at the bounds but never pulls one further in than it already is,
   *   so a view still easing back from a zoom never jumps.
   */
  clampTarget(mode: ClampMode = 'hard'): boolean {
    const b = this.bounds;
    if (!b || !b.length) return false;
    const sp = this.span(b, this.targetGoal.y);
    const sinP = Math.sin(this.pitch);
    const vr = this.halfH * this.aspect,
      vu = this.halfH;
    const free = this.freedom(sp);
    // nothing of the HUD sits at the sides, so across the screen the town may reach the very edge
    const [rLo, rHi] = viewRange(sp.r0, sp.r1, vr, SLACK_R, 0, free);
    const [uLo, uHi] = viewRange(sp.u0, sp.u1, vu, SLACK_U, (1 - FIT_FILL_U) * vu, free);
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; // screen right on the ground
    const f = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; // screen up on the ground (away from the camera)
    const hit = this.hit;
    hit.r = hit.u = false;
    const fit = (v: THREE.Vector3, prev: THREE.Vector3 | null): void => {
      const a = v.x * r.x + v.z * r.z,
        c = (v.x * f.x + v.z * f.z) * sinP; // camera-plane units up
      let lo = rLo,
        hi = rHi,
        lu = uLo,
        hu = uHi;
      if (prev) {
        const pa = prev.x * r.x + prev.z * r.z,
          pc = (prev.x * f.x + prev.z * f.z) * sinP;
        lo = Math.min(lo, pa);
        hi = Math.max(hi, pa);
        lu = Math.min(lu, pc);
        hu = Math.max(hu, pc);
      }
      const a2 = clamp(a, lo, hi),
        c2 = clamp(c, lu, hu) / sinP;
      const movedR = Math.abs(a2 - a) >= 1e-9,
        movedU = Math.abs(c2 - c / sinP) >= 1e-9;
      if (!movedR && !movedU) return;
      hit.r ||= movedR;
      hit.u ||= movedU;
      v.x = a2 * r.x + c2 * f.x;
      v.z = a2 * r.z + c2 * f.z;
    };
    if (mode === 'follow') {
      fit(this.targetGoal, this.prevGoal);
      fit(this.target, this.prevTarget);
    } else {
      fit(this.targetGoal, null);
      if (mode === 'hard') {
        fit(this.target, null);
        this.glide.set(0, 0, 0); // a cut (rotation, Fit, a scripted zoom) leaves nothing gliding
      }
    }
    return hit.r || hit.u;
  }
  /** Which screen axes the last clamp moved something along (a fling stops only along those). */
  private readonly hit = { r: false, u: false };

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
   * tiny, so it gets its widest view (0.5×) centred on the street instead.
   */
  fitZoom(points: readonly THREE.Vector3[], centre: THREE.Vector3): number {
    const e = this.extent(points, centre);
    const zx = (this.baseHalfH * this.aspect * FIT_FILL_R) / Math.max(e.w, 1e-3);
    const zy = (this.baseHalfH * FIT_FILL_U) / Math.max(e.h, 1e-3);
    const z = clamp(Math.min(zx, zy), this.minZoom, MAX_ZOOM);
    if (this.continuous) return z;
    // palette looks: the largest step that still fits
    const steps = this.steps;
    return [...steps].reverse().find((s) => s <= z + 1e-6) ?? steps[0]!;
  }

  /** Frame the whole town: centre on its projected middle and zoom to fit. Instant (the caller dissolves). */
  fit(points: readonly THREE.Vector3[], centre: THREE.Vector3): void {
    const z = this.fitZoom(points, centre);
    this.zoom = this.zoomGoal = z;
    this.anchor = null;
    this.fling.set(0, 0);
    this.glide.set(0, 0, 0);
    this.halfH = this.baseHalfH / z;
    this.updateProjection();
    this.targetGoal.copy(centre);
    this.target.copy(centre);
    this.update(0); // matrices for this yaw before shifting along them
    const e = this.extent(points, centre);
    this.shiftView(e.mx, e.my, true);
    this.clampTarget('hard');
  }

  /** Is a smooth zoom still easing? (The caller refreshes the build preview while it does.) */
  get zooming(): boolean {
    return Math.abs(Math.log(this.zoomGoal / this.zoom)) > 1e-4;
  }

  /** Is the view coasting after a fling? */
  get coasting(): boolean {
    return this.fling.lengthSq() > 0;
  }

  update(dt: number): void {
    this.sinceZoomIn += dt;
    if (this.zooming) {
      // ease in log space: the same feel zooming in and out
      const l = this.instant ? Math.log(this.zoomGoal) : damp(Math.log(this.zoom), Math.log(this.zoomGoal), ZOOM_RATE, dt);
      this.applyZoom(Math.abs(l - Math.log(this.zoomGoal)) < 1e-4 ? this.zoomGoal : Math.exp(l));
      if (!this.zooming) this.anchor = null;
    }
    if (this.coasting && dt > 0) {
      this.prevGoal.copy(this.targetGoal);
      this.prevTarget.copy(this.target);
      this.shiftView(this.fling.x * dt, this.fling.y * dt, true);
      // the bounds end the coast along the axis they stop, so a diagonal flick slides along an edge
      this.clampTarget('follow');
      if (this.hit.r) this.fling.x = 0;
      if (this.hit.u) this.fling.y = 0;
      this.fling.multiplyScalar(Math.exp(-FLING_FRICTION * dt));
      if (this.fling.length() < FLING_STOP) this.fling.set(0, 0);
    }
    // the bounds wait for a zoom in (and for fingers) to settle, then the view eases back inside
    const zoomingIn = this.zooming && this.zoomGoal > this.zoom;
    if (!this.hold && !zoomingIn && this.sinceZoomIn >= BOUNDS_SETTLE_S) this.clampTarget('goal');
    if (this.instant) {
      this.target.copy(this.targetGoal);
      this.glide.set(0, 0, 0);
    } else if (dt > 0) {
      // Critically damped spring, solved exactly (stable at any dt): a glide gathers speed and
      // settles without overshoot. Plain exponential smoothing starts at full speed, which reads
      // as a jolt at the start of every pan and every ease back into the bounds.
      const e = Math.exp(-PAN_OMEGA * dt);
      const x = this.target.clone().sub(this.targetGoal);
      const tmp = this.glide.clone().addScaledVector(x, PAN_OMEGA).multiplyScalar(dt);
      this.glide.addScaledVector(tmp, -PAN_OMEGA).multiplyScalar(e);
      this.target.copy(this.targetGoal).add(x.add(tmp).multiplyScalar(e));
      if (this.target.distanceToSquared(this.targetGoal) < 1e-10 && this.glide.lengthSq() < 1e-8) {
        this.target.copy(this.targetGoal);
        this.glide.set(0, 0, 0);
      }
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
    // texel snap, and the error it made for the presentation to undo (see `subpixel`)
    const px = (2 * this.halfH) / this.rtHeight;
    this.right.setFromMatrixColumn(c.matrixWorld, 0);
    this.up.setFromMatrixColumn(c.matrixWorld, 1);
    const dx = c.position.dot(this.right);
    const dy = c.position.dot(this.up);
    const ex = Math.round(dx / px) * px - dx;
    const ey = Math.round(dy / px) * px - dy;
    c.position.addScaledVector(this.right, ex);
    c.position.addScaledVector(this.up, ey);
    c.updateMatrixWorld();
    // the snapped camera sits ex right and ey up of the true one, so its image is ex left and ey low
    this.subpixel.x = ex / px;
    this.subpixel.y = -ey / px;
  }

  private updateProjection(): void {
    const c = this.camera;
    const m = (this.margin * 2 * this.halfH) / this.rtHeight;
    c.left = -this.halfH * this.aspect - m;
    c.right = this.halfH * this.aspect + m;
    c.top = this.halfH + m;
    c.bottom = -this.halfH - m;
    c.updateProjectionMatrix();
  }
}
