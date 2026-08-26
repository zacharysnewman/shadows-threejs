/**
 * Which *tiles* are lit, for the pathfinder (§5).
 *
 * §5 makes light terrain: a spider will not path into it and the Shadow Monster pays to. So
 * A\* asks "is this tile lit" once per node it expands, a few hundred times per search, and
 * this is what makes that affordable without teaching the navigation layer what a light is.
 *
 * **A tile is lit if its centre is**, which is the same approximation the walkability grid
 * already makes about being solid (§2). A pool that covers a corner of a tile and not its
 * middle does not close that tile — light and geometry agreeing about what a tile *is* is
 * worth more than either being exact about the edges.
 *
 * **Memoised for the length of one search, never longer.** The beam moves every frame, so a
 * mask that outlived a search would route enemies around light that is no longer there.
 * `begin()` invalidates everything by bumping a counter rather than clearing an array —
 * clearing a 50×50 grid on every path of every enemy is the cost this is avoiding.
 */

import type { LitTiles } from '../nav/LitGrid';
import type { IlluminationService } from './Illumination';

/** The tile geometry this needs, which `WalkabilityGrid` satisfies structurally (§2). */
export interface TileGeometry {
  readonly width: number;
  readonly height: number;
  gridToWorld(gx: number, gy: number): { wx: number; wz: number };
}

export class LitTileQuery implements LitTiles {
  /** Which search each tile's answer belongs to; 0 is "never answered". */
  private readonly stamp: Int32Array;
  private readonly answer: Uint8Array;
  private generation = 0;
  private queries = 0;
  private misses = 0;

  constructor(
    private readonly grid: TileGeometry,
    private readonly illumination: Pick<IlluminationService, 'litAt'>,
  ) {
    const size = Math.max(0, grid.width * grid.height);
    this.stamp = new Int32Array(size);
    this.answer = new Uint8Array(size);
  }

  /**
   * Start a fresh search. Every tile is unknown again from here.
   *
   * Called per path search rather than per tick, because two searches in one tick can
   * straddle a frame in which the beam moved — and the cheap thing to do about that is to
   * not share answers between them at all.
   */
  begin(): void {
    this.generation += 1;
  }

  isLit(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.grid.width || gy >= this.grid.height) return false;
    const index = gy * this.grid.width + gx;
    this.queries += 1;

    if (this.stamp[index] === this.generation) return this.answer[index] === 1;

    const { wx, wz } = this.grid.gridToWorld(gx, gy);
    const lit = this.illumination.litAt(wx, wz);
    this.stamp[index] = this.generation;
    this.answer[index] = lit ? 1 : 0;
    this.misses += 1;
    return lit;
  }

  /** Hit rate of the per-search memo, for the debug readout — this is a §7 cost. */
  get stats(): { queries: number; misses: number } {
    return { queries: this.queries, misses: this.misses };
  }

  resetStats(): void {
    this.queries = 0;
    this.misses = 0;
  }
}
