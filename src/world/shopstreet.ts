import * as THREE from 'three';
import { Kit, type WindowRef } from './kit';
import type { Materials } from '../render/materials';
import { hashString } from '../core/rng';
import { evaluate, type EvaluateHooks } from './grammar/evaluate';
import { planAttachments, planShopHouse, shopFootprint } from './grammar/archetypes/shophouse';
import { classifyGap, planSeam } from './grammar/seams';
import { streetContext } from './grammar/street';
import type { ShopHouseSpec } from './grammar/types';
import type { ShopAnchor } from './layout';
import type { ShopFollower } from './props';

/** Where along the street an anchor sits for a shop's extent. */
function edgeOf(s: { z0: number; z1: number }, edge: ShopAnchor['edge']): number {
  return edge === 'z0' ? s.z0 : edge === 'z1' ? s.z1 : (s.z0 + s.z1) / 2;
}

/** A nav obstacle a shop fixture carried along: free it at `from`, stamp it at `to`. */
export interface NavMove {
  x: number;
  r: number;
  from: number;
  to: number;
}

/** What one shop-house (or seam) built: its meshes and the things the world animates. */
interface Built {
  group: THREE.Group;
  windows: WindowRef[];
  shutters: { mesh: THREE.Mesh }[];
  lanterns: THREE.Mesh[];
}

/** Tracked things a build adds, so a rebuild can take exactly those back out (and put them back). */
export interface StreetSinks {
  shutters: { mesh: THREE.Mesh }[];
  lanterns: THREE.Mesh[];
}

/**
 * The shopping street as rebuildable parts (prompt 06 phase C): each shop-house and each seam
 * between two neighbours is its own group, with its own windows, shutters and lanterns recorded.
 * The first build goes through the shared Kit in the original order (so the town is unchanged);
 * a rebuild uses a Kit seeded by the building alone (hash of parcel, archetype and revision), so
 * re-planning one shop never reshuffles anything else. The first builds are kept: when a shop and
 * its street context (or a seam and its pair) are back as first laid out, as after an undo, the
 * original comes back exactly instead of a re-plan. Moving or resizing a shop re-plans that
 * shop and its two seams; its neighbours' bodies are re-planned only if their eaves or boards
 * change (the street context depends on immediate neighbours only).
 */
export class ShopStreet {
  specs: ShopHouseSpec[];
  /** The street as first laid out: fixtures are placed relative to it. */
  private readonly original: ReadonlyMap<string, { z0: number; z1: number }>;
  private readonly followers: ShopFollower[] = [];
  private readonly shops = new Map<string, Built>();
  private readonly seams = new Map<string, Built>();
  /** The first builds, with what they were built for (street context; a seam's pair), for an exact undo. */
  private readonly firstShops = new Map<string, { built: Built; ctx: string }>();
  private readonly firstSeams = new Map<string, { built: Built; sig: string }>();

  constructor(
    specs: readonly ShopHouseSpec[],
    private readonly m: Materials,
    private readonly sinks: StreetSinks,
    private readonly hooks: EvaluateHooks,
  ) {
    this.specs = specs.map((s) => ({ ...s }));
    this.original = new Map(specs.map((s) => [s.id, { z0: s.z0, z1: s.z1 }]));
  }

  /** A shop-front fixture (meter, downpipe, doorstep pots, its light) that moves with its shop. */
  follow(f: ShopFollower): void {
    this.followers.push(f);
    f.group.position.z = this.offset(f.anchor);
  }

  /** How far an anchor has moved from where the street was first laid out. */
  offset(a: ShopAnchor): number {
    const now = this.get(a.shop),
      was = this.original.get(a.shop);
    return now && was ? edgeOf(now, a.edge) - edgeOf(was, a.edge) : 0;
  }

  /** Where a shop's extents differ from the first layout (what a save keeps). */
  changed(): Record<string, { z0: number; z1: number }> {
    const out: Record<string, { z0: number; z1: number }> = {};
    for (const s of this.specs) {
      const o = this.original.get(s.id)!;
      if (s.z0 !== o.z0 || s.z1 !== o.z1) out[s.id] = { z0: s.z0, z1: s.z1 };
    }
    return out;
  }

  /** The first build, through the shared Kit and in the original order: bodies, then attachments. */
  buildInitial(k: Kit): void {
    const ctx = streetContext(this.specs);
    for (const s of this.specs)
      this.shops.set(
        s.id,
        this.capture(k, () => evaluate(k, planShopHouse(s, ctx.get(s.id)), this.hooks)),
      );
    for (const s of this.specs) {
      const b = this.shops.get(s.id)!;
      const extra = this.capture(k, () => evaluate(k, planAttachments(s, ctx.get(s.id)!.frontX), this.hooks), b.group);
      b.windows.push(...extra.windows);
      b.shutters.push(...extra.shutters);
      b.lanterns.push(...extra.lanterns);
      this.firstShops.set(s.id, { built: b, ctx: JSON.stringify(ctx.get(s.id)) });
    }
  }

  /** Seams last (they are new geometry: nothing before them should change). */
  buildSeams(k: Kit): void {
    for (const [key, a, b, fx] of this.pairs()) {
      const built = this.capture(k, () => evaluate(k, planSeam(classifyGap(a, b), a, b, fx), this.hooks));
      this.seams.set(key, built);
      this.firstSeams.set(key, { built, sig: JSON.stringify([a, b, fx]) });
    }
  }

  /** Neighbouring pairs along the street, with their footprints and the seam's front line. */
  private pairs(): [string, ReturnType<typeof shopFootprint>, ReturnType<typeof shopFootprint>, number][] {
    const ctx = streetContext(this.specs);
    const row = [...this.specs].sort((a, b) => a.z0 - b.z0);
    const out: [string, ReturnType<typeof shopFootprint>, ReturnType<typeof shopFootprint>, number][] = [];
    for (let i = 0; i + 1 < row.length; i++) {
      const fa = ctx.get(row[i]!.id)!.frontX,
        fb = ctx.get(row[i + 1]!.id)!.frontX;
      out.push([`${row[i]!.id}|${row[i + 1]!.id}`, shopFootprint(row[i]!, fa), shopFootprint(row[i + 1]!, fb), Math.max(fa, fb)]);
    }
    return out;
  }

  /** Run a build into a fresh group (or `into`), recording the windows, shutters and lanterns it adds. */
  private capture(k: Kit, fn: () => void, into?: THREE.Group): Built {
    const group = into ?? new THREE.Group();
    const w0 = k.windows.length,
      s0 = this.sinks.shutters.length,
      l0 = this.sinks.lanterns.length;
    k.into(group, fn);
    return { group, windows: k.windows.slice(w0), shutters: this.sinks.shutters.slice(s0), lanterns: this.sinks.lanterns.slice(l0) };
  }

  get(id: string): ShopHouseSpec | undefined {
    return this.specs.find((s) => s.id === id);
  }

  /**
   * Change a shop's extent along the street (a move keeps its frontage, a resize changes it) and
   * rebuild what that touches. Returns the windows removed and added, for the world's lighting.
   */
  setExtent(
    world: { root: THREE.Object3D; kit: Kit },
    id: string,
    z0: number,
    z1: number,
  ): { removed: WindowRef[]; added: WindowRef[]; restored: WindowRef[]; nav: NavMove[] } {
    const spec = this.get(id);
    if (!spec) return { removed: [], added: [], restored: [], nav: [] };
    const beforeCtx = streetContext(this.specs);
    spec.z0 = z0;
    spec.z1 = z1;
    const afterCtx = streetContext(this.specs);
    // re-plan the shop itself, and any shop whose eaves, front or board placement changed
    const touched = this.specs.filter((s) => s.id === id || JSON.stringify(beforeCtx.get(s.id)) !== JSON.stringify(afterCtx.get(s.id))).map((s) => s.id);
    const removed: WindowRef[] = [];
    const added: WindowRef[] = [];
    const restored: WindowRef[] = [];
    for (const sid of touched) {
      const old = this.shops.get(sid)!;
      removed.push(...old.windows);
      this.takeOut(old, world.kit);
      const s = this.get(sid)!;
      const ctx = afterCtx.get(sid)!;
      // back as first built (an undo): the original, exactly
      const first = this.firstShops.get(sid)!;
      const o = this.original.get(sid)!;
      if (s.z0 === o.z0 && s.z1 === o.z1 && JSON.stringify(ctx) === first.ctx) {
        this.putBack(first.built, world.root);
        this.shops.set(sid, first.built);
        restored.push(...first.built.windows);
        continue;
      }
      const kit = new Kit(world.root, this.m, hashString(`${s.id}|shophouse|${s.revision ?? 0}`));
      const built = this.capture(kit, () => {
        evaluate(kit, planShopHouse(s, ctx), this.hooks);
        evaluate(kit, planAttachments(s, ctx.frontX), this.hooks);
      });
      kit.finishWeathering();
      this.shops.set(sid, built);
      added.push(...built.windows);
    }
    // seams: all re-planned (cheap; a pair back as first built gets its original back)
    for (const b of this.seams.values()) this.takeOut(b, world.kit);
    this.seams.clear();
    for (const [key, a, b, fx] of this.pairs()) {
      const first = this.firstSeams.get(key);
      if (first && first.sig === JSON.stringify([a, b, fx])) {
        this.putBack(first.built, world.root);
        this.seams.set(key, first.built);
        restored.push(...first.built.windows);
        continue;
      }
      const kit = new Kit(world.root, this.m, hashString(key));
      this.seams.set(
        key,
        this.capture(kit, () => evaluate(kit, planSeam(classifyGap(a, b), a, b, fx), this.hooks)),
      );
      kit.finishWeathering();
    }
    // its fixtures follow it, nav obstacles included
    const nav: NavMove[] = [];
    for (const f of this.followers) {
      if (f.anchor.shop !== id) continue;
      const before = f.group.position.z;
      f.group.position.z = this.offset(f.anchor);
      for (const o of f.obstacles) nav.push({ x: o.x, r: o.r, from: o.z + before, to: o.z + f.group.position.z });
    }
    return { removed, added, restored, nav };
  }

  /**
   * Take a build out of the scene, and its windows, shutters and lanterns out of the world's lists.
   * A first build is only put aside (an undo may bring it back); a rebuild is freed.
   */
  private takeOut(b: Built, kit: Kit): void {
    b.group.removeFromParent();
    const shutters = new Set(b.shutters),
      lanterns = new Set(b.lanterns);
    for (let i = this.sinks.shutters.length - 1; i >= 0; i--) if (shutters.has(this.sinks.shutters[i]!)) this.sinks.shutters.splice(i, 1);
    for (let i = this.sinks.lanterns.length - 1; i >= 0; i--) if (lanterns.has(this.sinks.lanterns[i]!)) this.sinks.lanterns.splice(i, 1);
    for (const w of b.windows) {
      const i = kit.windows.indexOf(w);
      if (i >= 0) kit.windows.splice(i, 1);
    }
    const first = [...this.firstShops.values()].some((f) => f.built === b) || [...this.firstSeams.values()].some((f) => f.built === b);
    if (!first) b.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  /** Put a first build back into the scene, with its shutters and lanterns (the caller re-adds its windows). */
  private putBack(b: Built, root: THREE.Object3D): void {
    root.add(b.group);
    this.sinks.shutters.push(...b.shutters);
    this.sinks.lanterns.push(...b.lanterns);
  }
}
