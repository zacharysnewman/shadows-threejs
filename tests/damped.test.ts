/**
 * Critically damped scalar smoothing, shared by the camera rig (§3.2) and the flashlight's
 * pointer-aimed pitch (§4.1).
 */

import { describe, expect, it } from 'vitest';
import { CAMERA } from '../src/config';
import { Damped } from '../src/core/Damped';

describe('Damped', () => {
  it('converges on the target without overshooting it', () => {
    const damped = new Damped(0);
    let previous = 0;
    for (let i = 0; i < 120; i += 1) {
      const value = damped.step(10, CAMERA.smoothingTime, 1 / 60);
      expect(value).toBeLessThanOrEqual(10 + 1e-9);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
    // Two seconds is thirteen time constants; anything still short of the target by then
    // would be a spring that never settles.
    expect(previous).toBeCloseTo(10, 3);
  });

  it('lags the target rather than snapping to it', () => {
    const damped = new Damped(0);
    // One time constant in, a critically damped follow has covered ~26% of the distance.
    damped.step(10, CAMERA.smoothingTime, CAMERA.smoothingTime);
    expect(damped.value).toBeGreaterThan(0.5);
    expect(damped.value).toBeLessThan(9);
  });

  it('lands in the same place at any frame rate, since it is solved rather than integrated', () => {
    const slow = new Damped(0);
    const fast = new Damped(0);

    slow.step(10, CAMERA.smoothingTime, 0.1);
    for (let i = 0; i < 10; i += 1) fast.step(10, CAMERA.smoothingTime, 0.01);

    expect(fast.value).toBeCloseTo(slow.value, 2);
  });

  it('snaps when asked, dropping the velocity with it', () => {
    const damped = new Damped(0);
    damped.step(10, CAMERA.smoothingTime, 1 / 60);
    damped.snap(4);
    expect(damped.value).toBe(4);
    expect(damped.velocity).toBe(0);
  });
});
