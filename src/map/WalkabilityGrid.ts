/**
 * Walkability derivation and runtime mutation (§2).
 *
 * The rule from §2: a tile is walkable when its Layer 0 tile is non-zero **and** its
 * Layer 1 tile is not `solid`. Gates flip their tile's walkability at runtime (§6), so
 * the grid keeps an override map on top of the derived base and exposes a version counter
 * plus a change event — Phase 5's A\* rebuilds from that signal rather than polling.
 */

import { MAP_LIMITS } from '../config';
import type { GameMap, Tileset } from './types';

export type WalkabilityChangeListener = (grid: WalkabilityGrid) => void;

export class WalkabilityGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;

  /** Derived from the map layers; never mutated after `rebuild()`. */
  private readonly base: Uint8Array;
  /** Effective walkability = base with runtime overrides applied. */
  private readonly effective: Uint8Array;
  /** Tile index → forced walkability. Sparse: only gates and similar live here. */
  private readonly overrides = new Map<number, boolean>();

  private readonly listeners = new Set<WalkabilityChangeListener>();

  /** Bumped on every rebuild, so consumers can cheaply detect staleness. */
  private _version = 0;

  /**
   * §2 — tiles blocked by something that is not a tile: a landmark's footprint. Static,
   * so it belongs in the base grid rather than in `overrides`, which is where the things
   * that change at runtime live (§6's gates). Mixing the two would have a gate opening
   * able to unblock the goalpost standing next to it.
   */
  private readonly staticBlocked: ReadonlySet<number>;

  constructor(
    private readonly map: GameMap,
    private readonly tileset: Tileset,
    staticBlocked: Iterable<number> = [],
  ) {
    this.staticBlocked = new Set(staticBlocked);
    this.width = map.width;
    this.height = map.height;
    this.tileSize = map.tileSize;
    this.base = new Uint8Array(map.width * map.height);
    this.effective = new Uint8Array(map.width * map.height);
    this.rebuild();
  }

  get version(): number {
    return this._version;
  }

  index(gx: number, gy: number): number {
    return gy * this.width + gx;
  }

  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  /** Out-of-bounds tiles are never walkable, so callers need no bounds check of their own. */
  isWalkable(gx: number, gy: number): boolean {
    if (!this.inBounds(gx, gy)) return false;
    return this.effective[this.index(gx, gy)] === 1;
  }

  isWalkableAtWorld(wx: number, wz: number): boolean {
    const { gx, gy } = this.worldToGrid(wx, wz);
    return this.isWalkable(gx, gy);
  }

  worldToGrid(wx: number, wz: number): { gx: number; gy: number } {
    return { gx: Math.floor(wx / this.tileSize), gy: Math.floor(wz / this.tileSize) };
  }

  /** World-space centre of a tile, matching the entity mapping in §2. */
  gridToWorld(gx: number, gy: number): { wx: number; wz: number } {
    return { wx: (gx + 0.5) * this.tileSize, wz: (gy + 0.5) * this.tileSize };
  }

  /**
   * Force a tile walkable or not, overriding the derived value. Gates use this when they
   * open (§6). Passing `null` drops the override and restores the derived value.
   */
  setOverride(gx: number, gy: number, walkable: boolean | null): void {
    if (!this.inBounds(gx, gy)) return;
    const i = this.index(gx, gy);
    const current = this.overrides.get(i);
    if (walkable === null) {
      if (current === undefined) return;
      this.overrides.delete(i);
    } else {
      if (current === walkable) return;
      this.overrides.set(i, walkable);
    }
    this.rebuild();
  }

  /** Recompute the whole grid from the map layers and the current overrides. */
  rebuild(): void {
    const floor = this.map.layers[MAP_LIMITS.floorLayerIndex];
    const obstacles = this.map.layers[MAP_LIMITS.obstacleLayerIndex];

    for (let i = 0; i < this.base.length; i += 1) {
      const floorId = floor ? floor.data[i] ?? 0 : 0;
      const obstacleId = obstacles ? obstacles.data[i] ?? 0 : 0;
      const solid = this.tileset.get(obstacleId)?.solid === true;
      this.base[i] = floorId !== 0 && !solid && !this.staticBlocked.has(i) ? 1 : 0;
    }

    this.effective.set(this.base);
    for (const [i, walkable] of this.overrides) {
      this.effective[i] = walkable ? 1 : 0;
    }

    this._version += 1;
    for (const listener of this.listeners) listener(this);
  }

  onChange(listener: WalkabilityChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Count of walkable tiles — a cheap sanity number for the debug overlay. */
  walkableCount(): number {
    let n = 0;
    for (let i = 0; i < this.effective.length; i += 1) n += this.effective[i] ?? 0;
    return n;
  }
}
