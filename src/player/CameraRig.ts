/**
 * The player camera rig (§3.2).
 *
 * The camera keeps the spec's fixed pitch and never yaws — the map's north stays screen-up
 * so learned routes stay legible in the dark — so all it does is choose the ground point it
 * looks at: follow the player with critically damped smoothing, then clamp so the view
 * never frames off-map void.
 *
 * Clamping needs the frustum's ground footprint, which under a pitched camera is a
 * trapezoid rather than a rectangle: the far edge is both further away and wider than the
 * near one. The footprint is recomputed per frame because it depends on the aspect ratio,
 * which changes on resize.
 *
 * The two rules in §3.2 — follow the player, and do not frame off-map void — conflict near
 * a map edge, because the trapezoid's far corners reach the boundary long before the
 * player does. Framing the player wins: a camera that hides the void by leaving the player
 * at the screen edge has failed at the more important half of its job.
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

/** Bounds a target is clamped into, as world-space X/Z extents. */
export interface GroundBounds {
  minX: number;
  minZ: number;
  maxX: number;
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

const clampAxis = (value: number, low: number, high: number): number =>
  // An axis the map is too small to satisfy cannot be clamped at all — every position
  // shows void — so it centres instead, which at least keeps the void symmetrical.
  low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high);

/**
 * Where the camera should look, given where the player is (§3.2).
 *
 * Two clamps, applied in that order of preference:
 *
 * 1. **Map bounds.** Pull the target in until the ground footprint is inside the map.
 * 2. **Player visibility.** Undo as much of that correction as it takes to keep the player
 *    `margin` metres clear of the edge of the view. Near a boundary the two disagree —
 *    the far corners of a pitched frustum overhang the map before the player is anywhere
 *    near it — and this is the one that wins.
 */
export function clampCameraTarget(
  playerX: number,
  playerZ: number,
  footprint: GroundFootprint,
  bounds: GroundBounds,
  margin: number = CAMERA.playerMargin,
): { x: number; z: number } {
  const boundedX = clampAxis(
    playerX,
    bounds.minX + footprint.halfWidth,
    bounds.maxX - footprint.halfWidth,
  );
  const boundedZ = clampAxis(playerZ, bounds.minZ - footprint.minZ, bounds.maxZ - footprint.maxZ);

  // How far the target may sit from the player before the player leaves the frame. The
  // depth limits are asymmetric because the camera sits behind the target: there is more
  // room ahead of the player than behind them.
  const reachX = Math.max(0, footprint.halfWidthAtTarget - margin);
  return {
    x: clampAxis(boundedX, playerX - reachX, playerX + reachX),
    z: clampAxis(
      boundedZ,
      playerZ - Math.max(0, footprint.maxZ - margin),
      playerZ - Math.min(0, footprint.minZ + margin),
    ),
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
  private bounds: GroundBounds;

  constructor(
    private readonly viewport: Viewport,
    bounds: THREE.Box3,
  ) {
    this.bounds = { minX: bounds.min.x, minZ: bounds.min.z, maxX: bounds.max.x, maxZ: bounds.max.z };
  }

  /** The point the camera is currently looking at, after smoothing and clamping. */
  get targetX(): number {
    return this.x.value;
  }

  get targetZ(): number {
    return this.z.value;
  }

  /** Jump the rig to a position without smoothing — run start, and returning from debug. */
  snapTo(worldX: number, worldZ: number): void {
    const clamped = clampCameraTarget(worldX, worldZ, this.footprint(), this.bounds);
    this.x.snap(clamped.x);
    this.z.snap(clamped.z);
    this.apply();
  }

  /**
   * Driven by the render delta, not the sim tick: the rig is presentation, and smoothing it
   * per rendered frame is what keeps a 60 Hz simulation looking smooth on a 144 Hz display.
   * The target it follows is the interpolated player position for the same reason.
   */
  update(realDeltaSeconds: number, worldX: number, worldZ: number): void {
    // Clamp the goal rather than the smoothed result: clamping afterwards would fight the
    // spring at map edges and leave the camera creeping.
    const clamped = clampCameraTarget(worldX, worldZ, this.footprint(), this.bounds);
    this.x.step(clamped.x, CAMERA.smoothingTime, realDeltaSeconds);
    this.z.step(clamped.z, CAMERA.smoothingTime, realDeltaSeconds);
    this.apply();
  }

  private footprint(): GroundFootprint {
    return groundFootprint(this.viewport.camera.aspect);
  }

  private apply(): void {
    this.viewport.frame(this.x.value, this.z.value);
  }
}
