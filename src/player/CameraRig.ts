/**
 * The player camera rig (§3.2).
 *
 * The camera keeps the spec's fixed pitch and never yaws — the map's north stays screen-up
 * so learned routes stay legible in the dark — so all it does is follow the player with
 * critically damped smoothing. **It is locked to the player and nothing pulls it off them**
 * (§3.2): the player sits at the same point on the screen wherever they stand, so the
 * offset from the player to the cursor is the offset from the player to their aim, always
 * and everywhere.
 *
 * It used to clamp to the map's bounds so the view never framed off-map void, and the two
 * rules fought near every edge: a pitched frustum's far corners overhang the boundary long
 * before the player is anywhere near it, so the clamp slid the player off-centre exactly
 * where aiming matters most. The void is answered outside the map now (§2's surround),
 * which lets the camera do only the half of the job it was ever good at.
 *
 * `groundFootprint` stays: the frustum's ground footprint under a pitched camera is a
 * trapezoid, wider at its far edge than where the player stands, and how far it reaches is
 * what decides how far §2's surround has to extend.
 */

import * as THREE from 'three';
import { CAMERA } from '../config';
import type { Viewport } from '../core/Viewport';

/** Ground footprint of the frustum, as offsets from the point the camera looks at. */
export interface GroundFootprint {
  /** Half-width at the widest (far) edge. */
  halfWidth: number;
  /** Half-width level with the point the camera looks at — where the player stands. */
  halfWidthAtTarget: number;
  /** Offset of the far edge, negative: the camera looks along `-z`. */
  minZ: number;
  /** Offset of the near edge — behind the target, since the camera sits behind it. */
  maxZ: number;
}

/**
 * Where the frustum meets the ground plane, relative to the point the camera looks at.
 *
 * The camera sits `distance` along the pitch vector: `sin(pitch)·distance` above the
 * target and `cos(pitch)·distance` behind it. A screen-space ray leaving at depression
 * angle θ from horizontal hits the ground `height / tan(θ)` in front of the camera, which
 * is what both Z edges come from. Past 90° — the bottom of the screen under a steep pitch
 * — the tangent goes negative and the same expression lands the edge behind the camera,
 * which is exactly right.
 */
export function groundFootprint(
  aspect: number,
  fovDegrees: number = CAMERA.fov,
  pitchDegrees: number = CAMERA.pitchDegrees,
  distance: number = CAMERA.distance,
): GroundFootprint {
  const pitch = THREE.MathUtils.degToRad(pitchDegrees);
  const halfFovY = THREE.MathUtils.degToRad(fovDegrees) / 2;
  const height = Math.sin(pitch) * distance;
  const behind = Math.cos(pitch) * distance;

  // The top of the screen. At or below the horizon the ground never closes, so the
  // footprint is unbounded; the camera's far plane is the only honest limit left.
  const topAngle = pitch - halfFovY;
  const far = topAngle <= 1e-3 ? CAMERA.far : height / Math.tan(topAngle);

  const bottomAngle = pitch + halfFovY;
  const near = height / Math.tan(bottomAngle);

  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  // Widest where the frustum is furthest from the camera: the far ground edge.
  const farRayLength = Math.hypot(height, far);
  return {
    halfWidth: farRayLength * Math.tan(halfFovX),
    halfWidthAtTarget: distance * Math.tan(halfFovX),
    minZ: behind - far,
    maxZ: behind - near,
  };
}

/**
 * One axis of critically damped smoothing (§3.2).
 *
 * Critically damped is the point: an underdamped follow overshoots and sends the map
 * sliding back under the player, and in a game where the player reads threat position off
 * the screen edge, that reads as the world moving rather than the camera settling. Solved
 * analytically so the result is identical at any frame rate, rather than integrated.
 */
export class Damped {
  velocity = 0;

  constructor(public value: number = 0) {}

  snap(target: number): void {
    this.value = target;
    this.velocity = 0;
  }

  step(target: number, timeConstant: number, dt: number): number {
    if (dt <= 0) return this.value;
    if (timeConstant <= 1e-6) {
      this.snap(target);
      return this.value;
    }

    const omega = 1 / timeConstant;
    const decay = Math.exp(-omega * dt);
    const offset = this.value - target;
    const scaled = this.velocity + omega * offset;

    this.value = target + (offset + scaled * dt) * decay;
    this.velocity = (this.velocity - omega * scaled * dt) * decay;
    return this.value;
  }
}

export class CameraRig {
  private readonly x = new Damped();
  private readonly z = new Damped();

  constructor(private readonly viewport: Viewport) {}

  /** The point the camera is currently looking at, after smoothing. */
  get targetX(): number {
    return this.x.value;
  }

  get targetZ(): number {
    return this.z.value;
  }

  /** Jump the rig to a position without smoothing — run start, and returning from debug. */
  snapTo(worldX: number, worldZ: number): void {
    this.x.snap(worldX);
    this.z.snap(worldZ);
    this.apply();
  }

  /**
   * Driven by the render delta, not the sim tick: the rig is presentation, and smoothing it
   * per rendered frame is what keeps a 60 Hz simulation looking smooth on a 144 Hz display.
   * The target it follows is the interpolated player position for the same reason.
   */
  update(realDeltaSeconds: number, worldX: number, worldZ: number): void {
    this.x.step(worldX, CAMERA.smoothingTime, realDeltaSeconds);
    this.z.step(worldZ, CAMERA.smoothingTime, realDeltaSeconds);
    this.apply();
  }

  private apply(): void {
    this.viewport.frame(this.x.value, this.z.value);
  }
}
