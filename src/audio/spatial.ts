/**
 * Where a sound is (prompt 11): a virtual listener at the camera's focus point, not the far-away
 * orthographic camera. A source's pan comes from where it lands on screen (left of the view: left
 * ear), its gain and a low-pass from how far it is from the focus and how far the camera is zoomed
 * out (zoomed out, everything is a little further away). Pure maths, unit-tested.
 */

export interface Listener {
  /** The camera's focus on the ground. */
  x: number;
  z: number;
  /** Camera yaw (radians): which way is "right" on screen. */
  yaw: number;
  /** Zoom (1 = default; < 1 zoomed out). */
  zoom: number;
}

export interface Placement {
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** 0..1. */
  gain: number;
  /** Low-pass cutoff (Hz): far things lose their top. */
  cutoff: number;
}

/** Half the visible width at zoom 1 (m), roughly: a source this far to the side is hard left or right. */
const HALF_VIEW = 14;
/** Distance (m) at which a source has fallen to half its gain. */
const HALF_GAIN = 9;

/**
 * Place a source at (x, z) for the listener. The screen's right vector for an isometric camera at
 * `yaw` is (cos yaw, -sin yaw) on the ground; the source's offset along it is its screen x.
 */
export function place(l: Listener, x: number, z: number): Placement {
  const dx = x - l.x,
    dz = z - l.z;
  const right = dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw);
  const zoom = Math.max(0.3, l.zoom);
  const pan = Math.max(-1, Math.min(1, (right * zoom) / HALF_VIEW)) * 0.85; // never quite hard-panned
  const d = Math.hypot(dx, dz) / zoom;
  const gain = 1 / (1 + (d / HALF_GAIN) ** 2);
  const cutoff = 18000 / (1 + d / 6);
  return { pan, gain, cutoff: Math.max(500, cutoff) };
}

/**
 * Mono fold-down check: a pan law that keeps every source audible in mono (equal-power: a centred
 * source is −3 dB on each side, a hard-panned one never vanishes from the sum).
 */
export function monoLevel(pan: number): number {
  const a = ((pan + 1) * Math.PI) / 4;
  return Math.cos(a) + Math.sin(a);
}
