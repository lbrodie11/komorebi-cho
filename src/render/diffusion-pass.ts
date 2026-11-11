import * as THREE from 'three';
import { GLOW_KNEE, GLOW_THRESHOLD, type DiffusionParams } from './diffusion';

/**
 * Film Diffusion's GPU side: everything after the pixel pass when the setting is
 * above 0%. See docs/ARCHITECTURE.md ("Film Diffusion") for the target table.
 *
 *   pix (pixel-pass output, alpha = dither flag)
 *     → blend: dither-only neighbours are averaged, so in-between colours read
 *       as tone instead of a checkerboard; outlines and flat colour are untouched
 *     → resolved
 *   scene HDR (exposed, soft-knee bright pass) → 5 downsamples → 4 upsamples → glow
 *   resolved (sharp-bilinear enlargement) + glow (linear light) → canvas
 *
 * Every shader here writes values as-is: no colour-space include, no tone mapping.
 */

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
/** For passes that address pixels with gl_FragCoord: no varying (Firefox warns about unread outputs). */
const VERT_PLAIN = 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }';

/**
 * Depth tolerance for the dither blend. The camera is orthographic (near 1, far 400),
 * so depth is linear: 0.00075 × 399 ≈ 0.3 world units. Neighbours across a silhouette
 * never mix.
 */
export const BLEND_DEPTH_TOL = 0.00075;
/** Down levels: 1/2 … 1/32 of the internal resolution. */
const LEVELS = 5;
/** Pyramid alignment period: 2^LEVELS, so a wrap of the camera offset moves every level's grid by whole cells. */
const ALIGN = 32;
/** How much of the next-coarser level each upsample keeps (blur width). */
const UP_MIX = 0.7;

const BLEND_FRAG = /* glsl */ `
uniform sampler2D tPix;
uniform sampler2D tDepth;
uniform float resolve;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(tPix, 0) - 1;
  vec4 c = texelFetch(tPix, p, 0);
  if (c.a < .5 || resolve <= 0.){ gl_FragColor = vec4(c.rgb, 1.); return; }
  float dc = texelFetch(tDepth, p, 0).r;
  vec3 sum = vec3(0.);
  float ws = 0.;
  // 3×3 tent in sRGB over neighbours the dither also changed, on the same surface
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      ivec2 q = clamp(p + ivec2(i, j), ivec2(0), hi);
      vec4 n = texelFetch(tPix, q, 0);
      float near = 1. - step(DEPTH_TOL, abs(texelFetch(tDepth, q, 0).r - dc));
      float w = float((2 - abs(i)) * (2 - abs(j))) * n.a * near;
      sum += n.rgb * w;
      ws += w;
    }
  }
  gl_FragColor = vec4(mix(c.rgb, sum / ws, resolve), 1.);
}`;

/** First downsample: exact 2×2 box of the exposed HDR scene through a soft-knee bright pass. */
const DOWN0_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float exposure;
uniform ivec2 shift;
vec3 bright(vec3 c){
  c *= exposure;
  float br = max(c.r, max(c.g, c.b));
  float k = clamp(br - THRESH + KNEE, 0., 2. * KNEE);
  k = k * k / (4. * KNEE + 1e-4);
  c *= max(k, br - THRESH) / max(br, 1e-4);
  return min(c, vec3(8.)); // one hot pixel must not flicker a halo
}
// Pixel (v - shift) of the scene, or nothing outside it. The pyramid works in "virtual" pixels
// v = game pixel + shift, where shift follows the camera's whole-pixel offset (mod 32): every
// level's sampling grid then moves with the world, so a halo slides with its lantern instead
// of changing shape as the camera steps across the 2×2…32×32 grids.
vec3 tap(ivec2 v){
  ivec2 q = v - shift;
  ivec2 size = textureSize(tScene, 0);
  if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, size))) return vec3(0.);
  return bright(texelFetch(tScene, q, 0).rgb);
}
void main(){
  // the scene target is nearest-filtered (the pixel pass relies on that), so gather by hand
  ivec2 v = ivec2(gl_FragCoord.xy) * 2;
  vec3 s = tap(v) + tap(v + ivec2(1, 0)) + tap(v + ivec2(0, 1)) + tap(v + ivec2(1, 1));
  gl_FragColor = vec4(s * .25, 1.);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 inTexel;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tIn, vUv + inTexel * vec2(-1., -1.)).rgb
         + texture2D(tIn, vUv + inTexel * vec2(1., -1.)).rgb
         + texture2D(tIn, vUv + inTexel * vec2(-1., 1.)).rgb
         + texture2D(tIn, vUv + inTexel * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(s * .25, 1.);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tLow;
uniform vec2 lowTexel;
varying vec2 vUv;
void main(){
  vec3 t = vec3(0.);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
      t += texture2D(tLow, vUv + vec2(float(i), float(j)) * lowTexel).rgb * float((2 - abs(i)) * (2 - abs(j)));
  gl_FragColor = vec4(mix(texture2D(tCur, vUv).rgb, t / 16., UP_MIX), 1.);
}`;

/** Composite to the canvas: at most 2 texture reads per pixel. */
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tRes;
uniform sampler2D tGlow;
uniform vec2 pixRes;
uniform vec2 outRes;
uniform float edge;
uniform float glowAmt;
uniform vec2 glowShift;
uniform vec2 virtRes;
varying vec2 vUv;
vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(vec3(.04045), c)); }
vec3 toSRGB(vec3 c){ c = max(c, 0.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
void main(){
  // sharp-bilinear: each game pixel stays a flat block; only an 'edge'-wide step between blocks is filtered
  vec2 texel = vUv * pixRes;
  vec2 kk = (outRes / pixRes) / max(edge, 1e-3);
  vec2 range = max(.5 - .5 / kk, vec2(0.));
  vec2 cd = fract(texel) - .5;
  vec2 f = (cd - clamp(cd, -range, range)) * kk + .5;
  vec3 base = toLin(texture2D(tRes, (floor(texel) + f) / pixRes).rgb);
  // glow in linear light: never past 1, never darkens; tends to base + add as glowAmt → 0
  vec3 add = texture2D(tGlow, (texel + glowShift) / virtRes).rgb * vec3(1.03, 1., .96) * glowAmt;
  vec3 room = max(1. - base, vec3(1e-3));
  vec3 c = base + room * (1. - exp(-add / room));
  c = toSRGB(c) + (ign(gl_FragCoord.xy) - .5) / 255. * clamp(glowAmt * 50., 0., 1.);
  gl_FragColor = vec4(c, 1.);
}`;

export class DiffusionPass {
  /** Pixel-pass output (sRGB values, alpha = dither flag). The post pass renders into it. */
  readonly pix: THREE.WebGLRenderTarget;
  private readonly resolved: THREE.WebGLRenderTarget;
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly blendMat: THREE.ShaderMaterial;
  private readonly down0Mat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly finalMat: THREE.ShaderMaterial;
  private readonly materials: THREE.ShaderMaterial[];
  private outW = 1;
  private outH = 1;

  /**
   * `glowType`: HalfFloat when the GPU can render to it, else UnsignedByte (the glow
   * then clips at 1 per level, which only shortens the brightest halos).
   */
  constructor(
    private readonly quadScene: THREE.Scene,
    private readonly quad: THREE.Mesh,
    private readonly cam: THREE.Camera,
    glowType: THREE.TextureDataType,
  ) {
    const rt = (filter: THREE.MagnificationTextureFilter, type: THREE.TextureDataType) =>
      new THREE.WebGLRenderTarget(1, 1, { minFilter: filter, magFilter: filter, type, depthBuffer: false, generateMipmaps: false });
    this.pix = rt(THREE.NearestFilter, THREE.UnsignedByteType);
    this.resolved = rt(THREE.LinearFilter, THREE.UnsignedByteType);
    for (let i = 0; i < LEVELS; i++) this.down.push(rt(THREE.LinearFilter, glowType));
    for (let i = 0; i < LEVELS - 1; i++) this.up.push(rt(THREE.LinearFilter, glowType));

    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}) =>
      new THREE.ShaderMaterial({
        vertexShader: fragmentShader.includes('vUv') ? VERT : VERT_PLAIN,
        fragmentShader,
        uniforms,
        defines,
        depthTest: false,
        depthWrite: false,
      });
    this.blendMat = mat(
      BLEND_FRAG,
      { tPix: { value: this.pix.texture }, tDepth: { value: null }, resolve: { value: 0 } },
      { DEPTH_TOL: BLEND_DEPTH_TOL.toFixed(6) },
    );
    this.down0Mat = mat(
      DOWN0_FRAG,
      { tScene: { value: null }, exposure: { value: 1 }, shift: { value: new THREE.Vector2() } },
      { THRESH: GLOW_THRESHOLD.toFixed(4), KNEE: GLOW_KNEE.toFixed(4) },
    );
    this.downMat = mat(DOWN_FRAG, { tIn: { value: null }, inTexel: { value: new THREE.Vector2() } });
    this.upMat = mat(UP_FRAG, { tCur: { value: null }, tLow: { value: null }, lowTexel: { value: new THREE.Vector2() } }, { UP_MIX: UP_MIX.toFixed(3) });
    this.finalMat = mat(FINAL_FRAG, {
      tRes: { value: this.resolved.texture },
      tGlow: { value: this.up[0]!.texture },
      pixRes: { value: new THREE.Vector2(1, 1) },
      outRes: { value: new THREE.Vector2(1, 1) },
      edge: { value: 0 },
      glowAmt: { value: 0 },
      glowShift: { value: new THREE.Vector2() },
      virtRes: { value: new THREE.Vector2(ALIGN, ALIGN) },
    });
    this.materials = [this.blendMat, this.down0Mat, this.downMat, this.upMat, this.finalMat];
  }

  /** Internal (game-pixel) resolution. Reallocates every target. */
  setSize(w: number, h: number): void {
    this.pix.setSize(w, h);
    this.resolved.setSize(w, h);
    // the pyramid covers the frame plus up to ALIGN−1 pixels of shift, rounded to whole ALIGN cells
    const vw = Math.ceil((w + ALIGN) / ALIGN) * ALIGN,
      vh = Math.ceil((h + ALIGN) / ALIGN) * ALIGN;
    (this.finalMat.uniforms.virtRes!.value as THREE.Vector2).set(vw, vh);
    let lw = vw,
      lh = vh;
    for (let i = 0; i < LEVELS; i++) {
      lw = Math.max(1, Math.ceil(lw / 2));
      lh = Math.max(1, Math.ceil(lh / 2));
      this.down[i]!.setSize(lw, lh);
      if (i < LEVELS - 1) this.up[i]!.setSize(lw, lh);
    }
    (this.finalMat.uniforms.pixRes!.value as THREE.Vector2).set(w, h);
  }

  /** Canvas (output) resolution. */
  setOutputSize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    (this.finalMat.uniforms.outRes!.value as THREE.Vector2).set(w, h);
  }

  setParams(p: DiffusionParams): void {
    this.blendMat.uniforms.resolve!.value = p.resolve;
    this.finalMat.uniforms.edge!.value = p.edge;
    this.finalMat.uniforms.glowAmt!.value = p.glowAmt;
  }

  private pass(renderer: THREE.WebGLRenderer, m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.cam);
  }

  /**
   * Everything after the pixel pass has rendered into `pix`. `camOffset` is the camera's
   * position in whole game pixels along its right/up axes (what the texel snap rounds to).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget, exposure: number, camOffset: readonly [number, number]): void {
    const sx = ((camOffset[0] % ALIGN) + ALIGN) % ALIGN,
      sy = ((camOffset[1] % ALIGN) + ALIGN) % ALIGN;
    (this.down0Mat.uniforms.shift!.value as THREE.Vector2).set(sx, sy);
    (this.finalMat.uniforms.glowShift!.value as THREE.Vector2).set(sx, sy);
    this.blendMat.uniforms.tDepth!.value = scene.depthTexture;
    this.pass(renderer, this.blendMat, this.resolved);

    this.down0Mat.uniforms.tScene!.value = scene.texture;
    this.down0Mat.uniforms.exposure!.value = exposure;
    this.pass(renderer, this.down0Mat, this.down[0]!);
    const du = this.downMat.uniforms;
    for (let i = 1; i < LEVELS; i++) {
      const src = this.down[i - 1]!;
      du.tIn!.value = src.texture;
      (du.inTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.pass(renderer, this.downMat, this.down[i]!);
    }
    const uu = this.upMat.uniforms;
    for (let i = LEVELS - 2; i >= 0; i--) {
      const low = i === LEVELS - 2 ? this.down[LEVELS - 1]! : this.up[i + 1]!;
      uu.tCur!.value = this.down[i]!.texture;
      uu.tLow!.value = low.texture;
      (uu.lowTexel!.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      this.pass(renderer, this.upMat, this.up[i]!);
    }
    this.pass(renderer, this.finalMat, null);
  }

  get outputSize(): { w: number; h: number } {
    return { w: this.outW, h: this.outH };
  }

  /** Free GPU memory when the setting goes back to 0%. Not for a lost context (its handles are already gone). */
  dispose(): void {
    for (const t of [this.pix, this.resolved, ...this.down, ...this.up]) t.dispose();
    for (const m of this.materials) m.dispose();
  }
}
