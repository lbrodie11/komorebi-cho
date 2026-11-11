export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));

export type Vec2 = readonly [number, number];

export function pointInPolygon(x: number, z: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if (pi[1] > z !== pj[1] > z && x < ((pj[0] - pi[0]) * (z - pi[1])) / (pj[1] - pi[1]) + pi[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export const inRect = (x: number, z: number, r: Rect): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Hex "#rrggbb" to [r,g,b] in 0..1 sRGB (no colour-management conversion). */
export function hexToSrgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToSrgb(a);
  const B = hexToSrgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i]!, t) * 255));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
