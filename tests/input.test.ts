/** Analog stick conditioning shared by gamepad and touch input (§3.1). */

import { describe, expect, it } from 'vitest';
import { applyDeadzone } from '../src/core/Input';

describe('applyDeadzone', () => {
  it('reads a resting stick as no input', () => {
    expect(applyDeadzone(0.1, -0.05, 0.22)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });

  it('starts from zero at the edge of the dead zone rather than jumping to it', () => {
    const justOutside = applyDeadzone(0.23, 0, 0.22);
    expect(justOutside.magnitude).toBeGreaterThan(0);
    expect(justOutside.magnitude).toBeLessThan(0.02);
  });

  it('reaches full deflection at the edge of the stick', () => {
    expect(applyDeadzone(1, 0, 0.22).magnitude).toBeCloseTo(1);
  });

  it('is radial, so a diagonal push stays diagonal', () => {
    // An axial dead zone would zero one component here and turn this into a cardinal.
    const diagonal = applyDeadzone(0.5, 0.5, 0.22);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
    expect(diagonal.magnitude).toBeGreaterThan(0);
  });

  it('never exceeds full deflection, whatever the hardware reports', () => {
    // Some pads report a corner deflection greater than 1 on the diagonal.
    const corner = applyDeadzone(1, 1, 0.22);
    expect(corner.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(corner.x, corner.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
