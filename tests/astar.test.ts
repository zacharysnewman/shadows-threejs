/** Grid A\*, its corner rule, and the line-of-sight test that pulls paths straight (§5). */

import { describe, expect, it } from 'vitest';
import { findPath, hasLineOfSight, smoothPath, type PathGrid } from '../src/nav/AStar';

/** ASCII sketch: `#` blocked, anything else walkable. Row 0 is the top. */
function gridFrom(rows: string[]): PathGrid {
  const width = rows[0]!.length;
  const height = rows.length;
  return {
    width,
    height,
    isWalkable(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false;
      return rows[gy]![gx] !== '#';
    },
  };
}

const open5 = gridFrom(['     ', '     ', '     ', '     ', '     ']);

describe('findPath', () => {
  it('crosses open ground in one straight hop once smoothed', () => {
    const path = findPath(open5, 0, 0, 4, 4)!;
    expect(path).toEqual([{ x: 4, y: 4 }]);
  });

  it('returns every tile of that route unsmoothed', () => {
    const path = findPath(open5, 0, 0, 4, 4, { smooth: false })!;
    expect(path).toHaveLength(4);
    expect(path[path.length - 1]).toEqual({ x: 4, y: 4 });
  });

  it('routes around a wall rather than through it', () => {
    //  Wall across the middle with a gap at the right-hand end.
    const grid = gridFrom(['     ', '     ', '#### ', '     ', '     ']);
    const path = findPath(grid, 0, 0, 0, 4, { smooth: false })!;

    expect(path).not.toHaveLength(0);
    for (const step of path) expect(grid.isWalkable(step.x, step.y)).toBe(true);
    // It has to reach the gap at x = 4 to get past the wall.
    expect(path.some((step) => step.x === 4 && step.y === 2)).toBe(true);
    expect(path[path.length - 1]).toEqual({ x: 0, y: 4 });
  });

  it('never cuts the corner where two walls meet', () => {
    // The only diagonal from (0,0) to (1,1) passes between two blocked tiles.
    const grid = gridFrom([' # ', '#  ', '   ']);
    const path = findPath(grid, 0, 0, 1, 1, { smooth: false });
    expect(path).toBeNull();
  });

  it('gives up on an unreachable goal instead of searching for ever', () => {
    const grid = gridFrom(['   #  ', '   #  ', '   #  ']);
    expect(findPath(grid, 0, 0, 5, 0)).toBeNull();
  });

  it('refuses a start or goal that is not walkable', () => {
    const grid = gridFrom(['  ', ' #']);
    expect(findPath(grid, 1, 1, 0, 0)).toBeNull();
    expect(findPath(grid, 0, 0, 1, 1)).toBeNull();
  });

  it('returns an empty path when it is already there', () => {
    expect(findPath(open5, 2, 2, 2, 2)).toEqual([]);
  });

  it('honours the node budget rather than stalling a frame', () => {
    const wide = gridFrom(Array.from({ length: 60 }, () => ' '.repeat(60)));
    expect(findPath(wide, 0, 0, 59, 59, { nodeBudget: 20 })).toBeNull();
  });

  it('follows the grid as it changes, since it reads walkability live', () => {
    const blocked = new Set<string>();
    const grid: PathGrid = {
      width: 5,
      height: 3,
      isWalkable: (x, y) =>
        x >= 0 && y >= 0 && x < 5 && y < 3 && !blocked.has(`${x},${y}`),
    };

    expect(findPath(grid, 0, 1, 4, 1)).not.toBeNull();
    for (let y = 0; y < 3; y += 1) blocked.add(`2,${y}`);
    expect(findPath(grid, 0, 1, 4, 1)).toBeNull();
    blocked.delete('2,0');
    expect(findPath(grid, 0, 1, 4, 1)).not.toBeNull();
  });
});

describe('hasLineOfSight', () => {
  it('sees across open ground', () => {
    expect(hasLineOfSight(open5, 0, 0, 4, 4)).toBe(true);
    expect(hasLineOfSight(open5, 0, 2, 4, 2)).toBe(true);
  });

  it('is blocked by a wall between the two points', () => {
    const grid = gridFrom(['     ', '     ', '#####', '     ', '     ']);
    expect(hasLineOfSight(grid, 2, 0, 2, 4)).toBe(false);
  });

  it('refuses the diagonal gap between two corners, like the path search does', () => {
    const grid = gridFrom([' # ', '#  ', '   ']);
    expect(hasLineOfSight(grid, 0, 0, 1, 1)).toBe(false);
  });

  it('reports nothing visible from inside a wall', () => {
    const grid = gridFrom([' # ', '   ']);
    expect(hasLineOfSight(grid, 1, 0, 0, 1)).toBe(false);
  });
});

describe('smoothPath', () => {
  it('collapses a straight run to its endpoints', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(smoothPath(open5, path)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('keeps the corner it has to turn at', () => {
    const grid = gridFrom(['     ', '#### ', '     ']);
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 3, y: 2 },
    ];
    const smoothed = smoothPath(grid, path);
    expect(smoothed.length).toBeLessThan(path.length);
    // Every remaining leg still has to be a line that exists on the grid.
    for (let i = 1; i < smoothed.length; i += 1) {
      const a = smoothed[i - 1]!;
      const b = smoothed[i]!;
      expect(hasLineOfSight(grid, a.x, a.y, b.x, b.y)).toBe(true);
    }
  });
});
