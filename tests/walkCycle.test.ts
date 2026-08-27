/**
 * §3.1, §4.3 — the walk cycle, and the footfalls the sound is hung off.
 *
 * The regression this file exists for: the footsteps used to run on a distance counter of
 * their own, beside an animation driven at a rate. The two agreed at no speed at all, and
 * nothing in the suite could have said so — there was no shared number to compare. There
 * is one now, and these are the checks that it stays shared.
 */

import { describe, expect, it } from 'vitest';
import { PLAYER, PLAYER_RIG } from '../src/config';
import { CYCLE_METRES, FOOTFALL_METRES, lerpPhase, WalkCycle } from '../src/player/WalkCycle';

describe('WalkCycle (§3.1)', () => {
  it('takes its stride from the clip the body is actually posed with', () => {
    // The clip is authored as a duration at a speed, so the ground it covers is the
    // product — derived here rather than restated, because a tuning pass moves both.
    expect(CYCLE_METRES).toBeCloseTo(PLAYER_RIG.strideSeconds * PLAYER_RIG.walkClipSpeed);
    expect(FOOTFALL_METRES).toBeCloseTo(CYCLE_METRES / 2);
  });

  it('advances with ground covered and not with time', () => {
    const cycle = new WalkCycle(2);
    cycle.advance(0.5);
    expect(cycle.phase).toBeCloseTo(0.25);
    cycle.advance(1);
    expect(cycle.phase).toBeCloseTo(0.75);
  });

  it('stands still when the player does', () => {
    const cycle = new WalkCycle(2);
    for (let i = 0; i < 100; i += 1) expect(cycle.advance(0)).toBe(0);
    expect(cycle.phase).toBe(0);
    expect(cycle.footfalls).toBe(0);
  });

  it('lands a foot at each of the two plant phases, and nowhere else', () => {
    const cycle = new WalkCycle(2);
    const plant = 2 * PLAYER_RIG.footPlantPhase;
    // Just short of the first plant, then over it.
    expect(cycle.advance(plant - 0.01)).toBe(0);
    expect(cycle.advance(0.02)).toBe(1);
    // Nothing until half a cycle later, whatever ground is covered in between.
    expect(cycle.advance(0.9)).toBe(0);
    expect(cycle.advance(0.1)).toBe(1);
  });

  it('puts exactly two feet down per cycle, at any speed', () => {
    // Walked in 60 Hz ticks, as the simulation does, at both of §3.1's speeds. The count
    // is the same because the cycle is ground: only the time it takes changes.
    for (const speed of [PLAYER.walkSpeed, PLAYER.sprintSpeed]) {
      const cycle = new WalkCycle();
      const ticks = Math.round((CYCLE_METRES * 10) / (speed / 60));
      let steps = 0;
      for (let i = 0; i < ticks; i += 1) steps += cycle.advance(speed / 60);
      // Ten cycles' worth of ground: twenty feet, give or take the one at either end.
      expect(steps).toBeGreaterThanOrEqual(19);
      expect(steps).toBeLessThanOrEqual(20);
    }
  });

  it('never puts a step down where the legs are not, whatever the tick covered', () => {
    // The property the whole rewrite is for: at the moment a foot lands, the cycle is at a
    // plant phase — within the ground one tick covers. A rate-driven clip could not say this.
    const cycle = new WalkCycle();
    const perTick = PLAYER.sprintSpeed / 60;
    const tolerance = perTick / CYCLE_METRES;
    for (let i = 0; i < 2000; i += 1) {
      if (cycle.advance(perTick) === 0) continue;
      const fromPlant = Math.min(
        Math.abs(cycle.phase - PLAYER_RIG.footPlantPhase),
        Math.abs(cycle.phase - (PLAYER_RIG.footPlantPhase + 0.5)),
      );
      expect(fromPlant).toBeLessThanOrEqual(tolerance);
    }
  });

  it('does not swallow footfalls when one tick covers several', () => {
    const cycle = new WalkCycle(2);
    // Two and a half cycles in one go: five feet, and the remainder carries.
    expect(cycle.advance(5)).toBe(5);
    expect(cycle.phase).toBeCloseTo(0.5);
  });

  it('starts the legs again when the body is put down somewhere else', () => {
    const cycle = new WalkCycle(2);
    cycle.advance(1.3);
    cycle.reset();
    expect(cycle.phase).toBe(0);
  });
});

describe('lerpPhase (§7)', () => {
  it('interpolates between ticks like a position does', () => {
    expect(lerpPhase(0.2, 0.4, 0.5)).toBeCloseTo(0.3);
    expect(lerpPhase(0.2, 0.4, 0)).toBeCloseTo(0.2);
    expect(lerpPhase(0.2, 0.4, 1)).toBeCloseTo(0.4);
  });

  it('goes the short way round the wrap, rather than backwards through the cycle', () => {
    // Once per stride the phase wraps. A straight lerp walks the legs the other way round
    // the whole cycle in one frame, which is a visible hitch every 2.7 m.
    expect(lerpPhase(0.98, 0.02, 0.5)).toBeCloseTo(0);
    expect(lerpPhase(0.98, 0.02, 0.25)).toBeCloseTo(0.99);
    expect(lerpPhase(0.98, 0.02, 1)).toBeCloseTo(0.02);
  });
});
