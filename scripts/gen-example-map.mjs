/**
 * Regenerates `public/maps/example/map.json` (§2).
 *
 * The example map is a stand-in for the real level (Phase 11), which will be authored in
 * a 2D tile editor. Keeping the generator in the repo means the checked-in JSON can be
 * reproduced and edited as data rather than by hand-patching a 2,500-entry array.
 *
 *   node scripts/gen-example-map.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/maps/example/map.json');

const WIDTH = 50;
const HEIGHT = 50;
const TILE_SIZE = 2.0;

const EMPTY = 0;
const FLOOR_CONCRETE = 1;
const WALL_BRICK = 2;
const FENCE_CHAINLINK = 3;
const FLOOR_DIRT = 4;
const GATE_WOOD = 5;

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

// Outer boundary.
outline(walls, 0, 0, WIDTH - 1, HEIGHT - 1, WALL_BRICK);

// A dirt yard through the middle of the map, and a sunken void the player cannot cross —
// unwalkable through Layer 0 rather than through a collider, which exercises both halves
// of the walkability rule in §2.
fill(floor, 18, 4, 32, 20, FLOOR_DIRT);
fill(floor, 24, 30, 27, 34, EMPTY);

// Interior structures: three buildings with doorways, plus a fenced compound.
outline(walls, 4, 4, 14, 14, WALL_BRICK);
fill(walls, 9, 14, 9, 14, EMPTY); // doorway, south wall

outline(walls, 34, 6, 45, 18, WALL_BRICK);
fill(walls, 34, 12, 34, 12, EMPTY); // doorway, west wall

outline(walls, 6, 28, 20, 42, WALL_BRICK);
fill(walls, 13, 28, 13, 28, EMPTY); // doorway, north wall
fill(walls, 20, 36, 20, 36, EMPTY); // doorway, east wall

outline(walls, 30, 26, 46, 44, FENCE_CHAINLINK);
// The compound's only way in is a gate; it starts solid and flips walkability when opened.
set(walls, 30, 35, GATE_WOOD);

// Freestanding cover so the flashlight has something to throw shadows from (§7).
fill(walls, 22, 22, 23, 23, WALL_BRICK);
fill(walls, 40, 22, 41, 22, WALL_BRICK);
fill(walls, 16, 20, 16, 24, WALL_BRICK);

const entities = [
  { type: 'PlayerSpawn', x: 2, y: 2, properties: { rotation: 90 } },
  { type: 'Flashlight', x: 3, y: 2, properties: {} },
  { type: 'Note', x: 8, y: 9, properties: { noteId: 'intro_yard' } },
  { type: 'Note', x: 40, y: 12, properties: { noteId: 'substation' } },

  // Three latch switches route power to the exit (§6).
  { type: 'PowerSwitch', x: 8, y: 12, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 40, y: 16, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 12, y: 38, properties: { targetId: 'MainExit', mode: 'latch' } },
  // A latch switch opens the compound gate.
  { type: 'PowerSwitch', x: 26, y: 24, properties: { targetId: 'CompoundGate', mode: 'latch' } },
  // Toggle switches address light groups, so a lit area can be deliberately killed (§6).
  { type: 'PowerSwitch', x: 20, y: 8, properties: { targetId: 'YardLights', mode: 'toggle' } },
  { type: 'PowerSwitch', x: 36, y: 30, properties: { targetId: 'CompoundLights', mode: 'toggle' } },

  // Several lights share a groupId; a switch acts on the whole group at once (§2).
  { type: 'EnvironmentLight', x: 21, y: 7, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
  { type: 'EnvironmentLight', x: 29, y: 7, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
  { type: 'EnvironmentLight', x: 25, y: 17, properties: { groupId: 'YardLights', radius: 7, intensity: 0.8 } },
  { type: 'EnvironmentLight', x: 36, y: 32, properties: { groupId: 'CompoundLights', radius: 6, intensity: 1.0 } },
  { type: 'EnvironmentLight', x: 43, y: 40, properties: { groupId: 'CompoundLights', radius: 6, intensity: 1.0 } },

  { type: 'Gate', x: 30, y: 35, properties: { id: 'CompoundGate', targetId: 'CompoundGate', locked: true } },
  { type: 'ExitGate', x: 44, y: 42, properties: { id: 'MainExit', locked: true, requiredSwitches: 3 } },

  { type: 'SpiderEnemy', x: 12, y: 10, properties: {} },
  { type: 'SpiderEnemy', x: 38, y: 14, properties: {} },
  { type: 'SpiderEnemy', x: 10, y: 36, properties: {} },
  { type: 'ShadowMonster', x: 25, y: 25, properties: {} },
];

const map = {
  width: WIDTH,
  height: HEIGHT,
  tileSize: TILE_SIZE,
  layers: [
    { name: 'Floor', data: floor },
    { name: 'Walls', data: walls },
  ],
  entities,
};

mkdirSync(dirname(OUT), { recursive: true });
// `data` arrays are written one map row per line: a 2,500-entry array on one line is
// unreviewable, and a row per line makes the layout legible in a diff.
const json = JSON.stringify(map, null, 2).replace(
  /"data": \[\n([\s\S]*?)\n(\s*)\]/g,
  (_match, body, closeIndent) => {
    const values = body.split(',').map((v) => v.trim());
    const rows = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      rows.push(`${closeIndent}  ${values.slice(y * WIDTH, (y + 1) * WIDTH).join(', ')}`);
    }
    return `"data": [\n${rows.join(',\n')}\n${closeIndent}]`;
  },
);
writeFileSync(OUT, `${json}\n`);
console.log(`wrote ${OUT} (${WIDTH}×${HEIGHT}, ${entities.length} entities)`);
