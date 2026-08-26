/**
 * Light as terrain, for the pathfinder (§5).
 *
 * §5 gives the two enemies opposite relationships with lit ground: a spider will not enter
 * it at all, and the Shadow Monster merely finds it expensive. Both are expressed here, and
 * both are *pure* — a predicate in, a `PathGrid` or a cost function out. Nothing in this
 * file knows what a light is; `src/lighting/` answers that, because §4.1's query is the
 * only thing allowed to (see `Illumination`).
 *
 * **The spider's version is a grid rather than a cost, and that is load-bearing.** Making
 * lit tiles unwalkable does three jobs at once, because everything downstream already
 * consults `isWalkable`: A\* refuses to route through light, `hasLineOfSight` refuses to
 * call a line that crosses a pool clear — so a spider with the player in view still paths
 * around rather than walking straight in — and the string-pulling that straightens a
 * finished path cannot quietly put it back through the light A\* just avoided.
 */

import type { PathGrid } from './AStar';

/** Whether a tile is inside an active light volume (§4.1, §5). */
export interface LitTiles {
  isLit(gx: number, gy: number): boolean;
  /**
   * Start a fresh search, discarding whatever the last one worked out.
   *
   * On the interface rather than tucked inside an implementation because the *caller* is
   * what knows where one search ends: the beam moves every frame, so answers may be shared
   * within one path search and never between two.
   */
  begin(): void;
}

/**
 * The same grid with lit tiles taken out of it (§5 — the spider's rule).
 *
 * **The tile the search starts on is always walkable**, whatever the light is doing to it.
 * `findPath` rejects a search whose start tile is blocked, so without this exemption a
 * spider standing anywhere lit could not path at all — not to flee, not to leave the pool a
 * lamp just switched on over it. §5 puts the rule the same way round: the block is on
 * *entering* light, and one standing in it is stunned or fleeing, which §5.1 owns.
 */
export function unlitOnly(grid: PathGrid, lit: LitTiles, fromGx: number, fromGy: number): PathGrid {
  return {
    width: grid.width,
    height: grid.height,
    isWalkable(gx: number, gy: number): boolean {
      if (!grid.isWalkable(gx, gy)) return false;
      if (gx === fromGx && gy === fromGy) return true;
      return !lit.isLit(gx, gy);
    },
  };
}

/**
 * What entering each tile costs, for an enemy that finds light expensive rather than
 * impassable (§5 — the Shadow Monster's rule).
 *
 * The returned multiplier is a straight detour budget: at `litCost` 4, four tiles of
 * darkness are worth going round one tile of light, and beyond that it walks through. That
 * is what keeps §5.2 step 3 in the game — a monster that would never cross a lamp's pool
 * would never sabotage a lamp either, and §4.2's whole lifecycle would be waiting on a lamp
 * to switch on over one.
 */
export function litCostFor(lit: LitTiles, litCost: number): (gx: number, gy: number) => number {
  return (gx, gy) => (lit.isLit(gx, gy) ? litCost : 1);
}

/** Nothing is lit — for a run with no lights in it, and for tests that are about something else. */
export const NOTHING_LIT: LitTiles = { isLit: () => false, begin: () => {} };
