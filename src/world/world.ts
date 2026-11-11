import * as THREE from 'three';
import { Materials } from '../render/materials';
import type { SkyState } from '../render/sky';
import { hourInRange, type Season, type WorldClock } from '../core/clock';
import { clamp, damp } from '../core/math';
import { Kit, type WindowRef } from './kit';
import { buildNature, type NatureOut } from './nature';
import { buildBuildings, type BuildingsOut } from './buildings';
import { buildProps, routeDrops, type PropsOut } from './props';
import type { NavMove, ShopStreet } from './shopstreet';
import { townRoofs } from './grammar/footprints';
import { Weather } from './weather';
import { DROPS, G, GROUND, PLINTH, VENDING } from './layout';
import { groundHeight } from './terrain';
import { ACCENT_BUDGET, EMISSIVE, shopDarkness, windowLevel, windowSpill, windowStep } from './lighting';
import { LightPools } from './lightpools';
import { fitSunShadow, type ShadowFit } from '../render/shadow';

/**
 * The tight fit (render/shadow.ts) puts every texel on the diorama, so 1536² keeps a shadow
 * texel finer than one screen pixel even at 3× zoom (tested), at ~56% of 2048²'s fill cost.
 */
export const SHADOW_MAP = 1536;

/** Outline grid over the plinth: fine enough that a back-row roof and an empty front corner differ. */
const OUTLINE_NX = 8;
const OUTLINE_NZ = 6;

/**
 * The town as a few hundred points: the plinth's corners, top and bottom, and over a coarse grid
 * the top corners of each cell at the height of the tallest thing standing in it. The camera
 * projects these to know how far a pan may go along each screen axis (a box would let the view
 * wander into empty sky above a low front corner; the ground alone would hide the tallest roofs).
 */
export function townOutline(root: THREE.Object3D): THREE.Vector3[] {
  const { x0, x1, z0, z1 } = GROUND;
  const top = new Float64Array(OUTLINE_NX * OUTLINE_NZ).fill(G);
  const cw = (x1 - x0) / OUTLINE_NX,
    cd = (z1 - z0) / OUTLINE_NZ;
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  // only what is shown: a mesh under a hidden group raises nothing
  root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    box.setFromObject(o);
    if (box.isEmpty() || box.max.y <= G) return;
    const i0 = Math.max(0, Math.floor((box.min.x - x0) / cw)),
      i1 = Math.min(OUTLINE_NX - 1, Math.floor((box.max.x - x0) / cw));
    const j0 = Math.max(0, Math.floor((box.min.z - z0) / cd)),
      j1 = Math.min(OUTLINE_NZ - 1, Math.floor((box.max.z - z0) / cd));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) top[j * OUTLINE_NX + i] = Math.max(top[j * OUTLINE_NX + i]!, box.max.y);
  });
  const pts: THREE.Vector3[] = [];
  for (const x of [x0, x1]) for (const z of [z0, z1]) pts.push(new THREE.Vector3(x, G, z), new THREE.Vector3(x, G - PLINTH.h, z));
  for (let j = 0; j < OUTLINE_NZ; j++)
    for (let i = 0; i < OUTLINE_NX; i++) {
      const y = top[j * OUTLINE_NX + i]!;
      if (y <= G) continue;
      for (const [di, dj] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        pts.push(new THREE.Vector3(x0 + (i + di) * cw, y, z0 + (j + dj) * cd));
    }
  return pts;
}

/** Physical-light scale factors (three.js uses physically based units since r155). */
const SUN_K = 3.4;
const HEMI_K = 2.1;

/**
 * Assembles the static diorama and owns everything that changes with time:
 * lighting rig, window schedules, shutters, swaying things, seasons, weather.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly mats = new Materials();
  readonly kit: Kit;
  readonly weather: Weather;
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#333333', 1);
  readonly wireMat = new THREE.LineBasicMaterial({ color: '#16141f' });
  private readonly nature: NatureOut;
  private readonly buildings: BuildingsOut;
  private readonly props: PropsOut;
  private season: Season | null = null;
  /** Eased lamp brightness (0..1). Public so a memory render can set it for its hour, then put it back. */
  lampLevel = 0;
  private readonly pools: LightPools;
  /** Pools that follow the street-lamp level (lamps, vending machines). */
  private readonly lampPoolIds: number[] = [];
  /** Movable pools mirroring props.lightPool (player-placed lights), and where each was last placed. */
  private readonly placedPoolIds: number[] = [];
  private readonly placedAt: string[] = [];
  /** Every shadow caster and receiver: the static diorama plus headroom for things players place. */
  readonly shadowBox: THREE.Box3;
  shadowFit: ShadowFit | null = null;
  /** The static town's silhouette as points (plinth corners, rooftops): what the camera's pan bounds keep in reach. */
  readonly outline: THREE.Vector3[];
  /** Accessibility: stills swaying lanterns, flags and swings. */
  reducedMotion = false;

  constructor(seed = 0) {
    const root = new THREE.Group();
    this.scene.add(root);
    this.kit = new Kit(root, this.mats);
    this.nature = buildNature(this.kit);
    this.buildings = buildBuildings(this.kit);
    this.props = buildProps(this.kit, this.wireMat);
    for (const f of this.props.shopFollowers) this.buildings.street.follow(f);
    this.kit.finishWeathering();
    // measured before weather joins the root: rain streaks span 20 m of empty air and cast nothing
    this.shadowBox = new THREE.Box3().setFromObject(root);
    this.shadowBox.union(new THREE.Box3(new THREE.Vector3(GROUND.x0, this.shadowBox.min.y, GROUND.z0), new THREE.Vector3(GROUND.x1, 0, GROUND.z1)));
    this.shadowBox.max.y += 1; // a placed sakura on the terrace can top the tallest static roof
    this.outline = townOutline(root);
    this.weather = new Weather(root, this.mats, seed);
    this.pools = this.buildPools(root);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.scene.add(this.sun, this.sun.target, this.hemi);
  }

  /**
   * Ground pools (lighting.ts layer 4): under every streetlamp, in front of the vending machines,
   * and spilling out of ground-floor shop and kissaten windows. Upper-floor windows get none.
   */
  private buildPools(root: THREE.Object3D): LightPools {
    const pools = new LightPools();
    const groundAt = World.groundAt;
    for (const l of this.props.lampPools) this.lampPoolIds.push(pools.addRound(l.x, l.z, groundAt(l.x, l.z, l.r), l.r, '#ffcf8a', 0.42, GROUND));
    // one movable pool per pooled light, for the lanterns and vending machines players place
    for (let i = 0; i < this.props.lightPool.length; i++) this.placedPoolIds.push(pools.addMovable('#ffb35a', 0.34));
    for (const v of VENDING) this.lampPoolIds.push(pools.addRound(v.x, v.z + 0.9, groundAt(v.x, v.z + 0.9, 0.7), 0.75, v.glow, 0.3, GROUND, 0.85));
    for (const w of this.kit.windows) this.addWindowPool(pools, w);
    root.add(pools.group);
    return pools;
  }

  /** The highest surface under a footprint, so a pool never sinks under a kerb or a lawn. */
  private static groundAt(this: void, x: number, z: number, r: number): number {
    let y = -Infinity;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const)
      y = Math.max(y, groundHeight(x + dx * 0.7, z + dz * 0.7));
    return y + 0.035;
  }

  /** A ground-floor shop or café window spills light onto the ground in front of it. */
  private addWindowPool(pools: LightPools, w: WindowRef): void {
    if (w.kind === 'home') return;
    const g = w.geom;
    const nx = Math.sin(g.ry),
      nz = Math.cos(g.ry);
    const s = windowSpill(g, groundHeight(g.x + nx * 0.6, g.z + nz * 0.6), w.kind === 'cafe', GROUND);
    if (!s) return;
    w.pool = pools.addSpill(
      s,
      World.groundAt(s.x, s.z, Math.min(s.width, s.depth) / 2),
      w.kind === 'cafe' ? '#ffc070' : '#ffaa58',
      w.kind === 'cafe' ? 0.62 : 0.4,
    );
  }

  /** Next index for a rebuilt window (the occupancy and warmth hashes key on it; never reused). */
  private nextWindowIndex = 100000;

  /**
   * Move or resize a shop-house along the street (z0..z1): it and anything whose eaves or board
   * changed are re-planned through the grammar, and the seams re-planned. Windows and their light
   * pools follow, its fixtures come along and the service drops are re-routed. Returns the nav
   * obstacles that moved; the caller moves the shop's door and smart object.
   */
  setShopExtent(id: string, z0: number, z1: number): NavMove[] {
    const root = this.scene.children[0]!;
    const street = this.buildings.street;
    const before = new Set(this.buildings.shutters);
    const { removed, added, nav } = street.setExtent({ root, kit: this.kit }, id, z0, z1);
    for (const s of this.buildings.shutters) if (!before.has(s)) s.fresh = true;
    for (const w of removed) if (w.pool !== undefined) this.pools.retire(w.pool);
    for (const w of added) {
      w.index = this.nextWindowIndex++;
      this.kit.windows.push(w);
      this.addWindowPool(this.pools, w);
    }
    // the drops hang from the same poles; a roof that moved may now need (or free) an anchor bracket
    const drops = this.props.shopDrops;
    for (const o of [...drops.children]) {
      o.removeFromParent();
      (o as THREE.Mesh).geometry?.dispose();
    }
    routeDrops(
      new Kit(drops, this.mats),
      DROPS.filter((d) => d.follows).map((d) => ({ x: d.x, y: d.y, z: d.z + street.offset(d.follows!) })),
      townRoofs(street.specs),
      this.wireMat,
    );
    return nav;
  }

  /** The shopping street (its shops' extents as they stand). */
  get shopStreet(): ShopStreet {
    return this.buildings.street;
  }

  /**
   * Player-placed lights (BuildTool lends them pooled point lights) get a ground pool too: it follows
   * the light's position, colour and shared brightness, and switches off when the light is returned.
   */
  private syncPlacedPools(): void {
    this.props.lightPool.forEach((ref, i) => {
      const id = this.placedPoolIds[i]!;
      if (ref.base <= 0) {
        this.pools.set(id, 0);
        return;
      }
      const p = ref.light.position;
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${ref.light.color.getHexString()}`;
      if (this.placedAt[i] !== key) {
        this.placedAt[i] = key;
        this.pools.place(id, p.x, p.z, groundHeight(p.x, p.z) + 0.035, 1.6, ref.light.color, GROUND);
      }
      this.pools.set(id, this.lampLevel * (ref.crowd ?? 1));
    });
  }

  get lightPool() {
    return this.props.lightPool;
  }

  get chimneyTop(): THREE.Vector3 {
    return this.buildings.chimneyTop;
  }

  update(dt: number, time: number, clock: WorldClock, sky: SkyState, gameMinutes: number): void {
    const hour = clock.hour;
    if (clock.season !== this.season) {
      this.season = clock.season;
      this.mats.applySeason(clock.season);
      const showCrops = clock.season === 'spring' || clock.season === 'summer';
      for (const c of this.nature.crops) c.visible = showCrops;
    }
    this.weather.still = this.reducedMotion;
    this.weather.update(dt, gameMinutes, time, hour, clock.season);

    // light rig
    this.sun.color.set(sky.sun);
    this.sun.intensity = sky.sunI * SUN_K;
    // re-fit every frame: the frustum hugs the plinth from wherever the sun is, and bias follows its height
    this.shadowFit = fitSunShadow(this.sun, this.shadowBox, sky.sunDir, SHADOW_MAP);
    this.hemi.color.set(sky.hemiSky);
    this.hemi.groundColor.set(sky.hemiGround);
    this.hemi.intensity = sky.hemiI * HEMI_K;
    this.lampLevel = damp(this.lampLevel, sky.lamp, 2, dt);
    this.mats.setLampLevel(this.lampLevel, ACCENT_BUDGET[clock.season]);
    this.mats.lantern.emissiveIntensity = 0.4 + this.lampLevel * (EMISSIVE.lantern - 0.4);
    for (const id of this.lampPoolIds) this.pools.set(id, this.lampLevel);
    this.syncPlacedPools();
    for (const l of this.props.lights) l.light.intensity = l.base * (l.crowd ?? 1) * this.lampLevel;

    // windows follow routines (shops their hours once it's dark, homes in the evening), fading in
    // and out, each at its own brightness; ground-floor shops spill light onto the street
    const darkness = shopDarkness(sky.lamp, this.weather.rain);
    for (const w of this.kit.windows) {
      const level = windowLevel(w.kind, hour, w.offset, w.index, clock.day, darkness, w.hours);
      const mat = this.mats.windowMat(w.kind, windowStep(level));
      if (w.mesh.material !== mat) w.mesh.material = mat;
      if (w.pool !== undefined) this.pools.set(w.pool, level);
    }
    // shutters roll up at opening time
    for (const s of this.buildings.shutters) {
      const goal = hourInRange(hour, s.hours[0], s.hours[1]) ? 1 : 0;
      s.open = s.fresh ? goal : clamp(s.open + Math.sign(goal - s.open) * dt * 0.6, 0, 1);
      s.fresh = false;
      s.mesh.scale.y = Math.max(0.02, 1 - s.open);
      s.mesh.position.y = s.baseY + (s.height * s.open) / 2;
    }
    // parasols fold at night or in heavy rain
    const parasolOpen = hourInRange(hour, 8, 20) && this.weather.rain < 0.6 ? 1 : 0.35;
    for (const p of this.buildings.parasols) {
      const top = p.children[1];
      if (top) top.scale.x = top.scale.z = damp(top.scale.x, parasolOpen, 3, dt);
    }
    // ambient motion
    const wind = this.reducedMotion ? 0 : 1 + this.weather.rain * 1.5 + (clock.season === 'winter' ? 0.5 : 0);
    this.mats.time.value = this.reducedMotion ? 0 : time; // still water and still leaves
    this.mats.wind.value = wind;
    this.mats.skyTint.value.set(sky.bottom);
    this.buildings.lanterns.forEach((l, i) => (l.rotation.z = Math.sin(time * 1.3 + i) * 0.08 * wind));
    this.props.flags.forEach((f, i) => (f.rotation.x = Math.sin(time * 2 + i) * 0.12 * wind));
    this.props.swings.forEach((s, i) => (s.rotation.z = Math.sin(time * 1.4 + i * 1.5) * 0.12 * wind));
    this.nature.waterfall.offset.y = (time * 1.6) % 1;
  }
}
