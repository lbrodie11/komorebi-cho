import * as THREE from 'three';
import type { Kit } from '../kit';
import type { MatRef, Part } from './types';

/** Hooks for parts that the world tracks after building (shutters animate with opening hours). */
export interface EvaluateHooks {
  shutter(x: number, y: number, z: number, ry: number, w: number, h: number, hours: [number, number]): void;
}

/** Resolve a material description through Materials' caches (the same description, the same material). */
export function material(k: Kit, r: MatRef): THREE.Material {
  const m = k.m;
  if ('named' in r) return r.named === 'roof' ? m.roof : r.named === 'dark' ? m.dark : m.lantern;
  if ('solid' in r) return m.solid(r.solid, r.rough);
  return m.tex2(r.tex, r.color, r.rx, r.ry, r.rough);
}

/** Turn planned parts into geometry, in order (Kit's seeded window jitter depends on it). */
export function evaluate(k: Kit, parts: readonly Part[], hooks: EvaluateHooks): void {
  for (const p of parts) {
    switch (p.op) {
      case 'scope':
        k.weathering({ age: p.age }, () => evaluate(k, p.parts, hooks));
        break;
      case 'box': {
        const b = k.box(p.w, p.h, p.d, material(k, p.mat), p.x, p.y, p.z);
        if (p.rz) b.rotation.z = p.rz;
        break;
      }
      case 'gableZ':
        k.gableZ(p.w, p.d, p.h, material(k, p.mat), p.x, p.y, p.z);
        break;
      case 'shed':
        k.shed(p.x0, p.x1, p.z0, p.z1, p.y, p.rise, p.hi, material(k, p.wall), material(k, p.roof));
        break;
      case 'cyl':
        k.cyl(p.rt, p.rb, p.h, material(k, p.mat), p.x, p.y, p.z);
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
    }
  }
}
