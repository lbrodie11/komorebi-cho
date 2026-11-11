import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Season } from '../core/clock';
import { G, TG, TERRACE_FRONT_Z } from '../world/layout';
import { paintSign, SIGN_TEXEL, type SignSpec } from './glyphs';

export type TexKind =
  'plaster' | 'concrete' | 'siding' | 'roof' | 'wood' | 'asphalt' | 'gravel' | 'grain' | 'paving' | 'stone' | 'grass' | 'stripe' | 'shutter' | 'waterfall';

type Px = number | [number, number, number];

/**
 * Every texture in the game is generated here from a few lines of maths.
 * They are tiny (32x32) greyscale-ish detail maps; colour comes from the
 * material tint so one texture serves many buildings. NearestFilter keeps them
 * crisp before the pixel pass quantises everything anyway.
 */
function makeTexture(rng: Rng, f: (x: number, y: number) => Px, size = 32): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = f(x, y);
      if (typeof v === 'number') v = [v, v, v];
      const q = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) img.data[q + k] = Math.max(0, Math.min(255, v[k]!));
      img.data[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  void rng;
  return t;
}

function buildTextures(): Record<TexKind, THREE.CanvasTexture> {
  const r = new Rng(9001);
  const n = (a: number) => (r.next() - 0.5) * a;
  return {
    plaster: makeTexture(r, (_x, y) => 226 + n(24) - (y > 27 ? (y - 27) * 8 : 0) + (r.next() > 0.985 ? -45 : 0)),
    concrete: makeTexture(r, (x, y) => 206 + n(18) - ((x * 7) % 11 === 0 ? y * 1.3 : 0) - (y % 16 === 0 ? 26 : 0)),
    siding: makeTexture(r, (x) => (x % 4 < 2 ? 236 : 192) + n(12)),
    roof: makeTexture(r, (x, y) => (y % 4 === 0 ? 110 : (x + (Math.floor(y / 4) % 2) * 3) % 6 === 0 ? 165 : 212) + n(14)),
    wood: makeTexture(r, (x, y) => (x % 6 === 0 ? 148 : 212) + n(22) + Math.sin(y * 0.8 + x) * 5),
    asphalt: makeTexture(r, () => 150 + n(44) + (r.next() > 0.975 ? 55 : 0)),
    gravel: makeTexture(r, () => 185 + n(90)),
    grain: makeTexture(r, (x, y) => 205 + Math.sin(y * 1.2 + Math.sin(x * 0.35) * 2.2) * 26 + n(10)),
    paving: makeTexture(r, (x, y) => (x % 8 === 0 || y % 8 === 0 ? 150 : 205) + n(24)),
    stone: makeTexture(r, (x, y) => (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 8) % 16 === 0 ? 135 : 205) + n(30)),
    grass: makeTexture(r, () => 205 + n(50) + (r.next() > 0.92 ? 35 : 0)),
    stripe: makeTexture(r, (x) => (x % 8 < 4 ? [246, 236, 214] : [196, 62, 46])),
    shutter: makeTexture(r, (_x, y) => (y % 3 === 0 ? 150 : 215) + n(10)),
    waterfall: makeTexture(r, (x, y) => ((x * 5 + y * 3) % 7 < 2 ? [238, 242, 245] : [134, 174, 212])),
  };
}

export interface LeafSet {
  sakura: THREE.MeshStandardMaterial[];
  deciduous: THREE.MeshStandardMaterial[];
  evergreen: THREE.MeshStandardMaterial[];
}

const SEASON_COLORS: Record<
  Season,
  { sakura: string[]; deciduous: string[]; evergreen: string[]; grass: string; roof: string; roofDark: string; water: string; flag: string }
> = {
  spring: {
    sakura: ['#f4c7cf', '#e59b9b', '#c46a7a'],
    deciduous: ['#86b45a', '#b9d982', '#5b8c45'],
    evergreen: ['#27472b', '#3c6838', '#5b8c45'],
    grass: '#5b8c45',
    roof: '#4b4f5a',
    roofDark: '#3f3a58',
    water: '#2f7f7a',
    flag: '#f4c7cf',
  },
  summer: {
    sakura: ['#3c6838', '#5b8c45', '#27472b'],
    deciduous: ['#27472b', '#3c6838', '#5b8c45'],
    evergreen: ['#18301f', '#27472b', '#3c6838'],
    grass: '#3c6838',
    roof: '#4b4f5a',
    roofDark: '#3f3a58',
    water: '#2f7f7a',
    flag: '#4f73a3',
  },
  autumn: {
    sakura: ['#d0402a', '#ff6b3d', '#9a2b22'],
    deciduous: ['#ffa94d', '#d0402a', '#b07a4c'],
    evergreen: ['#27472b', '#3c6838', '#5b8c45'],
    grass: '#8a8a40',
    roof: '#4b4f5a',
    roofDark: '#3f3a58',
    water: '#2f7f7a',
    flag: '#ff6b3d',
  },
  winter: {
    sakura: ['#cfd2d4', '#eef2f5', '#adb2b8'],
    deciduous: ['#eef2f5', '#cfd2d4', '#8a5634'],
    evergreen: ['#eef2f5', '#27472b', '#3c6838'],
    grass: '#eef2f5',
    roof: '#cfd2d4',
    roofDark: '#eef2f5',
    water: '#86aed4',
    flag: '#d0402a',
  },
};

/** Value-noise helpers shared by the shader patches below. */
const NOISE_GLSL = /* glsl */ `
float kHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float kNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(kHash(i), kHash(i + vec2(1., 0.)), u.x), mix(kHash(i + vec2(0., 1.)), kHash(i + vec2(1., 1.)), u.x), u.y);
}`;

/**
 * Weathering: turns the per-vertex attributes from world/weathering.ts into grime.
 * Everything darkens *and* desaturates (dirt is grey, not black), leaning violet
 * like the palette's shadow ramp. Ground level comes from the terrain rule
 * (street G, terrace TG behind TERRACE_FRONT_Z), so splash-back sits where feet are.
 */
const WEATHER_VERT_HEAD = /* glsl */ `
attribute float ao;
attribute float upFacing;
attribute float dripMask;
attribute float age;
varying float vAo;
varying float vUp;
varying float vDrip;
varying float vAge;
varying vec3 vWPos;
varying vec3 vWNrm;`;
const WEATHER_VERT_BODY = /* glsl */ `
vAo = ao; vUp = upFacing; vDrip = dripMask; vAge = age;
vWPos = (modelMatrix * vec4(transformed, 1.)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`;
const WEATHER_FRAG_HEAD = /* glsl */ `
uniform float uWet;
uniform float uMoss;
uniform vec3 uMossColor;
varying float vAo;
varying float vUp;
varying float vDrip;
varying float vAge;
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE_GLSL}`;
const WEATHER_FRAG_BODY = /* glsl */ `
{
  float gy = vWPos.z < ${(TERRACE_FRONT_Z - 0.05).toFixed(2)} ? ${TG.toFixed(3)} : ${G.toFixed(3)};
  float hb = vWPos.y - gy;
  // splash-back band: rain bounces dirt up the bottom of every wall
  float ground = (1. - smoothstep(0., .7 + .7 * vAge, hb)) * (1. - vUp);
  // streaks: narrow across the wall, long down it (noise stretched in y). Kept at or above
  // ~2 render pixels per cycle at 1× zoom, or the stains alias into speckle.
  float along = dot(vWPos.xz, vec2(1., .7));
  float sn = kNoise(vec2(along * 3.2, vWPos.y * .4)) * .65 + kNoise(vec2(along * 6.5, vWPos.y * .8)) * .35;
  float streak = vDrip * smoothstep(.42, .78, sn) * (.45 + .55 * vAge);
  float grime = clamp((1. - vAo) * 1.1 + ground * (.3 + .4 * vAge) + streak * .7, 0., 1.) * (1. - vUp * .55);
  vec3 c = diffuseColor.rgb;
  float l = dot(c, vec3(.3, .59, .11));
  c = mix(c, vec3(l) * vec3(.94, .92, 1.), grime * .5);
  c *= 1. - grime * .42;
  // moss: shaded north faces (−z) and damp feet of walls; patchy, thicker with age
  float north = clamp(-vWNrm.z, 0., 1.);
  float damp = max(north, ground * .8);
  float patches = smoothstep(.32, .66, kNoise(vWPos.xz * 1.9 + vWPos.y * 2.3) * .7 + kNoise(vWPos.xy * 4.1) * .3);
  c = mix(c, uMossColor * (.75 + .25 * patches), uMoss * vAge * smoothstep(.35, .8, damp) * patches);
  // rain: porous surfaces drink water and darken; walls a little more than ledges (they stay wetter)
  c *= 1. - uWet * (.22 + .1 * (1. - vUp));
  diffuseColor.rgb = c;
}`;

/** Foliage: whole blobs sway with the wind (phase from their position) and vary slightly in tone. */
const LEAF_VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uWind;
varying vec3 vBlob;`;
const LEAF_VERT_BODY = /* glsl */ `
{
  vec3 bo = modelMatrix[3].xyz;
  vBlob = bo;
  float ph = dot(bo.xz, vec2(.73, 1.31));
  // taller canopies move more; low shrubs barely
  float amp = uWind * .05 * clamp((bo.y - .3) / 3., .2, 1.);
  vec3 sw = vec3(sin(uTime * 1.6 + ph), 0., cos(uTime * 1.25 + ph * 1.4)) * amp;
  // world offset back to object space; diorama transforms are rotation + uniform scale,
  // so the inverse is the transpose over scale² (a full inverse() per vertex cost ~0.7 ms GPU)
  mat3 m3 = mat3(modelMatrix);
  transformed += transpose(m3) * sw / dot(m3[0], m3[0]);
}`;
const LEAF_FRAG_BODY = /* glsl */ `
diffuseColor.rgb *= .9 + .2 * fract(sin(dot(vBlob, vec3(12.9898, 78.233, 37.719))) * 43758.5453);`;

/**
 * Water: two octaves of scrolling noise bend the normal (moving glints), a fresnel
 * term adds the sky's tint, and alpha carries a mask (WATER_MASK) so the post pass
 * knows where to paint reflections. sceneRT alpha is otherwise 1 for every opaque surface.
 */
export const WATER_MASK = 0.5;
/** Alpha mask for painted signs: the post pass skips dithering there, so lettering stays crisp. */
export const SIGN_MASK = 0.25;
const WATER_VERT_HEAD = /* glsl */ `
varying vec3 vWPos;`;
const WATER_VERT_BODY = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.)).xyz;`;
const WATER_FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uSky;
varying vec3 vWPos;
${NOISE_GLSL}
float kRip(vec2 q){
  return kNoise(q * 1.6 + uTime * vec2(.13, .07)) * .6 + kNoise(q * 3.1 - uTime * vec2(.09, .15)) * .4;
}`;
const WATER_FRAG_NORMAL = /* glsl */ `
{
  vec3 upV = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);
  if (dot(normal, upV) > .9){
    const float e = .12;
    float h0 = kRip(vWPos.xz), hx = kRip(vWPos.xz + vec2(e, 0.)), hz = kRip(vWPos.xz + vec2(0., e));
    vec3 nw = normalize(vec3(-(hx - h0) / e * .12, 1., -(hz - h0) / e * .12));
    normal = normalize((viewMatrix * vec4(nw, 0.)).xyz);
  }
}`;
const WATER_FRAG_EMISSIVE = /* glsl */ `
{
  vec3 vd = isOrthographic ? vec3(0., 0., 1.) : normalize(vViewPosition);
  float fr = pow(1. - clamp(dot(normal, vd), 0., 1.), 3.);
  totalEmissiveRadiance += uSky * (.015 + fr * .35);
}`;

type Uniform<T> = { value: T };

function inject(src: string, anchor: string, code: string, after = true): string {
  if (!src.includes(anchor)) throw new Error(`shader anchor missing: ${anchor}`);
  return src.replace(anchor, after ? `${anchor}\n${code}` : `${code}\n${anchor}`);
}

/** A lamp-like emissive material whose glow follows the time of day. */
export interface LampMaterial extends THREE.MeshStandardMaterial {
  userData: { base: number; ownLook?: boolean };
}

export class Materials {
  readonly tex = buildTextures();
  readonly lamps: LampMaterial[] = [];
  readonly leaves: LeafSet;
  readonly grass: THREE.MeshStandardMaterial;
  readonly roof: THREE.MeshStandardMaterial;
  readonly roofDark: THREE.MeshStandardMaterial;
  readonly water: THREE.MeshStandardMaterial;
  readonly flags: THREE.MeshStandardMaterial;
  readonly roads: THREE.MeshStandardMaterial[] = [];
  readonly dark = this.std('#2e2a42', 0.8);
  readonly stone = this.std('#adb2b8');
  readonly vermilion = this.std('#d0402a', 0.6);
  readonly windowDark = this.std('#2a3040', 0.3, { metalness: 0.3 });
  readonly windowLit = this.std('#ffd37a', 0.6, { emissive: new THREE.Color('#ffa94d'), emissiveIntensity: 1.6 });
  readonly shopLit = this.std('#ffc072', 0.6, { emissive: new THREE.Color('#ff9a40'), emissiveIntensity: 2 });
  /** The kissaten is the warmest light on the street at blue hour (sky.ts): a touch brighter and more golden than shops. */
  readonly cafeLit = this.std('#ffd37a', 0.6, { emissive: new THREE.Color('#ffb04a'), emissiveIntensity: 3.2 });
  readonly frame = this.std('#2e2a42', 0.8);
  readonly lantern = this.lamp('#ff7a55', '#ff3a1e', 2.2);
  /** Shared shader inputs, updated once a frame by World. */
  readonly time: Uniform<number> = { value: 0 };
  readonly wind: Uniform<number> = { value: 1 };
  readonly wet: Uniform<number> = { value: 0 };
  /** Sky colour near the horizon (linear), for the water's fresnel. */
  readonly skyTint: Uniform<THREE.Color> = { value: new THREE.Color('#c4dcee') };
  private readonly mossColor: Uniform<THREE.Color> = { value: new THREE.Color('#3c6838') };
  readonly puddle: THREE.MeshStandardMaterial;
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly weatheredCache = new Map<string, THREE.MeshStandardMaterial>();
  /** Every weathered twin with its base, so runtime recolours (seasons) reach both. */
  private readonly twins: [base: THREE.MeshStandardMaterial, twin: THREE.MeshStandardMaterial][] = [];

  constructor() {
    const leaf = () => this.patchLeaf(this.std('#ffffff', 0.9, { flatShading: true }));
    this.leaves = { sakura: [leaf(), leaf(), leaf()], deciduous: [leaf(), leaf(), leaf()], evergreen: [leaf(), leaf(), leaf()] };
    this.grass = this.tex2('grass', '#5b8c45', 0.5, 0.5);
    this.roof = this.tex2('roof', '#4b4f5a', 0.5, 0.5, 0.7);
    this.roofDark = this.tex2('roof', '#3f3a58', 0.5, 0.5, 0.7);
    this.water = this.patchWater(this.std('#2f7f7a', 0.12, { metalness: 0.35 }));
    this.puddle = this.patchWater(this.std('#1f2c45', 0.05, { metalness: 0.8 }));
    this.flags = this.std('#f4c7cf', 0.9, { side: THREE.DoubleSide });
  }

  private patchLeaf(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const time = this.time,
      wind = this.wind;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.uniforms.uWind = wind;
      sh.vertexShader = inject(inject(sh.vertexShader, '#include <common>', LEAF_VERT_HEAD), '#include <begin_vertex>', LEAF_VERT_BODY);
      sh.fragmentShader = inject(inject(sh.fragmentShader, '#include <common>', 'varying vec3 vBlob;'), '#include <color_fragment>', LEAF_FRAG_BODY);
    };
    m.customProgramCacheKey = () => 'leaf';
    m.userData.ownLook = true;
    return m;
  }

  private patchWater(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const time = this.time,
      sky = this.skyTint;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.uniforms.uSky = sky;
      sh.vertexShader = inject(inject(sh.vertexShader, '#include <common>', WATER_VERT_HEAD), '#include <project_vertex>', WATER_VERT_BODY);
      let f = inject(sh.fragmentShader, '#include <common>', WATER_FRAG_HEAD);
      f = inject(f, '#include <normal_fragment_maps>', WATER_FRAG_NORMAL);
      f = inject(f, '#include <emissivemap_fragment>', WATER_FRAG_EMISSIVE);
      f = inject(f, '#include <dithering_fragment>', `gl_FragColor.a = ${WATER_MASK.toFixed(2)};`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'water';
    m.userData.ownLook = true;
    return m;
  }

  /**
   * The weathered twin of a material, for geometry that carries weathering
   * attributes (Kit's weathering scope adds them). Cached, so a shared base stays
   * shared. `moss` (0..1) lets the stone wall grow it; render walls don't.
   */
  weathered(base: THREE.MeshStandardMaterial, moss = 0): THREE.MeshStandardMaterial {
    const key = `${base.uuid}|${moss}`;
    const hit = this.weatheredCache.get(key);
    if (hit) return hit;
    const m = base.clone();
    m.userData = { ownLook: true };
    const wet = this.wet,
      mossColor = this.mossColor,
      mossU = { value: moss };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = wet;
      sh.uniforms.uMoss = mossU;
      sh.uniforms.uMossColor = mossColor;
      sh.vertexShader = inject(inject(sh.vertexShader, '#include <common>', WEATHER_VERT_HEAD), '#include <project_vertex>', WEATHER_VERT_BODY);
      sh.fragmentShader = inject(inject(sh.fragmentShader, '#include <common>', WEATHER_FRAG_HEAD), '#include <color_fragment>', WEATHER_FRAG_BODY);
    };
    m.customProgramCacheKey = () => 'weathered';
    this.weatheredCache.set(key, m);
    this.twins.push([base, m]);
    return m;
  }

  /**
   * A sign painted from the glyph atlas. Returns its size in metres at native
   * texel size. `glow` > 0 makes it a back-lit box: the face emits, the ink doesn't,
   * and it brightens with the street lamps.
   */
  sign(spec: SignSpec, glow = 0): { material: THREE.MeshStandardMaterial; w: number; h: number } {
    const p = paintSign(spec);
    const t = new THREE.CanvasTexture(p.canvas);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    const material = this.std('#ffffff', 0.7, { map: t });
    material.userData.ownLook = true; // painted signs are never weathered over
    material.onBeforeCompile = (sh) => {
      sh.fragmentShader = inject(sh.fragmentShader, '#include <dithering_fragment>', `gl_FragColor.a = ${SIGN_MASK.toFixed(2)};`);
    };
    material.customProgramCacheKey = () => 'sign';
    if (glow > 0) {
      material.emissive.set('#ffffff');
      material.emissiveMap = t;
      material.emissiveIntensity = glow;
      const lamp = material as LampMaterial;
      lamp.userData = { base: glow, ownLook: true };
      this.lamps.push(lamp);
    }
    return { material, w: p.w * SIGN_TEXEL, h: p.h * SIGN_TEXEL };
  }

  std(color: string, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, ...extra });
  }

  /** Cached solid colour: identical calls share a material (fewer GPU programs/uniform uploads). */
  solid(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
    const key = `${color}|${roughness}`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.std(color, roughness);
      this.cache.set(key, m);
    }
    return m;
  }

  /** Textured material. `rx/ry` = texture repeats across a BoxGeometry face (0..1 UVs). */
  tex2(kind: TexKind, color: string, rx: number, ry: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const t = this.tex[kind].clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return this.std(color, roughness, { map: t, ...extra });
  }

  lamp(color: string, emissive: string, base: number): LampMaterial {
    const m = this.std(color, 0.6, { emissive: new THREE.Color(emissive), emissiveIntensity: base }) as LampMaterial;
    m.userData = { base };
    this.lamps.push(m);
    return m;
  }

  road(rx: number, ry: number): THREE.MeshStandardMaterial {
    const m = this.tex2('asphalt', '#5a5a62', rx, ry, 0.92);
    this.roads.push(m);
    return m;
  }

  setLampLevel(level: number): void {
    for (const m of this.lamps) m.emissiveIntensity = m.userData.base * (0.15 + level);
  }

  setWetness(w: number): void {
    this.wet.value = w;
    for (const r of this.roads) {
      r.roughness = 0.92 - 0.62 * w;
      r.metalness = 0.3 * w;
      r.color.set(w > 0.5 ? '#3e3e46' : '#5a5a62');
    }
  }

  applySeason(season: Season): void {
    const s = SEASON_COLORS[season];
    (['sakura', 'deciduous', 'evergreen'] as const).forEach((k) => this.leaves[k].forEach((m, i) => m.color.set(s[k][i]!)));
    this.grass.color.set(s.grass);
    this.roof.color.set(s.roof);
    this.roofDark.color.set(s.roofDark);
    this.water.color.set(s.water);
    this.flags.color.set(s.flag);
    // weathered roofs snow over too
    for (const [base, twin] of this.twins) twin.color.copy(base.color);
  }
}
