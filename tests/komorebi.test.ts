import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installHeadlessDom } from './helpers/headless';

beforeAll(() => installHeadlessDom());

describe('komorebi: sunlight through the leaves', () => {
  it('gives every tree canopy the dappled shadow, and leaves shrubs and pots solid', async () => {
    const { World } = await import('../src/world/world');
    const world = new World();
    let canopies = 0,
      solidLeaves = 0;
    const leafMats = new Set<THREE.Material>(Object.values(world.mats.leaves).flat());
    world.scene.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      if (me.userData.canopy) {
        expect(me.customDepthMaterial).toBe(world.mats.leafDepth);
        canopies++;
      } else if (leafMats.has(me.material as THREE.Material)) {
        expect(me.customDepthMaterial).toBeUndefined();
        solidLeaves++;
      }
    });
    expect(canopies).toBeGreaterThan(100); // seven trees of 14-24 blobs
    expect(solidLeaves).toBeGreaterThan(0); // shrubs, hedges and pots
  });

  it('marks catalogue foliage above head height as canopy, and a bonsai not', async () => {
    const { PLACEABLES } = await import('../src/world/props');
    const { Materials } = await import('../src/render/materials');
    const m = new Materials();
    const canopyIn = (kind: keyof typeof PLACEABLES) => {
      let n = 0;
      PLACEABLES[kind].build(m).object.traverse((o) => void (o.userData.canopy && n++));
      return n;
    };
    expect(canopyIn('maple')).toBeGreaterThan(0);
    expect(canopyIn('sakura')).toBeGreaterThan(0);
    expect(canopyIn('bonsai')).toBe(0);
  });
});
