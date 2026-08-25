/**
 * The Shadow Monster: the freeze, the flicker ramp, the blink, and its fatal contact
 * (§5.2, §5.3). The sabotage lifecycle it triggers is in `lighting.test.ts`, with the lamp
 * that owns it.
 */

import * as THREE from 'three';
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
    // Above the floor the formula is untouched.
    expect(flickerFraction(peak, 0.5, 1.2)).toBeCloseTo(1 - 0.6);
    expect(flickerFraction(peak, 0.4, 1.0)).toBeCloseTo(0.6);
  });

  it('never takes the beam below the floor, or to zero (§5.2)', () => {
    const peak = Math.PI / 2 / FLICKER.frequency;
    // 1 − 0.95 is 0.05, and 1 − 0.95 × 1.3 is negative: both would once have been a torch
    // switched off for a tick. The floor is what keeps it a torch struggling.
    expect(flickerFraction(peak, 0.95, 1.0)).toBeCloseTo(FLICKER.floor);
    expect(flickerFraction(peak, 0.95, FLICKER.jitter.max)).toBeCloseTo(FLICKER.floor);
    expect(FLICKER.floor).toBeGreaterThan(0);
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

  it('restarts the ramp the moment focus is lost, even mid-blink (§5.2)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    // Two seconds is past the first blink, so this also covers the case the 0.5 s window
    // introduced: sweeping the torch away *inside* a blink. The beam has to come clean on
    // that tick, not when the window happens to run out.
    tickFor(monster, context, 2);
    expect(monster.flickerSeverity).toBeGreaterThan(0.6);

    light.on = false;
    monster.tick(TICK, context);
    expect(monster.flickerSeverity).toBe(0);
    expect(monster.beamFraction).toBe(1);
    expect(monster.state).not.toBe('blink');

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

  it('holds the blink open for half a second and walks it, rather than jumping', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    // The ground a blink is worth is its own walking speed for its own duration — derived,
    // not written down, because both are tuning values.
    const walked = ENEMY.shadowMonster.pursueSpeed * BLINK.seconds;

    let blinkTicks = 0;
    let from: { x: number; y: number } | null = null;
    let longest = 0;
    let perTick = 0;
    let blinks = 0;
    for (let t = 0; t < 8; t += TICK) {
      const wasBlinking = monster.state === 'blink';
      const before = { x: monster.position.x, y: monster.position.y };
      monster.tick(TICK, context);
      if (monster.state === 'blink') {
        if (!wasBlinking) {
          from = { x: monster.position.x, y: monster.position.y };
          blinkTicks = 0;
          blinks += 1;
        }
        blinkTicks += 1;
        perTick = Math.max(
          perTick,
          Math.hypot(monster.position.x - before.x, monster.position.y - before.y),
        );
      } else if (wasBlinking && from) {
        longest = Math.max(
          longest,
          Math.hypot(monster.position.x - from.x, monster.position.y - from.y),
        );
        expect(blinkTicks).toBeLessThanOrEqual(Math.round(BLINK.seconds / TICK) + 1);
      }
    }

    expect(blinks).toBeGreaterThan(0);
    // Half a second of walking, and no more: it never covers ground it could not walk.
    // The lower bound is loose on purpose — it starts each blink from a standstill, so the
    // acceleration ramp (§5) spends roughly a third of the window getting up to speed.
    expect(longest).toBeLessThanOrEqual(walked + 1e-6);
    expect(longest).toBeGreaterThan(walked * 0.5);
    // And no single tick is a jump. The old lurch moved 2 m in nine ticks — 0.22 m each,
    // an order of magnitude more than a walking tick — so this is the check that would
    // have failed on it.
    expect(perTick).toBeLessThanOrEqual(ENEMY.shadowMonster.pursueSpeed * TICK + 1e-6);
  });

  it('puts the beam out for the blink, and never for the flicker (§5.2)', () => {
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    let flickerFloor = 1;
    const blinkFractions: number[] = [];
    for (let t = 0; t < 8; t += TICK) {
      monster.tick(TICK, context);
      if (monster.state === 'blink') blinkFractions.push(monster.beamFraction);
      else flickerFloor = Math.min(flickerFloor, monster.beamFraction);
    }

    // The struggle is the information (§5.2): a beam oscillating down to nothing reads as
    // the torch dying rather than as something reaching into the light, so the curve keeps
    // its floor everywhere except the window it is deliberately out for.
    expect(flickerFloor).toBeGreaterThanOrEqual(FLICKER.floor - 1e-9);
    expect(FLICKER.floor).toBeGreaterThan(0);

    // And the blink is off. Not dim, not the floor — off, and steady for the whole window
    // rather than a strobe inside a strobe.
    expect(blinkFractions.length).toBeGreaterThan(0);
    for (const fraction of blinkFractions) expect(fraction).toBe(0);
  });

  it('never has light on it on a tick it moved — §5.2\'s hard rule (§5.2)', () => {
    // "Never both moving and visible" is the whole design: the shadow is the only way to see
    // this creature, and a second, easier way would be a second way.
    //
    // The rule used to be enforced against the renderer — the beam held at 15% and the
    // monster's shadow switched off underneath it. It is physical now: the window it walks
    // in is a window the torch emits nothing in, so there is no light to cast by and nothing
    // to enforce.
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    let movingTicks = 0;
    let litAndStill = 0;
    for (let t = 0; t < 8; t += TICK) {
      const before = { x: monster.position.x, y: monster.position.y };
      monster.tick(TICK, context);
      monster.render(1);

      const moved = Math.hypot(monster.position.x - before.x, monster.position.y - before.y);
      if (moved > 1e-9) {
        movingTicks += 1;
        expect(monster.beamFraction, `lit while moving at t=${t.toFixed(2)}`).toBe(0);
      } else if (monster.beamFraction > 0) {
        litAndStill += 1;
      }
    }

    expect(movingTicks).toBeGreaterThan(0);
    // Not vacuous the other way: standing in the beam, it is very much lit.
    expect(litAndStill).toBeGreaterThan(0);
  });

  it('always casts, so its shadow is there whenever a light is (§5.2)', () => {
    // The other half of the same rule, and the half that used to be broken: the shadow *is*
    // the creature, so a mesh that stops casting is a creature that has stopped existing
    // under a light that is on it. Nothing switches it off any more.
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    const casts = (): boolean => {
      let all = true;
      monster.object.traverse((node) => {
        if (node instanceof THREE.Mesh && !node.castShadow) all = false;
      });
      return all;
    };

    for (let t = 0; t < 8; t += TICK) {
      monster.tick(TICK, context);
      monster.render(1);
      expect(casts(), `stopped casting at t=${t.toFixed(2)} in ${monster.state}`).toBe(true);
    }
  });

  it('can be heard walking while the beam is down', () => {
    // The blink used to be silent, because a 2 m jump-cut is not eight strides. It is a
    // walk now, and the footsteps are the only thing the player has in that half second.
    const built = world(OPEN);
    const light = beam(true);
    const monster = monsterAt(20, 20);
    const context = contextFor(built, 20, 8, { illumination: light });

    let movedWhileBlinking = 0;
    for (let t = 0; t < 8; t += TICK) {
      const before = { x: monster.position.x, y: monster.position.y };
      monster.tick(TICK, context);
      if (monster.state === 'blink') {
        movedWhileBlinking += Math.hypot(
          monster.position.x - before.x,
          monster.position.y - before.y,
        );
      }
    }

    // `MonsterFootsteps` plays one step per `strideMetres` of ground covered, and no
    // longer suppresses the blink — so ground covered here is steps heard.
    expect(movedWhileBlinking).toBeGreaterThan(ENEMY.shadowMonster.strideMetres);
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

    expect(blinkStarts.length).toBeGreaterThan(1);
    for (let i = 1; i < blinkStarts.length; i += 1) {
      // The dead time is measured from the *end* of the previous blink (§5.2), so two
      // starts are at least a blink plus a cooldown apart. Measured from the start — the
      // old rule — a cooldown no longer than the blink would allow them back to back.
      expect(blinkStarts[i]! - blinkStarts[i - 1]!).toBeGreaterThanOrEqual(
        BLINK.seconds + BLINK.cooldownSeconds - TICK,
      );
    }
  });

  it('walks around a wall rather than through it', () => {
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
    // Held on the walkable side of the wall's face, with its whole body clear of it. It
    // walks through the blink now, so what keeps it out is the same collider resolution
    // that keeps it out at any other time — not a march that stopped short.
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
