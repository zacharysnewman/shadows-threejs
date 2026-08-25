/**
 * Making a stamp, keeping it, and moving it as text (§9.4).
 *
 * Three things here can be wrong in ways nobody sees until a level is half built: a capture
 * that quietly drops the empty cells, a codec that loses which layers a stamp touches, and
 * an import that appends instead of replacing, so pasting back what you exported doubles
 * the library.
 */

import { describe, expect, it } from 'vitest';
import type { AuthoredEntity } from '../src/editor/Document';
import { EditorDocument } from '../src/editor/Document';
import { BUILT_IN_STAMPS, expandStamp, type Stamp } from '../src/editor/stamps';
import {
  StampLibrary,
  captureStamp,
  decodeRuns,
  formatStampFile,
  encodeRuns,
  loadProjectStamps,
  loadStamps,
  saveStamps,
  stampsFromJson,
  stampsToJson,
  uniqueStampId,
} from '../src/editor/stampLibrary';

/** A small map with a wall run, a tree and a note on the wall. */
function scene(): EditorDocument {
  const doc = EditorDocument.blank(10, 10);
  doc.edit((draft) => {
    for (let x = 2; x <= 5; x += 1) draft.layers[1]![3 * 10 + x] = 2;
    draft.layers[0]![4 * 10 + 3] = 4;
    draft.entities.push(
      { type: 'Landmark', x: 4, y: 5, properties: { prefab: 'prop_tree', rotation: 90 } },
      { type: 'Note', x: 3, y: 4, properties: { noteId: 'n1', facing: 180 } },
    );
  });
  return doc;
}

describe('capturing a stamp from the map (§9.4)', () => {
  it('takes the whole rectangle, empty cells included', () => {
    // The property laying ground depends on: a captured yard with no walls in it *clears*
    // the walls where it lands. Skipping the zeros would leave them standing, and the stamp
    // would work everywhere except over the mistake you were covering up.
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    expect(stamp.width).toBe(4);
    expect(stamp.height).toBe(3);
    expect(stamp.tiles.length).toBe(4 * 3 * 2);
    expect(stamp.tiles.filter((tile) => tile.layer === 1 && tile.id === 0).length).toBe(8);
  });

  it('measures from the rectangle\'s corner, whichever way it was dragged', () => {
    const forwards = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'a', 'A');
    const backwards = captureStamp(scene(), { x0: 5, y0: 5, x1: 2, y1: 3 }, 'a', 'A');
    expect(backwards.tiles).toEqual(forwards.tiles);
    expect(backwards.entities).toEqual(forwards.entities);
  });

  it('takes only the entities inside, offset to the corner', () => {
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    expect(stamp.entities.map((entity) => [entity.type, entity.x, entity.y])).toEqual([
      ['Landmark', 2, 2],
      ['Note', 1, 1],
    ]);
  });

  it('lifts rotation out of the properties rather than keeping two copies', () => {
    // `expandStamp` writes `rotation` from the stamp entity's own field, so a copy left in
    // `properties` is the stale one the moment the stamp is turned.
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    const tree = stamp.entities[0]!;
    expect(tree.rotation).toBe(90);
    expect(tree.properties?.['rotation']).toBeUndefined();
    expect(tree.properties?.['prefab']).toBe('prop_tree');
  });

  it('clamps a drag that ran off the edge instead of refusing it', () => {
    const stamp = captureStamp(scene(), { x0: -4, y0: -2, x1: 3, y1: 2 }, 'a', 'A');
    expect(stamp.width).toBe(4);
    expect(stamp.height).toBe(3);
  });

  it('survives a round trip through the map: capture, place, and it is what it was', () => {
    const doc = scene();
    const stamp = captureStamp(doc, { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    const placed = expandStamp(stamp, 2, 3, 0);

    for (const tile of placed.tiles) {
      expect(tile.id, `${tile.layer} at ${tile.x},${tile.y}`)
        .toBe(doc.tileAt(tile.layer, tile.x, tile.y));
    }
    for (const entity of placed.entities) {
      const original = doc.entityAt(entity.x, entity.y)!;
      expect(entity.type).toBe(original.type);
      expect(Number(entity.properties['rotation'] ?? 0))
        .toBe(Number(original.properties['rotation'] ?? 0));
    }
  });
});

describe('rotating what a capture picked up (§9.4)', () => {
  it('turns a note\'s facing with the wall it is mounted on', () => {
    // `facing` is which wall the note is on (§9.2), and the wall just rotated. A facing
    // left where it was describes a wall that is no longer there.
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    const facingAfter = (turns: number): number => {
      const note = expandStamp(stamp, 0, 0, turns).entities.find((e) => e.type === 'Note')!;
      return Number(note.properties['facing']);
    };
    expect(facingAfter(0)).toBe(180);
    expect(facingAfter(1)).toBe(270);
    expect(facingAfter(2)).toBe(0);
    expect(facingAfter(3)).toBe(90);
  });

  it('leaves an entity with no angles alone', () => {
    const stamp: Stamp = {
      id: 'x', label: 'X', width: 2, height: 2,
      tiles: [{ layer: 0, x: 0, y: 0, id: 1 }],
      entities: [{ type: 'SpiderEnemy', x: 0, y: 0, properties: { } }],
    };
    const spider = expandStamp(stamp, 0, 0, 1).entities[0]!;
    expect(spider.properties['facing']).toBeUndefined();
  });
});

describe('the exchange format (§9.4)', () => {
  it('collapses a filled rectangle to a single run', () => {
    // The reason the format exists: a captured yard is a few hundred cells that are almost
    // all the same, and one object per cell is not something a person pastes into a message.
    const stamp = BUILT_IN_STAMPS.find((s) => s.id === 'soccer-field')!;
    const runs = encodeRuns(stamp.tiles, stamp.width);
    expect(runs).toEqual([0, 96, 4]);
  });

  it('round-trips cells through runs, gaps and all', () => {
    const tiles = [
      { layer: 0, x: 0, y: 0, id: 4 },
      { layer: 0, x: 1, y: 0, id: 4 },
      { layer: 0, x: 3, y: 0, id: 7 },
      { layer: 0, x: 0, y: 1, id: 4 },
    ];
    expect(decodeRuns(encodeRuns(tiles, 4), 0, 4)).toEqual(tiles);
  });

  it('keeps which layers a stamp touches', () => {
    // A grove writes floor and leaves the walls alone. Densifying it on export would make
    // an imported grove flatten walls that the one in the project does not.
    const grove = BUILT_IN_STAMPS.find((s) => s.id === 'grove')!;
    const back = stampsFromJson(stampsToJson([grove]))[0]!;
    expect(new Set(back.tiles.map((tile) => tile.layer))).toEqual(new Set([0]));
    expect(back.tiles).toEqual(grove.tiles);
  });

  it('round-trips every built-in unchanged', () => {
    const back = stampsFromJson(stampsToJson(BUILT_IN_STAMPS));
    expect(back.length).toBe(BUILT_IN_STAMPS.length);
    BUILT_IN_STAMPS.forEach((stamp, index) => {
      expect(back[index]?.id).toBe(stamp.id);
      expect(back[index]?.label).toBe(stamp.label);
      expect(back[index]?.width).toBe(stamp.width);
      expect(back[index]?.height).toBe(stamp.height);
      expect(back[index]?.tiles).toEqual(stamp.tiles);
      expect(back[index]?.entities.map((e) => [e.type, e.x, e.y, e.rotation ?? 0])).toEqual(
        stamp.entities.map((e) => [e.type, e.x, e.y, e.rotation ?? 0]),
      );
    });
  });

  it('drops a malformed entry rather than the whole paste', () => {
    // This is text somebody pasted. One bad entry should cost that entry.
    const good = stampsToJson([BUILT_IN_STAMPS[0]!]).stamps[0];
    const parsed = stampsFromJson({
      stamps: [{ label: 'no id' }, { id: 'empty', width: 2, height: 2 }, good],
    });
    expect(parsed.map((stamp) => stamp.id)).toEqual([BUILT_IN_STAMPS[0]!.id]);
  });

  it('keeps the runs on one line, so the export is pasteable', () => {
    // Indented per number, a 12 x 10 yard is hundreds of lines of single digits. The runs
    // are not text anybody reads; the structure around them is.
    const yard: Stamp = {
      id: 'yard', label: 'Yard', width: 4, height: 2,
      tiles: decodeRuns([0, 8, 4], 0, 4), entities: [],
    };
    const text = formatStampFile(stampsToJson([yard]));
    expect(text).toContain('"0": [0, 8, 4]');
    // And it is still JSON that parses back to the same stamp.
    expect(stampsFromJson(JSON.parse(text))[0]?.tiles).toEqual(yard.tiles);
  });

  it('leaves the rest of the structure indented', () => {
    const text = formatStampFile(stampsToJson([BUILT_IN_STAMPS[0]!]));
    expect(text).toContain('\n  "stamps": [');
    expect(text.split('\n').length).toBeGreaterThan(5);
  });

  it('reads a bare array as well as a wrapped one', () => {
    expect(stampsFromJson(stampsToJson([BUILT_IN_STAMPS[0]!]).stamps).length).toBe(1);
  });
});

describe('the library (§9.4)', () => {
  const stamp = (id: string): Stamp => ({
    id, label: id, width: 1, height: 1,
    tiles: [{ layer: 0, x: 0, y: 0, id: 1 }], entities: [],
  });

  it('offers the project\'s stamps first, then the captured ones', () => {
    const library = new StampLibrary();
    library.add(stamp('mine'));
    expect(library.all.map((s) => s.id).slice(0, BUILT_IN_STAMPS.length))
      .toEqual(BUILT_IN_STAMPS.map((s) => s.id));
    expect(library.all.at(-1)?.id).toBe('mine');
  });

  it('never lets a capture take a built-in\'s id', () => {
    // Otherwise deleting a captured stamp would delete a definition out of the project,
    // from a text field, with no way back.
    const library = new StampLibrary();
    const id = library.add(stamp('soccer-field'));
    expect(id).not.toBe('soccer-field');
    expect(library.isCustom('soccer-field')).toBe(false);
    expect(library.byId('soccer-field')).toBe(BUILT_IN_STAMPS.find((s) => s.id === 'soccer-field'));
  });

  it('deletes only what it captured', () => {
    const library = new StampLibrary();
    const id = library.add(stamp('mine'));
    library.remove(id);
    expect(library.custom.length).toBe(0);
    library.remove('soccer-field');
    expect(library.all.length).toBe(BUILT_IN_STAMPS.length);
  });

  it('replaces on import rather than appending, so a paste-back is not a duplicate', () => {
    const library = new StampLibrary();
    library.add(stamp('yard'));
    const exported = library.toJson();

    library.merge(stampsFromJson(exported));
    expect(library.custom.length).toBe(1);

    library.merge(stampsFromJson(exported));
    expect(library.custom.length).toBe(1);
  });

  it('exports the captured stamps and not the project\'s', () => {
    const library = new StampLibrary();
    library.add(stamp('mine'));
    const ids = (library.toJson().stamps as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(['mine']);
  });

  it('names a second stamp of the same name rather than overwriting the first', () => {
    expect(uniqueStampId('Back yard', [])).toBe('back-yard');
    expect(uniqueStampId('Back yard', ['back-yard'])).toBe('back-yard-2');
    expect(uniqueStampId('Back yard', ['back-yard', 'back-yard-2'])).toBe('back-yard-3');
    expect(uniqueStampId('!!!', [])).toBe('stamp');
  });
});

describe('the project\'s pieces (§9.4)', () => {
  const piece = (id: string, label = id): Stamp => ({
    id, label, width: 1, height: 1,
    tiles: [{ layer: 0, x: 0, y: 0, id: 1 }], entities: [],
  });

  it('joins the defaults rather than replacing the palette', () => {
    const library = new StampLibrary();
    library.setProject([piece('loading-bay', 'Loading bay')]);
    expect(library.all.map((s) => s.id)).toEqual([
      ...BUILT_IN_STAMPS.map((s) => s.id),
      'loading-bay',
    ]);
  });

  it('replaces a default of the same id, in place', () => {
    // The file is the level's and the defaults are only where it starts, so committing a
    // better soccer field is committing `soccer-field` — not `soccer-field-2` sitting beside
    // the one it was meant to supersede.
    const library = new StampLibrary();
    library.setProject([piece('soccer-field', 'The pitch')]);
    expect(library.all.length).toBe(BUILT_IN_STAMPS.length);
    expect(library.byId('soccer-field')?.label).toBe('The pitch');
  });

  it('is not deletable and is not exported', () => {
    const library = new StampLibrary();
    library.setProject([piece('loading-bay')]);
    library.remove('loading-bay');
    expect(library.byId('loading-bay')).toBeDefined();
    expect((library.toJson().stamps as { id: string }[]).length).toBe(0);
  });

  it('renames a captured stamp whose id the project has taken', () => {
    // Two entries with one id would make `byId` answer for whichever came first: Delete
    // would remove a stamp the designer was not looking at, and the one they *were* looking
    // at is the one that cannot be deleted.
    const library = new StampLibrary();
    library.add(piece('loading-bay', 'Mine'));
    library.setProject([piece('loading-bay', 'Theirs')]);

    const ids = library.all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(library.byId('loading-bay')?.label).toBe('Theirs');
    expect(library.custom[0]?.label).toBe('Mine');
    expect(library.custom[0]?.id).not.toBe('loading-bay');
  });

  it('treats a paste of a project stamp as a new capture, not an overwrite', () => {
    const library = new StampLibrary();
    library.setProject([piece('loading-bay')]);
    library.merge([piece('loading-bay', 'Edited')]);
    expect(library.byId('loading-bay')?.label).toBe('loading-bay');
    expect(library.custom.length).toBe(1);
    expect(library.custom[0]?.id).not.toBe('loading-bay');
  });

  it('loads the file, and shrugs off every way it can be missing', async () => {
    const ok = stampsToJson([piece('loading-bay', 'Loading bay')]);
    const responses: Record<string, () => Promise<Response>> = {
      // The file, as committed.
      good: async () => new Response(JSON.stringify(ok), { status: 200 }),
      // A static host answering an unknown path with the app's own index.html and a 200,
      // which is the failure that looks like success (§1).
      html: async () => new Response('<!doctype html><html></html>', { status: 200 }),
      missing: async () => new Response('', { status: 404 }),
      offline: async () => {
        throw new Error('network');
      },
    };

    const original = globalThis.fetch;
    try {
      for (const [name, respond] of Object.entries(responses)) {
        globalThis.fetch = respond as typeof fetch;
        const stamps = await loadProjectStamps('/stamps.json');
        expect(stamps.length, name).toBe(name === 'good' ? 1 : 0);
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('keeping the library between sessions (§9.4)', () => {
  /** A `Storage` that is only a map, which is all this uses of it. */
  function fakeStore(): Storage {
    const data = new Map<string, string>();
    return {
      get length() { return data.size; },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => void data.delete(key),
      setItem: (key: string, value: string) => void data.set(key, value),
    } as Storage;
  }

  it('comes back with what was captured, and nothing else', () => {
    const store = fakeStore();
    const library = new StampLibrary();
    library.add({
      id: 'yard', label: 'Yard', width: 2, height: 1,
      tiles: [{ layer: 0, x: 0, y: 0, id: 4 }, { layer: 0, x: 1, y: 0, id: 4 }],
      entities: [{ type: 'Landmark', x: 0, y: 0, rotation: 90, properties: { prefab: 'prop_tree' } }],
    });
    saveStamps(library, store);

    const back = loadStamps(store);
    expect(back.custom.length).toBe(1);
    expect(back.custom[0]?.label).toBe('Yard');
    expect(back.custom[0]?.entities[0]?.rotation).toBe(90);
    expect(back.all.length).toBe(BUILT_IN_STAMPS.length + 1);
  });

  it('starts empty rather than throwing on a store full of nonsense', () => {
    const store = fakeStore();
    store.setItem('shadows.editor.stamps', 'not json');
    expect(loadStamps(store).custom.length).toBe(0);
  });

  it('edits without a store rather than refusing to', () => {
    // A private window, or a browser with site data blocked. Losing a stamp is not a reason
    // to stop editing (§9.3).
    const library = new StampLibrary();
    expect(() => saveStamps(library, null)).not.toThrow();
    expect(loadStamps(null).custom.length).toBe(0);
  });
});

describe('what a capture does not carry (§9.4)', () => {
  it('leaves no trace of the stamp in what it places', () => {
    // The property §2's flatness rests on, checked on the captured path too: what lands is
    // tiles and entities, indistinguishable from hand-drawn ones.
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    const serialised = JSON.stringify(expandStamp(stamp, 0, 0, 1));
    expect(serialised).not.toContain('yard');
    expect(serialised).not.toContain('Yard');
    expect(serialised).not.toContain('stamp');
  });

  it('produces entities the map format accepts', () => {
    const stamp = captureStamp(scene(), { x0: 2, y0: 3, x1: 5, y1: 5 }, 'yard', 'Yard');
    for (const entity of expandStamp(stamp, 0, 0, 2).entities as AuthoredEntity[]) {
      expect(typeof entity.type).toBe('string');
      expect(Number.isInteger(entity.x)).toBe(true);
      expect(Number.isInteger(entity.y)).toBe(true);
      expect(entity.properties).toBeTypeOf('object');
    }
  });
});
