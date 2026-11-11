import * as THREE from 'three';
import type { EventBus, GameEvents } from '../core/events';
import type { Materials } from '../render/materials';
import { BUILDABLE, G } from '../world/layout';
import { groundHeight, inPond, onBridge, onIslet, regionAt } from '../world/terrain';
import { PLACEABLES, type LightRef, type PlaceableKind } from '../world/props';
import { crowdFactors } from '../world/crowd';
import type { NavGrid } from '../sim/grid';
import { benchSlots, frontSlot, type SmartObject, type SmartRegistry, type Slot } from '../sim/smart';
import type { Residents } from '../sim/residents';
import type { PlacedRecord } from '../save/storage';

export type ToolMode = 'view' | 'build' | 'remove';

interface Placed extends PlacedRecord {
  object: THREE.Object3D;
  /** Materials made for this object alone (shared ones are left alone on removal). */
  owned: Set<THREE.Material>;
  radius: number;
  light?: LightRef;
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
  private readonly okMat = new THREE.MeshBasicMaterial({ color: '#86b45a' });
  private readonly badMat = new THREE.MeshBasicMaterial({ color: '#d0402a' });
  private hover: { x: number; z: number; ok: boolean } | null = null;
  private hoverRemove: Placed | null = null;
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
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 20), this.okMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    root.add(this.ring);
  }

  setMode(mode: ToolMode, kind?: PlaceableKind): void {
    this.mode = mode;
    if (kind) this.kind = kind;
    if (this.ghost) dispose(this.ghost.object, this.ghost.owned, this.m);
    this.ghost = null;
    this.hover = null;
    this.hoverRemove = null;
    this.ring.visible = false;
    if (mode === 'build') {
      const { result, owned } = this.m.own(() => PLACEABLES[this.kind].build(this.m).object);
      result.visible = false;
      this.root.add(result);
      this.ghost = { object: result, owned };
    }
  }

  rotate(): void {
    this.ry += Math.PI / 2;
    if (this.ghost) this.ghost.object.rotation.y = this.ry;
  }

  /** What a click would act on right now; touch uses it to tell a first tap (preview) from a second (commit). */
  targetKey(): string | null {
    if (this.mode === 'build') return this.hover ? `${this.hover.x},${this.hover.z}` : null;
    if (this.mode === 'remove') return this.hoverRemove?.id ?? null;
    return null;
  }

  /** Validity: soft ground only, not on water/bridges, clear of obstacles, people and other placements. */
  canPlace(kind: PlaceableKind, x: number, z: number, opts: { ignoreResidents?: boolean } = {}): boolean {
    const def = PLACEABLES[kind];
    if (!def) return false;
    const reg = regionAt(x, z);
    if (!reg || !BUILDABLE.includes(reg.kind)) return false;
    if (inPond(x, z) || onBridge(x, z) || onIslet(x, z)) return false;
    const r = def.radius;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const) {
      if (!this.grid.isOpenAt(x + dx, z + dz)) return false;
      const rr = regionAt(x + dx, z + dz);
      if (!rr || !BUILDABLE.includes(rr.kind) || inPond(x + dx, z + dz)) return false;
    }
    if (!opts.ignoreResidents && this.residents.anyoneNear(x, z, r + 0.4)) return false;
    for (const p of this.placed.values()) if (Math.hypot(p.x - x, p.z - z) < p.radius + r + 0.2) return false;
    return true;
  }

  pointer(ray: THREE.Ray): void {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(G + 0.1));
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) {
      this.hover = null;
      this.ring.visible = false;
      return;
    }
    const x = Math.round(hit.x * 4) / 4;
    const z = Math.round(hit.z * 4) / 4;
    if (this.mode === 'build' && this.ghost) {
      const ok = this.canPlace(this.kind, x, z);
      this.hover = { x, z, ok };
      const g = this.ghost.object;
      g.visible = true;
      g.position.set(x, groundHeight(x, z), z);
      g.rotation.y = this.ry;
      this.ring.visible = true;
      this.ring.material = ok ? this.okMat : this.badMat;
      this.ring.position.set(x, groundHeight(x, z) + 0.03, z);
      const s = PLACEABLES[this.kind].radius / 0.55;
      this.ring.scale.setScalar(s);
    } else if (this.mode === 'remove') {
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
      if (best) {
        this.ring.material = this.badMat;
        this.ring.position.set(best.x, groundHeight(best.x, best.z) + 0.03, best.z);
        this.ring.scale.setScalar(best.radius / 0.55 + 0.2);
      }
    }
  }

  click(): boolean {
    if (this.mode === 'build' && this.hover?.ok) {
      this.place({ id: `p${Date.now().toString(36)}${this.counter++}`, kind: this.kind, x: this.hover.x, z: this.hover.z, ry: this.ry }, true);
      this.hover.ok = false;
      this.ring.material = this.badMat;
      return true;
    }
    if (this.mode === 'remove' && this.hoverRemove) {
      this.remove(this.hoverRemove.id);
      this.hoverRemove = null;
      this.ring.visible = false;
      return true;
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
    this.root.add(object);
    this.grid.stamp({ x: rec.x, z: rec.z, r: def.radius }, 1);
    const o = this.smart.add({
      id: rec.id,
      kind: this.smartKind(rec.kind),
      label: def.label.toLowerCase(),
      x: rec.x,
      z: rec.z,
      slots: this.slots(rec),
      placed: true,
      createdAt: performance.now(),
    });
    let light: LightRef | undefined;
    if (def.glow) {
      light = this.lightPool.find((l) => l.base === 0);
      if (light) {
        light.base = def.glow.base;
        light.light.color.set(def.glow.color);
        light.light.position.set(rec.x, groundHeight(rec.x, rec.z) + def.glow.y, rec.z);
      }
    }
    this.placed.set(rec.id, { ...rec, object, owned, radius: def.radius, light });
    if (light) this.reshareLights();
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
    if (p.light) {
      p.light.base = 0;
      p.light.crowd = 1;
      p.light.light.intensity = 0;
      p.light.light.position.set(0, -20, 0);
    }
    this.placed.delete(id);
    if (p.light) this.reshareLights();
    this.bus.emit('sfx', { name: 'remove', x: p.x, z: p.z });
    this.bus.emit('objectRemoved', { id, kind: p.kind, x: p.x, z: p.z, novelty: 0 });
  }

  /** Clustered lights share brightness instead of stacking into a floodlight. */
  private reshareLights(): void {
    const lit = this.lightPool.filter((l) => l.base > 0);
    const f = crowdFactors(lit.map((l) => ({ x: l.light.position.x, z: l.light.position.z })));
    lit.forEach((l, i) => (l.crowd = f[i]));
  }

  records(): PlacedRecord[] {
    return [...this.placed.values()].map(({ id, kind, x, z, ry }) => ({ id, kind, x, z, ry }));
  }

  placedSmart(): SmartObject[] {
    return [...this.placed.keys()].map((id) => this.smart.objects.get(id)).filter((o): o is SmartObject => !!o);
  }

  private smartKind(k: PlaceableKind): SmartObject['kind'] {
    switch (k) {
      case 'bench':
        return 'bench';
      case 'vending':
        return 'vending';
      case 'catbowl':
        return 'catbowl';
      default:
        return 'admire';
    }
  }

  private slots(rec: PlacedRecord): Slot[] {
    switch (rec.kind) {
      case 'bench':
        return benchSlots(rec.x, rec.z, rec.ry);
      case 'vending':
        return [frontSlot(rec.x, rec.z, rec.ry, 0.85)];
      case 'catbowl':
        return [{ ...frontSlot(rec.x, rec.z, rec.ry, 0.7), pose: 'crouch' }];
      default:
        return [frontSlot(rec.x, rec.z, rec.ry, 1.1), frontSlot(rec.x, rec.z, rec.ry + Math.PI, 1.1)];
    }
  }
}
