/** Fixed-timestep simulation clock (§7). */

import { describe, expect, it, vi } from 'vitest';
import { SIM } from '../src/config';
import { SimClock } from '../src/core/SimClock';

describe('SimClock', () => {
  it('runs a whole number of fixed ticks and carries the remainder', () => {
    const clock = new SimClock(60);
    const listener = vi.fn();
    clock.onTick(listener);

    // 25 ms at 60 Hz is one tick with 8.33 ms carried; two such frames buy three ticks.
    expect(clock.advance(0.025)).toBe(1);
    expect(clock.advance(0.025)).toBe(2);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(clock.tick).toBe(3);
    expect(clock.elapsed).toBeCloseTo(3 / 60, 10);
  });

  it('delivers the same tick count for the same total time at any frame rate', () => {
    const slow = new SimClock(60);
    const fast = new SimClock(60);

    for (let i = 0; i < 10; i += 1) slow.advance(0.1); // 10 fps
    for (let i = 0; i < 240; i += 1) fast.advance(1 / 240); // 240 fps

    expect(slow.tick).toBe(60);
    expect(fast.tick).toBe(60);
  });

  it('clamps a huge delta so a backgrounded tab cannot spiral', () => {
    const clock = new SimClock(60);
    const ticks = clock.advance(30);
    expect(ticks).toBe(Math.floor(SIM.maxFrameSeconds * 60));
  });

  it('does not advance while paused', () => {
    const clock = new SimClock(60);
    clock.paused = true;
    expect(clock.advance(1)).toBe(0);
    expect(clock.tick).toBe(0);
  });

  it('steps exactly one tick while paused', () => {
    const clock = new SimClock(60);
    clock.paused = true;
    clock.stepOnce();
    expect(clock.tick).toBe(1);
  });

  it('scales time without changing the tick size', () => {
    const clock = new SimClock(60);
    clock.timeScale = 2;
    expect(clock.advance(0.1)).toBe(12);
    expect(clock.elapsed).toBeCloseTo(12 / 60, 10);
  });

  it('reports interpolation alpha for the pending tick', () => {
    const clock = new SimClock(60);
    clock.advance(1 / 120);
    expect(clock.alpha).toBeCloseTo(0.5, 3);
  });
});
