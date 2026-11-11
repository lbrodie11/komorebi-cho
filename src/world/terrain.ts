import { pointInPolygon, inRect } from '../core/math';
import { BRIDGE, G, ISLET, POND, REGIONS, STEPS, TG, TERRACE_FRONT_Z, type Region } from './layout';

/** First walkable region containing the point, if any. */
export function regionAt(x: number, z: number): Region | undefined {
  for (const r of REGIONS) if (inRect(x, z, r)) return r;
  return undefined;
}

export function onBridge(x: number, z: number): boolean {
  return Math.abs(z - BRIDGE.z) < BRIDGE.halfW && x > BRIDGE.x0 && x < BRIDGE.x1;
}
export function onIslet(x: number, z: number): boolean {
  return Math.hypot(x - ISLET.x, z - ISLET.z) < ISLET.r - 0.1;
}
export function inPond(x: number, z: number): boolean {
  return pointInPolygon(x, z, POND);
}

/** Surface height at a point: what feet stand on. */
export function groundHeight(x: number, z: number): number {
  if (inRect(x, z, STEPS)) return G + 1.4 * ((TERRACE_FRONT_Z - z) / (STEPS.z1 - STEPS.z0));
  if (z < TERRACE_FRONT_Z) return TG;
  if (onBridge(x, z)) {
    const t = (x - BRIDGE.x0) / (BRIDGE.x1 - BRIDGE.x0);
    return G + 0.15 + Math.sin(t * Math.PI) * BRIDGE.rise;
  }
  if (onIslet(x, z)) return G + 0.3;
  const r = regionAt(x, z);
  if (r && (r.kind === 'grass' || r.kind === 'front')) return G + 0.1;
  return G + 0.02;
}

/** Is this a place feet may go, ignoring obstacles? */
export function isWalkableSurface(x: number, z: number): boolean {
  if (onBridge(x, z) || onIslet(x, z)) return true;
  if (inPond(x, z)) return false;
  return regionAt(x, z) !== undefined;
}
