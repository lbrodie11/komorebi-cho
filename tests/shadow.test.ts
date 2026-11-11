import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitSunShadow } from '../src/render/shadow';
import { sunDirection } from '../src/render/sky';
import { BASE_HALF_H } from '../src/render/camera';

// the diorama's measured shadow box (World.shadowBox)
const box = new THREE.Box3(new THREE.Vector3(-17.3, -3.6, -13.6), new THREE.Vector3(17.3, 15.8, 13.3));

/** Project every box corner through the fitted shadow camera into clip space. */
function cornersInClip(sun: THREE.DirectionalLight): THREE.Vector3[] {
  sun.shadow.camera.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(vp));
  }
  return out;
}

describe('fitSunShadow', () => {
  for (const hour of [6, 9, 12, 15, 18, 22]) {
    it(`contains the whole plinth, tightly, at ${hour}:00`, () => {
      const sun = new THREE.DirectionalLight();
      fitSunShadow(sun, box, sunDirection(hour), 2048);
      const c = cornersInClip(sun);
      for (const p of c) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      }
      // tight: on each side some corner reaches the margin
      const ext = (k: 'x' | 'y') => Math.max(...c.map((p) => Math.abs(p[k])));
      expect(ext('x')).toBeGreaterThan(0.99);
      expect(ext('y')).toBeGreaterThan(0.99);
    });
  }

  it('keeps a 1536² texel finer than a screen pixel at 3× zoom, all day', () => {
    // 3× zoom: half-height BASE_HALF_H/3 world units over a ≥220 px render target
    const screenPx = (2 * (BASE_HALF_H / 3)) / 220;
    const sun = new THREE.DirectionalLight();
    for (let h = 0; h < 24; h += 0.25) {
      const { texel } = fitSunShadow(sun, box, sunDirection(h), 1536);
      expect(texel, `${h}:00`).toBeLessThan(screenPx);
    }
  });

  it('raises normal bias as the sun drops, keeps depth bias tiny', () => {
    const sun = new THREE.DirectionalLight();
    const noon = fitSunShadow(sun, box, sunDirection(12.4), 2048);
    const dusk = fitSunShadow(sun, box, sunDirection(18.8), 2048);
    expect(dusk.elevation).toBeLessThan(noon.elevation);
    expect(dusk.normalBias / dusk.texel).toBeGreaterThan(noon.normalBias / noon.texel);
    for (const f of [noon, dusk]) {
      expect(f.bias).toBeLessThan(0);
      expect(f.bias).toBeGreaterThan(-0.0005);
    }
  });

  it('aims the light along the sky direction, so lighting is unchanged', () => {
    const sun = new THREE.DirectionalLight();
    fitSunShadow(sun, box, sunDirection(15), 2048);
    const d = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    const want = new THREE.Vector3(...sunDirection(15)).normalize();
    expect(d.distanceTo(want)).toBeLessThan(1e-9);
  });
});
