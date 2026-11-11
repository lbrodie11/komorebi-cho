import * as THREE from 'three';
import { hexToSrgb } from '../core/math';
import { bakePaletteLut, LUT_AXIS, LUT_SIZE } from './lut';
import { SIGN_MASK, WATER_MASK } from './materials';

/**
 * The look of the game lives in these passes. Colour spaces at each stage are
 * documented in docs/COLOR.md.
 *
 *   scene → `sceneRT` (low res, half-float, LINEAR light, + depth)
 *   glow  → `glowRT`  (half of sceneRT): bright HDR neighbours gathered once per 2×2 block
 *           (the same 24 taps as before, over a quarter of the pixels)
 *   composite → canvas (sRGB palette colours):
 *     1. dithered sky (gradient, drifting cloud bands, stars, moon)
 *     2. lantern glow, upsampled from glowRT (halos dither nicely)
 *     3. drifting world-space cloud shadows; mirrored reflections on water (scene alpha = WATER_MASK)
 *     4. tonemap → sRGB → hue-shifted shading
 *     5. rain mist near the ground
 *     6. pixel-artist outlines (dark violet) and top rim light
 *     7. Bayer 4×4 dither (skipped on signs, scene alpha = SIGN_MASK) → palette snap (candidate 3D LUT, or the reference loop with `?lutOff`)
 *     8. Bayer dissolve from the previous view during camera steps
 * The canvas is then upscaled by an integer factor with `image-rendering: pixelated`.
 */

/** Camera-step dissolve length, seconds. */
export const DISSOLVE_S = 0.25;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

const BAYER = /* glsl */ `
float B2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float B4(vec2 a){ return B2(.5 * a) * .25 + B2(a); }`;

/**
 * Glow gather, evaluated once per 2×2 block (half resolution): 24 taps at a
 * quarter of the pixel count. Upsampled with NEAREST so halos stay chunky
 * pixel-art steps; `GLOW_TAP` (full-res pixels between taps) was tuned so
 * halo reach matches the old full-res gather (spacing 1.6 at full res).
 * The brightness cap lives in the composite, where exposure is known.
 */
export const GLOW_TAP = 1.2;
export const glowFragmentShader = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 res;
uniform float tap;
varying vec2 vUv;
void main(){
  vec2 px = 1. / res;
  vec3 g = vec3(0.);
  for (int i = -2; i <= 2; i++){
    for (int j = -2; j <= 2; j++){
      if (i == 0 && j == 0) continue;
      vec3 s = texture2D(tColor, vUv + vec2(float(i), float(j)) * px * tap).rgb;
      float l = max(max(s.r, s.g), s.b);
      g += s * max(l - 1.1, 0.) / (1. + float(i * i + j * j));
    }
  }
  gl_FragColor = vec4(g, 1.);
}`;

export const compositeFragmentShader = (n: number): string => /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tGlow;
uniform sampler2D tPrev;
uniform vec2 res;
uniform vec3 pal[${n}];
#ifdef USE_LUT
uniform sampler3D tLut;
// mirrors lutCell() in lut.ts: fine cells up to 1.0, coarse ones above
vec3 lutCell(vec3 c){
  vec3 lo = floor((c - LUT_LO) / (1. - LUT_LO) * LUT_A);
  vec3 hi = LUT_A + floor((c - 1.) / (LUT_HI - 1.) * LUT_B);
  return clamp(mix(lo, hi, step(1., c)), 0., LUT_A + LUT_B - 1.);
}
#endif
uniform vec3 bgTop;
uniform vec3 bgBottom;
uniform vec3 mistColor;
uniform float stars;
uniform float moon;
uniform float time;
uniform float exposure;
uniform float spread;
uniform float cloudShadow;
uniform float bgClouds;
uniform float mist;
uniform float glow;
uniform float fade;
uniform vec2 cloudOffset;
uniform mat4 invViewProj;
uniform vec2 upUv;
uniform float waterReflect;
varying vec2 vUv;
${BAYER}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1., 0.)), c = hash(i + vec2(0., 1.)), d = hash(i + vec2(1., 1.));
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= .5; } return v; }
vec3 toSRGB(vec3 c){ c = max(c, 0.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
vec3 worldPos(vec2 uv, float d){ vec4 w = invViewProj * vec4(uv * 2. - 1., d * 2. - 1., 1.); return w.xyz / w.w; }

void main(){
  vec2 px = 1. / res;
  float d = texture2D(tDepth, vUv).r;

  // 2. glow (gathered at half res in the glow pass); applies over sky too.
  // Hue-preserving cap: scale all channels together once the brightest passes 1, so a pile of
  // orange lanterns stays an orange halo instead of clipping channel-by-channel to white.
  vec3 G = texture2D(tGlow, vUv).rgb * glow * exposure;
  G /= max(1., max(max(G.r, G.g), G.b));
  vec3 glowC = toSRGB(G) * .55;

  vec3 c;
  float dither = spread;
  if (d >= .99999){
    // 1. sky
    float y = vUv.y;
    c = mix(bgBottom, bgTop, smoothstep(0., 1., y));
    float band = fbm(vec2(vUv.x * 2.6 + time * .006, vUv.y * 7.));
    float cl = smoothstep(.56, .78, band) * bgClouds * smoothstep(.25, .95, y);
    c = mix(c, mix(bgBottom, vec3(1.), .4), cl * .55);
    float s = hash(floor(vUv * res));
    if (s > .993) c += vec3(.8) * stars * (.55 + .45 * sin(time * 1.5 + s * 400.));
    vec2 mp = (vUv - vec2(.86, .8)) * vec2(res.x / res.y, 1.);
    float md = length(mp);
    float crescent = step(md, .045) * (1. - step(length(mp - vec2(.018, .01)), .04));
    c = mix(c, vec3(.96, .95, .86), crescent * moon);
  } else {
    vec4 sc = texture2D(tColor, vUv);
    vec3 lin = sc.rgb * exposure;
    vec3 wp = worldPos(vUv, d);
    // signs snap flat: pixel artists never dither lettering
    if (abs(sc.a - SIGN_A) < .12) dither = 0.;
    // 3a. water reflects what stands above it. Mirroring a point at height h above the surface moves
    // it 2h straight down the screen (orthographic camera), so march up the screen in steps of
    // mirror height and take the first pixel tall enough to be the reflection. Ripples wobble it.
    if (abs(sc.a - WATER_A) < .12){
      vec2 wob = vec2((vnoise(wp.xz * 2.2 + time * vec2(.35, .2)) - .5) * 2.5 * px.x, 0.);
      vec3 refl = pow(mix(bgBottom, bgTop, .35), vec3(2.2)); // nothing tall enough: the sky
      // the sky is mirrored faintly so the water keeps its own colour; objects come through stronger
      float k = waterReflect * .35;
      for (int i = 1; i <= 32; i++){
        float s = float(i) * .4;
        vec2 uv2 = vUv + wob + upUv * s;
        if (uv2.y > 1.) break;
        float d2 = texture2D(tDepth, uv2).r;
        if (d2 >= .99999) break;
        if (worldPos(uv2, d2).y - wp.y >= s * .5){
          vec4 r2 = texture2D(tColor, uv2);
          if (abs(r2.a - WATER_A) >= .12){ refl = r2.rgb; k = waterReflect; }
          break;
        }
      }
      lin = mix(lin, refl * exposure * vec3(.7, .9, .9), k); // water tints what it mirrors
    }
    // 3. cloud shadows drifting across the diorama
    float cs = fbm(wp.xz * .055 + cloudOffset);
    lin *= 1. - cloudShadow * smoothstep(.48, .72, cs) * .38;
    // 4. tonemap + sRGB + hue-shifted shading
    lin = lin / (1. + lin * .55) * 1.22;
    c = toSRGB(clamp(lin, 0., 1.));
    float l = dot(c, vec3(.3, .59, .11));
    c = mix(c * vec3(.82, .86, 1.14) + vec3(.012, 0., .035), c * vec3(1.04, 1., .93), smoothstep(.15, .7, l));
    // 5. low mist in rain
    c = mix(c, mistColor, mist * (1. - smoothstep(0., 5., wp.y)) * .32);
    // 6. outlines + rim light
    float dl = texture2D(tDepth, vUv - vec2(px.x, 0.)).r;
    float dr = texture2D(tDepth, vUv + vec2(px.x, 0.)).r;
    float dd = texture2D(tDepth, vUv - vec2(0., px.y)).r;
    float du = texture2D(tDepth, vUv + vec2(0., px.y)).r;
    if (max(max(dl, dr), dd) - d > .004) c = mix(c, vec3(.09, .07, .14), .5);
    else if (du - d > .004) c = c * 1.18 + .03;
  }
  c += glowC;
  // 7. ordered dither + palette snap
  c += (B4(gl_FragCoord.xy) - .5) * dither;
#ifdef USE_LUT
  // The cell lists the (up to 4) palette colours that can win inside it; pick the nearest to the exact colour.
  ivec3 cell = ivec3(lutCell(c));
  ivec4 k = ivec4(texelFetch(tLut, cell, 0) * 255. + .5);
  const vec3 W = vec3(.3, .59, .11);
  vec3 o = pal[k.x];
  vec3 e = c - o;
  float best = dot(e * e, W);
  vec3 p = pal[k.y]; e = c - p; float q = dot(e * e, W); if (q < best){ best = q; o = p; }
  p = pal[k.z]; e = c - p; q = dot(e * e, W); if (q < best){ best = q; o = p; }
  p = pal[k.w]; e = c - p; q = dot(e * e, W); if (q < best){ o = p; }
#else
  float best = 1e9; vec3 o = c;
  for (int i = 0; i < ${n}; i++){
    vec3 e = c - pal[i];
    float q = dot(e * e, vec3(.3, .59, .11));
    if (q < best){ best = q; o = pal[i]; }
  }
#endif
  // 8. camera-step dissolve: the previous view survives where the Bayer threshold is above 'fade'
  if (fade > 0. && B4(gl_FragCoord.xy) < fade) o = texture2D(tPrev, vUv).rgb;
  gl_FragColor = vec4(o, 1.);
}`;

export interface PostParams {
  bgTop: string;
  bgBottom: string;
  mistColor: string;
  stars: number;
  moon: number;
  exposure: number;
  cloudShadow: number;
  bgClouds: number;
  mist: number;
  glow: number;
  /** How strongly water mirrors the scene (0..1). */
  waterReflect: number;
}

const v3 = (hex: string) => new THREE.Vector3(...hexToSrgb(hex));

/** Everything that lives on the GPU; rebuilt wholesale after a context loss. */
interface Gpu {
  sceneRT: THREE.WebGLRenderTarget;
  glowRT: THREE.WebGLRenderTarget;
  /** Previous-view snapshots, ping-ponged so a new snapshot can read the one on screen. */
  prev: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  lut: THREE.Data3DTexture | null;
  glowMat: THREE.ShaderMaterial;
  compMat: THREE.ShaderMaterial;
}

export class PostPass {
  private gpu: Gpu;
  private readonly lutData: Uint8Array | null;
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly inv = new THREE.Matrix4();
  private readonly up = new THREE.Vector4();
  private w = 1;
  private h = 1;
  private fadeLeft = 0;
  /** Which `prev` target the composite currently dissolves from. */
  private prevIdx: 0 | 1 = 0;

  constructor(
    private readonly palette: readonly string[],
    readonly useLut = true,
  ) {
    this.lutData = useLut ? bakePaletteLut(palette).data : null;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.gpu = this.build();
  }

  private build(): Gpu {
    const sceneRT = new THREE.WebGLRenderTarget(this.w, this.h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
    });
    sceneRT.depthTexture = new THREE.DepthTexture(this.w, this.h);
    sceneRT.depthTexture.type = THREE.UnsignedIntType;
    // NEAREST upsample keeps halos in crisp 2×2 steps; LINEAR made them visibly bloomier than the old full-res gather.
    const glowRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    // Holds final palette colours (exact 8-bit values), so a plain RGBA8 target round-trips them losslessly.
    const prevOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false } as const;
    const prev: Gpu['prev'] = [new THREE.WebGLRenderTarget(1, 1, prevOpts), new THREE.WebGLRenderTarget(1, 1, prevOpts)];

    let lut: THREE.Data3DTexture | null = null;
    if (this.lutData) {
      lut = new THREE.Data3DTexture(this.lutData, LUT_SIZE, LUT_SIZE, LUT_SIZE);
      lut.format = THREE.RGBAFormat;
      lut.type = THREE.UnsignedByteType;
      lut.minFilter = lut.magFilter = THREE.NearestFilter;
      lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
      lut.unpackAlignment = 1;
      // Palette indices, not colours: never colour-converted, never filtered.
      lut.colorSpace = THREE.NoColorSpace;
      lut.needsUpdate = true;
    }

    const glowMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: sceneRT.texture }, res: { value: new THREE.Vector2(this.w, this.h) }, tap: { value: GLOW_TAP } },
      vertexShader: VERT,
      fragmentShader: glowFragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    // Palette and sky colours are raw sRGB vectors on purpose (THREE.Color would linearise them); see docs/COLOR.md.
    const compMat = new THREE.ShaderMaterial({
      defines: {
        // scene alpha tags surfaces: 1 for ordinary opaque ones, these for water and signs
        WATER_A: WATER_MASK.toFixed(3),
        SIGN_A: SIGN_MASK.toFixed(3),
        ...(lut
          ? { USE_LUT: '', LUT_LO: LUT_AXIS.lo.toFixed(6), LUT_HI: LUT_AXIS.hi.toFixed(6), LUT_A: LUT_AXIS.a.toFixed(1), LUT_B: LUT_AXIS.b.toFixed(1) }
          : {}),
      },
      uniforms: {
        tColor: { value: sceneRT.texture },
        tDepth: { value: sceneRT.depthTexture },
        tGlow: { value: glowRT.texture },
        tPrev: { value: prev[0].texture },
        tLut: { value: lut },
        res: { value: new THREE.Vector2(this.w, this.h) },
        pal: { value: this.palette.map(v3) },
        bgTop: { value: v3('#4f73a3') },
        bgBottom: { value: v3('#c4dcee') },
        mistColor: { value: v3('#8a8f99') },
        stars: { value: 0 },
        moon: { value: 0 },
        time: { value: 0 },
        exposure: { value: 1 },
        spread: { value: 0.1 },
        cloudShadow: { value: 0.6 },
        bgClouds: { value: 0.8 },
        mist: { value: 0 },
        glow: { value: 1 },
        fade: { value: 0 },
        cloudOffset: { value: new THREE.Vector2() },
        invViewProj: { value: new THREE.Matrix4() },
        upUv: { value: new THREE.Vector2() },
        waterReflect: { value: 0.4 },
      },
      vertexShader: VERT,
      fragmentShader: compositeFragmentShader(this.palette.length),
      depthTest: false,
      depthWrite: false,
    });
    this.prevIdx = 0;
    const gpu = { sceneRT, glowRT, prev, lut, glowMat, compMat };
    this.resizeTargets(gpu);
    return gpu;
  }

  private resizeTargets(g: Gpu): void {
    g.sceneRT.setSize(this.w, this.h);
    g.glowRT.setSize(Math.max(1, Math.ceil(this.w / 2)), Math.max(1, Math.ceil(this.h / 2)));
    for (const t of g.prev) t.setSize(this.w, this.h);
    (g.glowMat.uniforms.res!.value as THREE.Vector2).set(this.w, this.h);
    (g.compMat.uniforms.res!.value as THREE.Vector2).set(this.w, this.h);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.fadeLeft = 0; // the previous view no longer lines up
    this.resizeTargets(this.gpu);
  }

  set(p: Partial<PostParams>): void {
    const u = this.gpu.compMat.uniforms;
    if (p.bgTop) (u.bgTop!.value as THREE.Vector3).set(...hexToSrgb(p.bgTop));
    if (p.bgBottom) (u.bgBottom!.value as THREE.Vector3).set(...hexToSrgb(p.bgBottom));
    if (p.mistColor) (u.mistColor!.value as THREE.Vector3).set(...hexToSrgb(p.mistColor));
    for (const k of ['stars', 'moon', 'exposure', 'cloudShadow', 'bgClouds', 'mist', 'glow', 'waterReflect'] as const) {
      if (p[k] !== undefined) u[k]!.value = p[k];
    }
  }

  /**
   * Snapshot the frame on screen so the next camera step dissolves from it.
   * Call *before* moving the camera: it re-composites the scene/glow targets,
   * which still hold the old view. If a dissolve is already running, the
   * snapshot includes it (old pixels and all), so stepping again mid-dissolve
   * never pops. The snapshot goes into the idle `prev` target, because the
   * one being sampled can't also be rendered to (feedback loop).
   */
  beginDissolve(renderer: THREE.WebGLRenderer): void {
    const g = this.gpu;
    const u = g.compMat.uniforms;
    const next = this.prevIdx === 0 ? 1 : 0;
    u.fade!.value = this.fadeLeft / DISSOLVE_S;
    u.tPrev!.value = g.prev[this.prevIdx].texture;
    this.quad.material = g.compMat;
    renderer.setRenderTarget(g.prev[next]);
    renderer.render(this.quadScene, this.cam);
    renderer.setRenderTarget(null);
    this.prevIdx = next;
    u.tPrev!.value = g.prev[next].texture;
    this.fadeLeft = DISSOLVE_S;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number, wind: THREE.Vector2, dt: number): void {
    const g = this.gpu;
    const u = g.compMat.uniforms;
    u.time!.value = time;
    (u.cloudOffset!.value as THREE.Vector2).copy(wind);
    this.inv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // screen-space (uv) shift of one metre straight up, for the water reflections
    this.up.set(0, 1, 0, 0).applyMatrix4(this.inv);
    (u.upUv!.value as THREE.Vector2).set(this.up.x * 0.5, this.up.y * 0.5);
    (u.invViewProj!.value as THREE.Matrix4).copy(this.inv.invert());
    this.fadeLeft = Math.max(0, this.fadeLeft - dt);
    u.fade!.value = this.fadeLeft / DISSOLVE_S;

    renderer.setRenderTarget(g.sceneRT);
    renderer.render(scene, camera);
    this.quad.material = g.glowMat;
    renderer.setRenderTarget(g.glowRT);
    renderer.render(this.quadScene, this.cam);
    this.quad.material = g.compMat;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.cam);
  }

  /**
   * After `webglcontextrestored`: recreate every target, texture and material.
   * Uniform state (sky colours, exposure…) carries over from the old material.
   * The old objects are dropped, not disposed: their GL handles died with the old
   * context, and three re-created its bookkeeping on restore, so disposing would
   * only ask WebGL to delete objects that belong to another context.
   */
  rebuildAfterContextLoss(): void {
    const old = this.gpu;
    const next = this.build();
    for (const [k, { value }] of Object.entries(old.compMat.uniforms)) {
      const dst = next.compMat.uniforms[k];
      if (!dst) continue;
      if (typeof value === 'number') dst.value = value;
      else if (value instanceof THREE.Vector2) (dst.value as THREE.Vector2).copy(value);
      else if (value instanceof THREE.Vector3) (dst.value as THREE.Vector3).copy(value);
      else if (value instanceof THREE.Matrix4) (dst.value as THREE.Matrix4).copy(value);
    }
    this.gpu = next;
    this.fadeLeft = 0;
  }
}
