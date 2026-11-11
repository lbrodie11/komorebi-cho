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
 * enough (0.5 m cells, 3.3k cells) that A* is instant (docs/NAV.md has the
 * numbers). Dynamic obstacles (player-placed props) are stamped in/out with
 * reference counts so removing one prop never unblocks another overlapping one.
 * Connected regions are labelled lazily after each change, so a path between two
 * regions fails at once instead of searching the whole town, and anything sealed
 * off from the doors and exits (an island) can be found.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly base: Uint8Array; // surface walkable (static)
  private readonly blocked: Uint16Array; // obstacle reference counts
  private readonly heights: Float32Array;
  /** Bumped whenever walkability changes; agents compare to know when to re-path. */
  version = 0;
  /** Connected region of each cell (-1: closed), for `version` `labelled`. */
  private readonly comp: Int32Array;
  private labelled = -1;
  private mainComp = -1;
  /** Where people come and go (doors, exits): the region holding most of them is the town; the rest are islands. */
  private anchors: () => readonly (readonly [number, number])[] = () => [];

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
    this.comp = new Int32Array(n);
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

  /** The doors and exits that define the town's main region (see `island`). */
  setAnchors(anchors: () => readonly (readonly [number, number])[]): void {
    this.anchors = anchors;
    this.labelled = -1;
  }

  /**
   * Label connected regions (4-neighbour flood with the same step rule as A*: a diagonal move
   * needs both orthogonal moves, so it never joins regions the orthogonals don't). Lazy: once
   * per walkability change.
   */
  private label(): void {
    if (this.labelled === this.version) return;
    this.labelled = this.version;
    const comp = this.comp;
    comp.fill(-1);
    const stack: number[] = [];
    let next = 0;
    for (let k = 0; k < comp.length; k++) {
      const i0 = k % this.cols;
      if (comp[k] !== -1 || !this.open(i0, (k - i0) / this.cols)) continue;
      comp[k] = next;
      stack.push(k);
      while (stack.length) {
        const c = stack.pop()!;
        const i = c % this.cols,
          j = (c - i) / this.cols;
        for (let d = 0; d < 4; d++) {
          const ni = i + (d === 0 ? 1 : d === 1 ? -1 : 0),
            nj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!this.canStep(i, j, ni, nj)) continue;
          const nk = nj * this.cols + ni;
          if (comp[nk] !== -1) continue;
          comp[nk] = next;
          stack.push(nk);
        }
      }
      next++;
    }
    // the main region: the one most doors and exits open onto (ties: the lower label, deterministic)
    const votes = new Map<number, number>();
    for (const [x, z] of this.anchors()) {
      const p = this.nearestOpen(x, z, 3);
      if (!p) continue;
      const c = this.regionAt(p[0], p[1]);
      votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    let best = -1,
      bv = 0;
    for (const [c, v] of votes) if (v > bv || (v === bv && c < best)) [best, bv] = [c, v];
    this.mainComp = best;
  }

  /** The connected region at a point (-1 if the cell is closed). */
  regionAt(x: number, z: number): number {
    this.label();
    const [i, j] = this.cellOf(x, z);
    return this.inBounds(i, j) ? this.comp[j * this.cols + i]! : -1;
  }

  /** Is this open point sealed off from the town's doors and exits (an island the player's edits made)? */
  island(x: number, z: number): boolean {
    const r = this.regionAt(x, z);
    this.label();
    return r !== -1 && this.mainComp !== -1 && r !== this.mainComp;
  }

  /** Every open cell centre on an island, for the build tool's "unreachable" hint. */
  islandCells(): [number, number][] {
    this.label();
    const out: [number, number][] = [];
    if (this.mainComp === -1) return out;
    for (let k = 0; k < this.comp.length; k++) {
      const c = this.comp[k]!;
      if (c === -1 || c === this.mainComp) continue;
      const i = k % this.cols;
      out.push(this.center(i, (k - i) / this.cols));
    }
    return out;
  }

  /**
   * The nearest open point in the town's main region, searching outward through anything (a
   * resident sealed in by a ring of planters steps over the nearest one). Null if none is near.
   */
  nearestMain(x: number, z: number, maxRing = 8): [number, number] | null {
    this.label();
    if (this.mainComp === -1) return null;
    // ground at their own level first (never over the terrace wall), any level only if there's none
    const y = this.surfaceAt(x, z);
    return (
      this.spiral(x, z, maxRing, (i, j) => this.comp[j * this.cols + i] === this.mainComp && Math.abs(this.heightAt(i, j) - y) <= MAX_STEP) ??
      this.nearestInRegion(x, z, this.mainComp, maxRing)
    );
  }

  /** The nearest open cell to (x, z) at the level of `from` (a step away for someone there, not over a wall). */
  nearestOpenLevel(x: number, z: number, maxRing = 8, from: readonly [number, number] = [x, z]): [number, number] | null {
    const y = this.surfaceAt(from[0], from[1]);
    return this.spiral(x, z, maxRing, (i, j) => this.open(i, j) && Math.abs(this.heightAt(i, j) - y) <= MAX_STEP);
  }

  /** The ground height of the cell under a point. */
  private surfaceAt(x: number, z: number): number {
    const [i, j] = this.cellOf(x, z);
    return this.inBounds(i, j) ? this.heightAt(i, j) : 0;
  }

  /** The nearest open cell centre of region `region` within `maxRing` cells of a point. */
  private nearestInRegion(x: number, z: number, region: number, maxRing: number): [number, number] | null {
    return this.spiral(x, z, maxRing, (i, j) => this.comp[j * this.cols + i] === region);
  }

  /** The nearest cell centre (ring by ring outward from the point's cell) where `ok` holds. */
  private spiral(x: number, z: number, maxRing: number, ok: (i: number, j: number) => boolean): [number, number] | null {
    const [ci, cj] = this.cellOf(x, z);
    for (let r = 0; r <= maxRing; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = ci + di,
            j = cj + dj;
          if (!this.inBounds(i, j) || !ok(i, j)) continue;
          const c = this.center(i, j);
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

  /**
   * Is someone at (x, z) sealed off from the town? On an island cell, yes; on a closed cell (sitting
   * on a bench, inside a slot), only if no cell of the main region is within a step or two.
   */
  trapped(x: number, z: number): boolean {
    this.label();
    if (this.mainComp === -1) return false;
    const r = this.regionAt(x, z);
    if (r !== -1) return r !== this.mainComp;
    return this.nearestInRegion(x, z, this.mainComp, 3) === null && this.nearestOpen(x, z, 3) !== null;
  }

  /** Nearest open cell centre to a point (spiral search), for snapping goals. */
  nearestOpen(x: number, z: number, maxRing = 8): [number, number] | null {
    return this.spiral(x, z, maxRing, (i, j) => this.open(i, j));
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
    // different regions: no path, known at once (an unreachable goal used to search the whole town).
    // Someone on a closed cell (a bench seat) may have a pocket behind them and the street in front:
    // start from the goal's region if it's a step or two away.
    if (this.regionAt(start[0], start[1]) !== this.regionAt(goal[0], goal[1])) {
      const alt = this.isOpenAt(sx, sz) ? null : this.nearestInRegion(sx, sz, this.regionAt(goal[0], goal[1]), 3);
      if (!alt) return null;
      start[0] = alt[0];
      start[1] = alt[1];
    }
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

  /** Random open point inside a rectangle (for wandering); never on an island. */
  randomOpenIn(rand: () => number, x0: number, x1: number, z0: number, z1: number, tries = 20): [number, number] | null {
    for (let t = 0; t < tries; t++) {
      const x = x0 + (x1 - x0) * rand();
      const z = z0 + (z1 - z0) * rand();
      if (this.isOpenAt(x, z) && !this.island(x, z)) return [x, z];
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
