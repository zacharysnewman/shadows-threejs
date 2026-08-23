/**
 * Spawning, ticking, and the shared contact check (§2, §5, §5.3).
 *
 * The contact check is here rather than in either AI because §5.3 defines *one* test — an
 * X/Z distance below 1 m against the player's capsule — and two different answers to it.
 * This runs the test and hands it to the enemy that tripped it; what it means is the
 * enemy's own business, which is what stops a spider's cooldown quietly applying to the
 * monster. Listeners get the same event for debug and for the readout.
 *
 * Because the resolvers own their own cooldowns, contact is reported on every tick the
 * overlap holds rather than only on the tick it begins. An edge-triggered check would be
 * cheaper and would drop the second hit of any enemy that stays in contact.
 */

import * as THREE from 'three';
import { ENEMY } from '../config';
import type { Rng } from '../core/rng';
import type { EntityRegistry } from '../map/EntityRegistry';
import type { WalkabilityGrid } from '../map/WalkabilityGrid';
import type { ColliderIndex } from '../player/collision';
import {
  Enemy,
  type EnemyContext,
  type EnemyKind,
  type IlluminationSampler,
  type PlayerActions,
} from './Enemy';
import { ShadowMonster } from './ShadowMonster';
import { Spider } from './Spider';

/** Fired for every enemy overlapping the player, every tick the overlap lasts (§5.3). */
export type ContactListener = (enemy: Enemy, distance: number) => void;

/** Everything outside the enemies that a tick of them depends on. */
export interface EnemyWorld {
  playerX: number;
  playerZ: number;
  /** §4.1 — the shared light query. */
  illumination: IlluminationSampler;
  /** §5.3 — what contact resolves into. */
  player: PlayerActions;
}

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly root = new THREE.Group();

  private readonly listeners = new Set<ContactListener>();
  /** Debug switch; nothing in the game turns the enemies off. */
  private _enabled = true;
  private bodiesRevealed = false;

  constructor(
    registry: EntityRegistry,
    private readonly grid: WalkabilityGrid,
    private readonly colliders: ColliderIndex,
    rng: Rng,
  ) {
    this.root.name = 'Enemies';

    // One RNG stream per enemy, derived from the run seed and the entity's own key, so an
    // enemy's wander is reproducible and independent of how many others exist or of the
    // order they were spawned in (Cross-Cutting: determinism).
    const spawn = (kind: EnemyKind): void => {
      for (const entity of registry.byType(kind)) {
        const stream = rng.stream(entity.key);
        const enemy =
          kind === 'SpiderEnemy'
            ? new Spider(entity.key, entity.wx, entity.wz, stream)
            : new ShadowMonster(entity.key, entity.wx, entity.wz, stream);
        this.enemies.push(enemy);
        this.root.add(enemy.object);
      }
    };
    spawn('SpiderEnemy');
    spawn('ShadowMonster');
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.root.visible = value;
  }

  get count(): number {
    return this.enemies.length;
  }

  /** The Shadow Monsters, for the systems that only concern them (§4.2, §5.2). */
  get monsters(): ShadowMonster[] {
    return this.enemies.filter((enemy): enemy is ShadowMonster => enemy instanceof ShadowMonster);
  }

  /**
   * §5.2 — what the flashlight's rendered intensity should be scaled by, 0–1. The *worst*
   * of the monsters interfering with it: two of them in one beam is not two independent
   * flickers multiplied into darkness, it is whichever is dipping the beam hardest.
   */
  get beamInterference(): number {
    let worst = 1;
    for (const monster of this.monsters) worst = Math.min(worst, monster.beamFraction);
    return worst;
  }

  /** Where the monsters are, for §4.2's sabotage dwell. */
  monsterPositions(): { x: number; z: number }[] {
    return this.monsters.map((monster) => ({ x: monster.position.x, z: monster.position.y }));
  }

  /** How many are hunting rather than drifting — the readout's headline number. */
  get engagedCount(): number {
    return this.enemies.filter((enemy) => enemy.engaged).length;
  }

  countsByState(): string {
    const counts = new Map<string, number>();
    for (const enemy of this.enemies) {
      counts.set(enemy.state, (counts.get(enemy.state) ?? 0) + 1);
    }
    return [...counts].map(([state, n]) => `${state}×${n}`).join(' ');
  }

  /** Whether the debug harness is currently drawing the bodies §5.2 keeps invisible. */
  get bodiesShown(): boolean {
    return this.bodiesRevealed;
  }

  /** Debug harness: draw the bodies §5.2 keeps invisible. Returns the new state. */
  toggleRevealBodies(): boolean {
    this.bodiesRevealed = !this.bodiesRevealed;
    for (const enemy of this.enemies) enemy.setBodyRevealed(this.bodiesRevealed);
    return this.bodiesRevealed;
  }

  onContact(listener: ContactListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One simulation tick for every enemy, then the contact check (§7). */
  tick(dt: number, world: EnemyWorld): void {
    if (!this._enabled) return;

    const context: EnemyContext = {
      playerX: world.playerX,
      playerZ: world.playerZ,
      grid: this.grid,
      colliders: this.colliders,
      neighbours: this.enemies,
      illumination: world.illumination,
      player: world.player,
    };

    for (const enemy of this.enemies) enemy.tick(dt, context);

    for (const enemy of this.enemies) {
      const distance = enemy.distanceTo(world.playerX, world.playerZ);
      if (distance >= ENEMY.contactDistance) continue;
      enemy.onPlayerContact(distance, context);
      for (const listener of this.listeners) listener(enemy, distance);
    }
  }

  render(alpha: number): void {
    for (const enemy of this.enemies) enemy.render(alpha);
  }

  dispose(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies.length = 0;
    this.listeners.clear();
    this.root.removeFromParent();
  }
}
