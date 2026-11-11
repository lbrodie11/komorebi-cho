import * as THREE from 'three';
import type { Agent } from '../sim/residents';

/** Live numbers for the `?debug` URL flag. Off by default; costs nothing unless enabled. */
export interface DebugStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  cpuWorstMs: number;
  simMs: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  textures: number;
  geometries: number;
  residentsOnScreen: number;
  residentsOut: number;
  residentsTotal: number;
}

const REFRESH_S = 0.25;

export class DebugOverlay {
  private readonly el: HTMLPreElement;
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  private lastNow = -1;
  private window = { t: 0, frames: 0, cpu: 0, cpuWorst: 0, sim: 0 };
  stats: DebugStats | null = null;

  constructor(
    parent: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    // A frame issues several render() calls (shadow map, scene → low-res target, pixel quad).
    // With autoReset the counters would only show the last one, so reset once per frame instead.
    renderer.info.autoReset = false;
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    parent.append(this.el);
  }

  beginFrame(): void {
    this.renderer.info.reset();
  }

  /** `now` is the rAF timestamp; `cpuMs`/`simMs` were measured by the caller this frame. */
  endFrame(now: number, cpuMs: number, simMs: number, camera: THREE.Camera, agents: readonly Agent[]): void {
    const w = this.window;
    // A gap over 1 s means the tab was hidden (rAF paused); don't average the pause into the stats.
    if (this.lastNow >= 0 && now - this.lastNow < 1000) {
      w.t += (now - this.lastNow) / 1000;
      w.frames++;
      w.cpu += cpuMs;
      w.sim += simMs;
      w.cpuWorst = Math.max(w.cpuWorst, cpuMs);
    }
    this.lastNow = now;
    if (w.t < REFRESH_S || w.frames === 0) return;

    const info = this.renderer.info;
    const onScreen = this.countOnScreen(camera, agents);
    this.stats = {
      fps: w.frames / w.t,
      frameMs: (w.t * 1000) / w.frames,
      cpuMs: w.cpu / w.frames,
      cpuWorstMs: w.cpuWorst,
      simMs: w.sim / w.frames,
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      residentsOnScreen: onScreen,
      residentsOut: agents.filter((a) => !a.hidden).length,
      residentsTotal: agents.length,
    };
    this.el.textContent = format(this.stats);
    this.window = { t: 0, frames: 0, cpu: 0, cpuWorst: 0, sim: 0 };
  }

  private countOnScreen(camera: THREE.Camera, agents: readonly Agent[]): number {
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    let n = 0;
    for (const a of agents) {
      if (a.hidden) continue;
      this.sphere.center.set(a.x, a.root.position.y + 0.8, a.z);
      if (this.frustum.intersectsSphere(this.sphere)) n++;
    }
    return n;
  }
}

const f1 = (v: number) => v.toFixed(1);
const k = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v));

function format(s: DebugStats): string {
  return [
    `fps       ${s.fps.toFixed(0)}  (${f1(s.frameMs)} ms)`,
    `cpu       ${f1(s.cpuMs)} ms  worst ${f1(s.cpuWorstMs)}`,
    `sim tick  ${s.simMs.toFixed(2)} ms`,
    `calls     ${s.calls}`,
    `tris      ${k(s.triangles)}  pts ${k(s.points)}  lines ${k(s.lines)}`,
    `textures  ${s.textures}  geos ${s.geometries}`,
    `residents ${s.residentsOnScreen} on screen · ${s.residentsOut} out · ${s.residentsTotal} total`,
  ].join('\n');
}
