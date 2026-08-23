/** Walkability derivation and runtime flips (§2, §6). */

import { describe, expect, it, vi } from 'vitest';
import { parseMap, parseTileset } from '../src/map/validate';
import { WalkabilityGrid } from '../src/map/WalkabilityGrid';

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/**
 * 3×3. Centre tile is a wall (blocked by Layer 1); the top-right tile has no floor
 * (blocked by Layer 0). Between them they cover both halves of §2's walkability rule.
 */
function grid(): WalkabilityGrid {
  const map = parseMap(
    {
      width: 3,
      height: 3,
      tileSize: 2.0,
      layers: [
        { name: 'Floor', data: [1, 1, 0, 1, 1, 1, 1, 1, 1] },
        { name: 'Walls', data: [0, 0, 0, 0, 2, 0, 0, 0, 0] },
      ],
      entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }],
    },
    tileset,
  );
  return new WalkabilityGrid(map, tileset);
}

describe('WalkabilityGrid', () => {
  it('blocks a tile with a solid Layer 1 tile', () => {
    expect(grid().isWalkable(1, 1)).toBe(false);
  });

  it('blocks a tile with no Layer 0 floor', () => {
    expect(grid().isWalkable(2, 0)).toBe(false);
  });

  it('allows a floored, unobstructed tile', () => {
    expect(grid().isWalkable(0, 0)).toBe(true);
  });

  it('treats out-of-bounds as blocked', () => {
    const g = grid();
    expect(g.isWalkable(-1, 0)).toBe(false);
    expect(g.isWalkable(3, 0)).toBe(false);
  });

  it('round-trips world and grid coordinates through the tile centre (§2)', () => {
    const g = grid();
    expect(g.gridToWorld(1, 2)).toEqual({ wx: 3, wz: 5 });
    expect(g.worldToGrid(3, 5)).toEqual({ gx: 1, gy: 2 });
  });

  it('flips a tile at runtime and notifies listeners (§6 gates)', () => {
    const g = grid();
    const listener = vi.fn();
    g.onChange(listener);

    const before = g.version;
    g.setOverride(1, 1, true);

    expect(g.isWalkable(1, 1)).toBe(true);
    expect(g.version).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restores the derived value when an override is cleared', () => {
    const g = grid();
    g.setOverride(1, 1, true);
    g.setOverride(1, 1, null);
    expect(g.isWalkable(1, 1)).toBe(false);
  });

  it('does not rebuild when an override is set to the value it already has', () => {
    const g = grid();
    g.setOverride(1, 1, true);
    const version = g.version;
    g.setOverride(1, 1, true);
    expect(g.version).toBe(version);
  });

  it('counts walkable tiles', () => {
    expect(grid().walkableCount()).toBe(7);
  });
});
