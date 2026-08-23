/**
 * The Shadow Monster: the freeze, the flicker ramp, the blink, and its fatal contact
 * (§5.2, §5.3). The sabotage lifecycle it triggers is in `lighting.test.ts`, with the lamp
 * that owns it.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY, FLICKER } from '../src/config';
import { Rng } from '../src/core/rng';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { ShadowMonster } from '../src/enemies/ShadowMonster';
import { flickerFraction, severityAt } from '../src/lighting/flicker';
import { TICK, beam, contextFor, fakePlayer, world } from './support/world';

const FLICK = ENEMY.shadowMonster.flicker;
const BLINK = ENEMY.shadowMonster.blink;

const OPEN = Array.from({ length: 16 }, () => ' '.repeat(16));

function monsterAt(x: number, z: number, seed = 1): ShadowMonster {
  return new ShadowMonster('monster#0', x, z, new Rng(seed));
}

function tickFor(
  monster: ShadowMonster,
  context: Parameters<ShadowMonster['tick']>[1],
  seconds: number,
  each?: () => void,
): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) {
    each?.();
    monster.tick(TICK, context);
  }
}

describe('the flicker curve (§5.2)', () => {
  it('is I_base at the sine\'s zero crossings, whatever the severity', () => {
    // t = 0 and t = π/f are both |sin| = 0: a full-strength beam.
    expect(flickerFraction(0, 0.95, 1.3)).toBeCloseTo(1);
    expect(flickerFraction(Math.PI / FLICKER.frequency, 0.95, 1.3)).toBeCloseTo(1);
  });

  it('dips deepest at the sine\'s peak, by exactly severity × jitter', () => {
    const peak = Math.PI / 2 / FLICKER.frequency;
    expect(flickerFraction(peak, 0.95, 1.0)).toBeCloseTo(1 - 0.95);
    expect(flickerFraction(peak, 0.5, 1.2)).toBeCloseTo(1 - 0.6);
  });

  it('never reports a negative beam', () => {
    const peak = Math.PI / 2 / FLICKER.frequency;
    expect(flickerFraction(peak, 0.95, FLICKER.jitter.max)).toBeGreaterThanOrEqual(0);
  });

  it('ramps 0.1 → 0.95 over three seconds and holds there', () => {
    const at = (t: number) =>
      severityAt(t, FLICK.rampSeconds, FLICK.severity.from, FLICK.severity.to);
    expect(at(0)).toBeCloseTo(0.1);
    expect(at(1.5)).toBeCloseTo(0.525);
    expect(at(3)).toBeCloseTo(0.95);
    expect(at(10)).toBeCloseTo(0.95);
  });

  it('keeps the blink threshold out of reach until the ramp is half way', () => {
    // §5.2 — the threshold needs severity × |sin| × jitter > 0.65, and the deepest
    // possible dip at severity s is s × 1.3. Below 0.5 there is no draw that reaches it.
    const deepest = (severity: number) => 1 - severity * 1.0 * FLICKER.jitter.max;
    expect(deepest(0.1)).toBeGreaterThan(BLINK.intensityThreshold);
    expect(deepest(0.49)).toBeGreaterThan(BLINK.intensityThreshold);
    expect(deepest(0.95)).toBeLessThan(BLINK.intensityThreshold);
  });
});

describe('Shadow Monster freeze (§5.2)', () => {
  it('cannot move while anything is lighting it', () => {
    const built = world(OPEN);
    const light = beam(false);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    tickFor(monster, context, 1);
    expect(monster.state).toBe('pursue');
    expect(monster.speed).toBeGreaterThan(1);

    light.on = true;
    monster.tick(TICK, context);
    expect(monster.state).toBe('frozen');
    expect(monster.speed).toBe(0);

    // A second of it — short of the 1.4 s at which the blink below becomes reachable, so
    // this window is the freeze and nothing else.
    const where = monster.position.clone();
    tickFor(monster, context, 1);
    expect(monster.position.x).toBeCloseTo(where.x, 6);
    expect(monster.position.y).toBeCloseTo(where.y, 6);
    expect(monster.blinkCount).toBe(0);
  });

  it('is moving again on the tick the light leaves', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    tickFor(monster, context, 0.5);
    expect(monster.state).toBe('frozen');

    light.on = false;
    monster.tick(TICK, context);
    expect(monster.state).toBe('pursue');
  });

  it('always knows where the player is: it never stops coming (§5)', () => {
    const built = world(OPEN);
    const monster = monsterAt(2, 2);
    // The far corner, well beyond any spider's detect radius.
    const context = contextFor(built, 30, 30);
    tickFor(monster, context, 0.5);
    expect(monster.state).toBe('pursue');
  });
});

describe('Shadow Monster light interference (§5.2)', () => {
  it('ramps the severity with continuous flashlight focus', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    monster.tick(TICK, context);
    expect(monster.flickerSeverity).toBeCloseTo(FLICK.severity.from, 1);

    // Six seconds, because a blink is not focus: the 0.15 s of a lurch does not count
    // towards the ramp, so reaching the top takes longer than three seconds of wall time.
    tickFor(monster, context, 6);
    expect(monster.flickerSeverity).toBeCloseTo(FLICK.severity.to, 2);
  });

  it('restarts the ramp the moment focus is lost (§5.2 — focus is continuous)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    tickFor(monster, context, 2);
    expect(monster.flickerSeverity).toBeGreaterThan(0.6);

    light.on = false;
    monster.tick(TICK, context);
    expect(monster.flickerSeverity).toBe(0);
    expect(monster.beamFraction).toBe(1);

    light.on = true;
    monster.tick(TICK, context);
    expect(monster.flickerSeverity).toBeCloseTo(FLICK.severity.from, 1);
  });

  it('leaves the beam alone while it is unlit, and while a lamp holds it', () => {
    const built = world(OPEN);
    const light = beam(false);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    tickFor(monster, context, 0.5);
    expect(monster.beamFraction).toBe(1);

    // §4.2 pins it under a lamp; the lamp's own flicker is the lamp's, not the beam's.
    light.on = true;
    light.source = 'environment';
    tickFor(monster, context, 4);
    expect(monster.state).toBe('frozen');
    expect(monster.beamFraction).toBe(1);
    expect(monster.blinkCount).toBe(0);
  });
});

describe('Shadow Monster blink (§5.2)', () => {
  /** Hold the beam on it for `seconds` and report what happened. */
  function focus(seconds: number, monster = monsterAt(20, 20), playerZ = 8) {
    const built = world(OPEN);
    const light = beam(true);
    const context = contextFor(built, 20, playerZ, { illumination: light });
    tickFor(monster, context, seconds);
    return { built, monster, context, light };
  }

  it('never blinks in the first second and a half of focus', () => {
    const { monster } = focus(1.4);
    expect(monster.blinkCount).toBe(0);
  });

  it('blinks once the ramp is deep enough, and moves towards the player', () => {
    const monster = monsterAt(20, 20);
    const { monster: m } = focus(8, monster);
    expect(m.blinkCount).toBeGreaterThan(0);
    // The player is due north of it, and it only ever steps towards them.
    expect(m.position.y).toBeLessThan(20);
    expect(m.position.x).toBeCloseTo(20, 6);
  });

  it('covers no more than 2 m per blink, and takes 0.15 s to do it', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    let blinkTicks = 0;
    let from: { x: number; y: number } | null = null;
    let longest = 0;
    let blinks = 0;
    for (let t = 0; t < 8; t += TICK) {
      const wasBlinking = monster.state === 'blink';
      monster.tick(TICK, context);
      if (monster.state === 'blink') {
        if (!wasBlinking) {
          from = { x: monster.position.x, y: monster.position.y };
          blinkTicks = 0;
          blinks += 1;
        }
        blinkTicks += 1;
      } else if (wasBlinking && from) {
        longest = Math.max(longest, Math.hypot(monster.position.x - from.x, monster.position.y - from.y));
        // 0.15 s at 60 Hz is nine ticks; the tenth is the one that lands it.
        expect(blinkTicks).toBeLessThanOrEqual(Math.round(BLINK.seconds / TICK) + 1);
      }
    }
    expect(blinks).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(BLINK.distance + 1e-6);
    expect(longest).toBeGreaterThan(BLINK.distance * 0.9);
  });

  it('cannot retrigger inside its cooldown', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 30);
    // Far enough that it never arrives and stops blinking for want of anywhere to go.
    const context = contextFor(built, 20, 3, { illumination: light });

    const blinkStarts: number[] = [];
    let previous = monster.state;
    for (let t = 0; t < 10; t += TICK) {
      monster.tick(TICK, context);
      if (monster.state === 'blink' && previous !== 'blink') blinkStarts.push(t);
      previous = monster.state;
    }

    expect(blinkStarts.length).toBeGreaterThan(2);
    for (let i = 1; i < blinkStarts.length; i += 1) {
      expect(blinkStarts[i]! - blinkStarts[i - 1]!).toBeGreaterThanOrEqual(
        BLINK.cooldownSeconds - TICK,
      );
    }
  });

  it('stops short at a wall rather than stepping through it', () => {
    // A wall two rows north of the monster, with the player beyond it.
    const rows = Array.from({ length: 16 }, () => ' '.repeat(16));
    rows[8] = '#'.repeat(16);
    const built = world(rows);
    const light = beam(true);
    // Tile (10, 10) — world (21, 21). The wall row spans z = 16..18.
    const monster = monsterAt(21, 21);
    const context = contextFor(built, 21, 8, { illumination: light });

    for (let t = 0; t < 10; t += TICK) {
      monster.tick(TICK, context);
      const { gx, gy } = built.grid.worldToGrid(monster.position.x, monster.position.y);
      // Never once on an unwalkable tile, blink or otherwise.
      expect(built.grid.isWalkable(gx, gy)).toBe(true);
    }
    expect(monster.blinkCount).toBeGreaterThan(0);
    // Stopped at the wall's face with its whole body clear of it, not with its centre on
    // the last walkable point and half of it inside the brick.
    expect(monster.position.y).toBeGreaterThanOrEqual(18 + ENEMY.shadowMonster.radius - 1e-6);
  });

  it('replays identically from the same seed, and differs from another', () => {
    const blinksFor = (seed: number): number => {
      const built = world(OPEN);
      const light = beam(true);
      const monster = monsterAt(20, 28, seed);
      const context = contextFor(built, 20, 4, { illumination: light });
      tickFor(monster, context, 6);
      return monster.position.y;
    };
    expect(blinksFor(7)).toBeCloseTo(blinksFor(7), 9);
    expect(blinksFor(7)).not.toBeCloseTo(blinksFor(4242), 4);
  });
});

describe('Shadow Monster contact (§5.3)', () => {
  it('kills outright, at any health, with no wind-up', () => {
    const built = world(OPEN);
    const player = fakePlayer();
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 20.5, { player });

    monster.onPlayerContact(0.5, context);
    expect(player.kills).toBe(1);
    // Not a large deduction — its own thing, so no amount of health survives it.
    expect(player.damaged).toHaveLength(0);
  });
});

describe('Shadow Monsters in the manager', () => {
  const entities = [
    { type: 'PlayerSpawn', x: 0, y: 0, properties: {} },
    { type: 'ShadowMonster', x: 8, y: 8, properties: {} },
    { type: 'ShadowMonster', x: 9, y: 8, properties: {} },
  ];

  it('spawns them as ShadowMonsters, so the lifecycle is theirs', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    expect(manager.monsters).toHaveLength(2);
  });

  it('scales the beam by the worst interference, not by their product', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    const light = beam(true);
    const player = fakePlayer();

    let worstSeen = 1;
    for (let t = 0; t < 4; t += TICK) {
      manager.tick(TICK, { playerX: 17, playerZ: 17, illumination: light, player });
      const individually = manager.monsters.map((m) => m.beamFraction);
      expect(manager.beamInterference).toBeCloseTo(Math.min(...individually), 9);
      worstSeen = Math.min(worstSeen, manager.beamInterference);
    }
    // The ramp did get somewhere: a beam held for four seconds is visibly struggling.
    expect(worstSeen).toBeLessThan(0.35);
  });

  it('reports where they are, for §4.2 to work out who is under a lamp', () => {
    const built = world(OPEN, entities);
    const manager = new EnemyManager(built.registry, built.grid, built.colliders, new Rng(1));
    const positions = manager.monsterPositions();
    expect(positions).toHaveLength(2);
    expect(positions[0]!.x).toBeCloseTo(17);
    expect(positions[0]!.z).toBeCloseTo(17);
  });
});
