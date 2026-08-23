/**
 * Regenerates `public/maps/phase3-test/map.json` (§2).
 *
 * Built for the lighting phase, so everything on it exists to be looked at under a beam:
 *
 * - **A prop field** — free-standing crates in open ground. Upright geometry with floor
 *   around it is the only way to see whether the flashlight's shadows are hard, which is
 *   the phase's exit criterion and the mechanic the Shadow Monster is read by (§5.2).
 * - **Six lamps in three groups** — more than the two shadow slots §7 allows, so the
 *   budget has something to choose between, and in separate groups so powering them is
 *   visibly per-group rather than global (§2, §6).
 * - **A dark corridor with no lamp at all** — somewhere the flashlight is the only light,
 *   which is where the battery becomes a decision rather than a number.
 * - **A long sight line** — 24 m of open floor, longer than the beam's 12 m range, so the
 *   range limit is visible instead of inferred.
 *
 *   node scripts/gen-phase3-map.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/phase3-test/map.json');

const WIDTH = 28;
const HEIGHT = 20;
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

// --- West yard: open dirt with a scattered prop field ------------------------
// The props are deliberately spread rather than lined up: a beam swept across them should
// throw shadows in every direction, not one repeated silhouette.
fill(floor, 1, 1, 12, 18, FLOOR_DIRT);
for (const [x, y] of [
  [3, 3],
  [6, 5],
  [9, 3],
  [4, 8],
  [8, 9],
  [11, 7],
  [3, 13],
  [7, 14],
  [10, 16],
  [5, 17],
]) {
  set(walls, x, y, PROP_CRATE);
}

// --- Divider and the dark corridor ------------------------------------------
// No lamp reaches into the corridor: crossing it costs battery or costs sight.
for (let y = 1; y <= HEIGHT - 2; y += 1) set(walls, 13, y, WALL_BRICK);
for (let y = 1; y <= HEIGHT - 2; y += 1) set(walls, 16, y, WALL_BRICK);
set(walls, 13, 10, EMPTY);
set(walls, 16, 4, EMPTY);
set(walls, 16, 16, EMPTY);

// --- East hall: lamps, and one long sight line ------------------------------
// A single open run from the north wall to the south, 18 tiles of it, so the beam's 12 m
// range ends somewhere visible rather than at a wall.
fill(walls, 20, 6, 20, 13, WALL_BRICK);

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  entities: [
    { type: 'PlayerSpawn', x: 2, y: 2, properties: { rotation: 135 } },

    // Three groups. `YardLights` is the group with more lamps than shadow slots.
    { type: 'EnvironmentLight', x: 4, y: 5, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
    { type: 'EnvironmentLight', x: 10, y: 5, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
    { type: 'EnvironmentLight', x: 4, y: 15, properties: { groupId: 'YardLights', radius: 7, intensity: 0.7 } },
    { type: 'EnvironmentLight', x: 10, y: 15, properties: { groupId: 'YardLights' } },
    { type: 'EnvironmentLight', x: 18, y: 4, properties: { groupId: 'HallLights', radius: 5, intensity: 1.2 } },
    { type: 'EnvironmentLight', x: 24, y: 10, properties: { groupId: 'HallLights', radius: 8, intensity: 0.6 } },
    { type: 'EnvironmentLight', x: 24, y: 17, properties: { groupId: 'SouthLight', radius: 4, intensity: 1.0 } },

    // Switches for Phase 9 to find already wired to those groups.
    { type: 'PowerSwitch', x: 12, y: 10, properties: { targetId: 'YardLights', mode: 'toggle' } },
    { type: 'PowerSwitch', x: 17, y: 10, properties: { targetId: 'HallLights', mode: 'toggle' } },
    { type: 'PowerSwitch', x: 26, y: 18, properties: { targetId: 'SouthLight', mode: 'toggle' } },

    { type: 'Flashlight', x: 3, y: 2, properties: {} },
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
