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
 *
 * Sprinting is the one thing that breaks that independence, and deliberately: while
 * sprinting the aim is driven onto the direction of travel and pointer input is ignored
 * (§3.1). That is the whole price of the speed — a sprinting player cannot hold a light on
 * what is behind them.
 *
 * Both ends of that are a bounded turn, not a snap. Releasing a sprint with the cursor
 * behind you would otherwise whip the beam through 180° in one frame, which reads as a
 * glitch rather than as looking back — so the aim keeps turning at the same rate until it
 * catches up with where the player is pointing, and only then goes back to being direct.
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
  /** True while the player is sprinting, which is also what locks the aim (§3.1). */
  private _sprinting = false;
  /**
   * Where aim is being turned towards while it is rate-limited: the sprint's direction of
   * travel, or the last aim the player asked for while it catches back up. Null once it has
   * caught up and aiming is direct again.
   */
  private readonly aimGoal = new THREE.Vector2();
  private turningAim = false;
  /**
   * Whether `aimGoal` holds anything to turn towards. False for the gap between releasing a
   * sprint and the player's next aim input: the beam holds where the sprint left it rather
   * than turning towards a goal nobody has given it yet.
   */
  private hasAimGoal = false;

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

  /** While true, aim follows movement and pointer input is refused (§3.1). */
  get sprinting(): boolean {
    return this._sprinting;
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
  tick(dt: number, moveX: number, moveZ: number, sprintHeld = false): void {
    this.previous.copy(this.position);

    // §3.1 — no sprinting in place: a held key with no movement behind it is not a sprint,
    // and must not spend the aim lock.
    const intent = Math.hypot(moveX, moveZ);
    const wasSprinting = this._sprinting;
    this._sprinting = sprintHeld && intent >= PLAYER.sprintMinimumIntent;

    const speed = this._sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const targetX = moveX * speed;
    const targetZ = moveZ * speed;

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

    // §3.1 — while sprinting the goal is the direction of travel, taken from the *input*
    // rather than from the resolved velocity so that sliding along a wall does not swing
    // the beam into it.
    if (this._sprinting) {
      this.aimGoal.set(moveX / intent, moveZ / intent);
      this.turningAim = true;
      this.hasAimGoal = true;
    } else if (wasSprinting) {
      // Releasing arms the turn back, but with no goal yet: the beam holds where the sprint
      // left it until the player points somewhere, and then sweeps. Without this the
      // sprint's own turn completes, control returns to direct aiming, and the next pointer
      // sample cuts the beam round in a single frame — the whip §3.1 rules out.
      this.turningAim = true;
      this.hasAimGoal = false;
    }
    if (this.turningAim && this.hasAimGoal) this.turnAimTowardsGoal(dt);

    this.health.tick(dt);
  }

  /**
   * Point the player at a world position — pointer aim, once projected to the ground.
   * Refused while sprinting: the direction of travel owns the aim until the sprint ends
   * (§3.1), and letting the pointer fight it would make the lock a suggestion.
   */
  aimAt(worldX: number, worldZ: number): void {
    this.aimTowards(worldX - this.position.x, worldZ - this.position.y);
  }

  /** Point the player along a direction — stick aim, which is already a direction. */
  aimTowards(x: number, z: number): void {
    if (this._sprinting) return;
    if (Math.hypot(x, z) < 1e-4) return;

    if (this.turningAim) {
      // Sprinting, or still recovering from one: this becomes the goal the turn is heading
      // for rather than the aim itself, so the beam sweeps round instead of cutting.
      this.aimGoal.set(x, z).normalize();
      this.hasAimGoal = true;
      return;
    }
    this.aim.set(x, z).normalize();
  }

  /**
   * Rotate the aim towards its goal at the spec's maximum turn rate (§3.1), and hand
   * control back to direct aiming once it arrives.
   */
  private turnAimTowardsGoal(dt: number): void {
    const maximum = THREE.MathUtils.degToRad(PLAYER.aimTurnDegreesPerSecond) * dt;
    const current = Math.atan2(this.aim.x, this.aim.y);
    const goal = Math.atan2(this.aimGoal.x, this.aimGoal.y);

    // Shortest way round, so a turn never takes the long way for want of unwrapping.
    let delta = goal - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    if (Math.abs(delta) <= maximum) {
      this.aim.copy(this.aimGoal);
      this.turningAim = false;
      return;
    }

    const angle = current + Math.sign(delta) * maximum;
    this.aim.set(Math.sin(angle), Math.cos(angle));
  }

  /**
   * §5.3 — take a hit. Delegates to the pool so an attacker does not have to reach through
   * the player to find it; true when this deduction is the one that killed them.
   */
  damage(amount: number): boolean {
    return this.health.damage(amount);
  }

  /**
   * §5.3 — shoved `metres` directly away from a point by a spider that landed a hit.
   *
   * A displacement, resolved against the same geometry walking is, so the shove slides
   * along a wall rather than posting the player through it. Velocity is left alone: the
   * spec knocks the player back, it does not stagger them, and with §3.1's 0.1 s
   * acceleration a cancelled velocity would read as a second, invisible penalty.
   */
  knockBack(fromX: number, fromZ: number, metres: number): void {
    const dx = this.position.x - fromX;
    const dz = this.position.y - fromZ;
    const length = Math.hypot(dx, dz);
    const ux = length < 1e-4 ? 0 : dx / length;
    const uz = length < 1e-4 ? 1 : dz / length;

    const result = moveCircle(
      this.colliders,
      this.position.x,
      this.position.y,
      ux * metres,
      uz * metres,
      PLAYER.radius,
    );
    this.position.set(result.x, result.z);
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
    new THREE.MeshStandardMaterial({
      // Mid-tone rather than near-white: under an environmental light (§4.2) a white
      // capsule blows out to a featureless blob.
      color: 0x8a94a2,
      roughness: 0.7,
      // §4 — the player stays readable as a silhouette in the dark. Emissive rather than a
      // light: it illuminates nothing, so it cannot be used to see by and no light-reactive
      // enemy responds to it.
      emissive: 0x2a3038,
    }),
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
