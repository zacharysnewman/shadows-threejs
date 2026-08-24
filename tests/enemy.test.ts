/** The shared enemy: states, speeds, pathing, avoidance and the contact check (§5, §5.3). */

import { describe, expect, it } from 'vitest';
import { ENEMY } from '../src/config';
import { Rng } from '../src/core/rng';
import { Enemy, ENEMY_PROFILES } from '../src/enemies/Enemy';
import { EnemyManager } from '../src/enemies/EnemyManager';
import {
  TICK,
  contextFor,
  fakeIllumination,
  fakePlayer,
  run,
  world,
} from './support/world';

function spider(x: number, z: number, rng = new Rng(1)): Enemy {
  return new Enemy(ENEMY_PROFILES.SpiderEnemy, 'spider#0', x, z, rng);
}

const OPEN = Array.from({ length: 12 }, () => ' '.repeat(12));

describe('Enemy movement', () => {
  it('walks at §5\'s pursue speed when it is chasing', () => {
    const built = world(OPEN);
    const enemy = spider(5, 5);
    run(enemy, contextFor(built, 18, 5), 1.5);

    expect(enemy.state).toBe('pursue');
    expect(enemy.speed).toBeCloseTo(ENEMY.spider.pursueSpeed, 1);
  });

  it('closes the distance to a player it can see', () => {
    const built = world(OPEN);
    const enemy = spider(5, 5);
    const before = enemy.distanceTo(18, 5);
    const seconds = 2;
    run(enemy, contextFor(built, 18, 5), seconds);

    // Against §5's pursue speed rather than a metre count: how far two seconds of chasing
    // covers is a speed times a time, and a literal here breaks on the next tuning pass.
    const closed = ENEMY.spider.pursueSpeed * seconds * 0.8;
    expect(enemy.distanceTo(18, 5)).toBeLessThan(before - closed);
  });

  it('drifts at wander speed when there is nobody to chase', () => {
    const built = world(OPEN);
    const enemy = spider(5, 5);
    // Far outside the spider's detection range (§5).
    run(enemy, contextFor(built, 200, 200), 3);

    expect(enemy.state).toBe('wander');
    expect(enemy.speed).toBeLessThanOrEqual(ENEMY.spider.wanderSpeed + 0.05);
  });

  it('stands still while frozen, whatever it was doing (§5.2)', () => {
    const built = world(OPEN);
    const enemy = spider(5, 5);
    run(enemy, contextFor(built, 12, 5), 1);
    expect(enemy.speed).toBeGreaterThan(1);

    enemy.setState('frozen');
    const position = enemy.position.clone();
    run(enemy, contextFor(built, 12, 5), 1);

    // §5.1 — the velocity drops to zero rather than decaying, so it does not slide on.
    expect(enemy.speed).toBe(0);
    expect(enemy.position.distanceTo(position)).toBe(0);
  });

  it('releases a recoil hold on its own and goes back to pursuing (§5.3)', () => {
    const built = world(OPEN);
    const enemy = spider(5, 5);
    enemy.setState('recoil', 1.0);

    run(enemy, contextFor(built, 12, 5), 0.5);
    expect(enemy.state).toBe('recoil');

    run(enemy, contextFor(built, 12, 5), 0.7);
    expect(enemy.state).toBe('pursue');
  });

  it('never walks through a wall', () => {
    const built = world([
      '            ',
      '            ',
      '############',
      '            ',
      '            ',
    ]);
    const enemy = spider(11, 7); // south of the wall
    run(enemy, contextFor(built, 11, 1), 4); // player north of it

    // Wall spans world z 4..6; the body has to stay clear of it by its own radius.
    expect(enemy.position.y).toBeGreaterThan(6 + ENEMY.spider.radius - 0.05);
  });
});

describe('Enemy pathing', () => {
  it('routes around an obstacle instead of pressing into it', () => {
    // A wall between the two with a gap at the east end.
    const built = world([
      '            ',
      '            ',
      '#########   ',
      '            ',
      '            ',
    ]);
    const enemy = spider(3, 7);
    const context = contextFor(built, 3, 1);

    run(enemy, context, 12);
    // It got to the player's side of the wall, which is only possible via the gap.
    expect(enemy.position.y).toBeLessThan(4);
  });

  it('switches from a straight line to a path when the player breaks line of sight', () => {
    const built = world([
      '            ',
      '     #      ',
      '     #      ',
      '     #      ',
      '            ',
      '            ',
    ]);
    const enemy = spider(3, 9);
    // Seen first, in the open.
    run(enemy, contextFor(built, 3, 3), 0.5);
    expect(enemy.state).toBe('pursue');

    // Player steps behind the wall: still pursuing, now with a path rather than a line.
    run(enemy, contextFor(built, 13, 5), 1);
    expect(enemy.state).toBe('pursue');
    expect(enemy.waypoints.length).toBeGreaterThan(0);
  });

  it('picks up a walkability change mid-path (§2, §6)', () => {
    // One corridor through the wall, well away from the line between the two — otherwise
    // the enemy can see the player and walks straight, with no path to invalidate.
    const built = world([
      '            ',
      '            ',
      '########  ##',
      '            ',
      '            ',
      '            ',
    ]);
    const enemy = spider(5, 9);
    const context = contextFor(built, 5, 1);

    run(enemy, context, 1);
    expect(enemy.waypoints.length).toBeGreaterThan(0);
    const before = enemy.waypoints.map((w) => `${w.x},${w.y}`).join(' ');

    // Close the corridor under it, the way a gate would (§6).
    built.grid.setOverride(8, 2, false);
    built.grid.setOverride(9, 2, false);
    run(enemy, context, 0.6);

    // The old route is gone: either a different way round, or no way at all.
    const after = enemy.waypoints.map((w) => `${w.x},${w.y}`).join(' ');
    expect(after).not.toBe(before);
  });

  it('wanders only onto walkable ground', () => {
    const built = world([
      '     ',
      ' ### ',
      ' ### ',
      ' ### ',
      '     ',
    ]);
    const enemy = spider(1, 1, new Rng(7));

    for (let i = 0; i < 40; i += 1) {
      run(enemy, contextFor(built, 500, 500), 0.5);
      const { gx, gy } = built.grid.worldToGrid(enemy.position.x, enemy.position.y);
      expect(built.grid.isWalkable(gx, gy)).toBe(true);
    }
  });

  it('is deterministic: the same seed wanders the same way', () => {
    const runOnce = (): string => {
      const built = world(OPEN);
      const enemy = spider(5, 5, new Rng(1234));
      run(enemy, contextFor(built, 500, 500), 6);
      return `${enemy.position.x.toFixed(4)},${enemy.position.y.toFixed(4)}`;
    };
    expect(runOnce()).toBe(runOnce());
  });
});

describe('local avoidance', () => {
  it('pushes two spiders apart rather than letting them stack', () => {
    const built = world(OPEN);
    const a = spider(9, 9);
    const b = new Enemy(ENEMY_PROFILES.SpiderEnemy, 'spider#1', 9.3, 9, new Rng(2));
    const neighbours = [a, b];

    // Both chasing the same player from almost the same spot.
    for (let i = 0; i < 120; i += 1) {
      const context = contextFor(built, 18, 9, { neighbours: neighbours });
      a.tick(TICK, context);
      b.tick(TICK, context);
    }

    expect(a.position.distanceTo(b.position)).toBeGreaterThan(0.5);
  });

  it('leaves the Shadow Monster out of it — it ignores other entity colliders (§5)', () => {
    const built = world(OPEN);
    const monster = new Enemy(ENEMY_PROFILES.ShadowMonster, 'monster#0', 9, 9, new Rng(3));
    const other = new Enemy(ENEMY_PROFILES.ShadowMonster, 'monster#1', 9.1, 9, new Rng(4));

    for (let i = 0; i < 60; i += 1) {
      const context = contextFor(built, 18, 9, { neighbours: [monster, other] });
      monster.tick(TICK, context);
      other.tick(TICK, context);
    }

    // Both went straight at the player; neither steered around the other.
    expect(monster.position.distanceTo(other.position)).toBeLessThan(0.4);
  });
});

describe('EnemyManager', () => {
  const entities = [
    { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
    { type: 'SpiderEnemy', x: 3, y: 3, properties: {} },
    { type: 'SpiderEnemy', x: 5, y: 3, properties: {} },
    { type: 'ShadowMonster', x: 8, y: 8, properties: {} },
  ];

  it('spawns one enemy per map entity, at its tile centre (§2)', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));

    expect(manager.count).toBe(3);
    const monster = manager.enemies.find((e) => e.profile.kind === 'ShadowMonster')!;
    expect(monster.position.x).toBeCloseTo(17);
    expect(monster.position.y).toBeCloseTo(17);
  });

  it('reports contact below the §5.3 threshold, and not above it', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    const hits: string[] = [];
    manager.onContact((enemy, distance) => hits.push(`${enemy.profile.kind}@${distance.toFixed(2)}`));

    // Player far away: nothing touches.
    manager.tick(TICK, { playerX: 200, playerZ: 200, illumination: fakeIllumination(), player: fakePlayer() });
    expect(hits).toHaveLength(0);

    // Player standing on the monster's tile.
    manager.tick(TICK, { playerX: 17, playerZ: 17, illumination: fakeIllumination(), player: fakePlayer() });
    expect(hits.some((hit) => hit.startsWith('ShadowMonster'))).toBe(true);
  });

  it('keeps reporting while the overlap lasts, since the cooldowns live on the AIs (§5.3)', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    let count = 0;
    manager.onContact(() => (count += 1));

    manager.tick(TICK, { playerX: 17, playerZ: 17, illumination: fakeIllumination(), player: fakePlayer() });
    manager.tick(TICK, { playerX: 17, playerZ: 17, illumination: fakeIllumination(), player: fakePlayer() });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('counts what its enemies are doing, for the readout', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));

    manager.tick(TICK, { playerX: 200, playerZ: 200, illumination: fakeIllumination(), player: fakePlayer() });
    expect(manager.countsByState()).toContain('×');

    // Across the map from everything: the spiders drift, and the Shadow Monster is still
    // coming, because it always knows (§5).
    const spiders = manager.enemies.filter((e) => e.profile.kind === 'SpiderEnemy');
    const monster = manager.enemies.find((e) => e.profile.kind === 'ShadowMonster')!;
    expect(spiders.every((e) => e.state === 'wander')).toBe(true);
    expect(monster.state).toBe('pursue');
    expect(manager.engagedCount).toBe(1);
  });

  it('stops ticking when the debug switch turns it off', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    const enemy = manager.enemies[0]!;
    const position = enemy.position.clone();

    manager.enabled = false;
    for (let i = 0; i < 120; i += 1) manager.tick(TICK, { playerX: 8, playerZ: 8, illumination: fakeIllumination(), player: fakePlayer() });

    expect(enemy.position.equals(position)).toBe(true);
  });
});
