/**
 * Box collider generation from Layer 1 (§2, §3.1).
 *
 * Solid tiles are greedily merged into the largest axis-aligned rectangles that share a
 * tile id, so a 20-tile wall run is one collider rather than twenty. Phase 2 resolves the
 * player capsule against these by sliding along contact normals, and fewer, larger boxes
 * mean fewer interior seams for a capsule to catch on — the merge is a correctness win,
 * not only a performance one.
 *
 * Merging is per tile id rather than per solidity so prefabs of different heights (a wall
 * versus a chain-link fence) never collapse into one box with the wrong extent.
 */

import { MAP_LIMITS } from '../config';
import type { BoxCollider, GameMap, Tileset } from './types';

export type TileHeightResolver = (tileId: number) => number;

export function buildColliders(
  map: GameMap,
  tileset: Tileset,
  heightFor: TileHeightResolver,
): BoxCollider[] {
  const layer = map.layers[MAP_LIMITS.obstacleLayerIndex];
  if (!layer) return [];

  const { width, height, tileSize } = map;
  const consumed = new Uint8Array(width * height);
  const colliders: BoxCollider[] = [];

  const idAt = (x: number, y: number): number => layer.data[y * width + x] ?? 0;
  const isSolid = (id: number): boolean => tileset.get(id)?.solid === true;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (consumed[i] === 1) continue;

      const id = idAt(x, y);
      if (!isSolid(id)) continue;

      // Extend right along matching, unconsumed tiles.
      let x1 = x;
      while (x1 + 1 < width && consumed[y * width + x1 + 1] !== 1 && idAt(x1 + 1, y) === id) {
        x1 += 1;
      }

      // Extend down while the whole span still matches.
      let y1 = y;
      outer: while (y1 + 1 < height) {
        for (let sx = x; sx <= x1; sx += 1) {
          if (consumed[(y1 + 1) * width + sx] === 1 || idAt(sx, y1 + 1) !== id) break outer;
        }
        y1 += 1;
      }

      for (let sy = y; sy <= y1; sy += 1) {
        for (let sx = x; sx <= x1; sx += 1) consumed[sy * width + sx] = 1;
      }

      const tilesWide = x1 - x + 1;
      const tilesTall = y1 - y + 1;
      colliders.push({
        cx: (x + tilesWide / 2) * tileSize,
        cz: (y + tilesTall / 2) * tileSize,
        hx: (tilesWide * tileSize) / 2,
        hz: (tilesTall * tileSize) / 2,
        height: heightFor(id),
        gx0: x,
        gy0: y,
        gx1: x1,
        gy1: y1,
      });
    }
  }

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
