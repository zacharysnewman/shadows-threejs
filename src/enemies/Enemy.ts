/**
 * The enemy both AIs are built on (§5).
 *
 * This owns everything the two share: the state machine, the movement speeds from §5's
 * table, A\* with its repath interval, local avoidance, and the collision resolution that
 * keeps a body out of walls. What it deliberately does not own is *reacting to light* —
 * that is the whole of what makes each enemy itself (§5.1, §5.2), and it lives in the
 * subclasses, which wrap `decide` and defer everything they do not claim back to it.
 *
 * The states are all declared here, including the ones only one subclass ever enters. The
 * movement rule for each — flee runs at 1.5× pursue, frozen and attack and recoil are
 * velocity zero — belongs with the speeds table rather than with the AI that triggers it,
 * so a held enemy is held identically whatever held it.
 *
 * Simulation only: `tick` is arithmetic over the grid and the collider index, and `render`
 * is the one method that touches the scene graph.
 */

import * as THREE from 'three';
import { ENEMY } from '../config';
import type { Rng } from '../core/rng';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';
import { findPath, hasLineOfSight, type GridPoint } from '../nav/AStar';
import { moveCircle, type ColliderIndex } from '../player/collision';

export type EnemyKind = 'SpiderEnemy' | 'ShadowMonster';

/**
 * Every state either enemy can be in.
 *
 * - `wander` — no target; drifts between walkable points (§5.1).
 * - `pursue` — heading for the player, or for where they were last seen.
 * - `flee`   — running away at 1.5× pursue speed (§5.1).
 * - `frozen` — held still by light (§5.1, §5.2).
 * - `attack` — committed to a lunge and no longer advancing (§5.3).
 * - `recoil` — held after a strike, whether it landed or missed (§5.3).
 *
 * The last three are all "pinned": velocity is zero and nothing steers. What differs is
 * who releases them — the light, the strike timer, or the hold.
 */
export type EnemyState = 'wander' | 'pursue' | 'flee' | 'frozen' | 'attack' | 'recoil';

export interface EnemyProfile {
  kind: EnemyKind;
  radius: number;
  height: number;
  wanderSpeed: number;
  pursueSpeed: number;
  fleeSpeed: number;
  /** Range at which the player is acquired; `Infinity` for an enemy that always knows. */
  detectRadius: number;
  /** Range at which pursuit is abandoned. Wider than `detectRadius`, so it cannot flicker. */
  loseRadius: number;
}

export const ENEMY_PROFILES: Readonly<Record<EnemyKind, EnemyProfile>> = {
  SpiderEnemy: {
    kind: 'SpiderEnemy',
    radius: ENEMY.spider.radius,
    height: ENEMY.spider.height,
    wanderSpeed: ENEMY.spider.wanderSpeed,
    pursueSpeed: ENEMY.spider.pursueSpeed,
    fleeSpeed: ENEMY.spider.fleeSpeed,
    detectRadius: ENEMY.spider.detectRadius,
    loseRadius: ENEMY.spider.loseRadius,
  },
  ShadowMonster: {
    kind: 'ShadowMonster',
    radius: ENEMY.shadowMonster.radius,
    height: ENEMY.shadowMonster.height,
    wanderSpeed: ENEMY.shadowMonster.wanderSpeed,
    pursueSpeed: ENEMY.shadowMonster.pursueSpeed,
    // §5's table has no flee speed for the monster; it never flees. Kept equal to pursue so
    // the field is never a lie about a state the monster cannot enter.
    fleeSpeed: ENEMY.shadowMonster.pursueSpeed,
    detectRadius: ENEMY.shadowMonster.detectRadius,
    loseRadius: ENEMY.shadowMonster.loseRadius,
  },
};

/**
 * The illumination query as an enemy sees it (§4.1) — narrowed to what the AIs actually
 * ask, so a test can hand one an answer without a flashlight, a lamp or a scene.
 */
export interface IlluminationSampler {
  sample(key: string, x: number, z: number): { lit: boolean; amount: number };
}

/**
 * What an enemy can do *to* the player (§5.3). Behind an interface for the same reason:
 * the spider's attack is arithmetic over distances and timers, and testing it should not
 * require a Player, a collider index or a health bar on screen.
 */
export interface PlayerActions {
  /** Deduct health. True when this deduction is what took the pool to zero. */
  damage(amount: number): boolean;
  /** Shove the player `metres` directly away from a point. */
  knockBack(fromX: number, fromZ: number, metres: number): void;
}

/** What an enemy needs to know about the world on the tick it is updated. */
export interface EnemyContext {
  playerX: number;
  playerZ: number;
  grid: WalkabilityGrid;
  colliders: ColliderIndex;
  /** Every enemy, for local avoidance. Includes the one being ticked; it skips itself. */
  neighbours: readonly Enemy[];
  /** §4.1 — the one light query both AIs consume. */
  illumination: IlluminationSampler;
  /** §5.3 — what contact resolves into. */
  player: PlayerActions;
}

/** The states in which nothing steers and velocity is zero (§5.1, §5.3). */
function pinned(state: EnemyState): boolean {
  return state === 'frozen' || state === 'attack' || state === 'recoil';
}

export class Enemy {
  readonly position = new THREE.Vector2();
  readonly velocity = new THREE.Vector2();
  readonly object = new THREE.Group();

  private readonly previous = new THREE.Vector2();
  private _state: EnemyState = 'wander';

  /** Current path in grid coordinates, nearest waypoint first. */
  private path: GridPoint[] = [];
  private sinceRepath = Number.POSITIVE_INFINITY;
  /** Grid version the current path was found against (§2); a change invalidates it. */
  private pathGridVersion = -1;

  private wanderPause = 0;
  /** Seconds left of a `recoil` hold, or of any other timed state (§5.3). */
  private holdTimer = 0;

  constructor(
    readonly profile: EnemyProfile,
    readonly key: string,
    spawnX: number,
    spawnZ: number,
    protected readonly rng: Rng,
  ) {
    this.position.set(spawnX, spawnZ);
    this.previous.copy(this.position);
    this.object.name = `${profile.kind}:${key}`;
    this.object.add(buildPlaceholderMesh(profile));
    this.render(1);
  }

  get state(): EnemyState {
    return this._state;
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** Remaining waypoints, for the debug path overlay. */
  get waypoints(): readonly GridPoint[] {
    return this.path;
  }

  /** True while this enemy is chasing something rather than drifting. */
  get engaged(): boolean {
    return this._state === 'pursue';
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.position.x - x, this.position.y - z);
  }

  /**
   * Draw a body that §5.2 says is never drawn. Debug harness only — finding the Shadow
   * Monster is the game, and it cannot be debugged by staring at where it is not.
   */
  setBodyRevealed(revealed: boolean): void {
    if (this.profile.kind !== 'ShadowMonster') return;
    this.object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material as THREE.Material;
      material.colorWrite = revealed;
      material.depthWrite = revealed;
    });
  }

  /**
   * Enter a state directly. Phases 7 and 8 drive this from their light reactions; nothing
   * in Phase 5 calls it except the debug harness and the tests.
   */
  setState(state: EnemyState, holdSeconds = 0): void {
    this._state = state;
    this.holdTimer = holdSeconds;
    if (state !== 'pursue') this.path = [];
  }

  /**
   * Resolve contact with the player (§5.3). The manager runs one distance check and each
   * enemy says what it means; the base means nothing by it, so an enemy whose resolution
   * has not been written yet is harmless rather than accidentally lethal.
   */
  onPlayerContact(_distance: number, _context: EnemyContext): void {}

  /**
   * Shove this enemy `metres` directly away from a point, resolved against the same
   * geometry it walks through so a recoil cannot post it into a wall (§5.3). A
   * displacement, not an impulse: the caller is putting it into a held state, and the
   * velocity it had is not supposed to survive.
   */
  knockBack(colliders: ColliderIndex, fromX: number, fromZ: number, metres: number): void {
    const dx = this.position.x - fromX;
    const dz = this.position.y - fromZ;
    const length = Math.hypot(dx, dz);
    // Exactly co-located is not a direction. Nothing depends on which way it picks, only
    // that it picks one and the shove still happens.
    const ux = length < 1e-4 ? 0 : dx / length;
    const uz = length < 1e-4 ? 1 : dz / length;

    const result = moveCircle(
      colliders,
      this.position.x,
      this.position.y,
      ux * metres,
      uz * metres,
      this.profile.radius,
    );
    this.position.set(result.x, result.z);
    this.velocity.set(0, 0);
  }

  /** Advance one simulation tick (§7). */
  tick(dt: number, context: EnemyContext): void {
    this.previous.copy(this.position);
    this.sinceRepath += dt;
    if (this.holdTimer > 0) this.holdTimer = Math.max(0, this.holdTimer - dt);

    this.decide(dt, context);

    if (pinned(this._state)) {
      // §5.1 is literal about this: the velocity *drops* to zero. Letting it decay over the
      // usual smoothing would carry a pursuing spider the better part of half a metre into
      // the player after the beam has already caught it — and would let a committed lunge
      // coast the last of the distance it is supposed to have given up.
      this.velocity.set(0, 0);
      return;
    }

    const speed = this.speedForState();
    const steer = this.steer(context);
    // Normalised *before* avoidance is mixed in. The raw vector's length is the distance to
    // the target, so adding a push to it un-normalised would make avoidance matter less the
    // further away the target is — two enemies converging from across the map would walk
    // straight through each other and only separate at the end (§1, §5).
    if (steer.lengthSq() > 1e-8) steer.normalize();
    this.addAvoidance(steer, context);

    if (steer.lengthSq() > 1e-8) steer.normalize().multiplyScalar(speed);

    const blend = 1 - Math.exp(-dt / ENEMY.accelerationTime);
    this.velocity.x += (steer.x - this.velocity.x) * blend;
    this.velocity.y += (steer.y - this.velocity.y) * blend;

    const result = moveCircle(
      context.colliders,
      this.position.x,
      this.position.y,
      this.velocity.x * dt,
      this.velocity.y * dt,
      this.profile.radius,
    );
    this.position.set(result.x, result.z);

    if (result.hit) {
      const into = this.velocity.x * result.normalX + this.velocity.y * result.normalZ;
      if (into < 0) {
        this.velocity.x -= result.normalX * into;
        this.velocity.y -= result.normalZ * into;
      }
      // Walking into geometry means the route is wrong, not that the wall will move.
      this.sinceRepath = ENEMY.repathSeconds;
    }
  }

  /**
   * Choose a state and keep the path fit for it.
   *
   * `protected` and overridable: this is everything the two enemies share, and each
   * subclass wraps it with the light reaction that makes it itself (§5.1, §5.2). A
   * subclass handles the states it owns and defers the rest here.
   */
  protected decide(dt: number, context: EnemyContext): void {
    if (pinned(this._state)) {
      // Held: whatever put it here decides when it leaves. `recoil` releases itself once
      // its hold expires (§5.3); `frozen` and `attack` wait on their own AI.
      if (this._state === 'recoil' && this.holdTimer === 0) this._state = 'pursue';
      return;
    }

    const distance = this.distanceTo(context.playerX, context.playerZ);
    const visible = this.canSee(context);

    if (this._state === 'flee') {
      if (this.path.length === 0) this._state = 'wander';
      return;
    }

    // Acquisition is by proximity, not by sight (§5). An enemy that had to see the player
    // first could never begin a chase around a corner, which is most of what a chase is on
    // a map of buildings — and neither enemy is described as hunting by eye. Sight decides
    // only *how* it comes: straight, or routed.
    if (this._state === 'pursue') {
      // The gap between the two radii is what stops an enemy at the edge of its range
      // flickering between hunting and wandering.
      if (distance > this.profile.loseRadius) {
        this._state = 'wander';
        this.path = [];
        this.wanderPause = 0;
      }
    } else if (distance <= this.profile.detectRadius) {
      this._state = 'pursue';
      this.path = [];
      this.sinceRepath = Number.POSITIVE_INFINITY;
    }

    if (this._state === 'pursue') this.updatePursuitPath(context, visible);
    else this.updateWanderPath(dt, context);
  }

  /**
   * Whether the enemy has a clear line to the player. Not a detection test — that is by
   * proximity — but the choice between walking straight at them and paying for a path.
   */
  private canSee(context: EnemyContext): boolean {
    const grid = context.grid;
    const from = grid.worldToGrid(this.position.x, this.position.y);
    const to = grid.worldToGrid(context.playerX, context.playerZ);
    return hasLineOfSight(grid, from.gx, from.gy, to.gx, to.gy);
  }

  private updatePursuitPath(context: EnemyContext, visible: boolean): void {
    if (visible) {
      // Straight line available: no path to maintain, and no repath cost either.
      this.path = [];
      return;
    }

    const stale =
      this.sinceRepath >= ENEMY.repathSeconds ||
      this.pathGridVersion !== context.grid.version ||
      this.path.length === 0;
    if (!stale) return;

    this.repath(context, context.playerX, context.playerZ);
  }

  protected updateWanderPath(dt: number, context: EnemyContext): void {
    if (this.path.length > 0) {
      // A wander leg still has to notice the world changing under it (§2, §6).
      if (this.pathGridVersion !== context.grid.version) this.path = [];
      else return;
    }

    if (this.wanderPause > 0) {
      this.wanderPause -= dt;
      return;
    }

    const grid = context.grid;
    const here = grid.worldToGrid(this.position.x, this.position.y);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const gx = here.gx + this.rng.int(ENEMY.wanderRadiusTiles * 2 + 1) - ENEMY.wanderRadiusTiles;
      const gy = here.gy + this.rng.int(ENEMY.wanderRadiusTiles * 2 + 1) - ENEMY.wanderRadiusTiles;
      if (!grid.isWalkable(gx, gy)) continue;
      const world = grid.gridToWorld(gx, gy);
      if (this.repath(context, world.wx, world.wz)) return;
    }

    // Nowhere to go this time; wait and try again rather than spinning on it every tick.
    this.wanderPause = this.rng.range(
      ENEMY.wanderPauseSeconds.min,
      ENEMY.wanderPauseSeconds.max,
    );
  }

  protected repath(context: EnemyContext, targetX: number, targetZ: number): boolean {
    const grid = context.grid;
    const from = grid.worldToGrid(this.position.x, this.position.y);
    const to = grid.worldToGrid(targetX, targetZ);

    this.sinceRepath = 0;
    this.pathGridVersion = grid.version;
    const path = findPath(grid, from.gx, from.gy, to.gx, to.gy);
    this.path = path ?? [];
    return path !== null && path.length > 0;
  }

  /** Direction the enemy wants to move, before avoidance and before speed is applied. */
  private steer(context: EnemyContext): THREE.Vector2 {
    const steer = _steer.set(0, 0);
    if (pinned(this._state)) return steer;

    if (this._state === 'pursue' && this.path.length === 0) {
      // Straight at them.
      return steer.set(context.playerX - this.position.x, context.playerZ - this.position.y);
    }

    const grid = context.grid;
    while (this.path.length > 0) {
      const waypoint = this.path[0]!;
      const world = grid.gridToWorld(waypoint.x, waypoint.y);
      const dx = world.wx - this.position.x;
      const dz = world.wz - this.position.y;
      if (Math.hypot(dx, dz) > ENEMY.waypointRadius) return steer.set(dx, dz);
      this.path.shift();
    }

    if (this._state === 'wander' && this.wanderPause <= 0) {
      // Leg finished: stand for a moment before choosing another (§5).
      this.wanderPause = this.rng.range(
        ENEMY.wanderPauseSeconds.min,
        ENEMY.wanderPauseSeconds.max,
      );
    }
    return steer;
  }

  /**
   * Push away from neighbours that are too close. The Shadow Monster ignores other entity
   * colliders (§5), so it neither avoids nor is avoided — it walks through its own kind
   * and through the spiders, which is exactly the "takes routes the player cannot" note.
   */
  private addAvoidance(steer: THREE.Vector2, context: EnemyContext): void {
    if (this.profile.kind === 'ShadowMonster') return;

    for (const other of context.neighbours) {
      if (other === this || other.profile.kind === 'ShadowMonster') continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.y - other.position.y;
      const distance = Math.hypot(dx, dz);
      const minimum = this.profile.radius + other.profile.radius;
      if (distance >= minimum || distance < 1e-4) continue;

      const push = (minimum - distance) / minimum;
      steer.x += (dx / distance) * push * ENEMY.avoidanceStrength;
      steer.y += (dz / distance) * push * ENEMY.avoidanceStrength;
    }
  }

  private speedForState(): number {
    switch (this._state) {
      case 'pursue':
        return this.profile.pursueSpeed;
      case 'flee':
        return this.profile.fleeSpeed;
      case 'wander':
        return this.profile.wanderSpeed;
      case 'frozen':
      case 'attack':
      case 'recoil':
        return 0;
      default:
        return 0;
    }
  }

  /** Interpolated between ticks, like the player, so movement is smooth above 60 fps (§7). */
  render(alpha: number): void {
    this.object.position.set(
      THREE.MathUtils.lerp(this.previous.x, this.position.x, alpha),
      0,
      THREE.MathUtils.lerp(this.previous.y, this.position.y, alpha),
    );
    if (this.velocity.lengthSq() > 1e-4) {
      this.object.rotation.y = Math.atan2(this.velocity.x, this.velocity.y);
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) =>
          m.dispose(),
        );
      }
    });
    this.object.removeFromParent();
  }
}

const _steer = new THREE.Vector2();

/**
 * Placeholder bodies until the art pass (Phase 11). Both cast shadows, because that is how
 * each is meant to be read: the spider by sight, and the Shadow Monster *only* by the shadow
 * it throws (§5.2).
 *
 * The monster's body is never drawn. `colorWrite` and `depthWrite` off rather than
 * `visible = false`, because an invisible object is skipped by the shadow pass too, and the
 * shadow is the entire creature. What is left is a mesh that contributes nothing to the
 * image and everything to the shadow map.
 */
function buildPlaceholderMesh(profile: EnemyProfile): THREE.Object3D {
  const spider = profile.kind === 'SpiderEnemy';
  const geometry = spider
    ? new THREE.SphereGeometry(profile.radius, 10, 8)
    : new THREE.CapsuleGeometry(profile.radius, Math.max(0.1, profile.height - profile.radius * 2), 4, 10);

  const material = new THREE.MeshStandardMaterial({
    color: spider ? 0x6b3f3f : 0x201d28,
    roughness: 0.85,
  });
  if (!spider) {
    material.colorWrite = false;
    material.depthWrite = false;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = spider ? profile.radius * 0.8 : profile.height / 2;
  if (spider) mesh.scale.set(1, 0.7, 1.2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
