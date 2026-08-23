/**
 * Regenerates `public/maps/phase7-test/map.json` (§2).
 *
 * Built for the spider's light reaction lifecycle (§5.1) and its attack (§5.3). Every
 * feature is a branch of one of those, somewhere a beam can be pointed to see it:
 *
 * - **The flee lane** — a long walled corridor, entered from the yard at its south end,
 *   with a spider standing just inside it. Deter that one and it has 26 m of clear ground
 *   directly away from a player in the yard — more than §5.1's 18 m search, so the flee
 *   target lands at the cap rather than at a wall.
 * - **The blocked run** — a spider standing four metres south of a long wall. Directly
 *   away from a player approaching from the south is straight into it: the target has to
 *   stop short, and the spider must never end up on the far side.
 * - **The pocket** — a dead end with a spider in it and the only way out past the player.
 *   Nowhere to run, so §5.1's cower.
 * - **The yard** — open ground and a spider that will reach you, for the wind-up, the
 *   dodge, the miss and the knockback. Room to back out of a lunge in the 0.35 s it gives.
 * - **The lamp** — deterrence comes from the shared light query (§4.1), not from the
 *   flashlight, so a spider wandering into a lit pool must stun with nobody aiming at it.
 *
 * No Shadow Monster: its contact resolution is Phase 8's, and an invisible thing that
 * always knows where you are is not something to be debugging a spider next to.
 *
 *   node scripts/gen-phase7-map.mjs
 */

import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/phase7-test/map.json');

const WIDTH = 32;
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

// --- The flee lane -----------------------------------------------------------
// Columns 3–6 open from row 1 to row 16, walled either side, opening south into the yard.
// 16 tiles of lane is 32 m; §5.1 caps the search at 18, so the target is the cap.
for (let y = 1; y <= 16; y += 1) {
  set(walls, 2, y, WALL_BRICK);
  set(walls, 7, y, WALL_BRICK);
}
fill(floor, 3, 1, 6, 16, FLOOR_DIRT);

// --- The blocked run ---------------------------------------------------------
// A wall across the middle of the yard. A spider two tiles south of it, deterred by a
// player further south still, has four metres before the away vector runs out.
for (let x = 12; x <= 23; x += 1) set(walls, x, 9, WALL_BRICK);

// --- The pocket --------------------------------------------------------------
// Interior (27–28, 3–4), one tile wide mouth at (27, 5).
outline(walls, 26, 2, 29, 5, WALL_BRICK);
set(walls, 27, 5, EMPTY);
fill(floor, 27, 3, 28, 4, FLOOR_DIRT);

// --- Cover in the yard, so the attack has corners to happen near ---------------
for (const [x, y] of [
  [11, 18],
  [17, 20],
  [24, 15],
  [20, 13],
  [10, 13],
]) {
  set(walls, x, y, PROP_CRATE);
}

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  entities: [
    // In the yard, south-east of the lane's mouth, facing north (§2: degrees clockwise
    // from north). Far enough from every spider that the map opens on wandering.
    { type: 'PlayerSpawn', x: 12, y: 21, properties: { rotation: 0 } },
    { type: 'Flashlight', x: 13, y: 21, properties: {} },

    // Just inside the lane's south end, with the whole lane behind it. A player standing
    // in the yard is exactly the direction it has to run away from.
    { type: 'SpiderEnemy', x: 5, y: 14, properties: {} },
    // Two tiles south of the wall at row 9 — the run that has nowhere to finish.
    { type: 'SpiderEnemy', x: 17, y: 11, properties: {} },
    // In the pocket, with its back to the corner.
    { type: 'SpiderEnemy', x: 28, y: 3, properties: {} },
    // In the open, for the attack. Within detect range of the yard, not of the spawn.
    { type: 'SpiderEnemy', x: 20, y: 18, properties: {} },

    // §4.1 — a second way to be lit, so deterrence can be seen happening to a spider
    // nobody is aiming at. On its own switch, so it can be taken away again.
    { type: 'EnvironmentLight', x: 14, y: 16, properties: { groupId: 'YardLights', radius: 7 } },
    { type: 'PowerSwitch', x: 14, y: 21, properties: { targetId: 'YardLights', mode: 'toggle' } },
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
