/**
 * Interaction targeting (§3.3) and the objective chain it drives (§6): both switch modes,
 * the gate they open, the exit counter, and what a run remembers.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { INTERACTION } from '../src/config';
import { EntityRegistry } from '../src/map/EntityRegistry';
import type { MapGeometry } from '../src/map/MapGeometry';
import { buildColliders } from '../src/map/colliders';
import { WalkabilityGrid } from '../src/map/WalkabilityGrid';
import { ColliderIndex } from '../src/player/collision';
import { Gates } from '../src/world/Gates';
import { parseMap, parseTileset } from '../src/map/validate';
import type { Interactable } from '../src/world/Interaction';
import { findTarget, isInteractable } from '../src/world/Interaction';
import { NoteLibrary } from '../src/world/Notes';
import { Objectives } from '../src/world/Objectives';

const TILE = 2;

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

/** A registry from a bare entity list; the layers are the smallest thing that validates. */
function registryOf(entities: unknown[]): EntityRegistry {
  const size = 24;
  const map = parseMap(
    {
      width: size,
      height: size,
      tileSize: TILE,
      layers: [
        { name: 'Floor', data: new Array(size * size).fill(1) },
        { name: 'Walls', data: new Array(size * size).fill(0) },
      ],
      entities: [{ type: 'PlayerSpawn', x: 0, y: 0, properties: {} }, ...entities],
    },
    tileset,
  );
  return new EntityRegistry(map.entities);
}

const chain = [
  { type: 'Flashlight', x: 2, y: 2, properties: {} },
  { type: 'Note', x: 4, y: 2, properties: { noteId: 'intro' } },
  { type: 'PowerSwitch', x: 6, y: 2, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 8, y: 2, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 10, y: 2, properties: { targetId: 'MainExit', mode: 'latch' } },
  { type: 'PowerSwitch', x: 12, y: 2, properties: { targetId: 'Yard', mode: 'toggle' } },
  { type: 'PowerSwitch', x: 14, y: 2, properties: { targetId: 'SideGate', mode: 'latch' } },
  { type: 'EnvironmentLight', x: 13, y: 4, properties: { groupId: 'Yard' } },
  { type: 'Gate', x: 16, y: 2, properties: { id: 'SideGate', targetId: 'SideGate' } },
  { type: 'ExitGate', x: 20, y: 2, properties: { id: 'MainExit', requiredSwitches: 3 } },
];

function world() {
  const entities = registryOf(chain);
  return { entities, objectives: new Objectives(entities) };
}

const switchesFor = (entities: EntityRegistry, targetId: string) =>
  entities.byType('PowerSwitch').filter((s) => s.targetId === targetId);

describe('choosing a target (§3.3)', () => {
  // Three things in a row, 2 m apart at tile centres: (5,5), (9,5), (13,5) in world.
  const props = [
    { key: 'a', wx: 5, wz: 5 },
    { key: 'b', wx: 9, wz: 5 },
    { key: 'c', wx: 13, wz: 5 },
  ];

  it('takes the nearest thing inside the range', () => {
    const found = findTarget(props, { playerX: 8.5, playerZ: 5, aimX: 1, aimZ: 0 });
    expect(found?.key).toBe('b');
  });

  it('reaches nothing beyond 1.5 m', () => {
    expect(findTarget(props, { playerX: 7, playerZ: 5, aimX: 1, aimZ: 0 })).toBeNull();
    // 1.4 m away is inside; 1.6 m is not.
    expect(findTarget(props, { playerX: 9 - 1.4, playerZ: 5, aimX: 1, aimZ: 0 })?.key).toBe('b');
    expect(findTarget(props, { playerX: 9 - 1.6, playerZ: 5, aimX: 1, aimZ: 0 })).toBeNull();
  });

  it('refuses what is behind the player, and takes what is beside them', () => {
    const at = (aimX: number, aimZ: number) =>
      findTarget(props, { playerX: 9.8, playerZ: 5, aimX, aimZ })?.key ?? null;
    // The target is west of the player. Facing east is 180° off — outside ±90°.
    expect(at(1, 0)).toBeNull();
    expect(at(-1, 0)).toBe('b');
    // Exactly on the ±90° edge: due north, target due west. Inside, by the spec's ±90°.
    expect(at(0, -1)).toBe('b');
  });

  it('never refuses something the player is standing on', () => {
    // No direction to test at zero distance, and walking closer is all the player has.
    expect(findTarget(props, { playerX: 9, playerZ: 5, aimX: -1, aimZ: 0 })?.key).toBe('b');
  });

  it('agrees with the config, so tuning the range moves the test with it', () => {
    const far = [{ key: 'x', wx: 0, wz: INTERACTION.range + 0.01 }];
    const near = [{ key: 'x', wx: 0, wz: INTERACTION.range - 0.01 }];
    const query = { playerX: 0, playerZ: 0, aimX: 0, aimZ: 1 };
    expect(findTarget(far, query)).toBeNull();
    expect(findTarget(near, query)?.key).toBe('x');
  });

  it('knows which entity types the action can act on (§6)', () => {
    const entities = registryOf(chain);
    const kinds = new Set(entities.all.filter(isInteractable).map((e) => e.type));
    expect(kinds).toEqual(new Set(['Flashlight', 'Note', 'PowerSwitch', 'Gate', 'ExitGate']));
    // Not the enemies, not the lights, not the spawn.
    expect(entities.all.filter(isInteractable).map((e) => e.type)).not.toContain('EnvironmentLight');
  });
});

describe('the flashlight pick-up (§6.1)', () => {
  it('starts out of the player\'s hands when the map authors one', () => {
    const { objectives, entities } = world();
    expect(objectives.hasFlashlight).toBe(false);
    objectives.use(entities.byType('Flashlight')[0]!);
    expect(objectives.hasFlashlight).toBe(true);
  });

  it('starts in hand on a map that authors none', () => {
    const entities = registryOf([{ type: 'Note', x: 3, y: 3, properties: { noteId: 'n' } }]);
    expect(new Objectives(entities).hasFlashlight).toBe(true);
  });
});

describe('notes (§6.2)', () => {
  it('names the note to open, and counts distinct ones read', () => {
    const { objectives, entities } = world();
    const note = entities.byType('Note')[0]!;

    expect(objectives.notesRead).toBe(0);
    const result = objectives.use(note);
    expect(result.kind).toBe('note');
    expect(result.noteId).toBe('intro');
    expect(objectives.notesRead).toBe(1);

    // Re-reading is allowed and is not a second note: it stays on the map (§6.2).
    objectives.use(note);
    expect(objectives.notesRead).toBe(1);
    expect(objectives.promptFor(note)).toBe('Read again');
  });

  it('shows a placeholder for an id notes.json has no entry for', () => {
    const notes = new NoteLibrary({ intro: { title: 'Intro', body: 'Body' } });
    expect(notes.get('intro').placeholder).toBe(false);
    const missing = notes.get('nope');
    expect(missing.placeholder).toBe(true);
    expect(notes.missing.has('nope')).toBe(true);
  });
});

describe('switch modes (§6.3)', () => {
  it('toggles a light group both ways, and reports each change', () => {
    const { objectives, entities } = world();
    const toggle = switchesFor(entities, 'Yard')[0]!;
    const changes: [string, boolean][] = [];
    objectives.onPowerChange((groupId, on) => changes.push([groupId, on]));

    expect(objectives.isGroupPowered('Yard')).toBe(false);
    objectives.use(toggle);
    expect(objectives.isGroupPowered('Yard')).toBe(true);
    objectives.use(toggle);
    expect(objectives.isGroupPowered('Yard')).toBe(false);
    expect(changes).toEqual([['Yard', true], ['Yard', false]]);
  });

  it('latches one way, and firing it again is not progress', () => {
    const { objectives, entities } = world();
    const latch = switchesFor(entities, 'MainExit')[0]!;

    expect(objectives.use(latch).kind).toBe('switch');
    expect(objectives.isLatched(latch.key)).toBe(true);
    expect(objectives.exitProgress().fired).toBe(1);

    const again = objectives.use(latch);
    expect(again.kind).toBe('refused');
    expect(objectives.exitProgress().fired).toBe(1);
  });

  it('opens the gate it names, once', () => {
    const { objectives, entities } = world();
    const opened: string[] = [];
    objectives.onGateOpen((gate) => opened.push(gate.key));

    const latch = switchesFor(entities, 'SideGate')[0]!;
    objectives.use(latch);
    expect(opened).toHaveLength(1);
    expect(objectives.isGateOpen('SideGate')).toBe(true);

    objectives.use(latch);
    expect(opened).toHaveLength(1);
  });
});

describe('escaping (§6.5)', () => {
  it('does not end the run on a locked exit, however you got there', () => {
    // The bug this exists for shipped in this project's own example map: the exit stood on
    // a plain floor tile instead of a gate tile, so it was walkable from the start and the
    // run was won by walking onto it with nothing routed. The tile is the first line of
    // defence and the state is the second, because the first one lives in a map file.
    const { objectives, entities } = world();
    const exit = entities.byType('ExitGate')[0]!;
    expect(objectives.exitProgress().unlocked).toBe(false);
    expect(objectives.escapedAt(exit.gx, exit.gy)).toBe(false);
  });

  it('ends the run once the power is routed', () => {
    const { objectives, entities } = world();
    const exit = entities.byType('ExitGate')[0]!;
    for (const latch of switchesFor(entities, 'MainExit')) objectives.use(latch);

    expect(objectives.exitProgress().unlocked).toBe(true);
    expect(objectives.escapedAt(exit.gx, exit.gy)).toBe(true);
  });

  it('ends it only on the exit\'s own tile', () => {
    const { objectives, entities } = world();
    const exit = entities.byType('ExitGate')[0]!;
    for (const latch of switchesFor(entities, 'MainExit')) objectives.use(latch);

    expect(objectives.escapedAt(exit.gx + 1, exit.gy)).toBe(false);
    expect(objectives.escapedAt(exit.gx, exit.gy + 1)).toBe(false);
  });
});

describe('the exit counter (§6.5)', () => {
  it('counts distinct latch switches, and opens on the last one', () => {
    const { objectives, entities } = world();
    const latches = switchesFor(entities, 'MainExit');
    const opened: string[] = [];
    objectives.onGateOpen((gate) => opened.push(gate.type));

    expect(objectives.exitProgress()).toEqual({ fired: 0, required: 3, unlocked: false });

    objectives.use(latches[0]!);
    objectives.use(latches[0]!);
    objectives.use(latches[1]!);
    // Two distinct switches, three presses.
    expect(objectives.exitProgress()).toEqual({ fired: 2, required: 3, unlocked: false });
    expect(opened).toHaveLength(0);

    objectives.use(latches[2]!);
    expect(objectives.exitProgress()).toEqual({ fired: 3, required: 3, unlocked: true });
    // §6.5 — the last switch opens it where it stands; nothing is pressed at the gate.
    expect(opened).toEqual(['ExitGate']);
  });

  it('never moves backwards, whatever else the player does', () => {
    const { objectives, entities } = world();
    objectives.use(switchesFor(entities, 'MainExit')[0]!);
    const before = objectives.exitProgress().fired;

    const toggle = switchesFor(entities, 'Yard')[0]!;
    for (let i = 0; i < 5; i += 1) objectives.use(toggle);
    objectives.use(switchesFor(entities, 'SideGate')[0]!);
    objectives.use(entities.byType('Note')[0]!);

    expect(objectives.exitProgress().fired).toBe(before);
  });

  it('cutting a light group does not touch exit progress (§6.3)', () => {
    const { objectives, entities } = world();
    const latches = switchesFor(entities, 'MainExit');
    for (const latch of latches) objectives.use(latch);
    expect(objectives.exitProgress().unlocked).toBe(true);

    const toggle = switchesFor(entities, 'Yard')[0]!;
    objectives.use(toggle);
    objectives.use(toggle);
    expect(objectives.exitProgress().unlocked).toBe(true);
  });

  it('refuses to be opened by hand at the gate', () => {
    const { objectives, entities } = world();
    const exit = entities.byType('ExitGate')[0]! as Interactable;
    expect(objectives.use(exit).kind).toBe('refused');
    expect(objectives.exitProgress().unlocked).toBe(false);
  });
});

describe('the whole chain (§6, Phase 9 exit criteria)', () => {
  it('is completable: torch, note, three switches, exit open', () => {
    const { objectives, entities } = world();
    const gatesOpened: string[] = [];
    objectives.onGateOpen((gate) => gatesOpened.push(gate.type));

    objectives.use(entities.byType('Flashlight')[0]!);
    objectives.use(entities.byType('Note')[0]!);
    for (const latch of switchesFor(entities, 'MainExit')) objectives.use(latch);

    expect(objectives.hasFlashlight).toBe(true);
    expect(objectives.notesRead).toBe(1);
    expect(objectives.exitProgress()).toEqual({ fired: 3, required: 3, unlocked: true });
    expect(gatesOpened).toEqual(['ExitGate']);
  });
});

describe('a gate swinging open (§6.4)', () => {
  const TICK = 1 / 60;

  /** The map: a wall run across row 4 with a gate tile in it at (6, 4). */
  function gateWorld() {
    const size = 24;
    const floor = new Array(size * size).fill(1);
    const walls = new Array(size * size).fill(0);
    for (let x = 2; x <= 10; x += 1) walls[4 * size + x] = 2;
    const map = parseMap(
      {
        width: size,
        height: size,
        tileSize: TILE,
        layers: [
          { name: 'Floor', data: floor },
          { name: 'Walls', data: walls },
        ],
        entities: [
          { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
          { type: 'PowerSwitch', x: 6, y: 8, properties: { targetId: 'SideGate', mode: 'latch' } },
          { type: 'Gate', x: 6, y: 4, properties: { id: 'SideGate', targetId: 'SideGate' } },
        ],
      },
      tileset,
    );

    const grid = new WalkabilityGrid(map, tileset);
    const colliders = new ColliderIndex(
      buildColliders(map, tileset, () => 3),
      size,
      size,
      TILE,
    );
    const entities = new EntityRegistry(map.entities);
    const objectives = new Objectives(entities);

    // The geometry a gate needs is two methods; a scene is not one of them.
    const transforms = new Map<number, THREE.Matrix4>();
    const geometry = {
      obstacleInstances: new Map([[4 * size + 6, { rest: new THREE.Matrix4() }]]),
      setObstacleTransform: (tileIndex: number, m: THREE.Matrix4) =>
        transforms.set(tileIndex, m.clone()),
    } as unknown as MapGeometry;

    const gates = new Gates(geometry, grid, colliders, size, TILE);
    objectives.onGateOpen((gate) => gates.open(gate));
    return { map, grid, colliders, entities, objectives, gates, transforms, size };
  }

  function run(gates: Gates, seconds: number) {
    for (let i = 0; i < Math.round(seconds / TICK); i += 1) gates.tick(TICK);
  }

  it('stays shut to walking until the swing completes (§6.4)', () => {
    const { grid, gates, entities, objectives } = gateWorld();
    expect(grid.isWalkable(6, 4)).toBe(false);

    objectives.use(entities.byType('PowerSwitch')[0]!);
    run(gates, INTERACTION.gateSwingSeconds - 0.1);
    // Moving, but not yet passable: a gate you can walk through while it looks shut reads
    // as broken.
    expect(gates.swingingCount).toBe(1);
    expect(grid.isWalkable(6, 4)).toBe(false);

    run(gates, 0.2);
    expect(gates.swingingCount).toBe(0);
    expect(grid.isWalkable(6, 4)).toBe(true);
  });

  it('stops blocking movement at the same moment, not a moment apart', () => {
    const { colliders, gates, entities, objectives } = gateWorld();
    const wx = (6 + 0.5) * TILE;
    const wz = (4 + 0.5) * TILE;
    expect(colliders.query(wx, wz, 0.4).length).toBeGreaterThan(0);

    objectives.use(entities.byType('PowerSwitch')[0]!);
    run(gates, INTERACTION.gateSwingSeconds - 0.1);
    expect(colliders.query(wx, wz, 0.4).length).toBeGreaterThan(0);

    run(gates, 0.2);
    // The grid is what A* reads and the index is what walking hits; open to one and shut
    // to the other is a route enemies can take and the player cannot.
    expect(colliders.query(wx, wz, 0.4)).toHaveLength(0);
  });

  it('moves the tile it is drawn as, about a hinge rather than in place', () => {
    const { gates, entities, objectives, transforms, size } = gateWorld();
    objectives.use(entities.byType('PowerSwitch')[0]!);
    run(gates, INTERACTION.gateSwingSeconds);

    const matrix = transforms.get(4 * size + 6);
    expect(matrix).toBeDefined();
    const end = new THREE.Vector3().setFromMatrixPosition(matrix!);
    // Its neighbours along row 4 are solid, so the hinge is the west edge: a quarter turn
    // about it lands the tile a tile-width away, not back on its own centre.
    expect(end.distanceTo(new THREE.Vector3(0, 0, 0))).toBeGreaterThan(TILE / 2);
  });

  it('takes the same hinge every run, so a replay opens it the same way', () => {
    const first = gateWorld();
    first.objectives.use(first.entities.byType('PowerSwitch')[0]!);
    run(first.gates, INTERACTION.gateSwingSeconds);

    const second = gateWorld();
    second.objectives.use(second.entities.byType('PowerSwitch')[0]!);
    run(second.gates, INTERACTION.gateSwingSeconds);

    const a = first.transforms.get(4 * first.size + 6)!.elements;
    const b = second.transforms.get(4 * second.size + 6)!.elements;
    expect([...a]).toEqual([...b]);
  });

  it('cannot be opened twice', () => {
    const { gates, entities, objectives } = gateWorld();
    const latch = entities.byType('PowerSwitch')[0]!;
    objectives.use(latch);
    objectives.use(latch);
    expect(gates.openedCount).toBe(1);
  });
});
