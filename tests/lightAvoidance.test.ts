/**
 * Light as terrain (§5).
 *
 * §5 gives the two enemies opposite relationships with lit ground and says the difference
 * is the design rather than an inconsistency: a spider will not enter light at all, the
 * Shadow Monster only finds it expensive, and what that asymmetry buys is that a player who
 * hides under a lamp is safe from spiders and therefore *not* safe.
 *
 * So these are about routing, not about lighting. Which tiles are lit is a rectangle here;
 * the cone and pool arithmetic that decides it in a real run belongs to `Illumination` and
 * is tested with the rest of §4.1.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY } from '../src/config';
import { Rng } from '../src/core/rng';
import { findPath } from '../src/nav/AStar';
import { litCostFor, unlitOnly, NOTHING_LIT } from '../src/nav/LitGrid';
import type { EnemyContext } from '../src/enemies/Enemy';
import { ShadowMonster } from '../src/enemies/ShadowMonster';
import { Spider } from '../src/enemies/Spider';
import { TICK, TILE, contextFor, fakeIllumination, litRect, run, world } from './support/world';

/** Twenty tiles square, nothing in it — the routing is the only thing under test. */
const OPEN = Array.from({ length: 20 }, () => ' '.repeat(20));

describe('the grid a spider plans on (§5)', () => {
  const built = world(OPEN);

  it('takes lit tiles out of the map', () => {
    const dark = unlitOnly(built.grid, litRect(5, 5, 7, 7), 0, 0);
    expect(dark.isWalkable(6, 6)).toBe(false);
    expect(dark.isWalkable(8, 8)).toBe(true);
  });

  it('leaves the tile it is standing on walkable, whatever the light is doing to it', () => {
    // Without this a spider a lamp came on over could not path at all — `findPath` refuses
    // a search whose start tile is blocked — so it could not flee, and could never cross
    // its own pool to leave. §5 puts the rule on *entering* light for exactly this reason.
    const dark = unlitOnly(built.grid, litRect(5, 5, 7, 7), 6, 6);
    expect(dark.isWalkable(6, 6)).toBe(true);
    expect(dark.isWalkable(7, 7)).toBe(false);
  });

  it('never blocks a tile the map itself has already blocked, or unblocks one', () => {
    const walled = world(['####', '#  #', '#  #', '####']);
    const dark = unlitOnly(walled.grid, NOTHING_LIT, 1, 1);
    expect(dark.isWalkable(0, 0)).toBe(false);
    expect(dark.isWalkable(1, 1)).toBe(true);
  });

  it('routes around a pool rather than through it', () => {
    const lit = litRect(9, 8, 10, 12);
    const around = findPath(unlitOnly(built.grid, lit, 4, 10), 4, 10, 15, 10, { smooth: false });
    expect(around).not.toBeNull();
    expect(around!.some((step) => lit.isLit(step.x, step.y))).toBe(false);
  });

  it('reports no route at all when light seals the way', () => {
    // A pool clean across the map: there is no way round, and §5 says a spider does not
    // make one. What the spider does about it is `onPursuitBlocked`'s business, below.
    const wall = litRect(10, 0, 10, 19);
    expect(findPath(unlitOnly(built.grid, wall, 4, 10), 4, 10, 15, 10)).toBeNull();
  });
});

describe('what light costs the Shadow Monster (§5)', () => {
  const built = world(OPEN);

  it('prefers the dark way round when there is one', () => {
    const lit = litRect(9, 9, 10, 11);
    const path = findPath(built.grid, 4, 10, 15, 10, {
      smooth: false,
      enterCost: litCostFor(lit, ENEMY.lightAvoidance.monsterLitCost),
    });
    expect(path).not.toBeNull();
    expect(path!.some((step) => lit.isLit(step.x, step.y))).toBe(false);
  });

  it('walks straight through when going round would cost more than the light does', () => {
    // Light clean across the map: every route pays, so the cheapest is the shortest. This
    // is the case that keeps §5.2 step 3 alive — a monster that would not cross a pool
    // could never sabotage the lamp making it.
    const wall = litRect(10, 0, 10, 19);
    const path = findPath(built.grid, 4, 10, 15, 10, {
      smooth: false,
      enterCost: litCostFor(wall, ENEMY.lightAvoidance.monsterLitCost),
    });
    expect(path).not.toBeNull();
    expect(path!.some((step) => wall.isLit(step.x, step.y))).toBe(true);
  });

  it('is never stopped by light, however much of it there is', () => {
    const everywhere = litRect(0, 0, 19, 19);
    const path = findPath(built.grid, 4, 10, 15, 10, {
      enterCost: litCostFor(everywhere, ENEMY.lightAvoidance.monsterLitCost),
    });
    expect(path).not.toBeNull();
  });

  it('costs a detour only up to its budget, so the price is the design value', () => {
    // The number in `config` is a detour budget in disguise, and this is what it buys: a
    // one-tile pool is worth going round, and the same pool is not worth a detour longer
    // than the multiplier. Derived from the constant rather than typed out, so a tuning
    // pass moves it here too.
    const cost = ENEMY.lightAvoidance.monsterLitCost;
    expect(cost).toBeGreaterThan(1);
    const lit = litRect(5, 5, 5, 5);
    const price = litCostFor(lit, cost);
    expect(price(5, 5)).toBe(cost);
    expect(price(6, 5)).toBe(1);
  });
});

describe('a spider meeting light on its way (§5, §5.1)', () => {
  const entities = [{ type: 'PlayerSpawn', x: 1, y: 1, properties: {} }];

  function spiderAt(x: number, z: number): Spider {
    return new Spider('spider#0', x, z, new Rng(7));
  }

  it('gives up on a player it cannot reach, rather than circling the pool', () => {
    const built = world(OPEN, entities);
    const spider = spiderAt(9, 19);
    // A wall of light between it and the player, with the player behind it: there is no
    // route, and §5 says the hunt ends on §5.1's terms rather than in a stand-off.
    const context = contextFor(built, 9, 29, { lightTiles: litRect(0, 12, 19, 12) });

    run(spider, context, 1);
    expect(spider.state).toBe('flee');
  });

  it('hunts normally when the light is not in the way', () => {
    const built = world(OPEN, entities);
    const spider = spiderAt(9, 19);
    // The same light, off to one side of the route rather than across it.
    const context = contextFor(built, 9, 29, { lightTiles: litRect(0, 0, 2, 2) });

    run(spider, context, 1);
    expect(spider.state).toBe('pursue');
  });

  it('is not blocked by light while it is standing in some (§5.1)', () => {
    const built = world(OPEN, entities);
    const spider = spiderAt(9, 19);
    // Lit, and in a pool that covers the ground around it: §5 lifts the rule for a spider
    // already in light, so it can still plan its way out. Without the exemption it would
    // be stuck in the pool for the rest of the run.
    const context = contextFor(built, 9, 29, {
      illumination: fakeIllumination(() => true),
      lightTiles: litRect(0, 8, 19, 12),
    });

    // Long enough to stun, run the longest `T_flee` out, and get a flee leg going (§5.1).
    run(spider, context, ENEMY.spider.light.fleeDelaySeconds.max + TICK * 2);
    expect(spider.state).toBe('flee');
    expect(spider.lightStatus).not.toContain('cornered');
  });
});

describe('what actually happens over a run of ticks (§5)', () => {
  const entities = [{ type: 'PlayerSpawn', x: 1, y: 1, properties: {} }];

  /** Tile centre, so a scenario can be laid out in tiles and handed to the world in metres. */
  const at = (gx: number, gy: number) => ({ x: (gx + 0.5) * TILE, z: (gy + 0.5) * TILE });

  /**
   * The pool: five tiles across the middle of a twenty-tile map, with dark ground either
   * side of it. Wide enough to be worth going round, narrow enough that going round exists.
   */
  const POOL = { x0: 7, y0: 9, x1: 11, y1: 11 };
  const pool = () => litRect(POOL.x0, POOL.y0, POOL.x1, POOL.y1);
  const inPool = (gx: number, gy: number) =>
    gx >= POOL.x0 && gx <= POOL.x1 && gy >= POOL.y0 && gy <= POOL.y1;

  /** Where an enemy went, sampled every tick, in grid coordinates. */
  function trail(
    enemy: Spider | ShadowMonster,
    context: EnemyContext,
    grid: ReturnType<typeof world>['grid'],
    seconds: number,
  ): { gx: number; gy: number }[] {
    const seen: { gx: number; gy: number }[] = [];
    for (let t = 0; t < seconds; t += TICK) {
      enemy.tick(TICK, context);
      seen.push(grid.worldToGrid(enemy.position.x, enemy.position.y));
    }
    return seen;
  }

  it('walks a monster around a pool it could otherwise walk straight through', () => {
    // The player is directly beyond the pool, which before §5 made this a straight line and
    // meant the pathfinder never ran at all — the cost could not apply, because nothing
    // asked for a route.
    const built = world(OPEN, entities);
    const from = at(9, 15);
    const to = at(9, 5);
    const monster = new ShadowMonster('monster#0', from.x, from.z, new Rng(3));
    const context = contextFor(built, to.x, to.z, { lightTiles: pool() });

    const went = trail(monster, context, built.grid, 8);
    expect(went.some((step) => inPool(step.gx, step.gy))).toBe(false);
    // Round it, not away from it: §5.2's monster is never stopped, only redirected.
    expect(monster.position.y).toBeLessThan(from.z - TILE);
  });

  it('walks a monster straight through light it cannot get around', () => {
    const built = world(OPEN, entities);
    const from = at(9, 15);
    const to = at(9, 5);
    const monster = new ShadowMonster('monster#0', from.x, from.z, new Rng(3));
    // Clean across the map: every route pays, so the cheapest is the shortest (§5).
    const context = contextFor(built, to.x, to.z, { lightTiles: litRect(0, 10, 19, 10) });

    const went = trail(monster, context, built.grid, 10);
    expect(went.some((step) => step.gy === 10)).toBe(true);
  });

  it('never walks a spider into a pool it started outside of', () => {
    const built = world(OPEN, entities);
    const from = at(9, 15);
    const to = at(9, 5);
    const spider = new Spider('spider#0', from.x, from.z, new Rng(3));
    const context = contextFor(built, to.x, to.z, { lightTiles: pool() });

    const went = trail(spider, context, built.grid, 8);
    expect(went.some((step) => inPool(step.gx, step.gy))).toBe(false);
  });
});

describe('the Shadow Monster meeting the same light (§5, §5.2)', () => {
  const entities = [{ type: 'PlayerSpawn', x: 1, y: 1, properties: {} }];

  it('keeps coming through light that would stop a spider dead', () => {
    const built = world(OPEN, entities);
    const monster = new ShadowMonster('monster#0', 9, 19, new Rng(7));
    const context = contextFor(built, 9, 29, { lightTiles: litRect(0, 12, 19, 12) });

    run(monster, context, 1);
    // §5.2 — it has no way to lose the player and no reason to stop. The same wall of light
    // that sends a spider into a flee leg is, to this, a more expensive route.
    expect(monster.state).toBe('pursue');
    expect(monster.speed).toBeGreaterThan(0);
  });
});
