/**
 * Regenerates `public/maps/phase2-test/map.json` (§2).
 *
 * A small map built for one job: exercising every way the player capsule can get stuck
 * (§3.1) and every edge the camera has to clamp against (§3.2). The real map (Phase 11) is
 * the worst possible place to first find out that a capsule catches on an interior seam.
 *
 * What each feature is here to test:
 *
 * - **Pillar staircase** — single tiles on a diagonal. Walking into the inside of the
 *   staircase puts the capsule in contact with two boxes at once, which is where per-axis
 *   resolution catches and normal-based sliding does not.
 * - **Doorways** — one-tile (2 m) gaps in long walls, threaded head-on and at an angle.
 * - **Pit** — a hole in Layer 0 with nothing on Layer 1. Unwalkable for pathfinding, and
 *   the player has to be stopped by it too rather than strolling out over the void.
 * - **Fence run with a gap** — a second solid tile id at a different height, so the merge
 *   cannot collapse it into the neighbouring wall.
 * - **Alcove** — a dead end narrow enough to have to reverse out of.
 * - **Corner rooms** — reachable floor hard against all four map edges, so the camera can
 *   be driven into every clamp.
 *
 *   node scripts/gen-phase2-map.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/phase2-test/map.json');

const WIDTH = 24;
const HEIGHT = 18;
const TILE_SIZE = 2.0;

const EMPTY = 0;
const FLOOR_CONCRETE = 1;
const WALL_BRICK = 2;
const FENCE_CHAINLINK = 3;
const FLOOR_DIRT = 4;

const floor = new Array(WIDTH * HEIGHT).fill(FLOOR_CONCRETE);
const walls = new Array(WIDTH * HEIGHT).fill(EMPTY);

const idx = (x, y) => y * WIDTH + x;
const set = (layer, x, y, id) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  layer[idx(x, y)] = id;
};
const fill = (layer, x0, y0, x1, y1, id) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) set(layer, x, y, id);
};
const outline = (layer, x0, y0, x1, y1, id) => {
  for (let x = x0; x <= x1; x += 1) {
    set(layer, x, y0, id);
    set(layer, x, y1, id);
  }
  for (let y = y0; y <= y1; y += 1) {
    set(layer, x0, y, id);
    set(layer, x1, y, id);
  }
};

// Outer boundary. Everything inside it is floor, so every interior tile is walkable
// unless something below takes it away.
outline(walls, 0, 0, WIDTH - 1, HEIGHT - 1, WALL_BRICK);

// --- West room: the pillar staircase ---------------------------------------
// Isolated single tiles on a diagonal. Each is its own collider, and the inside of the
// diagonal is the corner case: two contacts at once, resolved along their normals.
for (let step = 0; step < 5; step += 1) set(walls, 2 + step, 3 + step, WALL_BRICK);

// A free-standing pair with a one-tile gap between them, to walk through at an angle.
set(walls, 3, 12, WALL_BRICK);
set(walls, 5, 12, WALL_BRICK);

// --- Divider between west and middle, with a doorway ------------------------
for (let y = 1; y <= HEIGHT - 2; y += 1) set(walls, 8, y, WALL_BRICK);
set(walls, 8, 9, EMPTY); // doorway, threaded head-on from the west room

// --- Middle room: the pit and the fence -------------------------------------
// A hole in the floor with nothing above it: unwalkable through Layer 0 alone (§2).
fill(floor, 11, 3, 14, 6, EMPTY);
// Dirt around the pit's lip, so the hole is legible before the player is standing at it.
outline(floor, 10, 2, 15, 7, FLOOR_DIRT);

// Chain-link run at a different height to the brick, with a gap to slip through. Its
// collider must not merge into the divider walls it touches.
for (let x = 9; x <= 15; x += 1) set(walls, x, 13, FENCE_CHAINLINK);
set(walls, 12, 13, EMPTY);

// --- Divider between middle and east, with an off-centre doorway -------------
for (let y = 1; y <= HEIGHT - 2; y += 1) set(walls, 16, y, WALL_BRICK);
set(walls, 16, 4, EMPTY); // doorway, only reachable on a diagonal approach

// --- East side: corridor and alcove -----------------------------------------
// A one-tile-wide corridor between two walls: 2 m of clearance for a 0.8 m capsule, so it
// is passable, and every step of it is a two-sided contact.
for (let y = 6; y <= HEIGHT - 2; y += 1) set(walls, 19, y, WALL_BRICK);
for (let y = 8; y <= HEIGHT - 2; y += 1) set(walls, 21, y, WALL_BRICK);

// Dead-end alcove off the north-east corner: three walls, one way in.
fill(walls, 20, 2, 22, 2, WALL_BRICK);
set(walls, 20, 3, WALL_BRICK);
set(walls, 22, 3, WALL_BRICK);

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  layers: [
    { name: 'Floor', data: floor },
    { name: 'Walls', data: walls },
  ],
  entities: [
    // Hard against the north-west corner, so the camera starts on two clamps at once.
    { type: 'PlayerSpawn', x: 1, y: 1, properties: { rotation: 90 } },
    // Something to walk to at the far corner, and a marker for the debug overlay.
    { type: 'Flashlight', x: 22, y: 16, properties: {} },
    { type: 'Note', x: 12, y: 16, properties: { noteId: 'phase2_test' } },
  ],
};

/** One row of tile ids per line, so a diff shows which row of the map moved. */
function formatLayerData(data) {
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    rows.push('        ' + data.slice(y * WIDTH, (y + 1) * WIDTH).join(', '));
  }
  return rows.join(',\n');
}

const json = [
  '{',
  `  "width": ${WIDTH},`,
  `  "height": ${HEIGHT},`,
  `  "tileSize": ${TILE_SIZE.toFixed(1)},`,
  '  "layers": [',
  ...map.layers.map(
    (layer, i) =>
      [
        '    {',
        `      "name": "${layer.name}",`,
        '      "data": [',
        formatLayerData(layer.data),
        '      ]',
        i === map.layers.length - 1 ? '    }' : '    },',
      ].join('\n'),
  ),
  '  ],',
  `  "entities": ${JSON.stringify(map.entities, null, 2).split('\n').join('\n  ')}`,
  '}',
  '',
].join('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`wrote ${OUT} (${WIDTH}×${HEIGHT})`);
