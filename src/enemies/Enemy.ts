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
import type { CharacterRig } from './CharacterRig';
import { ENEMY } from '../config';
import type { Rng } from '../core/rng';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';
import { findPath, hasLineOfSight, type GridPoint } from '../nav/AStar';
import { moveCircle, type ColliderIndex } from '../player/collision';
import { Gait, type GaitProfile } from './Gait';

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
 * - `blink`  — the beam is down and the freeze has lifted: walking at pursue speed, in the
 *   dark, for as long as the blink lasts (§5.2).
 *
 * `frozen`, `attack` and `recoil` are "pinned": nothing steers and velocity is zero. What
 * differs is who releases them — the light, the strike timer, or the hold. `blink` is not
 * pinned; it steers exactly as `pursue` does, and only the timer that started it decides
 * when it ends.
 */
export type EnemyState =
  | 'wander'
  | 'pursue'
  | 'flee'
  | 'frozen'
  | 'attack'
  | 'recoil'
  | 'blink';

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

/**
 * §5.1 — the spider's locomotion, speed-driven so its legs land where they touch. The
 * Shadow Monster has none, and needs none: §5.2 is absolute that it is never both moving
 * and visible, so no frame of it in motion is ever drawn to animate.
 */
const SPIDER_GAIT: GaitProfile = {
  /** Cat-sized and eight-legged: a short stride and a lot of them (§5.1). */
  strideMetres: 0.4,
  bobMetres: 0.035,
  swingRadians: 0.5,
  /** Its pursue speed, so a chase is the cycle at full amplitude. */
  fullSpeed: ENEMY.spider.pursueSpeed,
  windUpRadians: 0.55,
};

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
  sample(
    key: string,
    x: number,
    z: number,
  ): {
    lit: boolean;
    /**
     * §5.2 — the torch is on and pointed here, whatever its intensity. Only the Shadow
     * Monster asks: it is the one thing that can put the beam out, so during its own blink
     * "is there light on me" answers with the darkness it caused.
     */
    inBeam?: boolean;
    amount: number;
    /**
     * Which light is responsible. §5.2 needs it: the flashlight's interference blinks the
     * monster and an environmental light's never does, so "lit" alone is not enough.
     */
    source: 'flashlight' | 'environment' | null;
  };
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
  /**
   * §5.3 — kill outright, at any health. Its own verb rather than a large `damage`,
   * because the Shadow Monster's contact is not a big hit: there is no armour, no
   * threshold and no amount of health that survives it.
   */
  kill(): void;
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

/**
 * The states that are coming for the player, and therefore steer the same way. `blink` is
 * one of them (§5.2): the beam being down is what lets the monster move, not a different
 * way of moving. Named rather than written out at each site, because the three places that
 * ask this question have to agree — the first version of the blink walk missed `steer` and
 * produced a monster that was unfrozen, pathing, and standing perfectly still.
 */
function hunting(state: EnemyState): boolean {
  return state === 'pursue' || state === 'blink';
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

  /** §5.1 — what the body is doing, which is not what the AI is doing. */
  private readonly gait = new Gait(SPIDER_GAIT);
  /** The animated parts of the placeholder body; empty for a body that never moves. */
  private readonly limbs: THREE.Object3D[] = [];
  private body: THREE.Object3D | null = null;
  private bodyRestY = 0;
  /**
   * §5.1 — the real animated body, once the art has loaded. Until then (and for anything
   * with no character art) the placeholder above stands in, driven by the gait: the two are
   * alternatives, never both, so `poseBody` stops as soon as this exists.
   */
  private rig: CharacterRig | null = null;
  /** Placeholder parts, kept so attaching a rig can take them back out. */
  private readonly placeholderParts: THREE.Object3D[] = [];

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
    const built = buildPlaceholderMesh(profile);
    this.object.add(...built.parts);
    this.placeholderParts.push(...built.parts);
    this.body = built.body;
    this.bodyRestY = built.body.position.y;
    this.limbs.push(...built.limbs);
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
    // A route survives only into the states that would walk it (§5.2): a blink resumes the
    // hunt the freeze interrupted, so throwing the path away here would make it re-plan
    // from scratch inside a window half a second long.
    if (!hunting(state)) this.path = [];
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
    // §5.1 — driven by the ground actually covered, so a body stopped against a wall does
    // not walk on the spot.
    this.gait.advance(
      Math.hypot(this.position.x - this.previous.x, this.position.y - this.previous.y),
      this.speed,
      dt,
    );

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
    // §5.2 — `blink` keeps its own name through this: the state is what tells the readout,
    // the footsteps and the beam that the light is down, and re-acquiring into `pursue`
    // here would lose that for the length of the blink.
    if (hunting(this._state)) {
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

    if (hunting(this._state)) this.updatePursuitPath(context, visible);
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

    if (hunting(this._state) && this.path.length === 0) {
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
      // §5.2 — a blink is the monster walking while the beam is down, not a lurch with a
      // speed of its own. It closes ground at the rate it always closes ground; what a
      // blink changes is that it is allowed to.
      case 'blink':
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

  /**
   * How far through an attack's wind-up this enemy is, 0–1 at the strike (§5.3). Only the
   * spider has one; the base is never mid-lunge.
   */
  protected get attackProgress(): number {
    return 0;
  }

  /**
   * Swap the placeholder body for real animated art (§5.1).
   *
   * The placeholder is removed rather than hidden: it is eight boxes and a sphere, and a
   * hidden mesh is still a mesh the shadow pass walks. The rig owns the scale, so nothing
   * here touches the group's transform — `render` still moves the group, and the character
   * lives inside it exactly as the placeholder did.
   */
  attachCharacter(rig: CharacterRig): void {
    this.rig?.dispose();
    for (const part of this.placeholderParts) part.removeFromParent();
    this.placeholderParts.length = 0;
    this.limbs.length = 0;
    this.body = null;

    this.rig = rig;
    this.object.add(rig.character.scene);

    // §5.2 — the Shadow Monster's body is never drawn, and real art does not change that.
    // The same treatment the placeholder gets: `colorWrite` and `depthWrite` off rather
    // than `visible = false`, because an invisible object is skipped by the shadow pass and
    // the shadow is the entire creature. What the art buys is the *outline*, which is all
    // the player ever sees of it.
    if (this.profile.kind === 'ShadowMonster') this.setBodyRevealed(false);
  }

  /** Whether this enemy is running on real art rather than on the placeholder. */
  get hasCharacter(): boolean {
    return this.rig !== null;
  }

  /**
   * What this enemy's body can animate with, and what it is animating now. Null until the
   * art has loaded.
   *
   * §5.2 is why this is exposed rather than kept private: the Shadow Monster wears §5.1's
   * mesh, which has five clips, and the rule that none of them may ever play is now a
   * property of the object somebody could quietly undo. A rule nothing can observe is a
   * rule nothing can check.
   */
  get animation(): { clips: readonly string[]; playing: string | null } | null {
    return this.rig ? { clips: this.rig.clipNames, playing: this.rig.playing } : null;
  }

  /**
   * Interpolated between ticks, like the player, so movement is smooth above 60 fps (§7).
   *
   * `delta` is the *render* delta, and it is only used by the rig: an animation is a
   * presentation effect and belongs on the display's clock, not on the 60 Hz tick.
   */
  render(alpha: number, delta = 0): void {
    this.object.position.set(
      THREE.MathUtils.lerp(this.previous.x, this.position.x, alpha),
      0,
      THREE.MathUtils.lerp(this.previous.y, this.position.y, alpha),
    );
    if (this.velocity.lengthSq() > 1e-4) {
      this.object.rotation.y = Math.atan2(this.velocity.x, this.velocity.y);
    }
    if (this.rig) this.rig.update(this._state, this.speed, delta);
    else this.poseBody();
  }

  /**
   * Apply the gait to the placeholder body (§5.1). Presentation only: nothing read here is
   * read back by the AI, and an enemy whose art has not been made yet behaves identically
   * to one whose has.
   */
  private poseBody(): void {
    if (!this.body || this.limbs.length === 0) return;
    const pose = this.gait.pose(this.attackProgress);
    this.body.position.y = this.bodyRestY + pose.bob;
    this.body.rotation.x = pose.pitch;
    this.limbs.forEach((limb, index) => {
      // Alternating pairs, so the legs on one side are half a cycle behind the other —
      // the difference between walking and a body of legs moving as one.
      const phase = index % 2 === 0 ? pose.swing : -pose.swing;
      limb.rotation.x = phase;
    });
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
 * A placeholder body, split into the parts the gait moves (§5.1). Flat rather than under a
 * group of its own: the enemy's own node is already the body's parent, and a wrapper would
 * be one scene node per enemy that exists only to hold one other.
 */
interface PlaceholderBody {
  /** Everything to add to the enemy's node. */
  parts: THREE.Object3D[];
  /** The part that bobs and pitches. */
  body: THREE.Object3D;
  /** Legs, alternating sides, empty for a body §5.2 keeps still. */
  limbs: THREE.Object3D[];
}

/**
 * Placeholder bodies until the art pass (Phase 11). Both cast shadows, because that is how
 * each is meant to be read: the spider by sight, and the Shadow Monster *only* by the shadow
 * it throws (§5.2).
 *
 * The monster's body is never drawn. `colorWrite` and `depthWrite` off rather than
 * `visible = false`, because an invisible object is skipped by the shadow pass too, and the
 * shadow is the entire creature. What is left is a mesh that contributes nothing to the
 * image and everything to the shadow map.
 *
 * The spider gets legs, and the monster gets none — not for looks, but because §5.1 owes a
 * speed-driven locomotion cycle and §5.2 owes a single pose, and a placeholder that cannot
 * show the difference is a placeholder that hides whether the driver works.
 */
function buildPlaceholderMesh(profile: EnemyProfile): PlaceholderBody {
  const spider = profile.kind === 'SpiderEnemy';

  const geometry = spider
    ? new THREE.SphereGeometry(profile.radius, 10, 8)
    : new THREE.CapsuleGeometry(
        profile.radius,
        Math.max(0.1, profile.height - profile.radius * 2),
        4,
        10,
      );

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

  if (!spider) return { parts: [mesh], body: mesh, limbs: [] };

  // Eight legs on four pivots a side, hung off the body so they swing with it. Thin boxes
  // rather than anything shaped: what has to read is the *cycle*, and a shadow of eight
  // legs moving in pairs reads at any level of detail.
  const limbs: THREE.Object3D[] = [];
  const legGeometry = new THREE.BoxGeometry(0.05, 0.05, profile.radius * 1.5);
  for (let i = 0; i < 8; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const along = Math.floor(i / 2) - 1.5;

    const pivot = new THREE.Group();
    pivot.position.set(side * profile.radius * 0.7, profile.radius * 0.6, along * profile.radius * 0.4);
    pivot.rotation.z = side * 0.5;

    const leg = new THREE.Mesh(legGeometry, material);
    leg.position.z = profile.radius * 0.6;
    leg.castShadow = true;
    pivot.add(leg);
    limbs.push(pivot);
  }

  return { parts: [mesh, ...limbs], body: mesh, limbs };
}
