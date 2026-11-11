import * as THREE from 'three';
import type { Kit } from './kit';
import { APATO, ARCH, CAFE, MICRO_HOME, SENTO, SHOPS, TEMPLE, TOOL_SHED } from './layout';
import { evaluate } from './grammar/evaluate';
import { planAttachments, planShopHouse, shopFootprint } from './grammar/archetypes/shophouse';
import { planApato, planArch, planCafe, planMicroHome, planSento, planTemple, planToolShed } from './grammar/archetypes/landmarks';
import { classifyGap, planSeam } from './grammar/seams';

/** A roller shutter that rolls up at opening time. */
export interface Shutter {
  mesh: THREE.Mesh;
  open: number; // 0 closed .. 1 open (animated)
  hours: [number, number];
  baseY: number;
  height: number;
}

export interface BuildingsOut {
  lanterns: THREE.Mesh[];
  shutters: Shutter[];
  parasols: THREE.Object3D[];
  chimneyTop: THREE.Vector3;
}

export function buildBuildings(k: Kit): BuildingsOut {
  const m = k.m;
  const lanterns: THREE.Mesh[] = [];
  const shutters: Shutter[] = [];
  const parasols: THREE.Object3D[] = [];

  const lantern = (x: number, y: number, z: number, r = 0.26, mat: THREE.Material = m.lantern) => {
    const l = k.mesh(new THREE.SphereGeometry(r, 8, 6), mat, x, y, z);
    l.scale.y = 1.4;
    lanterns.push(l);
    return l;
  };
  const shutter = (x: number, y: number, z: number, ry: number, w: number, h: number, hours: [number, number]) => {
    const s = k.plane(w, h, m.tex2('shutter', '#adb2b8', 1, 3, 0.6), x, y, z, ry);
    s.translateZ(0.03);
    shutters.push({ mesh: s, open: 0, hours, baseY: y, height: h });
  };

  // Every building comes from data through the building grammar (src/world/grammar), in the
  // original build order: Kit's window jitter is seeded by order.
  const hooks = {
    shutter,
    lantern: (x: number, y: number, z: number, r: number, mat: THREE.Material) => void lantern(x, y, z, r, mat),
    parasol: (g: THREE.Object3D) => void parasols.push(g),
  };
  evaluate(k, planSento(SENTO), hooks);
  evaluate(k, planMicroHome(MICRO_HOME), hooks);
  evaluate(k, planApato(APATO), hooks);
  evaluate(k, planTemple(TEMPLE), hooks);
  // the shopping street: shop-house bodies, then their street-side attachments, then the arch
  for (const spec of SHOPS) evaluate(k, planShopHouse(spec), hooks);
  for (const spec of SHOPS) evaluate(k, planAttachments(spec), hooks);
  evaluate(k, planArch(ARCH), hooks);
  evaluate(k, planCafe(CAFE), hooks);
  evaluate(k, planToolShed(TOOL_SHED), hooks);

  // Seams between neighbouring shop-houses (downpipes in tight gaps, an alley in wider ones).
  // Built last: seams are new geometry, and nothing before them should change.
  const row = [...SHOPS].sort((a, b) => a.z0 - b.z0);
  for (let i = 0; i + 1 < row.length; i++) {
    const a = shopFootprint(row[i]!),
      b = shopFootprint(row[i + 1]!);
    evaluate(k, planSeam(classifyGap(a, b), a, b, row[i]!.frontX), hooks);
  }

  return { lanterns, shutters, parasols, chimneyTop: new THREE.Vector3(SENTO.chimney.x, SENTO.y + SENTO.chimney.h + 0.2, SENTO.chimney.z) };
}
