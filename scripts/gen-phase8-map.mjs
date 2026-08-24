/**
 * Regenerates `public/maps/phase8-test/map.json` (§2).
 *
 * Built for the Shadow Monster (§5.2) and the sabotage it causes (§4.2). Every feature is
 * one thing that has to be watchable:
 *
 * - **The long yard** — open floor from the player's corner to the monster's, with nothing
 *   in the way. The monster is only ever its shadow, so the phase's headline read is a
 *   beam swept across apparently empty ground finding one lying in it, and that needs
 *   ground to sweep.
 * - **The pit** — a floor gap between the yard and the north walk. Light crosses it (§4.1
 *   occludes on obstacles, and a hole is not one) and walking does not, so it is the one
 *   place a monster can be lit with something impassable between it and the player. That
 *   makes it the only reliable way to watch §5.2's blink stop short instead of lurching
 *   into a hole.
 * - **Two lamps, two groups** — one on the monster's route from its spawn, to run the
 *   strain/failure/recovery cycle without being driven there by hand, and one away from it
 *   as the control that should never so much as flicker.
 * - **Crates** — something for a beam to throw hard shadows off, so a monster's shadow has
 *   ordinary shadows to be told apart from.
 * - **Two spiders** — the comparison the whole design rests on. In one beam a spider is a
 *   body and the monster is a shadow with nothing above it, and that is only convincing
 *   with both in the same frame.
 *
 *   node scripts/gen-phase8-map.mjs
 */

import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/phase8-test/map.json');

const WIDTH = 34;
const HEIGHT = 24;
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

// --- The pit ----------------------------------------------------------------
// No floor at all: unwalkable (§2), collides as a `gap` so the player is stopped at its
// edge (§3.1), and transparent to light, because §4.1 only occludes on obstacles.
// Columns 1–12 and 21–32 stay floored either side of it, so the map is one connected
// space and a monster crossing the yard has a route rather than a wall.
fill(floor, 13, 10, 20, 12, EMPTY);

// --- A short wall to route around, north of the pit --------------------------
for (let x = 24; x <= 30; x += 1) set(walls, x, 8, WALL_BRICK);

// --- Dirt marking the two lamp pools, so they read as places -----------------
fill(floor, 5, 16, 11, 21, FLOOR_DIRT);
fill(floor, 25, 15, 31, 20, FLOOR_DIRT);

// --- Crates: shadow casters, and cover ---------------------------------------
for (const [x, y] of [
  [7, 6],
  [10, 3],
  [22, 4],
  [16, 17],
  [27, 11],
  [4, 12],
  [30, 3],
]) {
  set(walls, x, y, PROP_CRATE);
}

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  entities: [
    // South-west corner, facing north up the yard (§2: degrees clockwise from north).
    { type: 'PlayerSpawn', x: 4, y: 20, properties: { rotation: 0 } },
    { type: 'Flashlight', x: 5, y: 20, properties: {} },

    // The far corner. It always knows (§5), so this is a two-minute walk it will make
    // whatever the player does — and the map opens with nothing visible anywhere.
    { type: 'ShadowMonster', x: 30, y: 2, properties: {} },
    // On the north walk, directly across the pit from the yard: the one place it can be
    // lit with something impassable between it and the player.
    { type: 'ShadowMonster', x: 16, y: 8, properties: {} },

    // For the comparison. Both start beyond their detect radius (§5).
    { type: 'SpiderEnemy', x: 28, y: 21, properties: {} },
    { type: 'SpiderEnemy', x: 20, y: 20, properties: {} },

    // §4.2 — the lamp on the monster's route, and the control that should never flicker.
    { type: 'EnvironmentLight', x: 28, y: 17, properties: { groupId: 'YardLights', radius: 6 } },
    { type: 'EnvironmentLight', x: 8, y: 18, properties: { groupId: 'HomeLights', radius: 6 } },
    { type: 'PowerSwitch', x: 6, y: 20, properties: { targetId: 'YardLights', mode: 'toggle' } },
    { type: 'PowerSwitch', x: 7, y: 20, properties: { targetId: 'HomeLights', mode: 'toggle' } },
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
copyFileSync(resolve(HERE, '../public/maps/phase5-test/tileset.json'), resolve(dirname(OUT), 'tileset.json'));
console.log(`wrote ${OUT} (${WIDTH}×${HEIGHT})`);
