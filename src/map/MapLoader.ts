/**
 * Map pipeline entry point (§2): fetch → validate → build.
 *
 * A map lives in a directory containing `map.json` and its companion `tileset.json`, and
 * `loadMap` returns everything the rest of the game asks of a level: the checked data, the
 * static scene graph, the collider set, the walkability grid and the entity registry.
 */

import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { buildColliders, buildFloorGapColliders } from './colliders';
import { buildLandmarks, type LandmarkSet } from './Landmarks';
import { EntityRegistry } from './EntityRegistry';
import { buildMapGeometry, type MapGeometry } from './MapGeometry';
import { parseMap, parseTileset } from './validate';
import type { BoxCollider, GameMap, Tileset } from './types';
import { WalkabilityGrid } from './WalkabilityGrid';

export interface LoadedMap {
  /** Directory the map was loaded from, for diagnostics. */
  source: string;
  data: GameMap;
  tileset: Tileset;
  geometry: MapGeometry;
  /** Everything that blocks movement: Layer 1 obstacles and Layer 0 holes (§3.1). */
  colliders: readonly BoxCollider[];
  grid: WalkabilityGrid;
  entities: EntityRegistry;
  /** §2 — the map's landmarks, their meshes and their footprints. */
  landmarks: LandmarkSet;
  /** Static geometry root; add this to the scene. */
  root: THREE.Group;
  /** Map extent in world space, for camera clamping (§3.2). */
  bounds: THREE.Box3;
  dispose(): void;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * `rawMapOverride` is a map that did not come from a URL — the editor handing a level
 * straight to the game (§9.3). The tileset still comes from `directory`, because a level
 * being playtested is authored against the same tiles as every other level.
 */
export async function loadMap(
  directory: string,
  loader: AssetLoader,
  rawMapOverride?: unknown,
): Promise<LoadedMap> {
  const dir = directory.endsWith('/') ? directory : `${directory}/`;

  const [rawTileset, rawMap] = await Promise.all([
    fetchJson(`${dir}tileset.json`),
    rawMapOverride === undefined ? fetchJson(`${dir}map.json`) : Promise.resolve(rawMapOverride),
  ]);

  const tileset = parseTileset(rawTileset, `${dir}tileset.json`);
  const data = parseMap(rawMap, tileset, `${dir}map.json`);

  for (const warning of data.warnings) {
    console.warn(`[map] ${dir}map.json — ${warning}`);
  }

  const geometry = await buildMapGeometry(data, tileset, loader);
  const entities = new EntityRegistry(data.entities);

  // §2 — landmarks are the one piece of static geometry that is not a tile, so they are
  // built here rather than in `buildMapGeometry`: they come from the entity list, and their
  // footprints have to exist before the colliders and the grid are derived.
  const landmarks = await buildLandmarks(data, entities.byType('Landmark'), loader);
  landmarks.root.name = 'Landmarks';
  geometry.root.add(landmarks.root);
  for (const name of landmarks.missing) {
    const warning = `landmark prefab "${name}" is missing; those landmarks are skipped`;
    data.warnings.push(warning);
    console.warn(`[map] ${dir}map.json — ${warning}`);
  }

  // Colliders take their height from the prefab that was actually instanced, so a debug
  // box always matches the geometry the player will hit. Holes in the floor get barriers
  // of their own (§2, §3.1): they are unwalkable, and what is unwalkable for pathfinding
  // has to stop the player too, or the player can cross ground no enemy can follow onto.
  const colliders = [
    ...buildColliders(data, tileset, (id) => geometry.tileHeights.get(id) ?? 3),
    ...buildFloorGapColliders(data, tileset),
    ...landmarks.colliders,
  ];
  // The grid takes the landmarks' tiles as *static* blockers, so what the pathfinder
  // refuses and what the colliders refuse are the same ground (§2).
  const grid = new WalkabilityGrid(data, tileset, landmarks.blocked);

  // Anything that has to stand somewhere is worth checking against the derived grid: an
  // enemy spawned inside a wall has no path out, and it is far cheaper to catch here than
  // in Phase 5. Gates and switches are exempt — they are meant to sit on solid tiles.
  for (const entity of entities.all) {
    if (entity.type !== 'PlayerSpawn' && entity.type !== 'SpiderEnemy' && entity.type !== 'ShadowMonster') {
      continue;
    }
    if (!grid.isWalkable(entity.gx, entity.gy)) {
      const warning = `entity ${entity.index} (${entity.type}): tile (${entity.gx}, ${entity.gy}) is not walkable`;
      data.warnings.push(warning);
      console.warn(`[map] ${dir}map.json — ${warning}`);
    }
  }

  const bounds = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(data.width * data.tileSize, 0, data.height * data.tileSize),
  );

  return {
    source: dir,
    data,
    tileset,
    geometry,
    colliders,
    grid,
    entities,
    landmarks,
    root: geometry.root,
    bounds,
    dispose() {
      landmarks.dispose();
      geometry.dispose();
      // `MapGeometry.dispose` empties the group; taking it out of the scene is the
      // caller's, and a run that leaves it behind leaves an empty group per life.
      geometry.root.removeFromParent();
    },
  };
}
