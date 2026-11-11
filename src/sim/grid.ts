import type { Obstacle } from '../world/layout';

export interface GridSpec {
  x0: number;
  z0: number;
  w: number; // metres
  d: number; // metres
  cell: number;
}

export interface Surface {
  walkable(x: number, z: number): boolean;
  height(x: number, z: number): number;
}

/** Max step between neighbouring cells (stairs pass, the 1.4 m terrace wall does not). */
const MAX_STEP = 0.45;

/**
 * Walkability grid + A*. Cheap enough to rebuild a region on every edit, small
 * enough (0.5 m cells, ~3.5k cells) that A* is instant. Dynamic obstacles
 * (player-placed props) are stamped in/out with reference counts so removing
 * one prop never unblocks another overlapping one.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly base: Uint8Array; // surface walkable (static)
  private readonly blocked: Uint16Array; // obstacle reference counts
  private readonly heights: Float32Array;
  /** Bumped whenever walkability changes; agents compare to know when to re-path. */
  version = 0;

  constructor(
    readonly spec: GridSpec,
    private readonly surface: Surface,
    statics: readonly Obstacle[] = [],
  ) {
    this.cols = Math.round(spec.w / spec.cell);
    this.rows = Math.round(spec.d / spec.cell);
    const n = this.cols * this.rows;
    this.base = new Uint8Array(n);
    this.blocked = new Uint16Array(n);
    this.heights = new Float32Array(n);
    for (let j = 0; j < this.rows; j++)
      for (let i = 0; i < this.cols; i++) {
        const [x, z] = this.center(i, j);
        const k = j * this.cols + i;
        this.base[k] = surface.walkable(x, z) ? 1 : 0;
        this.heights[k] = surface.height(x, z);
      }
    for (const o of statics) this.stamp(o, 1);
  }

  center(i: number, j: number): [number, number] {
    return [this.spec.x0 + (i + 0.5) * this.spec.cell, this.spec.z0 + (j + 0.5) * this.spec.cell];
  }
  cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.spec.x0) / this.spec.cell), Math.floor((z - this.spec.z0) / this.spec.cell)];
  }
  inBounds(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows;
  }
  open(i: number, j: number): boolean {
    if (!this.inBounds(i, j)) return false;
    const k = j * this.cols + i;
    return this.base[k] === 1 && this.blocked[k] === 0;
  }
  isOpenAt(x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return this.open(i, j);
  }
  heightAt(i: number, j: number): number {
    return this.heights[j * this.cols + i] ?? 0;
  }

  /** Add (+1) or remove (-1) an obstacle footprint. */
  /** A checksum of every cell's obstacle count: an undone edit must leave no phantom obstacle behind. */
  get occupancyHash(): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.blocked.length; i++) h = Math.imul(h ^ this.blocked[i]!, 0x01000193);
    return h >>> 0;
  }

  stamp(o: Obstacle, delta: 1 | -1): void {
    const pad = 0.15;
    let x0: number, x1: number, z0: number, z1: number;
    let circle: { x: number; z: number; r: number } | null = null;
    if ('rect' in o) {
      x0 = o.x0 - pad;
      x1 = o.x1 + pad;
      z0 = o.z0 - pad;
      z1 = o.z1 + pad;
    } else {
      circle = { x: o.x, z: o.z, r: o.r + pad };
      x0 = o.x - circle.r;
      x1 = o.x + circle.r;
      z0 = o.z - circle.r;
      z1 = o.z + circle.r;
    }
    const [i0, j0] = this.cellOf(x0, z0);
    const [i1, j1] = this.cellOf(x1, z1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (!this.inBounds(i, j)) continue;
        if (circle) {
          const [cx, cz] = this.center(i, j);
          if (Math.hypot(cx - circle.x, cz - circle.z) > circle.r + this.spec.cell * 0.35) continue;
        }
        const k = j * this.cols + i;
        this.blocked[k] = Math.max(0, (this.blocked[k] ?? 0) + delta);
      }
    this.version++;
  }

  /** Nearest open cell centre to a point (spiral search), for snapping goals. */
  nearestOpen(x: number, z: number, maxRing = 8): [number, number] | null {
    const [ci, cj] = this.cellOf(x, z);
    if (this.open(ci, cj)) return this.center(ci, cj);
    for (let r = 1; r <= maxRing; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (!this.open(ci + di, cj + dj)) continue;
          const c = this.center(ci + di, cj + dj);
          const d = Math.hypot(c[0] - x, c[1] - z);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      if (best) return best;
    }
    return null;
  }

  private canStep(i: number, j: number, ni: number, nj: number): boolean {
    if (!this.open(ni, nj)) return false;
    return Math.abs(this.heightAt(i, j) - this.heightAt(ni, nj)) <= MAX_STEP;
  }

  /** A* with octile heuristic, no corner cutting, then line-of-sight smoothing. */
  findPath(sx: number, sz: number, gx: number, gz: number): [number, number][] | null {
    const start = this.nearestOpen(sx, sz, 3);
    const goal = this.nearestOpen(gx, gz, 6);
    if (!start || !goal) return null;
    const [si, sj] = this.cellOf(start[0], start[1]);
    const [gi, gj] = this.cellOf(goal[0], goal[1]);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - gi),
        dy = Math.abs(j - gj);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    const s = sj * this.cols + si;
    g[s] = 0;
    heap.push(s, h(si, sj));
    const goalK = gj * this.cols + gi;
    let found = false;
    while (heap.size) {
      const k = heap.pop();
      if (k === goalK) {
        found = true;
        break;
      }
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % this.cols,
        j = (k - i) / this.cols;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di,
            nj = j + dj;
          if (!this.canStep(i, j, ni, nj)) continue;
          if (di && dj && (!this.canStep(i, j, i + di, j) || !this.canStep(i, j, i, j + dj))) continue;
          const nk = nj * this.cols + ni;
          const cost = (g[k] ?? 0) + (di && dj ? Math.SQRT2 : 1);
          if (cost < (g[nk] ?? Infinity)) {
            g[nk] = cost;
            came[nk] = k;
            heap.push(nk, cost + h(ni, nj));
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = goalK; k !== -1; k = came[k] ?? -1) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.center(k % this.cols, Math.floor(k / this.cols)));
    pts[pts.length - 1] = [gx, gz];
    if (!this.isOpenAt(gx, gz)) pts[pts.length - 1] = goal;
    return this.smooth(pts);
  }

  /** Remove intermediate points that have clear, flat line of sight. */
  private smooth(pts: [number, number][]): [number, number][] {
    if (pts.length <= 2) return pts;
    const out: [number, number][] = [pts[0]!];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineClear(pts[anchor]!, pts[i]!)) {
        out.push(pts[i - 1]!);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  }

  lineClear(a: readonly [number, number], b: readonly [number, number]): boolean {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.spec.cell * 0.4));
    let [pi, pj] = this.cellOf(a[0], a[1]);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const [i, j] = this.cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (i === pi && j === pj) continue;
      if (!this.canStep(pi, pj, i, j)) return false;
      pi = i;
      pj = j;
    }
    return true;
  }

  /** Does a remaining path cross any now-blocked cell? */
  pathBlocked(path: readonly (readonly [number, number])[], from: number): boolean {
    for (let i = Math.max(1, from); i < path.length; i++) if (!this.lineClear(path[i - 1]!, path[i]!)) return true;
    return false;
  }

  /** Random open point inside a rectangle (for wandering). */
  randomOpenIn(rand: () => number, x0: number, x1: number, z0: number, z1: number, tries = 20): [number, number] | null {
    for (let t = 0; t < tries; t++) {
      const x = x0 + (x1 - x0) * rand();
      const z = z0 + (z1 - z0) * rand();
      if (this.isOpenAt(x, z)) return [x, z];
    }
    return null;
  }
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, pri: number): void {
    this.k.push(key);
    this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.p[parent]! <= this.p[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.k[0]!;
    const lastK = this.k.pop()!;
    const lastP = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lastK;
      this.p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l]! < this.p[m]!) m = l;
        if (r < this.k.length && this.p[r]! < this.p[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.p[a], this.p[b]] = [this.p[b]!, this.p[a]!];
  }
}
