/**
 * Debug free camera (Cross-Cutting: "free camera").
 *
 * Keeps the spec's fixed pitch and no-yaw rule (§3.2) and only moves the point the rig
 * looks at, so what the debug camera shows is what the real camera will show — just from
 * further out or somewhere else on the map.
 *
 * From Phase 2 on it is off by default and shares its keys with the player: the player rig
 * owns the camera, and enabling this takes it away — including `WASD`, which is why the
 * caller stops feeding movement to the player while it is enabled.
 */

import * as THREE from 'three';
import { CAMERA } from '../config';
import type { Viewport } from '../core/Viewport';

const PAN_SPEED = 18; // m/s
const ZOOM_STEP = 1.12;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 160;

export class FreeCamera {
  target = new THREE.Vector2();
  distance: number = CAMERA.distance;

  /** Off by default from Phase 2 on: the player rig drives the camera unless asked. */
  enabled = false;

  private readonly held = new Set<string>();
  private readonly onKeyDown = (event: KeyboardEvent) => this.held.add(event.code);
  private readonly onKeyUp = (event: KeyboardEvent) => this.held.delete(event.code);
  private readonly onBlur = () => this.held.clear();
  private readonly onWheel = (event: WheelEvent) => {
    if (!this.enabled) return;
    event.preventDefault();
    this.distance = THREE.MathUtils.clamp(
      this.distance * (event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
  };

  constructor(private readonly viewport: Viewport) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    viewport.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  lookAt(wx: number, wz: number, distance: number = this.distance): void {
    this.target.set(wx, wz);
    this.distance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.viewport.frame(wx, wz, this.distance);
  }

  /** Distance at which a world extent of `metres` fits the viewport vertically. */
  static fitDistance(metres: number): number {
    return (metres / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2))) * 1.12;
  }

  /**
   * Driven by the render delta rather than the sim clock: panning the debug camera must
   * keep working while the simulation is paused or stepped.
   */
  update(realDeltaSeconds: number): void {
    if (!this.enabled) return;

    let dx = 0;
    let dz = 0;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) dx -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) dx += 1;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) dz -= 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) dz += 1;

    if (dx !== 0 || dz !== 0) {
      const length = Math.hypot(dx, dz);
      // Scale with zoom so panning feels the same close in and far out.
      const speed = (PAN_SPEED * realDeltaSeconds * this.distance) / CAMERA.distance;
      this.target.x += (dx / length) * speed;
      this.target.y += (dz / length) * speed;
    }

    this.viewport.frame(this.target.x, this.target.y, this.distance);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.viewport.renderer.domElement.removeEventListener('wheel', this.onWheel);
  }
}
