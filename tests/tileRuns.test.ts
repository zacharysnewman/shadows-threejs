/**
 * Turning the tiles that are a *length* of something to follow the run they are in (§2).
 *
 * The kit models a wall, a fence and a gate as a 2 m run across x with only enough depth to
 * be solid. Placed unturned, a north–south run of them is a row of disconnected rungs with
 * a metre of daylight between each — which is what a fence looked like before this, and a
 * wall too. The map data still has no rotation in it: this is read off the neighbours.
 */

import { describe, expect, it } from 'vitest';
import { isRun, runRotation } from '../src/map/MapGeometry';

/** A grid of solid tiles from a picture, `#` solid and `.` clear. */
function solidity(rows: string[]): (gx: number, gy: number) => boolean {
  return (gx, gy) => rows[gy]?.[gx] === '#';
}

describe('isRun (§2)', () => {
  it('calls a module a run when it is longer than it is deep', () => {
    // The kit's own numbers: a half-wall is 2 × 1, a barrier 2 × 0.5.
    expect(isRun({ x: 2, z: 1 })).toBe(true);
    expect(isRun({ x: 2, z: 0.5 })).toBe(true);
  });

  it('leaves anything near square alone', () => {
    // A crate has no way round to be wrong, and neither has a floor tile. Turning one would
    // be a change nobody asked for that only shows up as a texture rotating.
    expect(isRun({ x: 1, z: 1 })).toBe(false);
    expect(isRun({ x: 2, z: 2 })).toBe(false);
    expect(isRun({ x: 2, z: 1.6 })).toBe(false);
  });
});

describe('runRotation (§2)', () => {
  const grid = solidity([
    '.....',
    '.###.',
    '...#.',
    '...#.',
    '.....',
  ]);

  it('leaves a run across x the way the kit modelled it', () => {
    expect(runRotation(grid, 2, 1)).toBe(0);
  });

  it('turns a quarter where the run goes north and south', () => {
    expect(runRotation(grid, 3, 2)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the modelled facing at a corner, where neither axis is the run', () => {
    // (3, 1) has a neighbour west and one south. Either choice leaves a notch, so it takes
    // the one that is the same every run and the same as the tiles beside it.
    expect(runRotation(grid, 3, 1)).toBe(0);
  });

  it('keeps the modelled facing for a tile standing on its own', () => {
    expect(runRotation(solidity(['.....', '..#..', '.....']), 2, 1)).toBe(0);
  });

  it('does not read a run out of tiles off the edge of the map', () => {
    // The neighbour test has to answer for a tile on the boundary; treating off-map as
    // solid would turn every tile along the north edge.
    expect(runRotation(solidity(['..#..']), 2, 0)).toBe(0);
  });
});
