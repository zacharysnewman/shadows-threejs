/**
 * Static geometry construction for Layers 0 and 1 (§2, §7).
 *
 * §7 is explicit that a 50×50 map must not be 2,500 draw calls, so every tile that shares
 * a prefab is drawn as one `InstancedMesh`. That gives one draw call per (layer, prefab)
 * pair — a handful for a whole level — and keeps per-tile transforms available should a
 * later phase need to address an individual tile.
 */

import * as THREE from 'three';
import type { AssetLoader, Prefab } from '../core/AssetLoader';
import { MAP_LIMITS } from '../config';
import type { GameMap, Tileset } from './types';

/**
 * §2 — is this module a *length* of something, or a thing that stands on its own?
 *
 * Read off the fitted footprint rather than named in a table: a wall, a fence and a gate
 * are all modelled as a 2 m run across x with only enough depth to be solid, and a crate is
 * square. `runFraction` is how much narrower than long a module has to be before it counts
 * — three-quarters, so an all-but-square module is left alone and a 2 × 1 wall is not.
 */
const RUN_FRACTION = 0.75;

export function isRun(footprint: { x: number; z: number }): boolean {
  return footprint.z < footprint.x * RUN_FRACTION;
}

/**
 * The turn a run-shaped tile needs to follow the run it is in, in radians (§2).
 *
 * Tiles carry no rotation in the map format and are not getting one — a rotating tile in
 * the *data* would break the collider merge and would be a field every author had to get
 * right. This is derived instead, from the solid tiles beside it, and it is presentation
 * only: the tile is solid across its whole square whichever way the model faces, so nothing
 * about collision, walkability or the merge can see it.
 *
 * A module with solid neighbours north or south and none east or west is in a north–south
 * run and turns a quarter. Everything else — a run across x, a corner, a tile on its own —
 * keeps the way it was modelled, which is the direction the kit authored it in.
 */
export function runRotation(
  isSolidAt: (gx: number, gy: number) => boolean,
  gx: number,
  gy: number,
): number {
  const alongX = isSolidAt(gx - 1, gy) || isSolidAt(gx + 1, gy);
  const alongZ = isSolidAt(gx, gy - 1) || isSolidAt(gx, gy + 1);
  return alongZ && !alongX ? Math.PI / 2 : 0;
}

/**
 * A handle on one tile's instance in the batch that drew it, so a gate can be moved (§6).
 * Only the obstacle layer is indexed: nothing in the game animates a floor tile, and an
 * index over every tile on a 50×50 map would be 2500 entries nobody reads.
 */
export interface TileInstance {
  mesh: THREE.InstancedMesh;
  instance: number;
  /** The matrix the tile was built with, so a transform can be composed from rest. */
  rest: THREE.Matrix4;
}

export interface MapGeometry {
  root: THREE.Group;
  /** One per (layer, prefab) pair — this is the draw-call count for static geometry. */
  instancedMeshCount: number;
  /** Total tiles instanced across all layers. */
  instanceCount: number;
  /** Tile id → prefab height, so collider extents match what is drawn. */
  tileHeights: Map<number, number>;
  /** Obstacle-layer tile index → its instance, for the few tiles that move (§6). */
  obstacleInstances: Map<number, TileInstance>;
  /** Re-place one obstacle tile. The only thing in the map that is not static. */
  setObstacleTransform(tileIndex: number, transform: THREE.Matrix4): void;
  /** Prefab names that fell back to a placeholder box. */
  placeholders: string[];
  dispose(): void;
}

export async function buildMapGeometry(
  map: GameMap,
  tileset: Tileset,
  loader: AssetLoader,
): Promise<MapGeometry> {
  // Gather the tile ids actually used, per layer, before touching the asset loader — a
  // map that never places `wall_brick` should not pay to load it.
  const usage: Array<Map<number, number[]>> = map.layers.map(() => new Map());
  map.layers.forEach((layer, layerIndex) => {
    const perId = usage[layerIndex]!;
    for (let i = 0; i < layer.data.length; i += 1) {
      const id = layer.data[i] ?? 0;
      if (id === 0) continue;
      if (!tileset.get(id)?.prefab) continue;
      let list = perId.get(id);
      if (!list) {
        list = [];
        perId.set(id, list);
      }
      list.push(i);
    }
  });

  const prefabNames = new Set<string>();
  for (const perId of usage) {
    for (const id of perId.keys()) {
      const prefab = tileset.get(id)?.prefab;
      if (prefab) prefabNames.add(prefab);
    }
  }

  const prefabs = new Map<string, Prefab>();
  await Promise.all(
    [...prefabNames].map(async (name) => {
      prefabs.set(name, await loader.load(name, map.tileSize));
    }),
  );

  const root = new THREE.Group();
  root.name = 'MapStatic';
  const tileHeights = new Map<number, number>();
  const obstacleInstances = new Map<number, TileInstance>();
  const disposables: Array<{ dispose(): void }> = [];
  let instancedMeshCount = 0;
  let instanceCount = 0;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Matrix4();

  /**
   * §2 — a tile is solid when its obstacle-layer id is one the tileset calls solid. This is
   * the same question the walkability derivation asks, asked here about the neighbours a
   * run-shaped module has to line up with.
   */
  const obstacles = map.layers[MAP_LIMITS.obstacleLayerIndex];
  const isSolidAt = (gx: number, gy: number): boolean => {
    if (!obstacles || gx < 0 || gy < 0 || gx >= map.width || gy >= map.height) return false;
    const id = obstacles.data[gy * map.width + gx] ?? 0;
    return id !== 0 && tileset.get(id)?.solid === true;
  };

  map.layers.forEach((layer, layerIndex) => {
    const perId = usage[layerIndex]!;
    if (perId.size === 0) return;

    const group = new THREE.Group();
    group.name = `Layer${layerIndex}:${layer.name}`;
    root.add(group);

    const isFloor = layerIndex === MAP_LIMITS.floorLayerIndex;

    for (const [id, indices] of perId) {
      const name = tileset.get(id)?.prefab;
      const prefab = name ? prefabs.get(name) : undefined;
      if (!prefab) continue;

      tileHeights.set(id, prefab.height);

      const mesh = new THREE.InstancedMesh(prefab.geometry, prefab.material, indices.length);
      mesh.name = `${layer.name}:${prefab.name}`;
      // Static geometry never moves, so skip the per-frame matrix upload.
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      // §7 — the floor only receives; upright geometry both casts and receives, because
      // the flashlight's floor shadows are the mechanic.
      mesh.castShadow = !isFloor;
      mesh.receiveShadow = true;

      // §2 — only a length of something has a way round to be wrong; a crate does not.
      const turns = !isFloor && isRun(prefab.footprint);

      indices.forEach((tileIndex, instance) => {
        const gx = tileIndex % map.width;
        const gy = Math.floor(tileIndex / map.width);
        matrix.makeTranslation((gx + 0.5) * map.tileSize, 0, (gy + 0.5) * map.tileSize);
        if (turns) {
          matrix.multiply(rotation.makeRotationY(runRotation(isSolidAt, gx, gy)));
        }
        mesh.setMatrixAt(instance, matrix);
        if (!isFloor) {
          obstacleInstances.set(tileIndex, { mesh, instance, rest: matrix.clone() });
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();

      group.add(mesh);
      disposables.push(mesh);
      instancedMeshCount += 1;
      instanceCount += indices.length;
    }
  });

  const placeholders = [...prefabs.values()].filter((p) => p.placeholder).map((p) => p.name);

  return {
    root,
    instancedMeshCount,
    instanceCount,
    tileHeights,
    obstacleInstances,
    setObstacleTransform(tileIndex, transform) {
      const handle = obstacleInstances.get(tileIndex);
      if (!handle) return;
      handle.mesh.setMatrixAt(handle.instance, transform);
      handle.mesh.instanceMatrix.needsUpdate = true;
      // The batch's bounds were computed for tiles that never moved; a gate swinging out
      // of its tile can otherwise be culled while it is on screen.
      handle.mesh.computeBoundingSphere();
    },
    placeholders,
    dispose() {
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}
