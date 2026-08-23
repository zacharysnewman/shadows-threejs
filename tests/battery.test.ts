/** Flashlight battery: drain, recharge, intensity falloff and the lockout (§4.1). */

import { describe, expect, it } from 'vitest';
import { FLASHLIGHT } from '../src/config';
import { Battery } from '../src/lighting/Battery';

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
    expect(battery.lockedOut).toBe(false);
    expect(battery.intensityFraction).toBe(0);
  });

  it('gives 45 s of continuous light from full (§4.1)', () => {
    const battery = new Battery();
    battery.turnOn();

    run(battery, 44);
    expect(battery.on).toBe(true);
    expect(battery.charge).toBeGreaterThan(0);

    run(battery, 1.5);
    expect(battery.on).toBe(false);
    // Cutting out starts the recharge on the very next tick, so the charge is already off
    // the floor by the time the run finishes — that is what clears the lockout later.
    expect(battery.charge).toBeLessThan(0.02);
    expect(battery.lockedOut).toBe(true);
  });

  it('recharges at half the drain rate while off (§4.1)', () => {
    const battery = new Battery();
    battery.set(0.5);
    run(battery, 9);

    // Nine seconds off returns 0.1; nine seconds on would have spent 0.2.
    expect(battery.charge).toBeCloseTo(0.6, 2);
  });

  it('does not recharge while it is on', () => {
    const battery = new Battery();
    battery.set(0.5);
    battery.turnOn();
    run(battery, 9);

    expect(battery.charge).toBeCloseTo(0.3, 2);
  });

  it('never charges past full', () => {
    const battery = new Battery();
    run(battery, 200);
    expect(battery.charge).toBe(1);
  });

  it('locks out at empty and refuses to switch back on (§4.1)', () => {
    const battery = new Battery();
    battery.turnOn();
    run(battery, 46);

    expect(battery.lockedOut).toBe(true);
    expect(battery.canTurnOn).toBe(false);
    expect(battery.turnOn()).toBe(false);
    expect(battery.on).toBe(false);
  });

  it('holds the lockout until the charge reaches the re-enable threshold', () => {
    const battery = new Battery();
    battery.set(0);

    // The threshold is 0.15 at 1/90 per second: 13.5 s of dark before the light is an
    // option again. This is the number that stops a strobe exploit against §5.2's freeze.
    run(battery, 13);
    expect(battery.charge).toBeLessThan(FLASHLIGHT.reEnableCharge);
    expect(battery.turnOn()).toBe(false);

    run(battery, 1);
    expect(battery.charge).toBeGreaterThanOrEqual(FLASHLIGHT.reEnableCharge);
    expect(battery.lockedOut).toBe(false);
    expect(battery.turnOn()).toBe(true);
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

  it('survives a full cycle: drain, lock out, recover, light again', () => {
    const battery = new Battery();
    battery.turnOn();
    run(battery, 46);
    expect(battery.lockedOut).toBe(true);

    run(battery, 14);
    expect(battery.turnOn()).toBe(true);

    // Recovered to just over the threshold, so this is a short, dim burst — the beam is
    // at partial intensity the whole way down.
    expect(battery.intensityFraction).toBeLessThan(1);
    run(battery, 8);
    expect(battery.on).toBe(false);
    expect(battery.lockedOut).toBe(true);
  });
});
