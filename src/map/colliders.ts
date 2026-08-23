/**
 * Box collider generation (§2, §3.1).
 *
 * Two things stop the player, and both are boxes:
 *
 * - **Layer 1 obstacles.** Solid tiles are greedily merged into the largest axis-aligned
 *   rectangles that share a tile id, so a 20-tile wall run is one collider rather than
 *   twenty. Phase 2 resolves the player capsule against these by sliding along contact
 *   normals, and fewer, larger boxes mean fewer interior seams for a capsule to catch on —
 *   the merge is a correctness win, not only a performance one. Merging is per tile id
 *   rather than per solidity so prefabs of different heights (a wall versus a chain-link
 *   fence) never collapse into one box with the wrong extent.
 * - **Holes in Layer 0.** A tile with no floor is unwalkable (§2) but has no obstacle to
 *   generate a collider from, so it needs one of its own — otherwise the player would walk
 *   out over a void that enemies cannot path onto, standing on nothing.
 */

import { MAP_LIMITS } from '../config';
import type { BoxCollider, GameMap, Tileset } from './types';

export type TileHeightResolver = (tileId: number) => number;

/** Nominal height for a hole's collider. It is a barrier, not geometry: low, for the overlay. */
const GAP_COLLIDER_HEIGHT = 0.5;

/**
 * Greedy rectangle merge over the tile grid.
 *
 * `keyAt` returns the key a tile merges on, or `null` for a tile that generates nothing.
 * Adjacent tiles merge only when their keys match, which is what keeps a fence out of a
 * wall's box.
 */
function mergeRegions(
  width: number,
  height: number,
  keyAt: (x: number, y: number) => number | null,
  emit: (x0: number, y0: number, x1: number, y1: number, key: number) => void,
): void {
  const consumed = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (consumed[i] === 1) continue;

      const key = keyAt(x, y);
      if (key === null) continue;

      // Extend right along matching, unconsumed tiles.
      let x1 = x;
      while (x1 + 1 < width && consumed[y * width + x1 + 1] !== 1 && keyAt(x1 + 1, y) === key) {
        x1 += 1;
      }

      // Extend down while the whole span still matches.
      let y1 = y;
      outer: while (y1 + 1 < height) {
        for (let sx = x; sx <= x1; sx += 1) {
          if (consumed[(y1 + 1) * width + sx] === 1 || keyAt(sx, y1 + 1) !== key) break outer;
        }
        y1 += 1;
      }

      for (let sy = y; sy <= y1; sy += 1) {
        for (let sx = x; sx <= x1; sx += 1) consumed[sy * width + sx] = 1;
      }

      emit(x, y, x1, y1, key);
    }
  }
}

function boxFor(
  map: GameMap,
  kind: BoxCollider['kind'],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  height: number,
): BoxCollider {
  const tilesWide = x1 - x0 + 1;
  const tilesTall = y1 - y0 + 1;
  return {
    kind,
    cx: (x0 + tilesWide / 2) * map.tileSize,
    cz: (y0 + tilesTall / 2) * map.tileSize,
    hx: (tilesWide * map.tileSize) / 2,
    hz: (tilesTall * map.tileSize) / 2,
    height,
    gx0: x0,
    gy0: y0,
    gx1: x1,
    gy1: y1,
  };
}

export function buildColliders(
  map: GameMap,
  tileset: Tileset,
  heightFor: TileHeightResolver,
): BoxCollider[] {
  const layer = map.layers[MAP_LIMITS.obstacleLayerIndex];
  if (!layer) return [];

  const { width, height } = map;
  const colliders: BoxCollider[] = [];

  const idAt = (x: number, y: number): number => layer.data[y * width + x] ?? 0;

  mergeRegions(
    width,
    height,
    (x, y) => {
      const id = idAt(x, y);
      return tileset.get(id)?.solid === true ? id : null;
    },
    (x0, y0, x1, y1, id) => {
      colliders.push(boxFor(map, 'obstacle', x0, y0, x1, y1, heightFor(id)));
    },
  );

  return colliders;
}

/**
 * Colliders for tiles with no floor (§2's other half of the walkability rule).
 *
 * Solid tiles are excluded because `buildColliders` has already covered them: a wall built
 * on a floorless tile is one box, not two overlapping ones.
 */
export function buildFloorGapColliders(map: GameMap, tileset: Tileset): BoxCollider[] {
  const floor = map.layers[MAP_LIMITS.floorLayerIndex];
  if (!floor) return [];
  const obstacles = map.layers[MAP_LIMITS.obstacleLayerIndex];

  const { width, height } = map;
  const colliders: BoxCollider[] = [];

  mergeRegions(
    width,
    height,
    (x, y) => {
      const i = y * width + x;
      if ((floor.data[i] ?? 0) !== 0) return null;
      const obstacleId = obstacles ? obstacles.data[i] ?? 0 : 0;
      return tileset.get(obstacleId)?.solid === true ? null : 1;
    },
    (x0, y0, x1, y1) => {
      colliders.push(boxFor(map, 'gap', x0, y0, x1, y1, GAP_COLLIDER_HEIGHT));
    },
  );

  return colliders;
}

/** Point-in-box test on the X/Z plane, inflated by `radius` (the player capsule, §3.1). */
export function overlapsCollider(
  collider: BoxCollider,
  wx: number,
  wz: number,
  radius = 0,
): boolean {
  return (
    Math.abs(wx - collider.cx) <= collider.hx + radius &&
    Math.abs(wz - collider.cz) <= collider.hz + radius
  );
}
