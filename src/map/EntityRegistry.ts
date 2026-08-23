/**
 * Typed registry of the entity records parsed out of `map.json` (§2).
 *
 * Phase 1 parses and indexes entities but does not spawn them beyond placeholder markers;
 * later phases pull what they need out of here — Phase 5 the enemy spawns, Phase 9 the
 * switches, gates and pick-ups — so nothing downstream re-walks the raw JSON.
 */

import type {
  EntityOfType,
  EntityType,
  EnvironmentLightEntity,
  MapEntity,
  PlayerSpawnEntity,
  PowerSwitchEntity,
} from './types';

export class EntityRegistry {
  private readonly byTypeIndex = new Map<EntityType, MapEntity[]>();
  private readonly byKey = new Map<string, MapEntity>();

  constructor(readonly all: readonly MapEntity[]) {
    for (const entity of all) {
      let bucket = this.byTypeIndex.get(entity.type);
      if (!bucket) {
        bucket = [];
        this.byTypeIndex.set(entity.type, bucket);
      }
      bucket.push(entity);
      this.byKey.set(entity.key, entity);
    }
  }

  get count(): number {
    return this.all.length;
  }

  byType<T extends EntityType>(type: T): EntityOfType<T>[] {
    return (this.byTypeIndex.get(type) ?? []) as EntityOfType<T>[];
  }

  get(key: string): MapEntity | undefined {
    return this.byKey.get(key);
  }

  /** §2 guarantees exactly one; the validator has already rejected maps without it. */
  get playerSpawn(): PlayerSpawnEntity {
    const spawn = this.byType('PlayerSpawn')[0];
    if (!spawn) throw new Error('map has no PlayerSpawn; validation should have rejected it');
    return spawn;
  }

  /** Every environmental light in a group — a switch acts on the whole group at once (§2). */
  lightsInGroup(groupId: string): EnvironmentLightEntity[] {
    return this.byType('EnvironmentLight').filter((light) => light.groupId === groupId);
  }

  /** Every switch pointed at a given light group or gate (§6). */
  switchesTargeting(targetId: string): PowerSwitchEntity[] {
    return this.byType('PowerSwitch').filter((sw) => sw.targetId === targetId);
  }

  /** Type → count, for the debug overlay. */
  countsByType(): Array<[EntityType, number]> {
    return [...this.byTypeIndex.entries()]
      .map(([type, list]) => [type, list.length] as [EntityType, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
}
