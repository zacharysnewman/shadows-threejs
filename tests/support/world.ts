/**
 * Shared scaffolding for the enemy tests: a map built from an ASCII sketch, and stand-ins
 * for the two things an enemy reaches outside itself for — the light query (§4.1) and the
 * player (§5.3). Both are interfaces precisely so this can exist: none of §5's arithmetic
 * needs a scene, a GPU or a flashlight to be exercised.
 */

import type {
  Enemy,
  EnemyContext,
  IlluminationSampler,
  PlayerActions,
} from '../../src/enemies/Enemy';
import { EntityRegistry } from '../../src/map/EntityRegistry';
import { buildColliders } from '../../src/map/colliders';
import { parseMap, parseTileset } from '../../src/map/validate';
import { WalkabilityGrid } from '../../src/map/WalkabilityGrid';
import { ColliderIndex } from '../../src/player/collision';

export const TILE = 2;
export const TICK = 1 / 60;

export const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/** ASCII sketch: `#` wall, everything else open floor. */
export function world(rows: string[], entities: unknown[] = [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }]) {
  const width = rows[0]!.length;
  const height = rows.length;
  const floor: number[] = [];
  const walls: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      floor.push(1);
      walls.push(cell === '#' ? 2 : 0);
    }
  }

  const map = parseMap(
    {
      width,
      height,
      tileSize: TILE,
      layers: [
        { name: 'Floor', data: floor },
        { name: 'Walls', data: walls },
      ],
      entities,
    },
    tileset,
  );

  const grid = new WalkabilityGrid(map, tileset);
  const colliders = new ColliderIndex(
    buildColliders(map, tileset, () => 3),
    width,
    height,
    TILE,
  );
  return { map, grid, colliders, registry: new EntityRegistry(map.entities) };
}

/**
 * A light query that answers whatever the test wants; the dark is the default. The source
 * matters to §5.2 — a monster under a lamp behaves differently to one in the beam — so it
 * is settable too.
 */
export function fakeIllumination(
  lit: () => boolean = () => false,
  source: () => 'flashlight' | 'environment' = () => 'flashlight',
) {
  return {
    sample: () => ({ lit: lit(), amount: lit() ? 1 : 0, source: lit() ? source() : null }),
  };
}

/** A player that records what was done to it, for §5.3's two answers. */
export function fakePlayer() {
  return {
    damaged: [] as number[],
    shoves: [] as { fromX: number; fromZ: number; metres: number }[],
    kills: 0,
    damage(amount: number): boolean {
      this.damaged.push(amount);
      return false;
    },
    knockBack(fromX: number, fromZ: number, metres: number): void {
      this.shoves.push({ fromX, fromZ, metres });
    },
    kill(): void {
      this.kills += 1;
    },
  };
}


/** The world an enemy is ticked against, dark and with an inert player unless asked. */
export function contextFor(
  built: ReturnType<typeof world>,
  playerX: number,
  playerZ: number,
  options: {
    neighbours?: Enemy[];
    illumination?: IlluminationSampler;
    player?: PlayerActions;
  } = {},
): EnemyContext {
  return {
    playerX,
    playerZ,
    grid: built.grid,
    colliders: built.colliders,
    neighbours: options.neighbours ?? [],
    illumination: options.illumination ?? fakeIllumination(),
    player: options.player ?? fakePlayer(),
  };
}

/** Advance an enemy for `seconds` of simulation against a fixed world. */
export function run(enemy: Enemy, context: EnemyContext, seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) enemy.tick(TICK, context);
}

/** A light the test can switch on and off between ticks, and re-source (§4.1, §5.2). */
export function beam(on = false, source: 'flashlight' | 'environment' = 'flashlight') {
  const state = {
    on,
    source,
    sample: () => ({
      lit: state.on,
      amount: state.on ? 1 : 0,
      source: state.on ? state.source : null,
    }),
  };
  return state;
}
