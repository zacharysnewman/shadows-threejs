/**
 * Regenerates `public/maps/poi-test/map.json` (§2).
 *
 * The map for landmarks. Everything on it is one thing that has to be watchable:
 *
 * - **A grove, straddling the player's route.** Trees are the case the whole feature was
 *   shaped around: the canopy is above the camera and never drawn (§2), so what the player
 *   gets is trunks rising out of frame. Some are placed close enough together that walking
 *   between them puts a trunk between the camera and the player, which is the occluder fade
 *   (§3.2) being asked the hardest question on any map — a 23 m column, not a 3 m wall.
 * - **A pitch, laid out by hand.** Two goals facing each other across open ground with a
 *   net down one side. This is the arrangement §9.4's soccer-field stamp will eventually
 *   place in one action; here it is drawn out longhand, which is exactly what a stamp
 *   expands *into*, so the map is also the test of what that expansion has to produce.
 * - **A hoop and a slide, off to one side.** The two footprint cases: the hoop's mesh
 *   overhangs ground you can walk under and takes an override (§2), and the slide is an
 *   ordinary derived box. Standing them together is how you see the difference between a
 *   landmark you can walk beneath and one you cannot.
 * - **Rotations that are not quarter turns.** Two of the trees and one goal sit at odd
 *   angles, because that is where the axis-aligned footprint is conservative rather than
 *   exact, and the amount it over-blocks is a thing to look at rather than to assume.
 *
 * A wall runs along the north so there is something ordinary for a landmark's shadow to
 * fall across, and the yard is otherwise open: the point is the landmarks, and geometry
 * that competes with them is geometry in the way.
 *
 *   node scripts/gen-poi-map.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/maps/poi-test/map.json', import.meta.url));

const WIDTH = 32;
const HEIGHT = 32;
const TILE_SIZE = 2.0;

const CONCRETE = 1;
const WALL = 2;
const DIRT = 4;

const floor = new Array(WIDTH * HEIGHT).fill(CONCRETE);
const walls = new Array(WIDTH * HEIGHT).fill(0);

const at = (x, y) => y * WIDTH + x;

// Dirt under the grove, so the ground says "this is a different place" even unlit.
for (let y = 4; y < 14; y += 1) {
  for (let x = 3; x < 15; x += 1) floor[at(x, y)] = DIRT;
}

// One wall along the north edge, for landmark shadows to land on.
for (let x = 0; x < WIDTH; x += 1) walls[at(x, 0)] = WALL;
for (let y = 0; y < HEIGHT; y += 1) {
  walls[at(0, y)] = WALL;
  walls[at(WIDTH - 1, y)] = WALL;
  walls[at(y < HEIGHT ? WIDTH - 1 : 0, HEIGHT - 1)] = WALL;
}
for (let x = 0; x < WIDTH; x += 1) walls[at(x, HEIGHT - 1)] = WALL;

const landmark = (x, y, prefab, rotation = 0) => ({
  type: 'Landmark',
  x,
  y,
  properties: { prefab, rotation },
});

const entities = [
  { type: 'PlayerSpawn', x: 16, y: 26, properties: { rotation: 0 } },
  { type: 'Flashlight', x: 17, y: 26, properties: {} },

  // The grove. Close spacing on the first three so a trunk lands between the camera and
  // the player as they walk north through it.
  landmark(5, 6, 'prop_tree'),
  landmark(8, 5, 'prop_tree', 37),
  landmark(6, 10, 'prop_tree', 154),
  landmark(11, 8, 'prop_tree'),
  landmark(13, 12, 'prop_tree', 71),

  // The pitch — what §9.4's stamp will place in one action.
  landmark(22, 8, 'prop_goal', 180),
  landmark(22, 20, 'prop_goal', 0),
  landmark(28, 14, 'prop_net', 90),

  // The two footprint cases, side by side.
  landmark(9, 22, 'prop_hoop'),
  landmark(13, 22, 'prop_slide', 45),
  landmark(6, 26, 'prop_swing', 90),

  // Something to find in the dark, so the map is playable rather than only lookable.
  { type: 'Note', x: 2, y: 2, properties: { noteId: 'intro', facing: 180 } },
  { type: 'SpiderEnemy', x: 24, y: 4, properties: {} },
];

const map = {
  layers: [
    { name: 'Floor', data: floor },
    { name: 'Walls', data: walls },
  ],
  entities,
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
  ...map.layers.map((layer, i) =>
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
