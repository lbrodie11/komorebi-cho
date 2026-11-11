import * as THREE from 'three';
import type { Kit } from './kit';
import { APATO, ARCH, CAFE, MICRO_HOME, SENTO, SHOPS, TEMPLE, TOOL_SHED } from './layout';
import { evaluate } from './grammar/evaluate';
import { ShopStreet } from './shopstreet';
import { planApato, planArch, planCafe, planCafeTerrace, planMicroHome, planSento, planTemple, planToolShed } from './grammar/archetypes/landmarks';

/** A roller shutter that rolls up at opening time. */
export interface Shutter {
  mesh: THREE.Mesh;
  open: number; // 0 closed .. 1 open (animated)
  hours: [number, number];
  baseY: number;
  height: number;
  /** Rebuilt (a shop moved): takes its opening-hours state at once rather than rolling up in front of the player. */
  fresh?: boolean;
}

export interface BuildingsOut {
  lanterns: THREE.Mesh[];
  shutters: Shutter[];
  parasols: THREE.Object3D[];
  /** The shopping street's shop-houses, rebuildable one at a time (moving and resizing). */
  street: ShopStreet;
  chimneyTop: THREE.Vector3;
}

export function buildBuildings(k: Kit): BuildingsOut {
  const m = k.m;
  const lanterns: THREE.Mesh[] = [];
  const shutters: Shutter[] = [];
  const parasols: THREE.Object3D[] = [];

  const lantern = (b: Kit, x: number, y: number, z: number, r = 0.26, mat: THREE.Material = m.lantern) => {
    const l = b.mesh(new THREE.SphereGeometry(r, 8, 6), mat, x, y, z);
    l.scale.y = 1.4;
    lanterns.push(l);
    return l;
  };
  const shutter = (b: Kit, x: number, y: number, z: number, ry: number, w: number, h: number, hours: [number, number]) => {
    const s = b.plane(w, h, m.tex2('shutter', '#adb2b8', 1, 3, 0.6), x, y, z, ry);
    s.translateZ(0.03);
    shutters.push({ mesh: s, open: 0, hours, baseY: y, height: h });
  };

  // Every building comes from data through the building grammar (src/world/grammar), in the
  // original build order: Kit's window jitter is seeded by order.
  const hooks = {
    shutter,
    lantern: (b: Kit, x: number, y: number, z: number, r: number, mat: THREE.Material) => void lantern(b, x, y, z, r, mat),
    parasol: (g: THREE.Object3D) => void parasols.push(g),
  };
  evaluate(k, planSento(SENTO), hooks);
  evaluate(k, planMicroHome(MICRO_HOME), hooks);
  evaluate(k, planApato(APATO), hooks);
  evaluate(k, planTemple(TEMPLE), hooks);
  // the shopping street: shop-house bodies, then their street-side attachments, then the arch
  // the street context settles the priority layers first: eaves trimmed short of neighbours,
  // setbacks, and where each shop board fits (or drops to an A-frame)
  // Each shop is its own rebuildable group (shopstreet.ts): built here through the shared Kit, in order.
  const street = new ShopStreet(SHOPS, m, { shutters, lanterns }, hooks);
  street.buildInitial(k);
  evaluate(k, planArch(ARCH), hooks);
  evaluate(k, planCafe(CAFE), hooks);
  // the roof terrace is many small parts (rails, posts, bulbs): merged by material, a few draw calls
  k.merged(() => evaluate(k, planCafeTerrace(CAFE), hooks));
  evaluate(k, planToolShed(TOOL_SHED), hooks);

  // Seams between neighbouring shop-houses (downpipes in tight gaps, an alley in wider ones).
  // Built last: seams are new geometry, and nothing before them should change.
  street.buildSeams(k);

  return { lanterns, shutters, parasols, street, chimneyTop: new THREE.Vector3(SENTO.chimney.x, SENTO.y + SENTO.chimney.h + 0.2, SENTO.chimney.z) };
}
