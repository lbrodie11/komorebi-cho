import * as THREE from 'three';
import type { EventBus, GameEvents } from '../core/events';
import type { Materials } from '../render/materials';
import { BUILDABLE, G, GROUND } from '../world/layout';
import { groundHeight, inPond, onBridge, onIslet, regionAt } from '../world/terrain';
import { PLACEABLES, type LightRef, type PlaceableKind } from '../world/props';
import { clusterLights, crowdFactors } from '../world/crowd';
import type { NavGrid } from '../sim/grid';
import { benchSlots, frontSlot, type SmartObject, type SmartRegistry, type Slot } from '../sim/smart';
import type { Residents } from '../sim/residents';
import type { PlacedRecord } from '../save/storage';
import type { Command } from '../edit/history';
import { SHOP_ROW, shopAt, shopCheck, type ShopExtent, type ShopReason } from '../edit/shops';

export type ToolMode = 'view' | 'build' | 'remove' | 'move';

/** Why a spot can't take a placeable (shown at the cursor; the words are `reason.<key>` in en.ts). */
export type PlaceReason = 'offPlinth' | 'lane' | 'garden' | 'steps' | 'water' | 'bridge' | 'blocked' | 'person' | 'tooClose';

/** The shopping street, as the build tool sees it (main.ts wires it to the world). */
export interface ShopHost {
  /** Every shop's extent as it stands. */
  row(): ShopExtent[];
  /** How tall a shop is (for its ghost). */
  height(id: string): number;
}

/** Rotation step for R / Shift+R. */
export const ROTATE_STEP = Math.PI / 4;
/** Positions snap to this grid (hold Alt to place freely, to the centimetre). */
export const SNAP = 0.25;

/** A ring cut into `dashes` arcs: the "can't place here" ring, readable without colour. */
function dashedRingGeometry(inner: number, outer: number, dashes: number): THREE.BufferGeometry {
  const parts: number[] = [];
  const idx: number[] = [];
  const seg = 3;
  for (let d = 0; d < dashes; d++) {
    const a0 = (d / dashes) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / dashes / 2; // half on, half off
    const base = parts.length / 3;
    for (let k = 0; k <= seg; k++) {
      const a = a0 + ((a1 - a0) * k) / seg;
      parts.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a) * outer, Math.sin(a) * outer, 0);
    }
    for (let k = 0; k < seg; k++) {
      const i = base + k * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  g.setIndex(idx);
  return g;
}

interface Placed extends PlacedRecord {
  object: THREE.Object3D;
  /** Materials made for this object alone (shared ones are left alone on removal). */
  owned: Set<THREE.Material>;
  radius: number;
}

/** A runtime-built object owns its geometry (placeables never share it) and the materials `own()` captured. */
function dispose(object: THREE.Object3D, owned: Set<THREE.Material>, m: Materials): void {
  object.removeFromParent();
  object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  m.release(owned);
}

/**
 * The builder loop: choose -> preview (ghost + validity ring) -> commit.
 * Commit is a small transaction: geometry in, nav footprint stamped, smart
 * object registered, event published so residents can notice. Removal runs the
 * same steps backwards and lets anyone using the object down gently.
 */
export class BuildTool {
  mode: ToolMode = 'view';
  kind: PlaceableKind = 'bench';
  ry = 0;
  readonly placed = new Map<string, Placed>();
  private ghost: { object: THREE.Object3D; owned: Set<THREE.Material> } | null = null;
  /** Skip the placement "pop" (Settings → Reduced motion). */
  reducedMotion = false;
  private readonly ring: THREE.Mesh;
  /** Valid spots get a solid green ring, invalid ones a dashed red ring: the shape says it, not only the colour. */
  private readonly okMat = new THREE.MeshBasicMaterial({ color: '#86b45a' });
  private readonly badMat = new THREE.MeshBasicMaterial({ color: '#d0402a' });
  private readonly solidRing = new THREE.RingGeometry(0.5, 0.62, 20);
  private readonly dashedRing = dashedRingGeometry(0.5, 0.62, 10);
  private hover: { x: number; z: number; ok: boolean } | null = null;
  private hoverRemove: Placed | null = null;
  /** Move mode: the placed thing being carried (hidden in place until it's put down). */
  private held: Placed | null = null;
  /** Why the spot under the cursor is invalid, if it is. */
  reason: PlaceReason | ShopReason | null = null;
  /** The shopping street (move mode can pick up a shop-house, slide it and resize it). */
  shops: ShopHost | null = null;
  /** Move mode: the shop under the pointer (nothing placed nearer). */
  private shopHover: ShopExtent | null = null;
  /** Move mode: the shop being carried: where it was, its frontage now, where the pointer took hold, where it would go. */
  private held_: { id: string; from: { z0: number; z1: number }; front: number; grab: number; z0: number; z1: number; ok: boolean } | null = null;
  /** Told when a shop is picked up or put down (the HUD shows Narrower / Wider; the frame loop may be idle). */
  onShopCarry: ((carrying: boolean) => void) | null = null;
  private get heldShop() {
    return this.held_;
  }
  private set heldShop(v) {
    const was = this.held_ !== null;
    this.held_ = v;
    if (was !== (v !== null)) this.onShopCarry?.(v !== null);
  }
  /** The pointer's last ground point and snap mode, so a resize can re-place the carried shop. */
  private lastHit: { z: number; free: boolean } | null = null;
  /**
   * A shop's ghost: a translucent block where it would stand, outlined on top of everything (trees
   * and eaves hide the street). It fits: a tinted block and a solid green outline. It doesn't: no
   * tint and a dashed red outline, so the shape says it, not only the colour.
   */
  private readonly shopGhost = new THREE.Group();
  private readonly shopFill: THREE.Mesh;
  private readonly shopEdges: THREE.LineSegments;
  private readonly shopOkLine = new THREE.LineBasicMaterial({ color: '#86b45a', depthTest: false, transparent: true });
  /** The "unreachable" hint: a dot on every cell the player's edits have sealed off from the town. */
  private readonly islandDots: THREE.InstancedMesh;
  private islandsAt = -1;
  private readonly shopBadLine = new THREE.LineDashedMaterial({ color: '#d0402a', depthTest: false, transparent: true, dashSize: 0.12, gapSize: 0.1 });
  /** Every edit goes through here (the history, in main.ts); without it, clicks apply directly. */
  onCommit: ((c: Command) => void) | null = null;
  private counter = 0;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly m: Materials,
    private readonly grid: NavGrid,
    private readonly smart: SmartRegistry,
    private readonly residents: Residents,
    private readonly bus: EventBus<GameEvents>,
    private readonly hourNow: () => number,
    private readonly lightPool: LightRef[] = [],
  ) {
    this.ring = new THREE.Mesh(this.solidRing, this.okMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    root.add(this.ring);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.shopFill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: '#86b45a', transparent: true, opacity: 0.4, depthWrite: false }));
    this.shopEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.shopOkLine);
    this.shopEdges.computeLineDistances();
    this.shopEdges.renderOrder = 3;
    this.shopGhost.add(this.shopFill, this.shopEdges);
    const dot = new THREE.PlaneGeometry(0.14, 0.14).rotateX(-Math.PI / 2);
    this.islandDots = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial({ color: '#ffd37a' }), grid.cols * grid.rows);
    this.islandDots.count = 0;
    this.islandDots.visible = false;
    root.add(this.islandDots);
    this.shopGhost.visible = false;
    root.add(this.shopGhost);
  }

  /**
   * While building, show where edits have sealed ground off from every door and exit (a dotted
   * patch): nobody can get there, and anyone caught inside steps out. Once a frame; it only
   * rebuilds when the nav grid changed.
   */
  showIslands(): void {
    const on = this.mode !== 'view';
    this.islandDots.visible = on;
    if (!on || this.islandsAt === this.grid.version) return;
    this.islandsAt = this.grid.version;
    const cells = this.grid.islandCells();
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], i) => this.islandDots.setMatrixAt(i, m.makeTranslation(x, groundHeight(x, z) + 0.04, z)));
    this.islandDots.count = cells.length;
    this.islandDots.instanceMatrix.needsUpdate = true;
    // three culls an InstancedMesh by a sphere computed once: recompute it, or new dots can be culled
    this.islandDots.computeBoundingSphere();
  }

  /** Show the shop ghost over z0..z1 (a hover highlight, or where a carried shop would go). */
  private showShop(id: string, z0: number, z1: number, ok: boolean): void {
    const h = (this.shops?.height(id) ?? 4) + 0.6;
    const g = this.shopGhost;
    this.shopFill.visible = ok;
    this.shopEdges.material = ok ? this.shopOkLine : this.shopBadLine;
    g.scale.set(SHOP_ROW.x1 - SHOP_ROW.x0 + 0.2, h, z1 - z0 + 0.1);
    g.position.set((SHOP_ROW.x0 + SHOP_ROW.x1) / 2, G + h / 2, (z0 + z1) / 2);
    g.visible = true;
  }

  /** Re-place the carried shop for the pointer at `z` (its frontage keeps its offset from where it was grabbed). */
  private placeHeldShop(z: number, free: boolean): void {
    const h = this.heldShop;
    if (!h || !this.shops) return;
    const q = free ? 100 : 1 / SNAP;
    // whole steps from where it started, so a shop off the grid (the street as first laid out) slides in tidy steps
    // to the centimetre: float noise must not reach the history, the save or the world hash
    const cm = (v: number) => Math.round(v * 100) / 100;
    const z0 = cm(h.from.z0 + Math.round((z - h.grab) * q) / q);
    const z1 = cm(z0 + h.front);
    this.reason = shopCheck(this.shops.row(), h.id, z0, z1);
    h.z0 = z0;
    h.z1 = z1;
    h.ok = this.reason === null;
    this.showShop(h.id, z0, z1, h.ok);
  }

  /** `[` / `]`: make the carried shop's frontage narrower or wider by one step (it grows northward). */
  resizeShop(dir: 1 | -1): boolean {
    const h = this.heldShop;
    if (!h) return false;
    h.front = Math.round((h.front + dir * SHOP_ROW.resizeStep) * 100) / 100;
    this.placeHeldShop(this.lastHit?.z ?? h.grab, this.lastHit?.free ?? false);
    return true;
  }

  /** Is a shop being carried (move mode)? */
  get carryingShop(): boolean {
    return this.heldShop !== null;
  }

  setMode(mode: ToolMode, kind?: PlaceableKind): void {
    this.dropHeld(); // switching tools puts anything being carried back where it was
    this.mode = mode;
    this.reason = null;
    if (kind) this.kind = kind;
    if (this.ghost) dispose(this.ghost.object, this.ghost.owned, this.m);
    this.ghost = null;
    this.hover = null;
    this.hoverRemove = null;
    this.shopHover = null;
    this.shopGhost.visible = false;
    this.ring.visible = false;
    if (mode === 'build') {
      const { result, owned } = this.m.own(() => PLACEABLES[this.kind].build(this.m).object);
      result.visible = false;
      this.root.add(result);
      this.ghost = { object: result, owned };
    }
  }

  /** Turn the item being placed or carried by one step (R; Shift+R the other way). */
  rotate(dir: 1 | -1 = 1): void {
    const t = Math.PI * 2;
    this.ry = (((this.ry + dir * ROTATE_STEP) % t) + t) % t;
    if (this.ghost) this.ghost.object.rotation.y = this.ry;
  }

  /** Put a carried item back where it came from (Esc, or a tool change). */
  dropHeld(): void {
    if (this.heldShop) {
      this.heldShop = null;
      this.shopGhost.visible = false;
      this.reason = null;
    }
    if (!this.held) return;
    this.held.object.visible = true;
    this.held = null;
    if (this.ghost) dispose(this.ghost.object, this.ghost.owned, this.m);
    this.ghost = null;
  }

  /** Is something being carried (move mode)? Esc puts it back first. */
  get carrying(): boolean {
    return this.held !== null || this.heldShop !== null;
  }

  /** What a click would act on right now; touch uses it to tell a first tap (preview) from a second (commit). */
  targetKey(): string | null {
    if (this.mode === 'build') return this.hover ? `${this.hover.x},${this.hover.z}` : null;
    if (this.mode === 'remove') return this.hoverRemove?.id ?? null;
    if (this.mode === 'move') {
      if (this.heldShop) return `${this.heldShop.z0},${this.heldShop.z1}`;
      if (this.held) return this.hover ? `${this.hover.x},${this.hover.z}` : null;
      return this.hoverRemove?.id ?? (this.shopHover ? `shop-${this.shopHover.id}` : null);
    }
    return null;
  }

  /**
   * Why `kind` can't go at (x, z), or null if it can: hard rules only (the ground, the water,
   * buildings and paths, people standing there, other placed things). `ignoreId` skips one placed
   * item (the one being moved).
   */
  placeCheck(kind: PlaceableKind, x: number, z: number, opts: { ignoreResidents?: boolean; ignoreId?: string } = {}): PlaceReason | null {
    const def = PLACEABLES[kind];
    if (!def) return 'blocked';
    const ground = (px: number, pz: number): PlaceReason | null => {
      if (px < GROUND.x0 || px > GROUND.x1 || pz < GROUND.z0 || pz > GROUND.z1) return 'offPlinth';
      if (inPond(px, pz) || onIslet(px, pz)) return 'water';
      if (onBridge(px, pz)) return 'bridge';
      const reg = regionAt(px, pz);
      if (!reg) return 'offPlinth';
      if (BUILDABLE.includes(reg.kind)) return null;
      return reg.kind === 'soil' ? 'garden' : reg.kind === 'steps' || reg.kind === 'terrace' ? 'steps' : 'lane';
    };
    const centre = ground(x, z);
    if (centre) return centre;
    const r = def.radius;
    for (const [dx, dz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const) {
      const g = ground(x + dx, z + dz);
      if (g) return g;
    }
    // the item being moved still holds its own spot on the nav grid: don't count it as in the way
    const held = opts.ignoreId ? this.placed.get(opts.ignoreId) : undefined;
    const open = (px: number, pz: number) => this.grid.isOpenAt(px, pz) || (!!held && Math.hypot(px - held.x, pz - held.z) <= held.radius + 0.3);
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const)
      if (!open(x + dx, z + dz)) return 'blocked';
    if (!opts.ignoreResidents && this.residents.anyoneNear(x, z, r + 0.4)) return 'person';
    for (const p of this.placed.values()) if (p.id !== opts.ignoreId && Math.hypot(p.x - x, p.z - z) < p.radius + r + 0.2) return 'tooClose';
    return null;
  }

  /** Validity: soft ground only, not on water/bridges, clear of obstacles, people and other placements. */
  canPlace(kind: PlaceableKind, x: number, z: number, opts: { ignoreResidents?: boolean; ignoreId?: string } = {}): boolean {
    return this.placeCheck(kind, x, z, opts) === null;
  }

  /** Follow the pointer's ray. `free`: no grid snap (Alt held), positions to the centimetre. */
  pointer(ray: THREE.Ray, free = false): void {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(G + 0.1));
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) {
      this.hover = null;
      this.reason = null;
      this.ring.visible = false;
      return;
    }
    const q = free ? 100 : 1 / SNAP;
    const x = Math.round(hit.x * q) / q;
    const z = Math.round(hit.z * q) / q;
    this.lastHit = { z: hit.z, free };
    if (this.mode === 'move' && this.heldShop) return this.placeHeldShop(hit.z, free);
    const carrying = this.mode === 'move' && this.held;
    if ((this.mode === 'build' || carrying) && this.ghost) {
      const kind = carrying ? this.held!.kind : this.kind;
      this.reason = this.placeCheck(kind, x, z, carrying ? { ignoreId: this.held!.id } : {});
      const ok = this.reason === null;
      this.hover = { x, z, ok };
      const g = this.ghost.object;
      g.visible = true;
      g.position.set(x, groundHeight(x, z), z);
      g.rotation.y = this.ry;
      this.ring.visible = true;
      this.setRing(ok);
      this.ring.position.set(x, groundHeight(x, z) + 0.03, z);
      const s = PLACEABLES[kind].radius / 0.55;
      this.ring.scale.setScalar(s);
    } else if (this.mode === 'remove' || this.mode === 'move') {
      this.reason = null;
      let best: Placed | null = null;
      let bd = Infinity;
      for (const p of this.placed.values()) {
        const d = Math.hypot(p.x - hit.x, p.z - hit.z);
        if (d < p.radius + 0.5 && d < bd) {
          best = p;
          bd = d;
        }
      }
      this.hoverRemove = best;
      this.ring.visible = !!best;
      // nothing placed under the pointer: a shop-house on the street can be picked up instead
      this.shopHover = this.mode === 'move' && !best && this.shops ? shopAt(this.shops.row(), hit.x, hit.z) : null;
      if (this.shopHover) this.showShop(this.shopHover.id, this.shopHover.z0, this.shopHover.z1, true);
      else this.shopGhost.visible = false;
      if (best) {
        this.setRing(this.mode === 'move'); // remove: the dashed red of "this goes"; move: a solid "pick this up"
        this.ring.position.set(best.x, groundHeight(best.x, best.z) + 0.03, best.z);
        this.ring.scale.setScalar(best.radius / 0.55 + 0.2);
      }
    }
  }

  private setRing(ok: boolean): void {
    this.ring.material = ok ? this.okMat : this.badMat;
    this.ring.geometry = ok ? this.solidRing : this.dashedRing;
  }

  /** Is there a valid spot under the pointer (or keyboard cursor) right now? */
  get canCommit(): boolean {
    if (this.mode === 'build') return !!this.hover?.ok;
    if (this.mode === 'remove') return !!this.hoverRemove;
    if (this.mode === 'move') return this.heldShop ? this.heldShop.ok : this.held ? !!this.hover?.ok : !!this.hoverRemove || !!this.shopHover;
    return false;
  }

  /** Hide the preview (the keyboard cursor left, or the tool changed). */
  clearPreview(): void {
    this.hover = null;
    this.hoverRemove = null;
    this.shopHover = null;
    this.ring.visible = false;
    if (!this.heldShop) this.shopGhost.visible = false;
    if (this.ghost) this.ghost.object.visible = false;
  }

  /** Commit an edit: through the history when one is attached (undo/redo), otherwise directly. */
  private commit(c: Command): void {
    if (this.onCommit) this.onCommit(c);
    else if (c.op === 'place') this.place(c.rec as PlacedRecord, true);
    else if (c.op === 'remove') this.remove(c.rec.id);
    else if (c.op === 'move') this.move(c.id, c.to.x, c.to.z, c.to.ry);
    // a shop edit needs the world; without a history attached there is nothing to apply it to
  }

  click(): boolean {
    if (this.mode === 'build' && this.hover?.ok) {
      this.commit({ op: 'place', rec: { id: `p${Date.now().toString(36)}${this.counter++}`, kind: this.kind, x: this.hover.x, z: this.hover.z, ry: this.ry } });
      this.hover.ok = false;
      this.setRing(false);
      return true;
    }
    if (this.mode === 'remove' && this.hoverRemove) {
      const { id, kind, x, z, ry } = this.hoverRemove;
      this.commit({ op: 'remove', rec: { id, kind, x, z, ry } });
      this.hoverRemove = null;
      this.ring.visible = false;
      return true;
    }
    if (this.mode === 'move') {
      if (this.heldShop) {
        const h = this.heldShop;
        if (!h.ok) return false;
        this.heldShop = null;
        this.shopGhost.visible = false;
        // put down where it was: nothing changed, nothing for undo to remember
        if (h.z0 !== h.from.z0 || h.z1 !== h.from.z1) this.commit({ op: 'shop', id: h.id, from: h.from, to: { z0: h.z0, z1: h.z1 } });
        return true;
      }
      if (!this.held && !this.hoverRemove && this.shopHover) {
        const s = this.shopHover;
        this.heldShop = {
          id: s.id,
          from: { z0: s.z0, z1: s.z1 },
          front: s.z1 - s.z0,
          grab: this.lastHit?.z ?? (s.z0 + s.z1) / 2,
          z0: s.z0,
          z1: s.z1,
          ok: true,
        };
        this.shopHover = null;
        this.showShop(s.id, s.z0, s.z1, true);
        return true;
      }
      if (!this.held && this.hoverRemove) {
        // pick it up: the original hides, a ghost of it follows the pointer
        this.held = this.hoverRemove;
        this.held.object.visible = false;
        this.ry = this.held.ry;
        const { result, owned } = this.m.own(() => PLACEABLES[this.held!.kind].build(this.m).object);
        result.rotation.y = this.ry;
        this.root.add(result);
        this.ghost = { object: result, owned };
        this.hoverRemove = null;
        return true;
      }
      if (this.held && this.hover?.ok) {
        const h = this.held;
        const to = { x: this.hover.x, z: this.hover.z, ry: this.ry };
        this.held = null;
        if (this.ghost) dispose(this.ghost.object, this.ghost.owned, this.m);
        this.ghost = null;
        h.object.visible = true;
        // put down where it was: nothing changed, nothing for undo to remember
        if (to.x !== h.x || to.z !== h.z || to.ry !== h.ry) this.commit({ op: 'move', id: h.id, from: { x: h.x, z: h.z, ry: h.ry }, to });
        this.ring.visible = false;
        return true;
      }
    }
    return false;
  }

  /** Commit a placement. `announce` = false when restoring a save (nobody is surprised by yesterday's bench). */
  place(rec: PlacedRecord, announce: boolean): void {
    const def = PLACEABLES[rec.kind];
    const {
      result: { object },
      owned,
    } = this.m.own(() => def.build(this.m));
    object.position.set(rec.x, groundHeight(rec.x, rec.z), rec.z);
    object.rotation.y = rec.ry;
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.m.leafShadows(object); // a placed tree lets the sun through too
    this.root.add(object);
    this.grid.stamp({ x: rec.x, z: rec.z, r: def.radius }, 1);
    // an undo or a load can put something back where someone now stands: they step aside
    this.residents.shuffleAside(rec.x, rec.z, def.radius);
    const o = this.smart.add({
      id: rec.id,
      kind: this.smartKind(rec.kind),
      label: rec.kind,
      x: rec.x,
      z: rec.z,
      slots: this.slots(rec),
      placed: true,
      createdAt: performance.now(),
    });
    this.placed.set(rec.id, { ...rec, object, owned, radius: def.radius });
    if (def.glow) this.relight();
    if (announce && !this.reducedMotion) {
      // a little "pop": scale in over a few frames
      object.scale.setScalar(0.01);
      const t0 = performance.now();
      const grow = () => {
        const k = Math.min(1, (performance.now() - t0) / 320);
        const c1 = 1.70158,
          c3 = c1 + 1; // easeOutBack: a small overshoot reads as "pop"
        object.scale.setScalar(Math.max(0.01, 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2));
        if (k < 1 && object.parent) requestAnimationFrame(grow);
      };
      grow();
    }
    if (announce) {
      this.bus.emit('sfx', { name: 'place', x: rec.x, z: rec.z });
      const ev = { id: rec.id, kind: rec.kind, x: rec.x, z: rec.z, novelty: def.novelty };
      this.bus.emit('objectPlaced', ev);
      this.residents.onPlaced(ev, o, this.hourNow());
    }
  }

  remove(id: string): void {
    const p = this.placed.get(id);
    if (!p) return;
    this.residents.onRemoved(id);
    this.smart.remove(id);
    this.grid.stamp({ x: p.x, z: p.z, r: p.radius }, -1);
    dispose(p.object, p.owned, this.m);
    this.placed.delete(id);
    if (PLACEABLES[p.kind].glow) this.relight();
    this.bus.emit('sfx', { name: 'remove', x: p.x, z: p.z });
    this.bus.emit('objectRemoved', { id, kind: p.kind, x: p.x, z: p.z, novelty: 0 });
  }

  /**
   * Move a placed thing (same id): its nav footprint, smart object and light follow, anyone using
   * it stands up and re-plans, and the neighbours notice it in its new spot (half as novel).
   */
  move(id: string, x: number, z: number, ry: number): void {
    const p = this.placed.get(id);
    if (!p) return;
    const def = PLACEABLES[p.kind];
    this.residents.onRemoved(id);
    this.smart.remove(id);
    this.grid.stamp({ x: p.x, z: p.z, r: p.radius }, -1);
    p.x = x;
    p.z = z;
    p.ry = ry;
    p.object.position.set(x, groundHeight(x, z), z);
    p.object.rotation.y = ry;
    p.object.visible = true;
    this.grid.stamp({ x, z, r: p.radius }, 1);
    this.residents.shuffleAside(x, z, p.radius);
    const o = this.smart.add({ id, kind: this.smartKind(p.kind), label: p.kind, x, z, slots: this.slots(p), placed: true, createdAt: performance.now() });
    if (def.glow) this.relight();
    this.bus.emit('sfx', { name: 'place', x, z });
    const ev = { id, kind: p.kind, x, z, novelty: def.novelty * 0.5 };
    this.bus.emit('objectPlaced', ev);
    this.residents.onPlaced(ev, o, this.hourNow());
  }

  /**
   * Hand the pooled point lights to the placed lights. With more placed lights than the pool
   * holds, nearby ones of the same colour share one light at their centre, √n as bright, so
   * every lantern still lights the ground. Clustered lights share brightness instead of
   * stacking into a floodlight.
   */
  private relight(): void {
    const glowing = [...this.placed.values()].filter((p) => PLACEABLES[p.kind].glow);
    for (const l of this.lightPool) {
      l.base = 0;
      l.crowd = 1;
      l.light.intensity = 0;
      l.light.position.set(0, -20, 0);
    }
    const clusters = clusterLights(
      glowing.map((p) => ({ x: p.x, z: p.z, tag: PLACEABLES[p.kind].glow!.color })),
      this.lightPool.length,
    );
    const centres = clusters.map((members) => {
      const x = members.reduce((s, i) => s + glowing[i]!.x, 0) / members.length;
      const z = members.reduce((s, i) => s + glowing[i]!.z, 0) / members.length;
      return { x, z };
    });
    const f = crowdFactors(centres);
    clusters.forEach((members, i) => {
      const l = this.lightPool[i]!;
      const glow = PLACEABLES[glowing[members[0]!]!.kind].glow!;
      const { x, z } = centres[i]!;
      l.base = glow.base * Math.sqrt(members.length);
      l.crowd = f[i];
      l.light.color.set(glow.color);
      l.light.position.set(x, groundHeight(x, z) + glow.y, z);
    });
  }

  /**
   * Show a placeable that isn't placed (a memory's snapshot holds an object since removed): display
   * only, no nav footprint, no smart object, no light. Returns the function that takes it away again.
   */
  stage(rec: PlacedRecord): () => void {
    const def = PLACEABLES[rec.kind];
    if (!def) return () => {};
    const {
      result: { object },
      owned,
    } = this.m.own(() => def.build(this.m));
    object.position.set(rec.x, groundHeight(rec.x, rec.z), rec.z);
    object.rotation.y = rec.ry;
    this.root.add(object);
    return () => dispose(object, owned, this.m);
  }

  records(): PlacedRecord[] {
    return [...this.placed.values()].map(({ id, kind, x, z, ry }) => ({ id, kind, x, z, ry }));
  }

  placedSmart(): SmartObject[] {
    return [...this.placed.keys()].map((id) => this.smart.objects.get(id)).filter((o): o is SmartObject => !!o);
  }

  /** What residents use it for, from its affordances (data), not its name. */
  private smartKind(k: PlaceableKind): SmartObject['kind'] {
    const a = PLACEABLES[k].affords;
    return a.includes('sit') ? 'bench' : a.includes('drink') ? 'vending' : a.includes('feed-cats') ? 'catbowl' : 'admire';
  }

  /** Where residents stand or sit to use it, from what it is for. */
  private slots(rec: PlacedRecord): Slot[] {
    const def = PLACEABLES[rec.kind];
    switch (this.smartKind(rec.kind)) {
      case 'bench':
        return benchSlots(rec.x, rec.z, rec.ry);
      case 'vending':
        return [frontSlot(rec.x, rec.z, rec.ry, 0.85)];
      case 'catbowl':
        return [{ ...frontSlot(rec.x, rec.z, rec.ry, 0.7), pose: 'crouch' }];
      default: {
        const d = Math.max(1.1, def.radius + 0.5);
        return [frontSlot(rec.x, rec.z, rec.ry, d), frontSlot(rec.x, rec.z, rec.ry + Math.PI, d)];
      }
    }
  }
}
