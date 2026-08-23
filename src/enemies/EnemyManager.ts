/**
 * Spawning, ticking, and the shared contact check (§2, §5, §5.3).
 *
 * The contact check is here rather than in either AI because §5.3 defines *one* test — an
 * X/Z distance below 1 m against the player's capsule — and two different answers to it.
 * This reports the condition and nothing else; Phase 7 turns it into damage, knockback and
 * a 1.5 s per-attacker cooldown, and Phase 8 turns it into death. Keeping the consequence
 * out of here is what stops a spider's cooldown quietly applying to the monster.
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
import { Enemy, ENEMY_PROFILES, type EnemyKind } from './Enemy';

/** Fired for every enemy overlapping the player, every tick the overlap lasts (§5.3). */
export type ContactListener = (enemy: Enemy, distance: number) => void;

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  readonly root = new THREE.Group();

  private readonly listeners = new Set<ContactListener>();
  /** Debug switch; nothing in the game turns the enemies off. */
  private _enabled = true;

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
        const enemy = new Enemy(
          ENEMY_PROFILES[kind],
          entity.key,
          entity.wx,
          entity.wz,
          rng.stream(entity.key),
        );
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

  onContact(listener: ContactListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One simulation tick for every enemy, then the contact check (§7). */
  tick(dt: number, playerX: number, playerZ: number): void {
    if (!this._enabled) return;

    const context = {
      playerX,
      playerZ,
      grid: this.grid,
      colliders: this.colliders,
      neighbours: this.enemies,
    };

    for (const enemy of this.enemies) enemy.tick(dt, context);

    for (const enemy of this.enemies) {
      const distance = enemy.distanceTo(playerX, playerZ);
      if (distance >= ENEMY.contactDistance) continue;
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
