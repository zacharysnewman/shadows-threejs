/**
 * The locomotion driver (§5.1, §5.3) — the half of Phase 11's art pass that is not art.
 *
 * What these check is the contract a real `.glb` clip will be driven by, so that swapping
 * a placeholder for art changes what is drawn and not when anything happens.
 */

import { describe, expect, it } from 'vitest';
import { ENEMY } from '../src/config';
import { Rng } from '../src/core/rng';
import { Gait, type GaitProfile } from '../src/enemies/Gait';
import { ShadowMonster } from '../src/enemies/ShadowMonster';
import { Spider } from '../src/enemies/Spider';
import { TICK, beam, contextFor, fakePlayer, world } from './support/world';

const PROFILE: GaitProfile = {
  strideMetres: 0.8,
  bobMetres: 0.07,
  swingRadians: 0.5,
  fullSpeed: 2.4,
  windUpRadians: 0.55,
};

const OPEN = Array.from({ length: 16 }, () => ' '.repeat(16));

/** Walk a gait `metres` at `speed`, in simulation ticks. */
function walk(gait: Gait, metres: number, speed: number): void {
  const perTick = speed * TICK;
  for (let covered = 0; covered < metres; covered += perTick) gait.advance(perTick, speed, TICK);
}

describe('the locomotion cycle (§5.1)', () => {
  it('advances with ground covered, not with time', () => {
    const slow = new Gait(PROFILE);
    const fast = new Gait(PROFILE);
    // Same distance, very different speeds and very different numbers of ticks.
    walk(slow, PROFILE.strideMetres * 4, 1.2);
    walk(fast, PROFILE.strideMetres * 4, 3.6);
    // The legs are in the same place, because they went the same way.
    expect(slow.pose().gait).toBeCloseTo(fast.pose().gait, 1);
  });

  it('does not walk on the spot: a body stopped against a wall stands still', () => {
    const gait = new Gait(PROFILE);
    walk(gait, PROFILE.strideMetres * 2, 2.4);
    const before = gait.pose().gait;
    // Pushing hard and going nowhere.
    for (let i = 0; i < 120; i += 1) gait.advance(0, 0, TICK);
    expect(gait.pose().gait).toBeCloseTo(before, 6);
  });

  it('settles out of its swing when it stops, rather than snapping flat', () => {
    const gait = new Gait(PROFILE);
    walk(gait, PROFILE.strideMetres * 3, 2.4);
    const running = Math.abs(gait.pose().swing);
    expect(running).toBeGreaterThan(0);

    gait.advance(0, 0, TICK);
    const justStopped = Math.abs(gait.pose().swing);
    // Reduced but not gone: the amplitude eases and the phase does not.
    expect(justStopped).toBeLessThan(running);
    expect(justStopped).toBeGreaterThan(0);

    for (let i = 0; i < 60; i += 1) gait.advance(0, 0, TICK);
    expect(Math.abs(gait.pose().swing)).toBeLessThan(0.01);
  });

  it('scales its amplitude with speed, so a wander is not a sprint', () => {
    // Sampled across a whole cycle and taken at its peak: the bob at any one instant is a
    // point on a sine, and which point depends on where the body happens to have stopped.
    const peakBob = (speed: number): number => {
      const gait = new Gait(PROFILE);
      walk(gait, 6, speed);
      let peak = 0;
      for (let i = 0; i < 120; i += 1) {
        gait.advance(speed * TICK, speed, TICK);
        peak = Math.max(peak, gait.pose().bob);
      }
      return peak;
    };
    expect(peakBob(ENEMY.spider.pursueSpeed)).toBeGreaterThan(peakBob(ENEMY.spider.wanderSpeed));
    // At or above its full speed the cycle is at full amplitude and stops growing.
    expect(peakBob(ENEMY.spider.fleeSpeed)).toBeCloseTo(peakBob(PROFILE.fullSpeed), 3);
  });

  it('starts and stays inside its cycle', () => {
    const gait = new Gait(PROFILE);
    for (let i = 0; i < 400; i += 1) {
      gait.advance(0.05, 2.4, TICK);
      const { gait: phase } = gait.pose();
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });
});

describe('the attack pose (§5.3)', () => {
  it('rears back across the wind-up and lands its contact frame at the strike', () => {
    const gait = new Gait(PROFILE);
    walk(gait, 2, 2.4);

    expect(gait.pose(0.0).strike).toBe(0);
    expect(gait.pose(0.5).strike).toBe(0);
    expect(gait.pose(0.99).strike).toBe(0);
    // §5.3 — the frame the player is being asked to react to is the frame damage lands on.
    expect(gait.pose(1).strike).toBe(1);
  });

  it('spends its time in the telegraph rather than in the throw', () => {
    const gait = new Gait(PROFILE);
    // Eased, so half way through the wind-up it is well short of half reared: the player's
    // window is the part of the animation that is visible for longest.
    expect(gait.pose(0.5).pitch).toBeLessThan(PROFILE.windUpRadians * 0.5);
    expect(gait.pose(1).pitch).toBeCloseTo(PROFILE.windUpRadians, 5);
  });
});

describe("what each enemy body does (§5.1, §5.2)", () => {
  it('gives the spider a cycle that reaches the strike exactly at the wind-up', () => {
    const built = world(OPEN);
    const player = fakePlayer();
    const spider = new Spider('spider#0', 10.5, 10, new Rng(1));
    const context = contextFor(built, 10, 10, { illumination: beam(false), player });

    spider.onPlayerContact(0.5, context);
    const seen: number[] = [];
    for (let t = 0; t < ENEMY.spider.attack.windUpSeconds + 4 * TICK; t += TICK) {
      spider.tick(TICK, context);
      seen.push((spider as unknown as { attackProgress: number }).attackProgress);
    }
    // Climbs across the wind-up and reaches 1 by the strike, never before it.
    expect(seen[0]).toBeLessThan(0.2);
    expect(Math.max(...seen)).toBe(1);
    expect(seen.filter((p) => p >= 1).length).toBeLessThanOrEqual(5);
  });

  it('gives the Shadow Monster no attack pose at all: §5.2 says one pose', () => {
    const monster = new ShadowMonster('monster#0', 10, 10, new Rng(1));
    expect((monster as unknown as { attackProgress: number }).attackProgress).toBe(0);
    // And no limbs to animate — the placeholder body is a single mesh.
    let meshes = 0;
    monster.object.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) meshes += 1;
    });
    expect(meshes).toBe(1);
  });

  it('gives the spider legs, so the cycle is something you can see', () => {
    const spider = new Spider('spider#0', 10, 10, new Rng(1));
    let meshes = 0;
    spider.object.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) meshes += 1;
    });
    expect(meshes).toBe(9);
  });
});
