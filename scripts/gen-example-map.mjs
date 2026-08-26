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

/**
 * A deterministic PRNG, so the checked-in map is reproducible.
 *
 * The game's own `Rng` is seeded per run and lives in `src/`; a build script that imported
 * it would be importing TypeScript into plain node. This is a mulberry32, which is enough
 * for scattering trees and is not used for anything a player experiences.
 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(20260826);

// The fence is the level's edge, and the only fence there is (§2). It stands three tiles
// inside the map so there is ground on the far side of it: the exit is out there, and the
// gate below is the only way onto it.
const MARGIN = 3;
const FENCE_MIN = MARGIN;
const FENCE_MAX = WIDTH - 1 - MARGIN;
outline(walls, FENCE_MIN, FENCE_MIN, FENCE_MAX, FENCE_MAX, FENCE_CHAINLINK);

// The way out, set into the south run. Solid until its switch is thrown (§6).
const GATE_X = 25;
set(walls, GATE_X, FENCE_MAX, GATE_WOOD);

// The exit itself, out on the far side of the fence: a gate tile in a short stub of fence.
//
// The tile matters as much as the entity. An `ExitGate` is a *gate* — solid until the
// power routes and it swings (§6.4, §6.5) — and standing where it stood is what wins the
// run. On plain ground it would be an entity marking walkable floor, and the run would be
// won by strolling onto it with nothing routed at all. The stub either side gives it a
// hinge to turn about, and gives the player something to recognise from a distance.
const EXIT_Y = HEIGHT - 2;
set(walls, GATE_X, EXIT_Y, GATE_WOOD);
set(walls, GATE_X - 1, EXIT_Y, FENCE_CHAINLINK);
set(walls, GATE_X + 1, EXIT_Y, FENCE_CHAINLINK);

// Ground beyond the fence reads as outside: dirt rather than the yard's concrete.
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (x < FENCE_MIN || x > FENCE_MAX || y < FENCE_MIN || y > FENCE_MAX) {
      set(floor, x, y, FLOOR_DIRT);
    }
  }
}

// Clearings, and a sunken void the player cannot cross — unwalkable through Layer 0 rather
// than through a collider, which exercises both halves of the walkability rule in §2.
fill(floor, 18, 6, 32, 20, FLOOR_DIRT);
fill(floor, 24, 30, 27, 34, EMPTY);

// **Nothing is built in here.** The fence above is the only wall on the map: inside it is
// forest, and the trees below are the cover, the sight-line breaks and the shadow-casters
// that three brick buildings used to be. A level made of rooms was scaffolding for the
// systems — walls to path around, doorways to shut, corners to lose a spider behind — and
// every one of those is something a wood does better and without announcing itself.

const entities = [
  { type: 'PlayerSpawn', x: 5, y: 5, properties: { rotation: 90 } },
  { type: 'Flashlight', x: 6, y: 5, properties: {} },
  { type: 'Note', x: 9, y: 10, properties: { noteId: 'intro_yard' } },
  { type: 'Note', x: 40, y: 13, properties: { noteId: 'substation' } },

  // Three latch switches route power to the exit (§6).
  { type: 'PowerSwitch', x: 9, y: 13, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 40, y: 16, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 13, y: 38, properties: { targetId: 'MainExit', mode: 'latch' } },
  // A latch switch opens the way out through the perimeter.
  { type: 'PowerSwitch', x: 26, y: 24, properties: { targetId: 'PerimeterGate', mode: 'latch' } },
  // Toggle switches address light groups, so a lit area can be deliberately killed (§6).
  { type: 'PowerSwitch', x: 20, y: 9, properties: { targetId: 'YardLights', mode: 'toggle' } },
  { type: 'PowerSwitch', x: 33, y: 30, properties: { targetId: 'GateLights', mode: 'toggle' } },

  // Several lights share a groupId; a switch acts on the whole group at once (§2).
  { type: 'EnvironmentLight', x: 21, y: 8, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
  { type: 'EnvironmentLight', x: 29, y: 8, properties: { groupId: 'YardLights', radius: 6, intensity: 1.0 } },
  { type: 'EnvironmentLight', x: 25, y: 17, properties: { groupId: 'YardLights', radius: 7, intensity: 0.8 } },
  { type: 'EnvironmentLight', x: 30, y: 32, properties: { groupId: 'GateLights', radius: 6, intensity: 1.0 } },
  // Over the gate itself: the last stretch of the escape is lit unless the player kills it.
  { type: 'EnvironmentLight', x: GATE_X, y: FENCE_MAX - 3, properties: { groupId: 'GateLights', radius: 6, intensity: 1.0 } },

  { type: 'Gate', x: GATE_X, y: FENCE_MAX, properties: { id: 'PerimeterGate', targetId: 'PerimeterGate', locked: true } },
  // Beyond the fence: the run ends out here, on the ground the gate opens onto.
  { type: 'ExitGate', x: GATE_X, y: EXIT_Y, properties: { id: 'MainExit', locked: true, requiredSwitches: 3 } },

  { type: 'SpiderEnemy', x: 13, y: 11, properties: {} },
  { type: 'SpiderEnemy', x: 38, y: 15, properties: {} },
  { type: 'SpiderEnemy', x: 11, y: 36, properties: {} },
  { type: 'ShadowMonster', x: 25, y: 25, properties: {} },
];

/**
 * Trees, scattered like a forest (§2).
 *
 * These are `Landmark` entities because that is how a map says "a model here"; they are
 * scenery rather than landmarks in §2's navigational sense, and the section says so.
 *
 * Placement is by rejection: walk a jittered grid and drop anything that would stand on
 * something. A tree blocks its own footprint like any solid geometry, so one in a doorway
 * or on a switch is a soft-locked level — which is why the clearances below are generous
 * and why `npm test` runs the audit over this file.
 */
const occupied = new Set(entities.map((e) => `${e.x},${e.y}`));
const planted = new Set();
const solidAt = (x, y) =>
  x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ||
  walls[idx(x, y)] !== EMPTY ||
  floor[idx(x, y)] === EMPTY;

/**
 * Whether a tree can stand here.
 *
 * Three clearances, and they are different distances on purpose:
 *
 * - **Nothing solid within one tile.** Keeps trunks off the fence and out of the gateway.
 * - **No interactable within two.** A note or a switch needs room to be seen, walked up to
 *   and read; one behind a trunk is one the player never finds.
 * - **No other tree in the eight tiles around this one.** A trunk fills most of its 2 m
 *   tile, so trees on touching tiles are a wall — and a forest that walls itself off is one
 *   the audit reports as stranded ground. One clear tile between trunks is as thick as a
 *   *walkable* wood gets, and it is what the spacing above is aiming at rather than
 *   something it happens to satisfy.
 */
function plantable(x, y) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (solidAt(x + dx, y + dy)) return false;
      if (planted.has(`${x + dx},${y + dy}`)) return false;
    }
  }
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (occupied.has(`${x + dx},${y + dy}`)) return false;
    }
  }
  // The lane from the gate to the exit stays clear, in both directions through the fence.
  if (Math.abs(x - GATE_X) <= 2 && y >= FENCE_MAX - 3) return false;
  return true;
}

/**
 * A tree's spin, in degrees, from the tile it stands on.
 *
 * The same idea the surround uses for its own trees (`spinAt` in `src/map/Surround.ts`), and
 * deliberately the same *rule* rather than shared code: this is a build script running under
 * bare node and that is runtime TypeScript, and one five-line hash copied is cheaper than a
 * module that has to be importable from both.
 *
 * Position in, angle out. A tree is a thing in a place, so its spin belongs to the place: it
 * does not change because the loop reached it in a different order, or because a tree
 * somewhere else was added or moved.
 */
function spinAt(x, y) {
  const mixed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return Math.round((mixed - Math.floor(mixed)) * 360);
}

// The kit's `prop_tree`: 26 m, canopy above the camera, so what a player walks through is a
// wood of trunks and the shadows they throw (§2, Landmarks). Two hundred of them is only
// affordable because landmarks are instanced per prefab (§7) — one draw call, not two
// hundred.
//
// Close enough that trunks are a constant presence and no sightline runs the width of the
// map, open enough to walk and be chased through. The rejections below are what keep it a
// wood rather than a thicket: nothing lands on a route, a switch, or the lane to the exit.
const TREE_SPACING = 2;
for (let y = 1; y < HEIGHT - 1; y += TREE_SPACING) {
  for (let x = 1; x < WIDTH - 1; x += TREE_SPACING) {
    // Most points take a tree, jittered off the lattice: a forest, not an orchard.
    if (random() > 0.86) continue;
    const tx = x + Math.floor(random() * TREE_SPACING);
    const ty = y + Math.floor(random() * TREE_SPACING);
    if (!plantable(tx, ty)) continue;
    planted.add(`${tx},${ty}`);
    entities.push({
      type: 'Landmark',
      x: tx,
      y: ty,
      properties: { prefab: 'prop_tree', rotation: spinAt(tx, ty) },
    });
  }
}

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
