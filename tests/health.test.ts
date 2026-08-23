/** The health pool, its regeneration delay and its refill curve (§3.4). */

import { describe, expect, it } from 'vitest';
import { HEALTH } from '../src/config';
import { Health } from '../src/player/Health';

/** Advance a whole number of simulation ticks (§7), the way the game does. */
function run(health: Health, seconds: number, tickSeconds = 1 / 60): void {
  const ticks = Math.round(seconds / tickSeconds);
  for (let i = 0; i < ticks; i += 1) health.tick(tickSeconds);
}

describe('Health', () => {
  it('starts full', () => {
    expect(new Health().value).toBe(HEALTH.max);
    expect(new Health().dead).toBe(false);
  });

  it('takes three spider contacts to kill from full (§3.4)', () => {
    const health = new Health();
    expect(health.damage()).toBe(false);
    expect(health.value).toBeCloseTo(0.66);
    expect(health.damage()).toBe(false);
    expect(health.value).toBeCloseTo(0.32);
    expect(health.damage()).toBe(true);
    expect(health.value).toBe(0);
    expect(health.dead).toBe(true);
  });

  it('kills a partially regenerated player in two, since the pool is not segmented', () => {
    const health = new Health();
    health.set(0.6);
    expect(health.damage()).toBe(false);
    expect(health.damage()).toBe(true);
  });

  it('does not regenerate before the delay has elapsed', () => {
    const health = new Health();
    health.damage();
    run(health, HEALTH.regenDelay - 0.5);

    expect(health.value).toBeCloseTo(0.66);
    expect(health.regenerating).toBe(false);
    expect(health.regenDelayRemaining).toBeCloseTo(0.5, 1);
  });

  it('refills at the specified rate once the delay has elapsed', () => {
    const health = new Health();
    health.damage();
    run(health, HEALTH.regenDelay + 2);

    // Two seconds of regeneration at 0.12/s — roughly 3 s to undo one hit (§3.4).
    expect(health.value).toBeCloseTo(0.66 + 2 * HEALTH.regenRate, 2);
    expect(health.regenerating).toBe(true);
  });

  it('takes about 3 s to undo one hit and about 8 s to recover from near-death (§3.4)', () => {
    const oneHit = new Health();
    oneHit.damage();
    run(oneHit, HEALTH.regenDelay + 3);
    expect(oneHit.value).toBeGreaterThan(0.99);

    const nearDeath = new Health();
    nearDeath.set(0.04);
    run(nearDeath, HEALTH.regenDelay + 8);
    expect(nearDeath.value).toBeGreaterThan(0.99);
  });

  it('resets the delay when damage lands again', () => {
    const health = new Health();
    health.damage();
    run(health, HEALTH.regenDelay - 1);
    health.damage();
    run(health, 2);

    // The second hit restarted the clock, so nothing has regenerated yet.
    expect(health.value).toBeCloseTo(0.32);
    expect(health.regenerating).toBe(false);
  });

  it('never overfills', () => {
    const health = new Health();
    health.damage(0.05);
    run(health, HEALTH.regenDelay + 60);
    expect(health.value).toBe(HEALTH.max);
    expect(health.regenerating).toBe(false);
  });

  it('stays dead: there is no respawn and nothing heals a dead player (§5.3)', () => {
    const health = new Health();
    health.damage(1);
    run(health, HEALTH.regenDelay + 30);

    expect(health.value).toBe(0);
    expect(health.dead).toBe(true);
    // The killing blow reports death once; a later contact on a corpse does not.
    expect(health.damage()).toBe(false);
  });

  it('flags the critical band the heartbeat and desaturation key off (§3.4)', () => {
    const health = new Health();
    health.damage();
    health.damage();
    expect(health.value).toBeLessThan(HEALTH.lowThreshold);
    expect(health.critical).toBe(true);
  });
});
