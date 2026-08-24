/**
 * The level being edited (§9.1).
 *
 * A plain, serialisable document: two tile layers and a list of entities, in exactly the
 * shape §2 gives `map.json`. Nothing here knows about a canvas, a pointer or a DOM — which
 * is what lets the editing rules be tested, and what makes "export" a `JSON.stringify`
 * rather than a translation step with its own bugs.
 *
 * **Undo is by snapshot.** A 50×50 map is 2,500 tiles a layer, so a whole-document copy is
 * two short arrays and a handful of objects — cheap enough that the alternative (a command
 * log with an inverse for every operation) would be more code and more ways to be wrong,
 * for no gain a level designer would notice. The stack is capped so a long session cannot
 * grow without bound.
 */

import { MAP_LIMITS } from '../config';

/** An entity as authored, before §2's validator turns it into a `MapEntity`. */
export interface AuthoredEntity {
  type: string;
  x: number;
  y: number;
  properties: Record<string, string | number | boolean>;
}

export interface DocumentSnapshot {
  width: number;
  height: number;
  tileSize: number;
  /** Row-major, `width × height`, one per layer (§2). Index 0 is floor, 1 is obstacles. */
  layers: number[][];
  entities: AuthoredEntity[];
}

/** How many undo steps are kept. Enough for a session; not enough to grow without bound. */
const UNDO_DEPTH = 60;

export class EditorDocument {
  private snapshot: DocumentSnapshot;
  private readonly past: DocumentSnapshot[] = [];
  private readonly future: DocumentSnapshot[] = [];
  /** Bumped on every change, so a view can tell whether it needs to redraw. */
  private _version = 0;

  constructor(snapshot: DocumentSnapshot) {
    this.snapshot = clone(snapshot);
  }

  /** A blank level: all floor, no obstacles, and the one spawn §2 requires. */
  static blank(width = 32, height = 32, tileSize = 2): EditorDocument {
    const floor = new Array<number>(width * height).fill(1);
    const walls = new Array<number>(width * height).fill(0);
    return new EditorDocument({
      width,
      height,
      tileSize,
      layers: [floor, walls],
      entities: [{ type: 'PlayerSpawn', x: 1, y: 1, properties: { rotation: 0 } }],
    });
  }

  static fromJson(raw: unknown): EditorDocument {
    const data = raw as {
      width?: number;
      height?: number;
      tileSize?: number;
      layers?: { data?: number[] }[];
      entities?: AuthoredEntity[];
    };
    const width = data.width ?? 32;
    const height = data.height ?? 32;
    const layer = (index: number, fill: number): number[] => {
      const source = data.layers?.[index]?.data;
      const out = new Array<number>(width * height).fill(fill);
      if (source) for (let i = 0; i < Math.min(source.length, out.length); i += 1) out[i] = source[i]!;
      return out;
    };
    return new EditorDocument({
      width,
      height,
      tileSize: data.tileSize ?? 2,
      layers: [layer(MAP_LIMITS.floorLayerIndex, 1), layer(MAP_LIMITS.obstacleLayerIndex, 0)],
      entities: (data.entities ?? []).map((e) => ({ ...e, properties: { ...e.properties } })),
    });
  }

  get version(): number {
    return this._version;
  }

  get width(): number {
    return this.snapshot.width;
  }

  get height(): number {
    return this.snapshot.height;
  }

  get tileSize(): number {
    return this.snapshot.tileSize;
  }

  get entities(): readonly AuthoredEntity[] {
    return this.snapshot.entities;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.snapshot.width && y < this.snapshot.height;
  }

  tileAt(layer: number, x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.snapshot.layers[layer]?.[y * this.snapshot.width + x] ?? 0;
  }

  entityAt(x: number, y: number): AuthoredEntity | undefined {
    return this.snapshot.entities.find((e) => e.x === x && e.y === y);
  }

  /**
   * Run an edit as one undoable step.
   *
   * Everything that changes the document goes through here, so there is exactly one place
   * that records history — an edit path that forgot to would be an edit that undo skips
   * over, which is worse than no undo at all.
   */
  edit(change: (draft: DocumentSnapshot) => void): void {
    const before = clone(this.snapshot);
    const draft = clone(this.snapshot);
    change(draft);
    if (same(before, draft)) return;

    this.past.push(before);
    if (this.past.length > UNDO_DEPTH) this.past.shift();
    // A new edit is a new branch: whatever was undone past is no longer reachable.
    this.future.length = 0;
    this.snapshot = draft;
    this._version += 1;
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(clone(this.snapshot));
    this.snapshot = previous;
    this._version += 1;
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(clone(this.snapshot));
    this.snapshot = next;
    this._version += 1;
  }

  /** §9.3 — the level, in exactly the shape §2's loader reads. */
  toMapJson(): unknown {
    return {
      width: this.snapshot.width,
      height: this.snapshot.height,
      tileSize: this.snapshot.tileSize,
      layers: [
        { name: 'Floor', data: [...this.snapshot.layers[MAP_LIMITS.floorLayerIndex]!] },
        { name: 'Walls', data: [...this.snapshot.layers[MAP_LIMITS.obstacleLayerIndex]!] },
      ],
      entities: this.snapshot.entities.map((e) => ({ ...e, properties: { ...e.properties } })),
    };
  }
}

function clone(snapshot: DocumentSnapshot): DocumentSnapshot {
  return {
    width: snapshot.width,
    height: snapshot.height,
    tileSize: snapshot.tileSize,
    layers: snapshot.layers.map((layer) => [...layer]),
    entities: snapshot.entities.map((e) => ({ ...e, properties: { ...e.properties } })),
  };
}

/**
 * Whether an edit actually changed anything. Dragging a brush across one tile fires a
 * pointer event per frame, and without this each one would be an undo step that undoes
 * nothing visible.
 */
function same(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  if (a.entities.length !== b.entities.length) return false;
  for (let l = 0; l < a.layers.length; l += 1) {
    const left = a.layers[l]!;
    const right = b.layers[l]!;
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  }
  return JSON.stringify(a.entities) === JSON.stringify(b.entities);
}
