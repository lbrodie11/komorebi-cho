import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/**
 * Orthographic 2:1 dimetric camera (pitch = atan(1/2), classic pixel-art
 * isometric) with 90-degree rotation steps, integer zoom steps and texel snapping.
 *
 * Nothing ever crawls:
 * - Texel snapping: the camera position is rounded to whole render-target
 *   pixels along its own right/up axes every frame, so panning moves the whole
 *   image by whole pixels.
 * - Rotation and zoom are instant steps (the post pass Bayer-dissolves between
 *   the two views), never tweens, so there is no in-between frame where
 *   geometry slides across the pixel grid.
 * - Zoom levels are integer magnifications of the base view (1×, 2×, 3×), so a
 *   world feature is always a whole multiple of its 1× size in pixels.
 */
/**
 * Half-height of the view at 1× magnification, world units. Sized so the whole
 * plinth, the chimney top and some sky margin fit the default view.
 */
export const BASE_HALF_H = 20;

export class IsoCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  readonly pitch = Math.atan(0.5);
  readonly baseHalfH = BASE_HALF_H;
  readonly magnifications = [1, 2, 3] as const;
  zoomIndex = 0;
  yaw = Math.PI / 4;
  halfH = this.baseHalfH;
  readonly target = new THREE.Vector3(0, 3.9, 0);
  readonly targetGoal = new THREE.Vector3(0, 3.9, 0);
  private aspect = 1;
  private rtHeight = 220;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  setViewport(rtWidth: number, rtHeight: number): void {
    this.aspect = rtWidth / rtHeight;
    this.rtHeight = rtHeight;
    this.updateProjection();
  }

  rotate(dir: 1 | -1): void {
    // keep yaw bounded so it never accumulates float error over many turns
    this.yaw = (((this.yaw + (dir * Math.PI) / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }

  /** Would `zoom(dir)` change anything? (Lets the caller skip a pointless dissolve.) */
  canZoom(dir: 1 | -1): boolean {
    return clamp(this.zoomIndex + dir, 0, this.magnifications.length - 1) !== this.zoomIndex;
  }

  zoom(dir: 1 | -1, focus?: THREE.Vector3): void {
    if (!this.canZoom(dir)) return;
    const next = this.zoomIndex + dir;
    this.zoomIndex = next;
    this.halfH = this.baseHalfH / this.magnifications[next]!;
    this.updateProjection();
    if (focus && dir > 0) this.targetGoal.set(focus.x, Math.max(1.5, focus.y + 1), focus.z);
    if (next === 0) this.targetGoal.set(0, 3.9, 0);
  }

  /** Pan in screen space (pixels of the CSS canvas). */
  panScreen(dxPx: number, dyPx: number, cssHeight: number): void {
    const worldPerPx = (2 * this.halfH) / cssHeight;
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    // project "up" onto the ground so panning slides along the plinth
    const fwd = new THREE.Vector3(this.up.x, 0, this.up.z).normalize();
    this.targetGoal.addScaledVector(this.right.setY(0).normalize(), -dxPx * worldPerPx);
    this.targetGoal.addScaledVector(fwd, (dyPx * worldPerPx) / Math.sin(this.pitch));
    this.targetGoal.x = clamp(this.targetGoal.x, -13, 13);
    this.targetGoal.z = clamp(this.targetGoal.z, -10, 10);
  }

  update(dt: number): void {
    this.target.x = damp(this.target.x, this.targetGoal.x, 8, dt);
    this.target.y = damp(this.target.y, this.targetGoal.y, 8, dt);
    this.target.z = damp(this.target.z, this.targetGoal.z, 8, dt);

    const r = 160;
    const c = this.camera;
    c.position.set(
      this.target.x + r * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target.y + r * Math.sin(this.pitch),
      this.target.z + r * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    c.lookAt(this.target);
    c.updateMatrixWorld();
    // texel snap
    const px = (2 * this.halfH) / this.rtHeight;
    this.right.setFromMatrixColumn(c.matrixWorld, 0);
    this.up.setFromMatrixColumn(c.matrixWorld, 1);
    const dx = c.position.dot(this.right);
    const dy = c.position.dot(this.up);
    c.position.addScaledVector(this.right, Math.round(dx / px) * px - dx);
    c.position.addScaledVector(this.up, Math.round(dy / px) * px - dy);
    c.updateMatrixWorld();
  }

  private updateProjection(): void {
    const c = this.camera;
    c.left = -this.halfH * this.aspect;
    c.right = this.halfH * this.aspect;
    c.top = this.halfH;
    c.bottom = -this.halfH;
    c.updateProjectionMatrix();
  }
}
