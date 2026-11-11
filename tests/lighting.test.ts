import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ACCENT_BUDGET,
  EMISSIVE,
  FADE_H,
  WINDOW_STEPS,
  occupiedTonight,
  ramp,
  shopDarkness,
  windowLevel,
  windowSpill,
  windowStep,
  windowWarmth,
  type WindowGeom,
} from '../src/world/lighting';
import { LightPools } from '../src/world/lightpools';
import { GROUND } from '../src/world/layout';
import { clusterLights } from '../src/world/crowd';

describe('window schedules', () => {
  it('fade over FADE_H instead of popping, and never jump between minutes', () => {
    for (const kind of ['home', 'shop', 'cafe'] as const) {
      let prev = windowLevel(kind, 0, 0, 3, 1, 1);
      for (let m = 1; m < 24 * 60; m++) {
        const v = windowLevel(kind, m / 60, 0, 3, 1, 1);
        // one in-world minute can move a window at most 1/(FADE_H·60) of the way, with smoothstep's ×1.5 peak slope
        expect(Math.abs(v - prev), `${kind} at ${(m / 60).toFixed(2)}h`).toBeLessThanOrEqual(1.5 / (FADE_H * 60) + 1e-9);
        prev = v;
      }
    }
  });

  it('never pop at midnight: "tonight" runs noon to noon on each window\'s own clock', () => {
    // walk every window offset across midnight minute by minute; a calendar-day key would jump here
    for (let index = 0; index < 60; index++)
      for (const offset of [-1.2, -0.6, 0, 0.6, 1.2]) {
        let prev = windowLevel('home', 23, offset, index, 4, 1);
        for (let m = 1; m < 120; m++) {
          const day = m < 60 ? 4 : 5;
          const hour = m < 60 ? 23 + m / 60 : (m - 60) / 60;
          const v = windowLevel('home', hour, offset, index, day, 1);
          expect(Math.abs(v - prev), `window ${index}, offset ${offset}, ${hour.toFixed(2)}h`).toBeLessThanOrEqual(1.5 / (FADE_H * 60) + 1e-9);
          prev = v;
        }
      }
  });

  it('derive from the clock alone: a paused or replayed clock gives the same light', () => {
    for (const h of [6.1, 12, 18.3, 23.5]) expect(windowLevel('home', h, 0.4, 9, 3, 0.5)).toBe(windowLevel('home', h, 0.4, 9, 3, 0.5));
  });

  it('leave about one home in five dark each night, a different set each day', () => {
    let dark = 0;
    const tonight: boolean[] = [];
    for (let i = 0; i < 400; i++) {
      if (!occupiedTonight(i, 5)) dark++;
      tonight.push(occupiedTonight(i, 5));
    }
    expect(dark / 400).toBeGreaterThan(0.12);
    expect(dark / 400).toBeLessThan(0.28);
    const tomorrow = Array.from({ length: 400 }, (_, i) => occupiedTonight(i, 6));
    expect(tomorrow.filter((v, i) => v !== tonight[i]).length).toBeGreaterThan(40);
    for (let i = 0; i < 50; i++) {
      expect(windowWarmth(i)).toBeGreaterThanOrEqual(0.7);
      expect(windowWarmth(i)).toBeLessThanOrEqual(1);
    }
  });

  it('keep shops dark when closed, even at night, and off in daylight', () => {
    const florist = [9, 18] as const;
    expect(windowLevel('shop', 20, 0, 0, 0, 1, florist)).toBe(0); // closed: shutter down, glass dark
    expect(windowLevel('shop', 12, 0, 0, 0, shopDarkness(0, 0), florist)).toBe(0); // open but bright day
    expect(windowLevel('shop', 17, 0, 0, 0, shopDarkness(0.8, 0), florist)).toBe(1); // open at dusk
    expect(windowLevel('shop', 12, 0, 0, 0, shopDarkness(0, 1), florist)).toBeGreaterThan(0.9); // heavy rain at noon
  });

  it('quantise to shared brightness steps', () => {
    expect(windowStep(0)).toBe(0);
    expect(windowStep(1)).toBe(WINDOW_STEPS);
    expect(windowStep(0.5)).toBe(WINDOW_STEPS / 2);
    expect(ramp(10, 7, 21.5)).toBe(1);
  });
});

describe('brightness hierarchy', () => {
  it('puts the kissaten first, then streetlamps, shops and lanterns, homes last', () => {
    expect(EMISSIVE.cafe).toBeGreaterThan(EMISSIVE.streetlamp);
    expect(EMISSIVE.streetlamp).toBeGreaterThan(EMISSIVE.shop);
    expect(EMISSIVE.shop).toBeGreaterThanOrEqual(EMISSIVE.lantern);
    expect(EMISSIVE.lantern).toBeGreaterThan(EMISSIVE.home);
  });
});

describe('window spill', () => {
  const shop: WindowGeom = { x: -10.46, y: 0.32 + 1.15, z: 1.5, ry: Math.PI / 2, w: 2.4, h: 1.6 };

  it('opens outward from the glass, never behind the wall', () => {
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
      const s = windowSpill({ ...shop, x: 0, z: 0, ry }, 0.32)!;
      const n = [Math.sin(ry), Math.cos(ry)] as const;
      const along = s.x * n[0] + s.z * n[1];
      // the near edge sits at the glass, the whole footprint in front of it
      expect(along - s.depth / 2).toBeGreaterThanOrEqual(0);
      expect(along - s.depth / 2).toBeLessThan(0.1);
    }
  });

  it('only comes from ground-floor windows', () => {
    expect(windowSpill(shop, 0.32)).not.toBeNull();
    expect(windowSpill({ ...shop, y: 0.32 + 3.8, h: 1 }, 0.32)).toBeNull();
  });

  it('stops at the plinth edge, and a window facing off the edge casts none', () => {
    const east: WindowGeom = { x: 16.24, y: 0.32 + 1.4, z: -1.2, ry: Math.PI / 2, w: 2.4, h: 1.6 };
    expect(windowSpill(east, 0.32, true, GROUND)).toBeNull();
    const nearEdge: WindowGeom = { ...east, x: GROUND.x1 - 1.2 };
    const s = windowSpill(nearEdge, 0.32, true, GROUND)!;
    expect(s.x + s.depth / 2).toBeLessThanOrEqual(GROUND.x1);
  });
});

describe('light pools', () => {
  it('clip round pools to the plinth', () => {
    const p = new LightPools();
    p.addRound(GROUND.x1 - 0.5, 0, 0.4, 2, '#ffffff', 1, GROUND);
    const pos = (p.group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getX(i)).toBeLessThanOrEqual(GROUND.x1 + 1e-9);
  });

  it('move with a placed light, clipped to the plinth, in its colour', () => {
    const p = new LightPools();
    const id = p.addMovable('#ffffff', 1);
    p.place(id, GROUND.x1 - 0.3, 0, 0.4, 1.6, new THREE.Color('#4fd6ff'), GROUND);
    p.set(id, 1);
    const m = p.group.children[0] as THREE.Mesh;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getX(i)).toBeLessThanOrEqual(GROUND.x1 + 1e-9);
    expect((m.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(new THREE.Color('#4fd6ff').getHexString());
    expect(m.visible).toBe(true);
  });

  it('switch off below a visible level and scale their colour with the level', () => {
    const p = new LightPools();
    p.addRound(0, 0, 0.4, 1, '#ffffff', 0.5, GROUND);
    const m = p.group.children[0] as THREE.Mesh;
    p.set(0, 0);
    expect(m.visible).toBe(false);
    p.set(0, 1);
    expect(m.visible).toBe(true);
    expect((m.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(0.5, 5);
  });
});

describe('placed-light clusters', () => {
  it('gives every light its own pooled light while there are enough', () => {
    const pts = Array.from({ length: 5 }, (_, i) => ({ x: i * 4, z: 0 }));
    expect(clusterLights(pts, 8)).toEqual([[0], [1], [2], [3], [4]]);
  });

  it('shares lights between the nearest neighbors when there are more than the pool, so none goes dark', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 5, z: Math.floor(i / 4) * 5 + (i % 2) * 0.3 }));
    const c = clusterLights(pts, 8);
    expect(c.length).toBe(8);
    expect(c.flat().sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });

  it('prefers merging lights of the same color, and is deterministic', () => {
    const pts = [
      { x: 0, z: 0, tag: 'warm' },
      { x: 1, z: 0, tag: 'cool' },
      { x: 3, z: 0, tag: 'warm' },
    ];
    expect(clusterLights(pts, 2)).toEqual([[0, 2], [1]]);
    expect(clusterLights(pts, 2)).toEqual(clusterLights(pts, 2));
  });
});

describe('seasonal accent budget', () => {
  it('only ever dims accents, most in autumn, and never enough to lift them over the café', () => {
    for (const v of Object.values(ACCENT_BUDGET)) expect(v).toBeLessThanOrEqual(1);
    expect(ACCENT_BUDGET.autumn).toBeLessThan(ACCENT_BUDGET.summer);
    expect(ACCENT_BUDGET.spring).toBeLessThan(1);
    // the café and streetlamps are never scaled; lanterns at full budget still sit below them
    expect(EMISSIVE.lantern * Math.max(...Object.values(ACCENT_BUDGET))).toBeLessThan(EMISSIVE.streetlamp);
  });
});

describe('light pools', () => {
  it('reuses a retired pool slot, so shop rebuilds never grow the pool list', async () => {
    const { LightPools } = await import('../src/world/lightpools');
    const p = new LightPools();
    const spill = { x: 0, z: 0, ry: 0, width: 1, depth: 1 };
    const a = p.addSpill(spill, 0, '#ffaa58', 0.4);
    p.addSpill(spill, 0, '#ffaa58', 0.4);
    p.retire(a);
    expect(p.addSpill(spill, 0, '#ffaa58', 0.4)).toBe(a);
  });
});
