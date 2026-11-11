import * as THREE from 'three';
import type { Kit } from '../kit';
import type { MatRef, Part } from './types';

/** Hooks for parts the world tracks after building: shutters (opening hours), lanterns (sway, dusk), parasols (rain). */
export interface EvaluateHooks {
  shutter(x: number, y: number, z: number, ry: number, w: number, h: number, hours: [number, number]): void;
  lantern(x: number, y: number, z: number, r: number, mat: THREE.Material): void;
  parasol(group: THREE.Object3D): void;
}

/** Lamp materials by description, shared within one build (several lanterns, one material, as before). */
const lamps = new WeakMap<Kit, Map<string, THREE.Material>>();

/** Resolve a material description through Materials' caches (the same description, the same material). */
export function material(k: Kit, r: MatRef): THREE.Material {
  const m = k.m;
  if ('named' in r) return m[r.named];
  if ('solid' in r) return m.solid(r.solid, r.rough);
  if ('std' in r)
    return m.std(r.std, r.rough ?? 0.9, {
      ...(r.metal !== undefined ? { metalness: r.metal } : {}),
      ...(r.double ? { side: THREE.DoubleSide } : {}),
      ...(r.flat ? { flatShading: true } : {}),
    });
  if ('lamp' in r) {
    let cache = lamps.get(k);
    if (!cache) lamps.set(k, (cache = new Map<string, THREE.Material>()));
    const key = `${r.lamp}|${r.glow}|${r.intensity}|${r.accent ? 1 : 0}`;
    let mat = cache.get(key);
    if (!mat) cache.set(key, (mat = m.lamp(r.lamp, r.glow, r.intensity, r.accent)));
    return mat;
  }
  return m.tex2(r.tex, r.color, r.rx, r.ry, r.rough);
}

/** Turn planned parts into geometry, in order (Kit's seeded window jitter depends on it). */
export function evaluate(k: Kit, parts: readonly Part[], hooks: EvaluateHooks): void {
  for (const p of parts) {
    switch (p.op) {
      case 'scope':
        k.weathering({ age: p.age, ...(p.moss !== undefined ? { moss: p.moss } : {}) }, () => evaluate(k, p.parts, hooks));
        break;
      case 'box': {
        const b = k.box(p.w, p.h, p.d, material(k, p.mat), p.x, p.y, p.z);
        if (p.rx) b.rotation.x = p.rx;
        if (p.ry) b.rotation.y = p.ry;
        if (p.rz) b.rotation.z = p.rz;
        break;
      }
      case 'gableZ':
        k.gableZ(p.w, p.d, p.h, material(k, p.mat), p.x, p.y, p.z);
        break;
      case 'gableX':
        k.gableX(p.w, p.d, p.h, material(k, p.mat), p.x, p.y, p.z);
        break;
      case 'prism':
        k.prism(
          p.pts.map(([x, z]) => [x, z] as [number, number]),
          p.y,
          p.h,
          material(k, p.mat),
        );
        break;
      case 'shed':
        k.shed(p.x0, p.x1, p.z0, p.z1, p.y, p.rise, p.hi, material(k, p.wall), material(k, p.roof));
        break;
      case 'cyl':
        k.cyl(p.rt, p.rb, p.h, material(k, p.mat), p.x, p.y, p.z, p.seg);
        break;
      case 'win':
        k.win(p.x, p.y, p.z, p.ry, p.w, p.h, p.kind);
        if (p.hours) k.windows[k.windows.length - 1]!.hours = [p.hours[0], p.hours[1]];
        break;
      case 'plane':
        k.plane(p.w, p.h, material(k, p.mat), p.x, p.y, p.z, p.ry);
        break;
      case 'sign':
        k.sign(p.sign, p.x, p.y, p.z, p.ry, p.glow);
        break;
      case 'shutter':
        hooks.shutter(p.x, p.y, p.z, p.ry, p.w, p.h, [p.hours[0], p.hours[1]]);
        break;
      case 'ac':
        k.ac(p.x, p.y, p.z, p.ry);
        break;
      case 'lantern':
        hooks.lantern(p.x, p.y, p.z, p.r ?? 0.26, p.mat ? material(k, p.mat) : k.m.lantern);
        break;
      case 'blob': {
        const b = k.blob(p.x, p.y, p.z, p.r);
        if (p.mat) b.material = material(k, p.mat);
        break;
      }
      case 'gem':
        k.mesh(new THREE.IcosahedronGeometry(p.r, 0), material(k, p.mat), p.x, p.y, p.z).castShadow = true;
        break;
      case 'pot':
        k.pot(p.x, p.z, p.y, p.r);
        break;
      case 'parasol': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 4), k.m.solid('#adb2b8'));
        pole.position.y = 1;
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.35, 8), k.m.solid(p.top));
        top.position.y = 2.05;
        g.add(pole, top);
        g.position.set(p.x, p.y, p.z);
        hooks.parasol(k.add(g));
        break;
      }
    }
  }
}
