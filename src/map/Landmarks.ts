/**
 * Landmarks (§2) — decoration you navigate by.
 *
 * The middle of §2's three tiers, and the one that exists because a tile cannot do it. A
 * tile is 2 m and has no rotation; a goal is 3 m, a net is 10.7 m, and neither faces the
 * same way twice. So a landmark is an entity: continuous position, free rotation, one
 * model of whatever size the art is.
 *
 * **The footprint comes from the art.** The prefab's own bounding box, in the metres it was
 * authored in, rotated and handed to the collider pass. The alternative — a number in a
 * table beside each prefab name — is right until somebody swaps the model, and then it is
 * silently wrong in a way nothing can catch. Deriving it means the collision follows the
 * mesh, always.
 *
 * Two honest limits, both spelled out rather than hidden:
 *
 * - **Colliders are axis-aligned** (`BoxCollider`), so a rotated landmark contributes the
 *   axis-aligned box that *contains* its rotated footprint. Exact at quarter turns, which
 *   is what a stamp places (§9.4) and what most authoring does; conservative in between,
 *   where it blocks a little more ground than the model covers. Oriented boxes would mean
 *   changing how everything in §3.1 resolves collision, for an accuracy nobody has yet
 *   asked for.
 * - **The walkability grid blocks any tile the footprint touches at all**, rather than the
 *   tiles it mostly covers. The two have to agree or enemies path into geometry the
 *   collider then refuses them, and being generous to the grid is the safe direction to be
 *   wrong in: an enemy walks around slightly more than it had to, instead of walking into a
 *   wall and staying there.
 */

import * as THREE from 'three';
import { PREFAB_FOOTPRINT } from '../config';
import type { AssetLoader, Prefab } from '../core/AssetLoader';
import type { BoxCollider, GameMap, LandmarkEntity } from './types';

export interface Landmark {
  entity: LandmarkEntity;
  mesh: THREE.Mesh;
  collider: BoxCollider;
  /** Tile indices the footprint touches, for the walkability grid. */
  blocked: number[];
}

export interface LandmarkSet {
  landmarks: Landmark[];
  root: THREE.Group;
  /** Prefab names named by a landmark that could not be loaded (§2 — skipped, not boxed). */
  missing: string[];
  colliders: BoxCollider[];
  /** Every tile index any landmark blocks. */
  blocked: number[];
  dispose(): void;
}

/**
 * Half-extents of the axis-aligned box containing a rotated one.
 *
 * `|cos|` and `|sin|` rather than the signed values: a box rotated 190° covers the same
 * ground as one rotated 10°, and a signed projection would give one of them negative
 * extents.
 */
export function rotatedHalfExtents(
  hx: number,
  hz: number,
  rotationDegrees: number,
): { hx: number; hz: number } {
  const radians = THREE.MathUtils.degToRad(rotationDegrees);
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { hx: hx * cos + hz * sin, hz: hx * sin + hz * cos };
}

/**
 * The ground half-extents a prefab contributes, before rotation.
 *
 * `PREFAB_FOOTPRINT` overrides the mesh where the mesh lies — a basketball hoop's backboard
 * overhangs ground a player can walk under, and its bounds would block a square of empty
 * yard nobody can see a reason for (§2).
 */
export function prefabHalfExtents(prefab: Prefab): { hx: number; hz: number } {
  const override = PREFAB_FOOTPRINT[prefab.name];
  if (override) return { hx: override.hx, hz: override.hz };

  prefab.geometry.computeBoundingBox();
  const box = prefab.geometry.boundingBox;
  if (!box) return { hx: 0.5, hz: 0.5 };
  return { hx: (box.max.x - box.min.x) / 2, hz: (box.max.z - box.min.z) / 2 };
}

/** Every tile index a world-space box touches, clamped to the map. */
export function tilesUnder(
  map: GameMap,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
): number[] {
  const size = map.tileSize;
  const gx0 = Math.max(0, Math.floor((cx - hx) / size));
  const gx1 = Math.min(map.width - 1, Math.floor((cx + hx) / size));
  const gy0 = Math.max(0, Math.floor((cz - hz) / size));
  const gy1 = Math.min(map.height - 1, Math.floor((cz + hz) / size));

  const out: number[] = [];
  for (let gy = gy0; gy <= gy1; gy += 1) {
    for (let gx = gx0; gx <= gx1; gx += 1) out.push(gy * map.width + gx);
  }
  return out;
}

/**
 * Build every `Landmark` entity on the map.
 *
 * Prefabs are loaded once each however many landmarks name them, through the same cache
 * the tiles use — five goals is one load and five meshes.
 */
export async function buildLandmarks(
  map: GameMap,
  entities: readonly LandmarkEntity[],
  loader: AssetLoader,
): Promise<LandmarkSet> {
  const root = new THREE.Group();
  root.name = 'Landmarks';

  const names = [...new Set(entities.map((entity) => entity.prefab))];
  const loaded = new Map<string, Prefab>();
  await Promise.all(
    names.map(async (name) => {
      loaded.set(name, await loader.load(name, map.tileSize));
    }),
  );

  const landmarks: Landmark[] = [];
  const missing: string[] = [];
  const disposables: THREE.Mesh[] = [];

  for (const entity of entities) {
    const prefab = loaded.get(entity.prefab);
    // §2 — a landmark whose prefab is missing is skipped rather than boxed. Everywhere else
    // a placeholder keeps a map legible while the art lands; here the whole job is being
    // recognisable, and an anonymous grey box is a distinctive thing that is not
    // distinctive — worse than nothing standing there.
    if (!prefab || prefab.placeholder) {
      if (!missing.includes(entity.prefab)) missing.push(entity.prefab);
      continue;
    }

    const mesh = new THREE.Mesh(prefab.geometry, prefab.material);
    mesh.name = `Landmark:${entity.prefab}`;
    mesh.position.set(entity.wx, 0, entity.wz);
    mesh.rotation.y = THREE.MathUtils.degToRad(entity.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    disposables.push(mesh);

    const local = prefabHalfExtents(prefab);
    const { hx, hz } = rotatedHalfExtents(local.hx, local.hz, entity.rotation);
    const blocked = tilesUnder(map, entity.wx, entity.wz, hx, hz);
    const collider: BoxCollider = {
      kind: 'obstacle',
      cx: entity.wx,
      cz: entity.wz,
      hx,
      hz,
      height: prefab.height,
      gx0: Math.max(0, Math.floor((entity.wx - hx) / map.tileSize)),
      gy0: Math.max(0, Math.floor((entity.wz - hz) / map.tileSize)),
      gx1: Math.min(map.width - 1, Math.floor((entity.wx + hx) / map.tileSize)),
      gy1: Math.min(map.height - 1, Math.floor((entity.wz + hz) / map.tileSize)),
    };

    landmarks.push({ entity, mesh, collider, blocked });
  }

  return {
    landmarks,
    root,
    missing,
    colliders: landmarks.map((landmark) => landmark.collider),
    blocked: [...new Set(landmarks.flatMap((landmark) => landmark.blocked))],
    dispose() {
      // The geometry and material belong to the `AssetLoader`'s cache and are shared with
      // every other landmark of the same prefab; disposing them here would take the kit
      // down with one landmark.
      for (const mesh of disposables) mesh.removeFromParent();
      root.clear();
      root.removeFromParent();
    },
  };
}
