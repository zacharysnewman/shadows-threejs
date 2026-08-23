/** Collider generation from Layer 1 (§2, §3.1). */

import { describe, expect, it } from 'vitest';
import { buildColliders, overlapsCollider } from '../src/map/colliders';
import { parseMap, parseTileset } from '../src/map/validate';
import type { GameMap } from '../src/map/types';

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
    '3': { prefab: 'fence_chainlink', solid: true },
  },
});

function mapWithWalls(width: number, height: number, walls: number[]): GameMap {
  return parseMap(
    {
      width,
      height,
      tileSize: 2.0,
      layers: [
        { name: 'Floor', data: new Array(width * height).fill(1) },
        { name: 'Walls', data: walls },
      ],
      entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }],
    },
    tileset,
  );
}

const heights = (id: number) => (id === 3 ? 1.6 : 3.0);

describe('buildColliders', () => {
  it('merges a horizontal wall run into one box', () => {
    const map = mapWithWalls(5, 1, [2, 2, 2, 2, 2]);
    const colliders = buildColliders(map, tileset, heights);

    expect(colliders).toHaveLength(1);
    expect(colliders[0]).toMatchObject({ cx: 5, cz: 1, hx: 5, hz: 1, height: 3 });
  });

  it('merges a rectangular block into one box', () => {
    const map = mapWithWalls(4, 4, [
      0, 0, 0, 0,
      0, 2, 2, 0,
      0, 2, 2, 0,
      0, 0, 0, 0,
    ]);
    const colliders = buildColliders(map, tileset, heights);

    expect(colliders).toHaveLength(1);
    expect(colliders[0]).toMatchObject({ cx: 4, cz: 4, hx: 2, hz: 2, gx0: 1, gy0: 1, gx1: 2, gy1: 2 });
  });

  it('never merges tiles of different ids, so heights stay correct', () => {
    const map = mapWithWalls(4, 1, [2, 2, 3, 3]);
    const colliders = buildColliders(map, tileset, heights);

    expect(colliders).toHaveLength(2);
    expect(colliders.map((c) => c.height).sort()).toEqual([1.6, 3]);
  });

  it('ignores non-solid tiles', () => {
    const map = mapWithWalls(3, 1, [0, 1, 0]);
    expect(buildColliders(map, tileset, heights)).toHaveLength(0);
  });

  it('covers every solid tile exactly once', () => {
    // An L: greedy meshing must split it, and must not double-cover the corner.
    const map = mapWithWalls(3, 3, [
      2, 2, 2,
      2, 0, 0,
      2, 0, 0,
    ]);
    const colliders = buildColliders(map, tileset, heights);

    const covered = new Set<string>();
    for (const c of colliders) {
      for (let y = c.gy0; y <= c.gy1; y += 1) {
        for (let x = c.gx0; x <= c.gx1; x += 1) {
          const key = `${x},${y}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(covered.size).toBe(5);
  });
});

describe('overlapsCollider', () => {
  it('inflates the box by the capsule radius (§3.1)', () => {
    const [collider] = buildColliders(mapWithWalls(1, 1, [2]), tileset, heights);

    expect(overlapsCollider(collider!, 1, 1)).toBe(true);
    expect(overlapsCollider(collider!, 2.2, 1)).toBe(false);
    expect(overlapsCollider(collider!, 2.2, 1, 0.4)).toBe(true);
  });
});
