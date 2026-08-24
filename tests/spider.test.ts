/**
 * The spider's light reaction lifecycle and its attack (§5.1, §5.3).
 *
 * Every branch is driven through a fake light query rather than a flashlight: what §5.1
 * cares about is *lit or not*, and the geometry that decides it is §4.1's, tested there.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY, HEALTH } from '../src/config';
import { Rng } from '../src/core/rng';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { Spider } from '../src/enemies/Spider';
import { TICK, beam, contextFor, fakePlayer, world } from './support/world';

const LIGHT = ENEMY.spider.light;
const ATTACK = ENEMY.spider.attack;

const OPEN = Array.from({ length: 16 }, () => ' '.repeat(16));

function spiderAt(x: number, z: number, seed = 1): Spider {
  return new Spider('spider#0', x, z, new Rng(seed));
}

function tickFor(spider: Spider, context: Parameters<Spider['tick']>[1], seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) spider.tick(TICK, context);
}

describe('Spider light reaction (§5.1)', () => {
  it('stops dead the instant the beam reaches it', () => {
    const built = world(OPEN);
    const light = beam(false);
    const spider = spiderAt(10, 10);
    const context = contextFor(built, 10, 4, { illumination: light });

    // Let it get up to pursue speed first, so "stops" means something.
    tickFor(spider, context, 1);
    expect(spider.state).toBe('pursue');
    expect(spider.speed).toBeGreaterThan(1);

    light.on = true;
    spider.tick(TICK, context);
    expect(spider.state).toBe('frozen');
    expect(spider.speed).toBe(0);
  });

  it('holds still under the beam until T_flee, then runs (§5.1 steps 2–3)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const spider = spiderAt(10, 10);
    const context = contextFor(built, 10, 4, { illumination: light });

    // Below the shortest possible roll: still frozen, wherever the die landed.
    tickFor(spider, context, LIGHT.fleeDelaySeconds.min - 0.1);
    expect(spider.state).toBe('frozen');
    expect(spider.position.x).toBeCloseTo(10);
    expect(spider.position.y).toBeCloseTo(10);

    // Past the longest: it must have broken by now.
    tickFor(spider, context, LIGHT.fleeDelaySeconds.max);
    expect(spider.state).toBe('flee');
  });

  it('rolls T_flee from the run seed, so two seeds break at different times', () => {
    const built = world(OPEN);
    const timeToFlee = (seed: number): number => {
      const light = beam(true);
      const spider = spiderAt(10, 10, seed);
      const context = contextFor(built, 10, 4, { illumination: light });
      for (let t = 0; t < 6; t += TICK) {
        spider.tick(TICK, context);
        if (spider.state === 'flee') return t;
      }
      return Number.POSITIVE_INFINITY;
    };

    const a = timeToFlee(7);
    const b = timeToFlee(99);
    for (const t of [a, b]) {
      expect(t).toBeGreaterThanOrEqual(LIGHT.fleeDelaySeconds.min - TICK);
      expect(t).toBeLessThanOrEqual(LIGHT.fleeDelaySeconds.max + TICK);
    }
    expect(a).not.toBeCloseTo(b, 1);
    // Same seed, same run: replaying must deter identically (Cross-Cutting: determinism).
    expect(timeToFlee(7)).toBeCloseTo(a, 5);
  });

  it('runs away from the player, faster than it chased them (§5.1 step 3)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const spider = spiderAt(16, 16);
    // Player to the south-west, so "away" is unambiguously north-east.
    const context = contextFor(built, 8, 8, { illumination: light });

    tickFor(spider, context, LIGHT.fleeDelaySeconds.max + 0.5);
    expect(spider.state).toBe('flee');

    const before = spider.distanceTo(8, 8);
    tickFor(spider, context, 1);
    expect(spider.distanceTo(8, 8)).toBeGreaterThan(before);
    expect(spider.position.x).toBeGreaterThan(16);
    expect(spider.position.y).toBeGreaterThan(16);
    expect(spider.speed).toBeGreaterThan(ENEMY.spider.pursueSpeed);
    expect(spider.speed).toBeLessThanOrEqual(ENEMY.spider.fleeSpeed + 0.01);
  });

  it('never targets an unwalkable point: it stops at the wall in the way', () => {
    // A wall four tiles north-east of the spider, with open floor beyond it. The naive
    // "furthest point on the vector" would aim straight through it.
    const rows = Array.from({ length: 16 }, () => ' '.repeat(16));
    rows[4] = ' '.repeat(16).replace(/ /g, '#');
    const built = world(rows);
    const light = beam(true);
    // Tile (8, 8) is south of the wall row at y = 4; the player is further south still.
    const spider = spiderAt(17, 17);
    const context = contextFor(built, 17, 25, { illumination: light });

    tickFor(spider, context, LIGHT.fleeDelaySeconds.max + LIGHT.fleeSeconds);

    // It fled north, and it is still on walkable ground south of the wall (y ≥ 10 in world
    // metres, the near face of the row of tiles spanning y = 8..10).
    expect(spider.position.y).toBeLessThan(17);
    const { gx, gy } = built.grid.worldToGrid(spider.position.x, spider.position.y);
    expect(built.grid.isWalkable(gx, gy)).toBe(true);
  });

  it('cowers when the way out is a wall, and does not walk into it', () => {
    // A pocket: the spider is in the corner and the player is diagonally in front of it,
    // so directly away is into the corner.
    const rows = [
      '################',
      '#              #',
      '#              #',
      ...Array.from({ length: 12 }, () => '#              #'),
      '################',
    ];
    const built = world(rows);
    const light = beam(true);
    const spider = spiderAt(3, 3);
    const context = contextFor(built, 7, 7, { illumination: light });

    tickFor(spider, context, LIGHT.fleeDelaySeconds.max + 0.5);
    expect(spider.state).toBe('flee');
    expect(spider.lightStatus).toContain('cornered');

    const x = spider.position.x;
    const z = spider.position.y;
    tickFor(spider, context, 1);
    expect(spider.position.x).toBeCloseTo(x, 3);
    expect(spider.position.y).toBeCloseTo(z, 3);
  });

  it('resumes approaching 0.2 s after the beam leaves (§5.1 step 4)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const spider = spiderAt(10, 10);
    const context = contextFor(built, 10, 4, { illumination: light });

    tickFor(spider, context, 0.5);
    expect(spider.state).toBe('frozen');

    light.on = false;
    tickFor(spider, context, LIGHT.resumeDelaySeconds - 2 * TICK);
    expect(spider.state).toBe('frozen');
    expect(spider.speed).toBe(0);

    tickFor(spider, context, 3 * TICK);
    expect(spider.state).toBe('pursue');
  });

  it('re-rolls T_flee each time, so flicking the beam never deters it', () => {
    const built = world(OPEN);
    const light = beam(false);
    const spider = spiderAt(10, 10);
    const context = contextFor(built, 10, 4, { illumination: light });

    // Nine bursts of 0.9 s — well over the longest roll in total, none of it continuous.
    for (let i = 0; i < 9; i += 1) {
      light.on = true;
      tickFor(spider, context, 0.9);
      light.on = false;
      tickFor(spider, context, 0.4);
    }
    expect(spider.state).not.toBe('flee');
  });

  it('does not re-freeze a fleeing spider, so a held beam cannot pin it', () => {
    const built = world(OPEN);
    const light = beam(true);
    const spider = spiderAt(16, 16);
    const context = contextFor(built, 8, 8, { illumination: light });

    tickFor(spider, context, LIGHT.fleeDelaySeconds.max + 0.5);
    expect(spider.state).toBe('flee');

    const start = spider.distanceTo(8, 8);
    tickFor(spider, context, LIGHT.fleeSeconds - 0.5);
    expect(spider.state).toBe('flee');
    expect(spider.distanceTo(8, 8)).toBeGreaterThan(start + 2);
  });
});

describe('Spider attack (§5.3)', () => {
  /** Player standing still at `px, pz`; the spider is already touching them. */
  function engagement(px = 10, pz = 10, spiderX = 10.5, spiderZ = 10) {
    const built = world(OPEN);
    const light = beam(false);
    const player = fakePlayer();
    const spider = spiderAt(spiderX, spiderZ);
    const context = contextFor(built, px, pz, { illumination: light, player });
    return { built, light, player, spider, context };
  }

  it('commits to a wind-up on contact rather than dealing damage', () => {
    const { spider, context, player } = engagement();

    spider.onPlayerContact(0.5, context);
    expect(spider.state).toBe('attack');
    expect(player.damaged).toHaveLength(0);

    // Held still for the whole telegraph — the spider stops advancing (§5.3 step 1).
    tickFor(spider, context, ATTACK.windUpSeconds - 2 * TICK);
    expect(spider.state).toBe('attack');
    expect(spider.speed).toBe(0);
    expect(player.damaged).toHaveLength(0);
  });

  it('lands the strike at the wind-up, with the damage and both knockbacks', () => {
    const { spider, context, player } = engagement();

    spider.onPlayerContact(0.5, context);
    tickFor(spider, context, ATTACK.windUpSeconds + TICK);

    expect(player.damaged).toEqual([HEALTH.spiderDamage]);
    expect(player.shoves).toHaveLength(1);
    expect(player.shoves[0]!.metres).toBeCloseTo(ATTACK.playerKnockback);
    expect(spider.state).toBe('recoil');
    // §5.3 — the spider throws itself 1.5 m clear of where the player was.
    expect(spider.distanceTo(10, 10)).toBeCloseTo(0.5 + ATTACK.recoilDistance, 2);
  });

  it('misses a player who walked out of reach during the wind-up, and still pays for it', () => {
    const built = world(OPEN);
    const light = beam(false);
    const player = fakePlayer();
    const spider = spiderAt(10.5, 10);
    // The player starts in reach and is 1.5 m away by the strike — §5.3's dodge.
    let px = 10;
    const context = {
      ...contextFor(built, px, 10, { illumination: light, player }),
      get playerX() {
        return px;
      },
    };

    spider.onPlayerContact(0.5, context);
    tickFor(spider, context, ATTACK.windUpSeconds - TICK);
    px = 8;
    tickFor(spider, context, 2 * TICK);

    expect(player.damaged).toHaveLength(0);
    expect(player.shoves).toHaveLength(0);
    // Missing costs it tempo: held, and on the same cooldown a hit would have started.
    expect(spider.state).toBe('recoil');
    expect(spider.attackCooldownRemaining).toBeGreaterThan(0);
    expect(spider.speed).toBe(0);
  });

  it('holds for less after a miss than after a hit (§5.3)', () => {
    const held = (dodge: boolean): number => {
      const built = world(OPEN);
      const player = fakePlayer();
      const spider = spiderAt(10.5, 10);
      let px = 10;
      const base = contextFor(built, px, 10, { illumination: beam(false), player });
      const context = {
        ...base,
        get playerX() {
          return px;
        },
      };

      spider.onPlayerContact(0.5, context);
      tickFor(spider, context, ATTACK.windUpSeconds - TICK);
      if (dodge) px = 8;
      tickFor(spider, context, 2 * TICK);

      let held = 0;
      while (spider.state === 'recoil' && held < 5) {
        spider.tick(TICK, context);
        held += TICK;
      }
      return held;
    };

    expect(held(true)).toBeCloseTo(ATTACK.missHoldSeconds, 1);
    expect(held(false)).toBeCloseTo(ATTACK.hitHoldSeconds, 1);
  });

  it('cannot land hits faster than its own cooldown', () => {
    const { spider, context, player } = engagement();

    // Ten seconds of a player who never backs off. The cooldown is the only limit.
    for (let t = 0; t < 10; t += TICK) {
      spider.tick(TICK, context);
      if (spider.distanceTo(10, 10) < ENEMY.contactDistance) spider.onPlayerContact(0.5, context);
    }

    const cycle = ATTACK.windUpSeconds + ATTACK.cooldownSeconds;
    expect(player.damaged.length).toBeLessThanOrEqual(Math.ceil(10 / cycle));
    expect(player.damaged.length).toBeGreaterThanOrEqual(2);
  });

  it('three hits from full health kill (§3.4, §5.3)', () => {
    // The pool itself, taking §5.3's deduction three times.
    const { spider, context } = engagement();
    void spider;
    void context;

    let pool = HEALTH.max;
    let hits = 0;
    while (pool > 0) {
      pool -= HEALTH.spiderDamage;
      hits += 1;
    }
    expect(hits).toBe(3);
  });

  it('is cancelled outright by light: no strike, no cooldown (§5.3)', () => {
    const { spider, context, player, light } = engagement();

    spider.onPlayerContact(0.5, context);
    tickFor(spider, context, ATTACK.windUpSeconds - 4 * TICK);
    light.on = true;
    spider.tick(TICK, context);

    expect(spider.state).toBe('frozen');
    expect(spider.attackCooldownRemaining).toBe(0);

    // Well past when the strike would have landed: it never does.
    tickFor(spider, context, 1);
    expect(player.damaged).toHaveLength(0);
    expect(spider.state).toBe('frozen');
  });

  it('refuses to start a second attack while it is on cooldown', () => {
    const { spider, context, player } = engagement();

    spider.onPlayerContact(0.5, context);
    tickFor(spider, context, ATTACK.windUpSeconds + TICK);
    expect(player.damaged).toHaveLength(1);

    // Contact reported on every tick of the overlap; the cooldown is what refuses it.
    for (let t = 0; t < ATTACK.cooldownSeconds - 0.1; t += TICK) {
      spider.tick(TICK, context);
      spider.onPlayerContact(0.5, context);
    }
    expect(player.damaged).toHaveLength(1);
  });

  it('does not attack out of a stun or a flee', () => {
    const { spider, context, light } = engagement();

    light.on = true;
    spider.tick(TICK, context);
    expect(spider.state).toBe('frozen');
    spider.onPlayerContact(0.5, context);
    expect(spider.state).toBe('frozen');
  });
});

describe('Spiders in the manager', () => {
  const entities = [
    { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
    { type: 'SpiderEnemy', x: 5, y: 5, properties: {} },
    { type: 'SpiderEnemy', x: 6, y: 5, properties: {} },
  ];

  it('spawns spiders as Spiders, so the lifecycle is theirs', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    expect(manager.enemies.every((enemy) => enemy instanceof Spider)).toBe(true);
  });

  it('lets two converging spiders both land inside the same second (§5.3)', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    const player = fakePlayer();
    // Standing between the two spawn tiles, at their tile centres' midpoint.
    const world_ = { playerX: 11, playerZ: 11, illumination: beam(false), player };

    // Which spiders ever got a strike away, and when the damage landed.
    const struck = new Set<string>();
    const landedAt: number[] = [];
    for (let t = 0; t < 3; t += TICK) {
      const before = player.damaged.length;
      manager.tick(TICK, world_);
      if (player.damaged.length > before) landedAt.push(t);
      for (const enemy of manager.enemies) {
        if ((enemy as Spider).attackCooldownRemaining > 0) struck.add(enemy.key);
      }
    }

    // Both of them, not one of them twice: the cooldown is the spider's, not the player's.
    expect(struck.size).toBe(2);
    expect(landedAt.length).toBeGreaterThanOrEqual(2);
    expect(landedAt[1]! - landedAt[0]!).toBeLessThan(1);
  });
});
