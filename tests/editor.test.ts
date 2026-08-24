/**
 * The editor's rules (§9).
 *
 * The canvas and the chrome are not here — what is testable, and what actually goes wrong,
 * is the document model and §9.2's mounting rule. The second one is a design constraint
 * derived from where the camera sits, and getting it backwards would let a level be
 * authored full of notes nobody can read.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../src/editor/Document';
import {
  ENTITIES,
  FLOOR_TILES,
  OBSTACLE_TILES,
  entityChoice,
  facingIsVisible,
  missingProperties,
  mountOptions,
  normalise,
} from '../src/editor/palette';
import { parseMap, parseTileset } from '../src/map/validate';

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_concrete', solid: false },
    '2': { prefab: 'wall_brick', solid: true },
  },
});

describe('the document (§9.1)', () => {
  it('starts as a floor with the one spawn §2 requires', () => {
    const doc = EditorDocument.blank(8, 6);
    expect(doc.width).toBe(8);
    expect(doc.tileAt(0, 3, 3)).toBe(1);
    expect(doc.tileAt(1, 3, 3)).toBe(0);
    expect(doc.entities.filter((e) => e.type === 'PlayerSpawn')).toHaveLength(1);
  });

  it('exports exactly the shape the game loads (§2)', () => {
    const doc = EditorDocument.blank(6, 4);
    doc.edit((draft) => {
      draft.layers[1]![2 * 6 + 3] = 2;
    });
    // The real validator, not a lookalike: if this parses, the game can open it.
    const map = parseMap(doc.toMapJson(), tileset);
    expect(map.warnings).toEqual([]);
    expect(map.width).toBe(6);
    expect(map.layers[1]!.data[2 * 6 + 3]).toBe(2);
  });

  it('survives a round trip through JSON', () => {
    const doc = EditorDocument.blank(5, 5);
    doc.edit((draft) => {
      draft.layers[1]![7] = 2;
      draft.entities.push({ type: 'SpiderEnemy', x: 2, y: 2, properties: {} });
    });
    const again = EditorDocument.fromJson(doc.toMapJson());
    expect(again.toMapJson()).toEqual(doc.toMapJson());
  });
});

describe('undo (§9.1)', () => {
  it('steps back and forward over edits', () => {
    const doc = EditorDocument.blank(4, 4);
    expect(doc.canUndo).toBe(false);

    doc.edit((draft) => {
      draft.layers[1]![5] = 2;
    });
    expect(doc.tileAt(1, 1, 1)).toBe(2);
    expect(doc.canUndo).toBe(true);

    doc.undo();
    expect(doc.tileAt(1, 1, 1)).toBe(0);
    doc.redo();
    expect(doc.tileAt(1, 1, 1)).toBe(2);
  });

  it('does not record an edit that changed nothing', () => {
    // Dragging a brush across one tile fires a pointer event per frame; without this, each
    // is an undo step that undoes nothing visible and the real edit is twenty taps back.
    const doc = EditorDocument.blank(4, 4);
    doc.edit((draft) => {
      draft.layers[1]![5] = 2;
    });
    for (let i = 0; i < 20; i += 1) {
      doc.edit((draft) => {
        draft.layers[1]![5] = 2;
      });
    }
    doc.undo();
    expect(doc.tileAt(1, 1, 1)).toBe(0);
    expect(doc.canUndo).toBe(false);
  });

  it('drops the redo branch once a new edit is made', () => {
    const doc = EditorDocument.blank(4, 4);
    doc.edit((draft) => {
      draft.layers[1]![5] = 2;
    });
    doc.undo();
    expect(doc.canRedo).toBe(true);
    doc.edit((draft) => {
      draft.layers[1]![6] = 2;
    });
    expect(doc.canRedo).toBe(false);
  });

  it('keeps the snapshot it handed out from being mutated underneath it', () => {
    const doc = EditorDocument.blank(4, 4);
    // Not (1, 1): a blank document already has its spawn there (§2).
    doc.edit((draft) => {
      draft.entities.push({ type: 'SpiderEnemy', x: 2, y: 2, properties: { a: 1 } });
    });
    const exported = doc.toMapJson() as {
      entities: { x: number; properties: Record<string, unknown> }[];
    };
    const spider = exported.entities.find((e) => e.x === 2)!;
    spider.properties['a'] = 999;
    expect(doc.entityAt(2, 2)?.properties['a']).toBe(1);
  });
});

describe('mounting and facing (§9.2)', () => {
  /** A 5×5 map with one wall, placed wherever the test needs it. */
  const solidAt = (wx: number, wy: number) => (x: number, y: number) => x === wx && y === wy;

  it('faces away from the wall it is mounted on', () => {
    // A wall to the north means the thing on it faces south, back towards the camera.
    expect(mountOptions(2, 2, solidAt(2, 1), false)).toEqual([180]);
    expect(mountOptions(2, 2, solidAt(3, 2), false)).toEqual([270]);
    expect(mountOptions(2, 2, solidAt(1, 2), false)).toEqual([90]);
    expect(mountOptions(2, 2, solidAt(2, 3), false)).toEqual([0]);
  });

  it('refuses the one facing the camera cannot see', () => {
    // §3.2 — the camera is pitched down with no yaw on the +Z side, so only south-facing
    // surfaces are ever seen. A wall to the south puts the note on that wall's north face,
    // which is behind it from every angle the game can be viewed from.
    expect(facingIsVisible(0)).toBe(false);
    expect(facingIsVisible(180)).toBe(true);
    expect(facingIsVisible(90)).toBe(true);
    expect(facingIsVisible(270)).toBe(true);

    expect(mountOptions(2, 2, solidAt(2, 3), true)).toEqual([]);
    expect(mountOptions(2, 2, solidAt(2, 1), true)).toEqual([180]);
  });

  it('offers every wall a switch could be on, since a switch only has to be reachable', () => {
    const surrounded = () => true;
    expect(mountOptions(2, 2, surrounded, false)).toEqual([180, 270, 0, 90]);
    // The same tile for a note: three of the four, with the unreadable one gone.
    expect(mountOptions(2, 2, surrounded, true)).toEqual([180, 270, 90]);
  });

  it('has nowhere to mount in open ground', () => {
    expect(mountOptions(2, 2, () => false, false)).toEqual([]);
  });

  it('snaps a facing to the compass', () => {
    expect(normalise(0)).toBe(0);
    expect(normalise(-90)).toBe(270);
    expect(normalise(450)).toBe(90);
    expect(normalise(181)).toBe(180);
  });
});

describe('the palette (§9.1)', () => {
  it('offers every entity type the loader accepts (§2)', () => {
    const offered = new Set(ENTITIES.map((choice) => choice.type));
    for (const type of [
      'PlayerSpawn',
      'Flashlight',
      'Note',
      'PowerSwitch',
      'EnvironmentLight',
      'Gate',
      'ExitGate',
      'SpiderEnemy',
      'ShadowMonster',
    ]) {
      expect(offered.has(type)).toBe(true);
    }
  });

  it('knows which properties §2 requires, and says when they are unset', () => {
    const note = { type: 'Note', x: 0, y: 0, properties: { noteId: '' } };
    expect(missingProperties(note)).toEqual(['noteId']);
    expect(missingProperties({ ...note, properties: { noteId: 'intro' } })).toEqual([]);

    // A gate needs both an id and a target; half-filled is still incomplete.
    const gate = { type: 'Gate', x: 0, y: 0, properties: { id: 'A', targetId: '' } };
    expect(missingProperties(gate)).toEqual(['targetId']);
  });

  it('marks the two entities §2 allows only one of', () => {
    expect(entityChoice('PlayerSpawn')?.unique).toBe(true);
    expect(entityChoice('ExitGate')?.unique).toBe(true);
    expect(entityChoice('SpiderEnemy')?.unique).toBeUndefined();
  });

  it('offers no tile the shipped tilesets cannot render (§9.1)', () => {
    // The editor writes ids; a `tileset.json` is what gives them walls and floors (§2). A
    // palette id that some map's tileset leaves undefined is a tile that silently becomes
    // empty ground when the level is opened there — including through §9.3's playtest,
    // which borrows the default map's tileset.
    const palette = new Set([...FLOOR_TILES, ...OBSTACLE_TILES].map((tile) => String(tile.id)));
    const root = new URL('../public/maps/', import.meta.url);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const tileset = JSON.parse(
        readFileSync(new URL(`${entry.name}/tileset.json`, root), 'utf8'),
      ) as { tiles: Record<string, unknown> };
      const defined = new Set(Object.keys(tileset.tiles));
      const missing = [...palette].filter((id) => !defined.has(id));
      expect(`${entry.name}: ${missing.join(', ')}`).toBe(`${entry.name}: `);
    }
  });

  it('mounts exactly the two entities §9.2 puts on walls', () => {
    expect(ENTITIES.filter((c) => c.mounts).map((c) => c.type)).toEqual(['Note', 'PowerSwitch']);
    // And only the note has to be legible from where the camera is.
    expect(ENTITIES.filter((c) => c.mustBeVisible).map((c) => c.type)).toEqual(['Note']);
  });
});
