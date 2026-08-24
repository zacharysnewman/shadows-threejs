/**
 * Flashlight battery: the run's supply of light, and the intensity falloff at the end of
 * it (§4.1).
 *
 * The durations here are derived from `FLASHLIGHT.drainPerSecond` rather than written out,
 * because 10 minutes is a tuning value and a test that hard-codes 600 fails on the next
 * pass for a reason that has nothing to do with what it was checking.
 */

import { describe, expect, it } from 'vitest';
import { FLASHLIGHT } from '../src/config';
import { Battery } from '../src/lighting/Battery';

/** Seconds of continuous light a full charge buys (§4.1). */
const FULL_RUNTIME = 1 / FLASHLIGHT.drainPerSecond;

/** Advance whole simulation ticks (§7), the way the game does. */
function run(battery: Battery, seconds: number, tickSeconds = 1 / 60): void {
  const ticks = Math.round(seconds / tickSeconds);
  for (let i = 0; i < ticks; i += 1) battery.tick(tickSeconds);
}

describe('Battery', () => {
  it('starts full and off', () => {
    const battery = new Battery();
    expect(battery.charge).toBe(1);
    expect(battery.on).toBe(false);
    expect(battery.intensityFraction).toBe(0);
  });

  it('gives ten minutes of continuous light from full (§4.1)', () => {
    expect(FULL_RUNTIME).toBe(600);

    const battery = new Battery();
    battery.turnOn();

    run(battery, FULL_RUNTIME - 5);
    expect(battery.on).toBe(true);
    expect(battery.charge).toBeGreaterThan(0);

    run(battery, 6);
    expect(battery.on).toBe(false);
    expect(battery.charge).toBe(0);
  });

  it('does not recharge while off — the charge only ever falls (§4.1)', () => {
    // The rule this replaces: the battery used to return 1/90 per second while off, so
    // being in the dark was a way of getting the light back. It is not. Time spent unlit
    // buys nothing except the charge it did not spend.
    const battery = new Battery();
    battery.set(0.5);

    run(battery, 120);
    expect(battery.charge).toBe(0.5);

    battery.turnOn();
    run(battery, 60);
    const spent = battery.charge;
    expect(spent).toBeLessThan(0.5);

    battery.turnOff();
    run(battery, 300);
    expect(battery.charge).toBe(spent);
  });

  it('drains only while it is on', () => {
    const battery = new Battery();
    battery.set(0.5);
    battery.turnOn();
    run(battery, 60);

    // A minute of the ten spends a tenth of a full charge.
    expect(battery.charge).toBeCloseTo(0.5 - 60 * FLASHLIGHT.drainPerSecond, 4);
  });

  it('is flat for the rest of the run once it empties (§4.1)', () => {
    const battery = new Battery();
    battery.turnOn();
    run(battery, FULL_RUNTIME + 1);

    expect(battery.charge).toBe(0);
    expect(battery.canTurnOn).toBe(false);
    expect(battery.turnOn()).toBe(false);
    expect(battery.on).toBe(false);

    // No amount of waiting brings it back — that is the whole point of no recharge.
    run(battery, 600);
    expect(battery.charge).toBe(0);
    expect(battery.turnOn()).toBe(false);
  });

  it('makes strobing cost charge rather than earn it (§5.2)', () => {
    // Why there is no lockout any more. The exploit a lockout guarded against — blinking
    // the beam to hold the monster frozen on almost no charge — only pays if the charge
    // comes back. Each blink here is spent for good, so the strobe pays for itself.
    const strobed = new Battery();
    const held = new Battery();

    const blink = 0.5;
    for (let i = 0; i < 60; i += 1) {
      strobed.turnOn();
      run(strobed, blink);
      strobed.turnOff();
      run(strobed, blink);
    }
    held.turnOn();
    run(held, 60 * blink);

    // Sixty seconds of wall-clock strobing costs exactly the thirty seconds of light it
    // actually produced: no better than holding the beam, and no worse.
    expect(strobed.charge).toBeCloseTo(held.charge, 6);
    expect(strobed.charge).toBeLessThan(1);
  });

  it('runs at full beam above a quarter charge and falls off linearly below it (§4.1)', () => {
    const battery = new Battery();
    battery.turnOn();
    expect(battery.intensityFraction).toBe(1);

    battery.set(FLASHLIGHT.falloffCharge);
    battery.turnOn();
    expect(battery.intensityFraction).toBeCloseTo(1);

    battery.set(FLASHLIGHT.falloffCharge / 2);
    battery.turnOn();
    expect(battery.intensityFraction).toBeCloseTo(0.7);

    battery.set(0.001);
    battery.turnOn();
    expect(battery.intensityFraction).toBeCloseTo(FLASHLIGHT.minIntensityFraction, 2);
  });

  it('reports no beam while off, whatever the charge', () => {
    const battery = new Battery();
    expect(battery.intensityFraction).toBe(0);
  });

  it('toggles, and reports the state it ended in', () => {
    const battery = new Battery();
    expect(battery.toggle()).toBe(true);
    expect(battery.toggle()).toBe(false);

    battery.set(0);
    expect(battery.toggle()).toBe(false);
  });

  it('spends the last quarter as a dimming beam, not a cliff (§4.1)', () => {
    const battery = new Battery();
    battery.set(FLASHLIGHT.falloffCharge);
    battery.turnOn();
    expect(battery.intensityFraction).toBeCloseTo(1);

    // A quarter charge is 2.5 minutes of warning that the run's light is ending.
    const remaining = FLASHLIGHT.falloffCharge * FULL_RUNTIME;
    run(battery, remaining / 2);
    expect(battery.on).toBe(true);
    expect(battery.intensityFraction).toBeLessThan(1);
    expect(battery.intensityFraction).toBeGreaterThan(FLASHLIGHT.minIntensityFraction);

    run(battery, remaining / 2 + 1);
    expect(battery.on).toBe(false);
    expect(battery.intensityFraction).toBe(0);
  });
});
