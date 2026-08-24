/**
 * The map audit (§2, §6): can an authored level actually be finished?
 *
 * The interesting cases are the ones a level designer creates by accident — a gate whose
 * only switch is behind itself, an exit needing more latches than the map has, a switch on
 * a wall nobody can stand next to. Each is built here as the smallest map that has it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EntityRegistry } from '../src/map/EntityRegistry';
import { auditMap } from '../src/map/audit';
import { parseMap, parseTileset } from '../src/map/validate';

const TILE = 2;

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
    '5': { prefab: 'gate_wood', solid: true },
  },
});

/**
 * A map from an ASCII sketch. `#` wall, `=` gate tile, space floor, `.` no floor at all.
 * One character per tile, so a test reads as the level it is describing.
 */
function sketch(rows: string[], entities: unknown[]) {
  const width = rows[0]!.length;
  const height = rows.length;
  const floor: number[] = [];
  const walls: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      floor.push(cell === '.' ? 0 : 1);
      walls.push(cell === '#' ? 2 : cell === '=' ? 5 : 0);
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
      entities,
    },
    tileset,
  );
  return { map, entities: new EntityRegistry(map.entities) };
}

function audit(rows: string[], entities: unknown[], noteIds: string[] = []) {
  const built = sketch(rows, entities);
  return auditMap(built.map, tileset, built.entities, { noteIds: new Set(noteIds) });
}

const codes = (result: ReturnType<typeof audit>) => result.findings.map((f) => f.code);

describe('reachability (§2, §6)', () => {
  // Two rooms, a wall between them with a gate at (4, 2).
  const TWO_ROOMS = [
    '#########',
    '#   #   #',
    '#   =   #',
    '#   #   #',
    '#########',
  ];

  it('opens a gate whose switch is on the near side, and reaches what is beyond', () => {
    const result = audit(TWO_ROOMS, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'PowerSwitch', x: 3, y: 1, properties: { targetId: 'Mid', mode: 'latch' } },
      { type: 'Gate', x: 4, y: 2, properties: { id: 'Mid', targetId: 'Mid' } },
      { type: 'ExitGate', x: 7, y: 2, properties: { id: 'Way', requiredSwitches: 0 } },
    ]);
    expect(codes(result)).not.toContain('gate-locked-out');
    expect(codes(result)).not.toContain('exit-stranded');
    expect(result.strandedTiles).toBe(0);
  });

  it('catches a gate whose only switch is behind itself', () => {
    const result = audit(TWO_ROOMS, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      // The switch is in the far room, which is exactly what the gate is guarding.
      { type: 'PowerSwitch', x: 6, y: 1, properties: { targetId: 'Mid', mode: 'latch' } },
      { type: 'Gate', x: 4, y: 2, properties: { id: 'Mid', targetId: 'Mid' } },
    ]);
    expect(codes(result)).toContain('gate-locked-out');
    expect(result.findings.find((f) => f.code === 'gate-locked-out')?.severity).toBe('blocking');
    // And the ground behind it is reported as ground nobody sees.
    expect(result.strandedTiles).toBeGreaterThan(0);
  });

  it('cascades: a gate opened by a switch behind an earlier gate', () => {
    const rows = [
      '###########',
      '#   #   # #',
      '#   =   = #',
      '#   #   # #',
      '###########',
    ];
    const result = audit(rows, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'PowerSwitch', x: 3, y: 1, properties: { targetId: 'First', mode: 'latch' } },
      { type: 'Gate', x: 4, y: 2, properties: { id: 'First', targetId: 'First' } },
      // Only reachable once `First` is open, and it opens `Second`.
      { type: 'PowerSwitch', x: 6, y: 1, properties: { targetId: 'Second', mode: 'latch' } },
      { type: 'Gate', x: 8, y: 2, properties: { id: 'Second', targetId: 'Second' } },
      { type: 'ExitGate', x: 9, y: 2, properties: { id: 'Way', requiredSwitches: 0 } },
    ]);
    expect(codes(result)).not.toContain('gate-locked-out');
    expect(codes(result)).not.toContain('exit-stranded');
  });

  it('does not let the player through a diagonal gap', () => {
    // Two rooms touching only at a corner: passable to a careless flood fill, not to feet.
    const rows = [
      '######',
      '#  ###',
      '###  #',
      '######',
    ];
    const result = audit(rows, [{ type: 'PlayerSpawn', x: 1, y: 1, properties: {} }]);
    expect(result.strandedTiles).toBeGreaterThan(0);
  });
});

describe('the objective chain (§6)', () => {
  const ROOM = ['#######', '#     #', '#     #', '#######'];

  it('catches an exit that needs more latches than the map has', () => {
    const result = audit(ROOM, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'PowerSwitch', x: 3, y: 1, properties: { targetId: 'Way', mode: 'latch' } },
      { type: 'ExitGate', x: 5, y: 2, properties: { id: 'Way', requiredSwitches: 3 } },
    ]);
    const finding = result.findings.find((f) => f.code === 'exit-underfed');
    expect(finding?.severity).toBe('blocking');
    expect(finding?.message).toContain('has 1');
  });

  it('does not count toggle switches towards the exit (§6.3)', () => {
    const result = audit(ROOM, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'PowerSwitch', x: 2, y: 1, properties: { targetId: 'Way', mode: 'latch' } },
      // A `toggle` is reversible and feeds nothing; only `latch` is progress.
      { type: 'PowerSwitch', x: 3, y: 1, properties: { targetId: 'Way', mode: 'toggle' } },
      { type: 'ExitGate', x: 5, y: 2, properties: { id: 'Way', requiredSwitches: 2 } },
    ]);
    expect(codes(result)).toContain('exit-underfed');
  });

  it('catches a switch nobody can stand next to', () => {
    // A wall block three tiles thick, with the switch buried at its centre.
    const rows = ['#########', '#  ###  #', '#  ###  #', '#########'];
    const result = audit(rows, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'PowerSwitch', x: 4, y: 1, properties: { targetId: 'Way', mode: 'latch' } },
      { type: 'ExitGate', x: 7, y: 1, properties: { id: 'Way', requiredSwitches: 1 } },
    ]);
    expect(codes(result)).toContain('exit-unreachable-switches');
  });

  it('catches an unreachable flashlight, since §6.1 gives the player none without it', () => {
    const rows = ['#######', '#  ####', '#  ####', '#######'];
    const result = audit(rows, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'Flashlight', x: 5, y: 1, properties: {} },
    ]);
    const finding = result.findings.find((f) => f.code === 'flashlight-unreachable');
    expect(finding?.severity).toBe('blocking');
  });

  it('catches a note whose text was never written (§6.2)', () => {
    const result = audit(
      ROOM,
      [
        { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
        { type: 'Note', x: 3, y: 1, properties: { noteId: 'written' } },
        { type: 'Note', x: 4, y: 1, properties: { noteId: 'forgotten' } },
      ],
      ['written'],
    );
    const finding = result.findings.find((f) => f.code === 'note-unwritten');
    expect(finding?.message).toContain('forgotten');
    expect(finding?.severity).toBe('warning');
  });

  it('catches a light group with no switch, and a switch naming nothing (§4.2)', () => {
    const result = audit(ROOM, [
      { type: 'PlayerSpawn', x: 1, y: 1, properties: {} },
      { type: 'EnvironmentLight', x: 3, y: 1, properties: { groupId: 'Yard' } },
      { type: 'PowerSwitch', x: 4, y: 1, properties: { targetId: 'Ghost', mode: 'toggle' } },
    ]);
    expect(codes(result)).toContain('group-no-switch');
    expect(codes(result)).toContain('switch-targets-nothing');
  });

  it('says nothing about a map with no exit beyond that it has none', () => {
    const result = audit(ROOM, [{ type: 'PlayerSpawn', x: 1, y: 1, properties: {} }]);
    expect(codes(result)).toEqual(['no-exit']);
    expect(result.blocking).toHaveLength(0);
  });
});

describe('the checked-in maps', () => {
  function load(name: string) {
    const dir = resolve(__dirname, '../public/maps', name);
    const set = parseTileset(JSON.parse(readFileSync(resolve(dir, 'tileset.json'), 'utf8')));
    const map = parseMap(JSON.parse(readFileSync(resolve(dir, 'map.json'), 'utf8')), set);
    return { map, set, entities: new EntityRegistry(map.entities) };
  }

  const noteIds = new Set(
    Object.keys(JSON.parse(readFileSync(resolve(__dirname, '../public/notes.json'), 'utf8'))),
  );

  it('leaves the example map completable end to end (§6)', () => {
    const { map, set, entities } = load('example');
    const result = auditMap(map, set, entities, { noteIds });
    expect(result.blocking).toEqual([]);
    expect(result.strandedTiles).toBe(0);
  });

  for (const name of ['phase2-test', 'phase3-test', 'phase5-test', 'phase7-test', 'phase8-test']) {
    it(`finds nothing blocking in ${name}`, () => {
      const { map, set, entities } = load(name);
      // The phase maps are scaffolding and mostly have no exit at all; what must hold is
      // that nothing on them is a soft-lock.
      expect(auditMap(map, set, entities, { noteIds }).blocking).toEqual([]);
    });
  }
});
