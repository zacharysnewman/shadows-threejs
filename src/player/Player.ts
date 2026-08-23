/**
 * The player entity: movement, collision and the health pool (§3.1, §3.4).
 *
 * Simulation and presentation are deliberately split. `tick` runs on the fixed clock (§7)
 * and is pure arithmetic over the collider index — no Three.js, no input devices, no
 * cameras — so the movement and collision behaviour this phase is judged on can be
 * exercised in tests. `render` is the only part that touches the scene graph, and it
 * interpolates between the last two ticks so a 60 Hz simulation looks smooth at any frame
 * rate.
 *
 * Aim is a field rather than an argument because it changes with the pointer at frame
 * rate, independently of movement (§3.1: the two are independent, so the player can back
 * away while keeping the beam on a threat). Phase 3 reads it to point the flashlight.
 */

import * as THREE from 'three';
import { PLAYER } from '../config';
import type { PlayerSpawnEntity } from '../map/types';
import { moveCircle, type ColliderIndex } from './collision';
import { Health } from './Health';

/**
 * Grid rotation, in degrees clockwise from north (§2), as a world-space direction. North
 * is `-z` — screen-up under the un-rotated camera (§3.2).
 */
export function directionFromRotation(degrees: number): { x: number; z: number } {
  const radians = THREE.MathUtils.degToRad(degrees);
  return { x: Math.sin(radians), z: -Math.cos(radians) };
}

export class Player {
  /** Simulation position on the X/Z plane; `y` is always 0 — the floor (§2). */
  readonly position = new THREE.Vector2();
  /** Position at the end of the previous tick, for render interpolation. */
  private readonly previous = new THREE.Vector2();
  /** Current velocity in m/s, smoothed towards the input's target (§3.1). */
  readonly velocity = new THREE.Vector2();
  /** Unit aim direction on the X/Z plane (§3.1, §4.1). */
  readonly aim = new THREE.Vector2();

  readonly health = new Health();

  /** Scene graph node — a placeholder capsule until the art pass (Phase 11). */
  readonly object = new THREE.Group();

  /** True while the last resolved move ended in contact with a collider. Debug readout. */
  private _touchingWall = false;

  constructor(
    spawn: PlayerSpawnEntity,
    private readonly colliders: ColliderIndex,
  ) {
    this.position.set(spawn.wx, spawn.wz);
    this.previous.copy(this.position);

    const facing = directionFromRotation(spawn.rotation);
    this.aim.set(facing.x, facing.z);

    this.object.add(...buildPlaceholderMesh());
    this.render(1);
  }

  get touchingWall(): boolean {
    return this._touchingWall;
  }

  get speed(): number {
    return this.velocity.length();
  }

  /**
   * Advance one simulation tick.
   *
   * `moveX` / `moveZ` are the input's movement intent in world axes with magnitude ≤ 1;
   * the player has one speed and no sprint (§3.1), so intent scales it and nothing else.
   */
  tick(dt: number, moveX: number, moveZ: number): void {
    this.previous.copy(this.position);

    const targetX = moveX * PLAYER.walkSpeed;
    const targetZ = moveZ * PLAYER.walkSpeed;

    // §3.1 — acceleration and deceleration smoothed over 0.1 s, so input neither snaps the
    // player to full speed nor stops them dead. Exponential approach, so the time constant
    // means the same thing at any tick rate.
    const blend = 1 - Math.exp(-dt / PLAYER.accelerationTime);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.y += (targetZ - this.velocity.y) * blend;

    const result = moveCircle(
      this.colliders,
      this.position.x,
      this.position.y,
      this.velocity.x * dt,
      this.velocity.y * dt,
      PLAYER.radius,
    );
    this.position.set(result.x, result.z);
    this._touchingWall = result.hit;

    if (result.hit) {
      // Cancel only the component driving into the surface: the along-wall component is
      // what makes grazing a wall slide instead of halting (§3.1). Without this the
      // velocity keeps building into the wall and the player rockets off on release.
      const into = this.velocity.x * result.normalX + this.velocity.y * result.normalZ;
      if (into < 0) {
        this.velocity.x -= result.normalX * into;
        this.velocity.y -= result.normalZ * into;
      }
    }

    this.health.tick(dt);
  }

  /** Point the player at a world position — pointer aim, once projected to the ground. */
  aimAt(worldX: number, worldZ: number): void {
    const dx = worldX - this.position.x;
    const dz = worldZ - this.position.y;
    if (Math.hypot(dx, dz) < 1e-4) return;
    this.aim.set(dx, dz).normalize();
  }

  /** Point the player along a direction — stick aim, which is already a direction. */
  aimTowards(x: number, z: number): void {
    if (Math.hypot(x, z) < 1e-4) return;
    this.aim.set(x, z).normalize();
  }

  /** Teleport without smoothing; used by run start and the debug warp (Cross-Cutting). */
  moveTo(worldX: number, worldZ: number): void {
    this.position.set(worldX, worldZ);
    this.previous.copy(this.position);
    this.velocity.set(0, 0);
  }

  /**
   * Place the mesh for rendering. `alpha` is the sim clock's fraction into the pending
   * tick; interpolating with it decouples visible smoothness from the 60 Hz tick rate.
   */
  render(alpha: number): void {
    this.object.position.set(
      THREE.MathUtils.lerp(this.previous.x, this.position.x, alpha),
      0,
      THREE.MathUtils.lerp(this.previous.y, this.position.y, alpha),
    );
    // Yaw only: the rig looks down at the player, so pitch and roll have nothing to say.
    this.object.rotation.y = Math.atan2(this.aim.x, this.aim.y);
  }

  /** World position as the rest of the game sees it — X/Z, on the floor. */
  worldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, 0, this.position.y);
  }
}

/**
 * Placeholder body: a capsule at the spec's radius and height, and a wedge showing aim.
 * The wedge exists because Phase 2 has no flashlight yet — without it, aim is invisible
 * and untestable by eye.
 */
function buildPlaceholderMesh(): THREE.Object3D[] {
  const cylinderHeight = Math.max(0.1, PLAYER.height - PLAYER.radius * 2);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER.radius, cylinderHeight, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8e0e8, roughness: 0.7 }),
  );
  body.position.y = PLAYER.height / 2;
  body.castShadow = true;

  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd27f, roughness: 0.5 }),
  );
  // Local +z is the aim direction after the yaw applied in `render`.
  marker.position.set(0, PLAYER.height * 0.6, PLAYER.radius + 0.28);
  marker.rotation.x = Math.PI / 2;

  return [body, marker];
}
