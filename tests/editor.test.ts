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
  DEFAULT_MAP,
  MAPS_KEY,
  PROJECT_MAPS,
  type SavedMap,
  canOverwrite,
  findMap,
  loadSavedMaps,
  mapsFromJson,
  normaliseMapName,
  putMap,
  renameMap,
  saveSavedMaps,
  uniqueMapName,
} from '../src/editor/mapLibrary';
import { previewFit } from '../src/editor/preview';
import {
  ENTITIES,
  FLOOR_TILES,
  OBSTACLE_TILES,
  entityChoice,
  facingIsVisible,
  missingProperties,
  mountOptions,
  nameSuggestions,
  normalise,
} from '../src/editor/palette';
import { parseMap, parseTileset } from '../src/map/validate';

const tileset = parseTileset({
  tiles: {
    '0': { prefab: null, solid: false },
    '1': { prefab: 'floor_grass', solid: false },
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

describe('the properties sheet (§9.1)', () => {
  it('offers §6.3\'s two switch modes rather than asking for the word', () => {
    // The bug this is the fix for: §6.5 needs `latch` switches, the audit says so, and the
    // only way to make one was to know the word and type it into a bare text box.
    const modes = entityChoice('PowerSwitch')?.choices?.['mode'];
    expect(modes).toEqual(['toggle', 'latch']);
    // The default stays `toggle` (§2): an unannotated switch must not silently be
    // irreversible progress.
    expect(entityChoice('PowerSwitch')?.defaults['mode']).toBe('toggle');
  });

  it('gives every fixed-value property its values, and only those properties', () => {
    for (const choice of ENTITIES) {
      for (const [key, options] of Object.entries(choice.choices ?? {})) {
        expect(options.length, `${choice.type}.${key}`).toBeGreaterThan(1);
        // A choice list that does not contain the default is a sheet that opens with
        // nothing selected and no way to get back to where it started.
        const fallback = String(choice.defaults[key] ?? '');
        expect(options, `${choice.type}.${key} default`).toContain(fallback);
      }
    }
  });

  it('suggests the light groups a switch could be wired to', () => {
    // §4.2 — a lamp only ever comes on if a switch names its group back, and a name typed
    // twice is a name spelled two ways.
    const entities = [
      { type: 'EnvironmentLight', x: 1, y: 1, properties: { groupId: 'Yard' } },
      { type: 'EnvironmentLight', x: 2, y: 1, properties: { groupId: 'Yard' } },
      { type: 'EnvironmentLight', x: 3, y: 1, properties: { groupId: 'Dock' } },
      { type: 'Gate', x: 4, y: 1, properties: { id: 'SideGate', targetId: '' } },
      { type: 'ExitGate', x: 5, y: 1, properties: { id: 'MainExit' } },
    ];
    expect(nameSuggestions(entities, 'group')).toEqual(['Dock', 'Yard']);
    // §6.3 — a switch acts on a light group, a gate or the exit.
    expect(nameSuggestions(entities, 'target')).toEqual(['Dock', 'MainExit', 'SideGate', 'Yard']);
    // An id somebody is inventing has nothing to suggest.
    expect(nameSuggestions(entities, 'own')).toEqual([]);
  });

  it('suggests nothing on a map that names nothing yet', () => {
    expect(nameSuggestions([{ type: 'EnvironmentLight', x: 1, y: 1, properties: {} }], 'group'))
      .toEqual([]);
  });

  it('points every id-naming property at a role that can answer it', () => {
    for (const choice of ENTITIES) {
      for (const [key, role] of Object.entries(choice.namesEntity ?? {})) {
        expect(Object.keys(choice.defaults), `${choice.type}.${key}`).toContain(key);
        expect(['target', 'group', 'own']).toContain(role);
      }
    }
  });
});

describe('the map library (§9.3)', () => {
  const store = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    } as Storage;
  };

  const some = (name: string): SavedMap => ({ name, savedAt: 1, map: { layers: [] } });

  it('ships the project maps it found on disk, `example` among them', () => {
    // Derived from the tree at build time — a manifest nobody remembers to update is how
    // this list would come to describe maps that are not there.
    expect(PROJECT_MAPS).toContain(DEFAULT_MAP);
    expect(PROJECT_MAPS).toContain('phase1-test');
  });

  it('never lets a save overwrite a project map (§9.3)', () => {
    // The rule the whole thing rests on: `public/maps/` changes through a commit.
    expect(canOverwrite({ source: 'project', name: DEFAULT_MAP })).toBe(false);
    expect(canOverwrite({ source: 'browser', name: 'yard' })).toBe(true);
    // Nothing open is not something to overwrite either — it has to be named first.
    expect(canOverwrite(null)).toBe(false);
  });

  it("refuses a browser map named after one of the project's", () => {
    // Two different things under one label in the same list, one of which cannot be
    // changed, is a menu that cannot be read.
    expect(normaliseMapName(DEFAULT_MAP)).toBeNull();
    expect(normaliseMapName('  ')).toBeNull();
    expect(normaliseMapName('  the   yard ')).toBe('the yard');
  });

  it('suggests a free name rather than one that is taken', () => {
    const maps = [some('yard'), some('yard 2')];
    expect(uniqueMapName(maps, 'yard')).toBe('yard 3');
    expect(uniqueMapName(maps, 'shed')).toBe('shed');
    // Saving out of a project map: the obvious name is exactly the unavailable one.
    expect(uniqueMapName([], DEFAULT_MAP)).toBe(`${DEFAULT_MAP} 2`);
  });

  it('replaces a map of the same name rather than sitting beside it (§9.3)', () => {
    const first = putMap([], 'yard', { v: 1 });
    const second = putMap(first, 'YARD', { v: 2 });
    expect(second).toHaveLength(1);
    expect(second[0]!.map).toEqual({ v: 2 });
    // Case-insensitively, or `Yard` and `yard` are two rows and neither is findable.
    expect(findMap(second, 'yard')?.name).toBe('YARD');
  });

  it('renames in place, and refuses a name that is taken or unusable', () => {
    const maps = [some('yard'), some('shed')];
    expect(renameMap(maps, 'yard', 'lot').map((m) => m.name)).toEqual(['lot', 'shed']);
    expect(renameMap(maps, 'yard', 'shed').map((m) => m.name)).toEqual(['yard', 'shed']);
    expect(renameMap(maps, 'yard', DEFAULT_MAP).map((m) => m.name)).toEqual(['yard', 'shed']);
    // Renaming to what it already is is not a clash with itself.
    expect(renameMap(maps, 'yard', 'Yard').map((m) => m.name)).toEqual(['Yard', 'shed']);
  });

  it('survives a stored library that is not one', () => {
    // A half-written entry costs that entry and never the editor.
    expect(mapsFromJson(null)).toEqual([]);
    expect(mapsFromJson('nonsense')).toEqual([]);
    expect(mapsFromJson([{ name: 'ok', map: { a: 1 } }, { name: '' }, { map: {} }])).toHaveLength(1);
    // A stored map that took a project name is dropped rather than shadowing it.
    expect(mapsFromJson([{ name: DEFAULT_MAP, map: {} }])).toEqual([]);
  });

  it('round-trips through storage, and reads an unwritable one as empty', () => {
    const s = store();
    saveSavedMaps([some('yard')], s);
    expect(loadSavedMaps(s).map((m) => m.name)).toEqual(['yard']);
    expect(loadSavedMaps(null)).toEqual([]);
    s.setItem(MAPS_KEY, '{oh no');
    expect(loadSavedMaps(s)).toEqual([]);
  });

  it('drops the undo stack when a map is opened over another (§9.3)', () => {
    // An undo across an open would take one map's edits back into another.
    const doc = EditorDocument.blank(8, 8);
    doc.edit((draft) => {
      draft.layers[1]![0] = 2;
    });
    expect(doc.canUndo).toBe(true);

    doc.replace(EditorDocument.blank(6, 6).toSnapshot());
    expect(doc.canUndo).toBe(false);
    expect(doc.width).toBe(6);
  });
});

describe('the map preview (§9.3)', () => {
  it('fits a map inside its box and centres it, whichever way round it is', () => {
    // The failure this holds shut is silent: a preview that overflows its box just draws
    // the bottom rows outside it, and looks like a map with nothing down there.
    const wide = previewFit(100, 10, 280, 150);
    expect(wide.zoom * 100).toBeLessThanOrEqual(280);
    expect(wide.zoom * 10).toBeLessThanOrEqual(150);
    expect(wide.offsetX).toBeCloseTo((280 - 100 * wide.zoom) / 2);
    expect(wide.offsetY).toBeCloseTo((150 - 10 * wide.zoom) / 2);

    const tall = previewFit(10, 100, 280, 150);
    expect(tall.zoom * 10).toBeLessThanOrEqual(280);
    expect(tall.zoom * 100).toBeLessThanOrEqual(150);

    // The long side decides, or a wide map is fitted by its height and runs off the sides.
    expect(previewFit(100, 10, 280, 150).zoom).toBeLessThan(previewFit(10, 10, 280, 150).zoom);
  });

  it('does not divide by a box with no room in it', () => {
    // A sheet that is hidden reports a zero-sized canvas, and a zoom of NaN paints nothing
    // and logs nothing.
    expect(previewFit(50, 50, 0, 0).zoom).toBe(0);
    expect(previewFit(50, 50, 4, 4).zoom).toBe(0);
  });
});
