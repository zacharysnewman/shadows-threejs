/**
 * Regenerates `public/maps/phase5-test/map.json` (§2).
 *
 * Built for navigation, so every feature is a question about routing:
 *
 * - **A central block with two doors** — a pursuing enemy has to pick a side, and picks
 *   the near one. Watching it choose the far side is how a broken heuristic shows.
 * - **A long wall with one doorway** — the tile to close with the debug key while an enemy
 *   is mid-path, which is what a gate does when it shuts (§6). The grid rebuild has to be
 *   picked up without waiting for the repath timer.
 * - **A dead-end pocket** — somewhere a route can be wrong in a way that matters.
 * - **Open yard** — room to wander in, and the sight lines that let an enemy take the
 *   straight route instead of paying for a path.
 *
 * The spiders start beyond their own detection radius (§5), so the first thing the map
 * shows is wandering, and pursuit begins when the player walks in. The Shadow Monster
 * starts at the far corner and comes anyway; it always knows.
 *
 *   node scripts/gen-phase5-map.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/phase5-test/map.json');

const WIDTH = 30;
const HEIGHT = 22;
const TILE_SIZE = 2.0;

const EMPTY = 0;
const FLOOR_CONCRETE = 1;
const WALL_BRICK = 2;
const FLOOR_DIRT = 4;
const PROP_CRATE = 6;

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

outline(walls, 0, 0, WIDTH - 1, HEIGHT - 1, WALL_BRICK);

// --- Central block, solid, with open ground either side ---------------------
// Routing around this is the phase's headline behaviour: two ways past, and the enemy
// should take the shorter one for where it happens to be standing.
fill(walls, 11, 6, 18, 15, WALL_BRICK);
fill(floor, 10, 5, 19, 16, FLOOR_DIRT);

// --- The wall with one doorway ---------------------------------------------
// Everything north of row 3 is reachable only through (24, 3) — close it mid-chase and
// the enemy has to find the long way round the block instead.
for (let x = 20; x <= WIDTH - 2; x += 1) set(walls, x, 3, WALL_BRICK);
set(walls, 24, 3, EMPTY);

// --- Dead-end pocket in the south-west --------------------------------------
for (let y = 16; y <= 19; y += 1) set(walls, 5, y, WALL_BRICK);
for (let x = 1; x <= 5; x += 1) set(walls, x, 19, WALL_BRICK);

// --- Scattered cover, so paths have something to bend around ----------------
for (const [x, y] of [
  [7, 3],
  [8, 12],
  [21, 8],
  [22, 17],
  [26, 12],
  [3, 8],
]) {
  set(walls, x, y, PROP_CRATE);
}

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  entities: [
    { type: 'PlayerSpawn', x: 2, y: 2, properties: { rotation: 90 } },

    // Well beyond the spider's 14 m detection radius from spawn, so the map opens on
    // wandering and pursuit starts when the player closes in.
    { type: 'SpiderEnemy', x: 26, y: 8, properties: {} },
    { type: 'SpiderEnemy', x: 27, y: 9, properties: {} },
    { type: 'SpiderEnemy', x: 8, y: 18, properties: {} },
    // The far corner, behind the block, on the other side of the doorway.
    { type: 'ShadowMonster', x: 27, y: 1, properties: {} },

    { type: 'Flashlight', x: 3, y: 2, properties: {} },
    { type: 'EnvironmentLight', x: 24, y: 11, properties: { groupId: 'YardLights', radius: 7 } },
    { type: 'PowerSwitch', x: 22, y: 11, properties: { targetId: 'YardLights', mode: 'toggle' } },
  ],
  layers: [
    { name: 'Floor', data: floor },
    { name: 'Walls', data: walls },
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
