import * as THREE from 'three';

export interface ShadowFit {
  /** World size of one shadow-map texel (the larger axis). */
  texel: number;
  /** Sun elevation, radians (0 = horizon). */
  elevation: number;
  bias: number;
  normalBias: number;
}

const corner = new THREE.Vector3();
const center = new THREE.Vector3();
const size = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * Point the sun at the diorama from `sunDir` and fit its orthographic shadow
 * camera tightly around `box` (every caster and receiver: the plinth and what
 * stands on it). Every shadow-map texel lands on the diorama instead of on
 * empty air, which is ~2× the texel density of the old fixed ±27 m frustum.
 *
 * Bias is derived per frame from the fitted texel size and the sun's elevation:
 * - `normalBias` (world units, along the surface normal) kills acne. Acne grows as
 *   the light grazes a surface, so it scales up as the sun drops.
 * - `bias` (normalised depth) is kept tiny: a large constant depth bias is what
 *   detaches long dusk shadows from their casters (peter-panning).
 */
export function fitSunShadow(sun: THREE.DirectionalLight, box: THREE.Box3, sunDir: readonly [number, number, number], mapSize: number): ShadowFit {
  box.getCenter(center);
  box.getSize(size);
  dir.set(...sunDir).normalize();
  const reach = size.length() / 2 + 5;

  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  sun.position.copy(center).addScaledVector(dir, reach);
  sun.updateMatrixWorld();

  // same view three's DirectionalLightShadow builds: from the light, looking at the target
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
    x0 = Math.min(x0, corner.x);
    x1 = Math.max(x1, corner.x);
    y0 = Math.min(y0, corner.y);
    y1 = Math.max(y1, corner.y);
    z0 = Math.min(z0, corner.z);
    z1 = Math.max(z1, corner.z);
  }
  const texel = Math.max(x1 - x0, y1 - y0) / mapSize;
  // a couple of texels of margin so PCF-free edge taps never sample outside the map
  const pad = texel * 2;
  cam.left = x0 - pad;
  cam.right = x1 + pad;
  cam.bottom = y0 - pad;
  cam.top = y1 + pad;
  // view space looks down -z: nearest corner has the largest z
  cam.near = Math.max(0.1, -z1 - 1);
  cam.far = -z0 + 1;
  cam.updateProjectionMatrix();

  const elevation = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const graze = 1 - Math.sin(Math.max(0, elevation)); // 0 overhead → 1 at the horizon
  const normalBias = texel * (0.8 + 1.7 * graze);
  const bias = -(texel * 0.25) / (cam.far - cam.near);
  sun.shadow.normalBias = normalBias;
  sun.shadow.bias = bias;
  return { texel, elevation, bias, normalBias };
}
