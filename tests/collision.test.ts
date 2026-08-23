/** Player capsule resolution against map colliders (§3.1). */

import { describe, expect, it } from 'vitest';
import { buildColliders, buildFloorGapColliders } from '../src/map/colliders';
import { parseMap, parseTileset } from '../src/map/validate';
import type { BoxCollider } from '../src/map/types';
import { circleBoxContact, ColliderIndex, moveCircle } from '../src/player/collision';

const TILE = 2;
const RADIUS = 0.4;

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/**
 * Build a collider index from an ASCII sketch, one string per row: `#` is a wall, `.` is
 * a hole in the floor, anything else is open floor. Tiles are 2 m, so grid `(x, y)` spans
 * world `[2x, 2x+2] × [2y, 2y+2]`.
 */
function indexFrom(rows: string[]): ColliderIndex {
  const width = rows[0]!.length;
  const height = rows.length;
  const floor: number[] = [];
  const walls: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      floor.push(cell === '.' ? 0 : 1);
      walls.push(cell === '#' ? 2 : 0);
    }
  }

  const map = parseMap(
    {
      width,
      height,
      tileSize: TILE,
      layers: [
        { name: 'Floor', data: floor },
        { name: 'Walls', data: walls },
      ],
      entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }],
    },
    tileset,
  );

  const colliders: BoxCollider[] = [
    ...buildColliders(map, tileset, () => 3),
    ...buildFloorGapColliders(map, tileset),
  ];
  return new ColliderIndex(colliders, width, height, TILE);
}

describe('circleBoxContact', () => {
  const box: BoxCollider = {
    kind: 'obstacle',
    cx: 0,
    cz: 0,
    hx: 1,
    hz: 1,
    height: 3,
    gx0: 0,
    gy0: 0,
    gx1: 0,
    gy1: 0,
  };

  it('reports no contact outside the inflated box', () => {
    expect(circleBoxContact(box, 1.5, 0, RADIUS)).toBeNull();
  });

  it('reports the face normal and depth against a flat side', () => {
    const contact = circleBoxContact(box, 1.2, 0, RADIUS)!;
    expect(contact.nx).toBeCloseTo(1);
    expect(contact.nz).toBeCloseTo(0);
    expect(contact.depth).toBeCloseTo(0.2);
  });

  it('reports a diagonal normal against a corner, which is what makes a capsule slide off', () => {
    const contact = circleBoxContact(box, 1.2, 1.2, RADIUS)!;
    expect(contact.nx).toBeCloseTo(Math.SQRT1_2);
    expect(contact.nz).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves along the nearest face when the centre is inside the box', () => {
    // Nearer the +x face than any other, so that is the shortest way out.
    const contact = circleBoxContact(box, 0.8, 0.1, RADIUS)!;
    expect(contact.nx).toBe(1);
    expect(contact.depth).toBeCloseTo(0.2 + RADIUS);
  });
});

describe('ColliderIndex', () => {
  it('returns a merged collider once however many of its tiles the query spans', () => {
    const index = indexFrom([
      '#####',
      '     ',
      '     ',
    ]);
    // The whole wall run merged into one box, and a wide query covers several of its tiles.
    const hits = index.query(5, 1, 4, []);
    expect(hits).toHaveLength(1);
  });

  it('returns nothing for a query over open floor', () => {
    const index = indexFrom(['   ', '   ', '   ']);
    expect(index.query(3, 3, RADIUS, [])).toHaveLength(0);
  });
});

describe('moveCircle', () => {
  it('stops at the face of a wall rather than entering it', () => {
    // Wall column at grid x = 2, spanning world x 4..6.
    const index = indexFrom(['  #  ', '  #  ', '  #  ']);
    const result = moveCircle(index, 2, 3, 3, 0, RADIUS);

    expect(result.hit).toBe(true);
    expect(result.x).toBeCloseTo(4 - RADIUS);
    expect(result.z).toBeCloseTo(3);
    expect(result.normalX).toBeCloseTo(-1);
  });

  it('slides along a wall instead of halting on it (§3.1)', () => {
    // Wall run along the top row: world z 0..2. Approach it diagonally from below.
    const index = indexFrom(['#####', '     ', '     ']);
    const result = moveCircle(index, 5, 2.5, 0.5, -0.5, RADIUS);

    // The into-the-wall half of the move is removed; the along-the-wall half survives.
    expect(result.z).toBeCloseTo(2 + RADIUS);
    expect(result.x).toBeCloseTo(5.5);
  });

  it('resolves an inside corner without squeezing through it', () => {
    const index = indexFrom(['###', '#  ', '#  ']);
    const result = moveCircle(index, 3, 3, -2, -2, RADIUS);

    expect(result.x).toBeGreaterThanOrEqual(2 + RADIUS - 1e-6);
    expect(result.z).toBeGreaterThanOrEqual(2 + RADIUS - 1e-6);
  });

  it('does not tunnel through a wall on a single large step', () => {
    const index = indexFrom(['  #  ', '  #  ', '  #  ']);
    // Far more than a tick's worth of movement — knockback (§5.3) and a time-scaled debug
    // session both produce steps like this.
    const result = moveCircle(index, 1, 3, 40, 0, RADIUS);

    expect(result.x).toBeCloseTo(4 - RADIUS);
  });

  it('is stopped by a hole in the floor, not only by walls (§2, §3.1)', () => {
    const index = indexFrom(['     ', '  .  ', '     ']);
    const result = moveCircle(index, 2, 3, 3, 0, RADIUS);

    expect(result.hit).toBe(true);
    expect(result.x).toBeCloseTo(4 - RADIUS);
  });

  it('keeps the circle inside the map even where the boundary is open', () => {
    const index = indexFrom(['   ', '   ', '   ']);
    const west = moveCircle(index, 1, 3, -10, 0, RADIUS);
    expect(west.x).toBeCloseTo(RADIUS);

    const south = moveCircle(index, 3, 3, 0, 10, RADIUS);
    expect(south.z).toBeCloseTo(3 * TILE - RADIUS);
  });

  it('reports no contact and moves the full distance across open floor', () => {
    const index = indexFrom(['     ', '     ', '     ']);
    const result = moveCircle(index, 3, 3, 0.05, -0.05, RADIUS);

    expect(result.hit).toBe(false);
    expect(result.x).toBeCloseTo(3.05);
    expect(result.z).toBeCloseTo(2.95);
  });
});
