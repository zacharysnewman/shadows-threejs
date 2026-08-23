/**
 * Map pipeline entry point (§2): fetch → validate → build.
 *
 * A map lives in a directory containing `map.json` and its companion `tileset.json`, and
 * `loadMap` returns everything the rest of the game asks of a level: the checked data, the
 * static scene graph, the collider set, the walkability grid and the entity registry.
 */

import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { buildColliders } from './colliders';
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
  colliders: readonly BoxCollider[];
  grid: WalkabilityGrid;
  entities: EntityRegistry;
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

export async function loadMap(directory: string, loader: AssetLoader): Promise<LoadedMap> {
  const dir = directory.endsWith('/') ? directory : `${directory}/`;

  const [rawTileset, rawMap] = await Promise.all([
    fetchJson(`${dir}tileset.json`),
    fetchJson(`${dir}map.json`),
  ]);

  const tileset = parseTileset(rawTileset, `${dir}tileset.json`);
  const data = parseMap(rawMap, tileset, `${dir}map.json`);

  for (const warning of data.warnings) {
    console.warn(`[map] ${dir}map.json — ${warning}`);
  }

  const geometry = await buildMapGeometry(data, tileset, loader);
  // Colliders take their height from the prefab that was actually instanced, so a debug
  // box always matches the geometry the player will hit.
  const colliders = buildColliders(data, tileset, (id) => geometry.tileHeights.get(id) ?? 3);
  const grid = new WalkabilityGrid(data, tileset);
  const entities = new EntityRegistry(data.entities);

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
    root: geometry.root,
    bounds,
    dispose() {
      geometry.dispose();
    },
  };
}
