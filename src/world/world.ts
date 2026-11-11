import * as THREE from 'three';
import { Materials } from '../render/materials';
import type { SkyState } from '../render/sky';
import { hourInRange, type Season, type WorldClock } from '../core/clock';
import { clamp, damp } from '../core/math';
import { Kit } from './kit';
import { buildNature, type NatureOut } from './nature';
import { buildBuildings, type BuildingsOut } from './buildings';
import { buildProps, type PropsOut } from './props';
import { Weather } from './weather';
import { GROUND, VENDING } from './layout';
import { groundHeight } from './terrain';
import { EMISSIVE, shopDarkness, windowLevel, windowSpill, windowStep } from './lighting';
import { LightPools } from './lightpools';
import { fitSunShadow, type ShadowFit } from '../render/shadow';

/**
 * The tight fit (render/shadow.ts) puts every texel on the diorama, so 1536² keeps a shadow
 * texel finer than one screen pixel even at 3× zoom (tested), at ~56% of 2048²'s fill cost.
 */
export const SHADOW_MAP = 1536;

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
  private lampLevel = 0;
  private readonly pools: LightPools;
  /** Pools that follow the street-lamp level (lamps, vending machines). */
  private readonly lampPoolIds: number[] = [];
  /** Movable pools mirroring props.lightPool (player-placed lights), and where each was last placed. */
  private readonly placedPoolIds: number[] = [];
  private readonly placedAt: string[] = [];
  /** Every shadow caster and receiver: the static diorama plus headroom for things players place. */
  readonly shadowBox: THREE.Box3;
  shadowFit: ShadowFit | null = null;
  /** Accessibility: stills swaying lanterns, flags and swings. */
  reducedMotion = false;

  constructor(seed = 0) {
    const root = new THREE.Group();
    this.scene.add(root);
    this.kit = new Kit(root, this.mats);
    this.nature = buildNature(this.kit);
    this.buildings = buildBuildings(this.kit);
    this.props = buildProps(this.kit, this.wireMat);
    this.kit.finishWeathering();
    // measured before weather joins the root: rain streaks span 20 m of empty air and cast nothing
    this.shadowBox = new THREE.Box3().setFromObject(root);
    this.shadowBox.union(new THREE.Box3(new THREE.Vector3(GROUND.x0, this.shadowBox.min.y, GROUND.z0), new THREE.Vector3(GROUND.x1, 0, GROUND.z1)));
    this.shadowBox.max.y += 1; // a placed sakura on the terrace can top the tallest static roof
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
    // the highest surface under a footprint, so a pool never sinks under a kerb or a lawn
    const groundAt = (x: number, z: number, r: number) => {
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
    };
    for (const l of this.props.lampPools) this.lampPoolIds.push(pools.addRound(l.x, l.z, groundAt(l.x, l.z, l.r), l.r, '#ffcf8a', 0.42, GROUND));
    // one movable pool per pooled light, for the lanterns and vending machines players place
    for (let i = 0; i < this.props.lightPool.length; i++) this.placedPoolIds.push(pools.addMovable('#ffb35a', 0.34));
    for (const v of VENDING) this.lampPoolIds.push(pools.addRound(v.x, v.z + 0.9, groundAt(v.x, v.z + 0.9, 0.7), 0.75, v.glow, 0.3, GROUND, 0.85));
    for (const w of this.kit.windows) {
      if (w.kind === 'home') continue;
      const g = w.geom;
      const nx = Math.sin(g.ry),
        nz = Math.cos(g.ry);
      const s = windowSpill(g, groundHeight(g.x + nx * 0.6, g.z + nz * 0.6), w.kind === 'cafe', GROUND);
      if (!s) continue;
      w.pool = pools.addSpill(s, groundAt(s.x, s.z, Math.min(s.width, s.depth) / 2), w.kind === 'cafe' ? '#ffc070' : '#ffaa58', w.kind === 'cafe' ? 0.62 : 0.4);
    }
    root.add(pools.group);
    return pools;
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
    this.mats.setLampLevel(this.lampLevel);
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
      s.open = clamp(s.open + Math.sign(goal - s.open) * dt * 0.6, 0, 1);
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
