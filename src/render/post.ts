import * as THREE from 'three';
import { hexToSrgb } from '../core/math';
import { bakePaletteLut, LUT_AXIS, LUT_SIZE } from './lut';
import { SIGN_MASK, WATER_MASK } from './materials';
import { DiffusionPass } from './diffusion-pass';
import { diffusionParams, type DiffusionParams } from './diffusion';

/**
 * The look of the game lives in these passes. Colour spaces at each stage are
 * documented in docs/COLOR.md.
 *
 *   scene → `sceneRT` (low res, half-float, LINEAR light, + depth)
 *   glow  → `glowRT`  (half of sceneRT): bright HDR neighbours gathered once per 2×2 block
 *           (the same 24 taps as before, over a quarter of the pixels)
 *   composite → canvas (sRGB palette colours):
 *     1. sky (gradient, drifting cloud bands, stars, moon): smooth, never dithered or palette-snapped
 *     2. lantern glow, upsampled from glowRT (halos dither nicely)
 *     3. drifting world-space cloud shadows; mirrored reflections on water (scene alpha = WATER_MASK)
 *     4. tonemap → sRGB → hue-shifted shading
 *     5. rain mist near the ground
 *     6. pixel-artist outlines (dark violet; a moonlit rim against a dark night sky) and top rim light
 *     7. Bayer 4×4 dither (skipped on signs, scene alpha = SIGN_MASK) → palette snap (the diorama only;
 *        the Smooth preset skips both and keeps full-colour shading) (candidate 3D LUT, or the reference loop with `?lutOff`)
 *     8. Bayer dissolve from the previous view during camera steps
 * The canvas is then upscaled by an integer factor with `image-rendering: pixelated`.
 */

/** How much of the pixel-pass halo (glowC) Film Diffusion's glow replaces at full strength. */
const HALO_FADE = 0.6;

/**
 * Ordered-dither amplitude, applied only inside light halos (see the composite). Small on purpose:
 * a Bayer offset of ±0.015 only flips pixels within ~1.5% of the boundary between two palette
 * shades, so a halo falls off through thin dithered seams instead of hard rings. Everywhere else
 * the palette snap shades in flat clusters. (It was 0.1 everywhere, which checkered walls, roofs
 * and lawns and hid small details at 1× zoom.)
 */
export const DITHER_SPREAD = 0.03;

/** Camera-step dissolve length, seconds. */
export const DISSOLVE_S = 0.25;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
/** For passes that address pixels with gl_FragCoord (no varying: Firefox warns about unread outputs). */
const VERT_PLAIN = 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }';

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
// camera offset mod 2: each 2×2 block covers the same two world pixels as the camera pans,
// so the chunky halo slides with its lantern instead of re-sampling (shimmering) every step
uniform vec2 shift;
void main(){
  vec2 px = 1. / res;
  vec2 vUv = (2. * floor(gl_FragCoord.xy) + 1. - shift) * px;
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
uniform vec2 glowRes;
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
uniform vec2 ditherShift;
// where the visible screen sits in the render target (overscan margin less the sub-pixel shift), and its size
uniform vec2 skyOff;
uniform vec2 skyRes;
// whole pixels to move the dissolving previous view by, so it stays where it was on screen
uniform vec2 prevShift;
// 1: snap to the palette (Fine/Classic/Chunky); 0: full-colour shading (Smooth)
uniform float snap;
// Film Diffusion (0, and haloScale 1, on the plain path)
uniform float flagOut;
uniform float haloScale;
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

// nearest palette colour (weighted RGB distance)
vec3 snapPal(vec3 c){
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
  return o;
#else
  float best = 1e9; vec3 o = c;
  for (int i = 0; i < ${n}; i++){
    vec3 e = c - pal[i];
    float q = dot(e * e, vec3(.3, .59, .11));
    if (q < best){ best = q; o = pal[i]; }
  }
  return o;
#endif
}

void main(){
  vec2 px = 1. / res;
  float d = texture2D(tDepth, vUv).r;
  bool sky = d >= .99999;

  // 2. glow (gathered at half res in the glow pass); applies over sky too.
  // Hue-preserving cap: scale all channels together once the brightest passes 1, so a pile of
  // orange lanterns stays an orange halo instead of clipping channel-by-channel to white.
  vec2 gq = floor((gl_FragCoord.xy + mod(ditherShift, 2.)) / 2.);
  vec3 G = texture2D(tGlow, (gq + .5) / glowRes).rgb * glow * exposure * haloScale;
  G /= max(1., max(max(G.r, G.g), G.b));
  vec3 glowC = toSRGB(G) * .55;

  vec3 c;
  // Dither only where light falls off through a halo. On ordinary surfaces it checkered whole
  // lawns and walls whose colour sat near a palette boundary; flat palette clusters read better.
  float dither = spread * smoothstep(.01, .06, max(glowC.r, max(glowC.g, glowC.b)));
  if (sky){
    // 1. sky, a backdrop fixed to the screen: evaluated at this pixel's place on the screen (q), not
    // in the render target, which is drawn with an overscan margin and shifted by the camera's
    // sub-pixel offset. Otherwise the backdrop would wobble by up to half a pixel as the camera moves.
    vec2 q = gl_FragCoord.xy - skyOff;
    vec2 sUv = q / skyRes;
    float y = sUv.y;
    c = mix(bgBottom, bgTop, smoothstep(0., 1., y));
    float band = fbm(vec2(sUv.x * 2.6 + time * .006, sUv.y * 7.));
    float cl = smoothstep(.56, .78, band) * bgClouds * smoothstep(.25, .95, y);
    c = mix(c, mix(bgBottom, vec3(1.), .4), cl * .55);
    // Stars live on a grid at most 300 cells tall, one render pixel each, so density and the hash's
    // input range stay the same at any render height (a per-pixel hash at Smooth's ~700 rows
    // degraded into vertical streaks). At palette heights (≤ 300) the grid is the pixel grid.
    // Each star is a one-pixel tent at its place on the screen: a single pixel when the screen and
    // the render target line up, shared between neighbours when they don't, so it never moves.
    float sg = min(skyRes.y, 300.);
    vec2 sgrid = vec2(skyRes.x / skyRes.y, 1.) * sg;
    vec2 base = floor(sUv * sgrid);
    float st = 0.;
    for (int i = -1; i <= 1; i++){
      for (int j = -1; j <= 1; j++){
        vec2 cell = base + vec2(float(i), float(j));
        float s = hash(cell);
        if (s <= .993) continue;
        vec2 dp = abs((cell + .5) / sgrid * skyRes - q);
        st += max(0., 1. - dp.x) * max(0., 1. - dp.y) * (.55 + .45 * sin(time * 1.5 + s * 400.));
      }
    }
    c += vec3(.8) * stars * st;
    vec2 mp = (sUv - vec2(.86, .8)) * vec2(skyRes.x / skyRes.y, 1.);
    float md = length(mp);
    // edges by pixel coverage, not a hard step: the render grid slides under the still moon as the
    // camera moves, and a hard edge would flicker a pixel in and out; coverage changes smoothly
    float aa = 1. / skyRes.y; // one screen pixel, in these units
    float crescent = clamp((.045 - md) / aa + .5, 0., 1.) * (1. - clamp((.04 - length(mp - vec2(.018, .01))) / aa + .5, 0., 1.));
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
    float far = max(max(dl, dr), dd);
    if (far - d > .004) {
      // A dark outline, except where the edge meets a dark sky: at night a near-black line against a
      // near-black sky erases the silhouette (#2e2a42 roofs on #1f2c45 sky are 1.01:1), so the edge
      // gets a faint cool moonlit rim instead. By day the line stays.
      float skyL = dot(mix(bgBottom, bgTop, .5), vec3(.3, .59, .11));
      float night = (far >= .99999 ? 1. : 0.) * (1. - smoothstep(.12, .3, skyL));
      c = mix(mix(c, vec3(.09, .07, .14), .5), c * 1.12 + vec3(.035, .04, .075), night);
    } else if (du - d > .004) c = c * 1.18 + .03;
  }
  c += glowC;
  // 7. ordered dither + palette snap
  vec3 unsnapped = c;
  vec3 o;
  float flag = 0.;
  if (snap > .5){
    // the pattern is pinned to the world (camera offset), so panning moves it with the scene instead of crawling
    c += (B4(gl_FragCoord.xy + ditherShift) - .5) * dither;
    o = snapPal(c);
    // Film Diffusion: tell the dither-blend pass which pixels the dither actually changed
    if (flagOut > .5 && o != snapPal(unsnapped)) flag = 1.;
  } else {
    // the Smooth look: full-colour shading, no palette and no dither; ±½/255 noise hides 8-bit banding
    o = clamp(unsnapped, 0., 1.) + (hash(gl_FragCoord.xy) - .5) / 255.;
  }
  if (sky){
    // The sky is a smooth gradient, never a dithered checkerboard: it is the backdrop to every
    // silhouette, and a busy two-colour pattern there competes with the diorama's edges.
    // ±½/255 of noise hides 8-bit banding. Stars, moon and clouds ride along unsnapped.
    o = clamp(unsnapped, 0., 1.) + (hash(gl_FragCoord.xy) - .5) / 255.;
    flag = 0.;
  }
  // 8. camera-step dissolve: the previous view survives where the Bayer threshold is above 'fade'
  if (fade > 0. && B4(gl_FragCoord.xy) < fade){
    o = texture2D(tPrev, (floor(gl_FragCoord.xy) + prevShift + .5) * px).rgb;
    flag = 0.;
  }
  gl_FragColor = vec4(o, flagOut > .5 ? flag : 1.);
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
  /** Film Diffusion: null on the plain (0%) path, which renders exactly as before it existed. */
  private diff: DiffusionPass | null = null;
  private strength = 0;
  private scale = 1;
  private outW = 1;
  private outH = 1;
  private params: DiffusionParams = diffusionParams(0, 1);

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
      uniforms: {
        tColor: { value: sceneRT.texture },
        res: { value: new THREE.Vector2(this.w, this.h) },
        tap: { value: GLOW_TAP },
        shift: { value: new THREE.Vector2() },
      },
      vertexShader: VERT_PLAIN,
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
        glowRes: { value: new THREE.Vector2(1, 1) },
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
        spread: { value: DITHER_SPREAD },
        cloudShadow: { value: 0.6 },
        bgClouds: { value: 0.8 },
        mist: { value: 0 },
        glow: { value: 1 },
        fade: { value: 0 },
        cloudOffset: { value: new THREE.Vector2() },
        invViewProj: { value: new THREE.Matrix4() },
        upUv: { value: new THREE.Vector2() },
        waterReflect: { value: 0.4 },
        ditherShift: { value: new THREE.Vector2() },
        skyOff: { value: new THREE.Vector2() },
        skyRes: { value: new THREE.Vector2(this.w, this.h) },
        prevShift: { value: new THREE.Vector2() },
        snap: { value: 1 },
        flagOut: { value: 0 },
        haloScale: { value: 1 },
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
    // one extra pixel of room: the 2×2 blocks are offset by the camera's offset mod 2
    g.glowRT.setSize(Math.ceil((this.w + 1) / 2), Math.ceil((this.h + 1) / 2));
    (g.compMat.uniforms.glowRes!.value as THREE.Vector2).set(g.glowRT.width, g.glowRT.height);
    for (const t of g.prev) t.setSize(this.w, this.h);
    (g.glowMat.uniforms.res!.value as THREE.Vector2).set(this.w, this.h);
    (g.compMat.uniforms.res!.value as THREE.Vector2).set(this.w, this.h);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.fadeLeft = 0; // the previous view no longer lines up
    this.resizeTargets(this.gpu);
    this.diff?.setSize(w, h);
    this.setSkyFrame(0, 0, w, h); // until told otherwise, the screen is the whole render target
  }

  /** Where the previous view's snapshot was taken, in the same terms as setSkyFrame's offset. */
  private readonly snapOff = new THREE.Vector2();

  /**
   * Where the visible screen sits in the render target: its lower-left corner at (`offX`, `offY`)
   * render pixels (the overscan margin less the camera's sub-pixel shift, y up) and `w`×`h` in
   * size. The sky is drawn in these screen terms so it stays still while the canvas is shifted,
   * and a dissolving previous view is moved by the change, so it stays where it was on screen.
   */
  setSkyFrame(offX: number, offY: number, w: number, h: number): void {
    const u = this.gpu.compMat.uniforms;
    (u.skyOff!.value as THREE.Vector2).set(offX, offY);
    (u.skyRes!.value as THREE.Vector2).set(w, h);
    (u.prevShift!.value as THREE.Vector2).set(Math.round(this.snapOff.x - offX), Math.round(this.snapOff.y - offY));
  }

  /**
   * Film Diffusion strength (0..DIFFUSION_MAX) and the enlargement in device pixels per
   * game pixel. Above 0 the pixel pass renders into an internal target and the
   * diffusion passes draw the canvas at `setOutputSize`; at exactly 0 the pixel pass
   * draws the canvas itself, unchanged. Returns whether the active path is running
   * (false when 0, or when the GPU can't set it up).
   */
  setDiffusion(renderer: THREE.WebGLRenderer, s: number, devPxPerGamePx: number): boolean {
    this.strength = s;
    this.scale = devPxPerGamePx;
    this.params = diffusionParams(s, devPxPerGamePx);
    if (s <= 0) {
      this.diff?.dispose();
      this.diff = null;
      return false;
    }
    if (!this.diff) {
      try {
        const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
        this.diff = new DiffusionPass(this.quadScene, this.quad, this.cam, half ? THREE.HalfFloatType : THREE.UnsignedByteType);
        this.diff.setSize(this.w, this.h);
        this.diff.setOutputSize(this.outW, this.outH);
      } catch (e) {
        console.warn('Film Diffusion unavailable; using the plain pixel path.', e);
        this.diff = null;
        return false;
      }
    }
    this.diff.setParams(this.params);
    return true;
  }

  /** Palette snap on (the pixel-art presets) or off (Smooth: full-colour shading). */
  setPalette(on: boolean): void {
    this.gpu.compMat.uniforms.snap!.value = on ? 1 : 0;
  }

  /** Canvas size for the active path (device-resolution budget, see diffusionOutputSize). */
  setOutputSize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    this.diff?.setOutputSize(w, h);
  }

  private readonly axis = new THREE.Vector3();
  /** Camera position in whole render pixels along its right/up axes (the texel snap makes these integers). */
  private camOffset(camera: THREE.Camera): [number, number] {
    const c = camera as THREE.OrthographicCamera;
    const px = (c.top - c.bottom) / c.zoom / this.h;
    const x = c.position.dot(this.axis.setFromMatrixColumn(c.matrixWorld, 0)) / px;
    const y = c.position.dot(this.axis.setFromMatrixColumn(c.matrixWorld, 1)) / px;
    return [Math.round(x), Math.round(y)];
  }

  get diffusing(): boolean {
    return this.diff !== null;
  }

  get outputWidth(): number {
    return this.outW;
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
    // the snapshot was composited in the current screen frame: no shift until the frame moves
    this.snapOff.copy(u.skyOff!.value as THREE.Vector2);
    (u.prevShift!.value as THREE.Vector2).set(0, 0);
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
    // Bayer 4×4 repeats every 4 pixels, so the camera's whole-pixel offset mod 4 pins it to the world
    const off = this.camOffset(camera);
    (u.ditherShift!.value as THREE.Vector2).set(((off[0] % 4) + 4) % 4, ((off[1] % 4) + 4) % 4);
    (g.glowMat.uniforms.shift!.value as THREE.Vector2).set(((off[0] % 2) + 2) % 2, ((off[1] % 2) + 2) % 2);

    renderer.setRenderTarget(g.sceneRT);
    renderer.render(scene, camera);
    this.quad.material = g.glowMat;
    renderer.setRenderTarget(g.glowRT);
    renderer.render(this.quadScene, this.cam);
    this.quad.material = g.compMat;
    const d = this.diff;
    u.flagOut!.value = d ? 1 : 0;
    // the old chunky halo gives way to the smooth glow as it rises, so they don't stack
    u.haloScale!.value = d ? 1 - HALO_FADE * this.params.glowAmt : 1;
    renderer.setRenderTarget(d ? d.pix : null);
    renderer.render(this.quadScene, this.cam);
    if (d) d.render(renderer, g.sceneRT, u.exposure!.value as number, off);
  }

  /**
   * After `webglcontextrestored`: recreate every target, texture and material.
   * Uniform state (sky colours, exposure…) carries over from the old material.
   * The old objects are dropped, not disposed: their GL handles died with the old
   * context, and three re-created its bookkeeping on restore, so disposing would
   * only ask WebGL to delete objects that belong to another context.
   */
  rebuildAfterContextLoss(renderer: THREE.WebGLRenderer): void {
    const old = this.gpu;
    const next = this.build();
    // the diffusion targets died with the context too: drop (don't dispose) and rebuild
    this.diff = null;
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
    if (this.strength > 0) this.setDiffusion(renderer, this.strength, this.scale);
  }
}
