/** The camera rig's footprint, bounds clamp and damping (§3.2). */

import { describe, expect, it } from 'vitest';
import { CAMERA } from '../src/config';
import { clampCameraTarget, Damped, groundFootprint } from '../src/player/CameraRig';

const WIDE = 16 / 9;

describe('groundFootprint', () => {
  const footprint = groundFootprint(WIDE);

  it('sees further ahead of the target than behind it, because the camera is behind it', () => {
    expect(footprint.minZ).toBeLessThan(0);
    expect(footprint.maxZ).toBeGreaterThan(0);
    expect(Math.abs(footprint.minZ)).toBeGreaterThan(footprint.maxZ);
  });

  it('is wider than it is deep on a widescreen viewport', () => {
    expect(footprint.halfWidth).toBeGreaterThan(footprint.maxZ - footprint.minZ);
  });

  it('is narrower where the player stands than at the far edge it clamps on', () => {
    expect(footprint.halfWidthAtTarget).toBeLessThan(footprint.halfWidth);
    expect(footprint.halfWidthAtTarget).toBeGreaterThan(0);
  });

  it('narrows with the aspect ratio and never inverts', () => {
    const portrait = groundFootprint(0.5);
    expect(portrait.halfWidth).toBeLessThan(footprint.halfWidth);
    expect(portrait.halfWidth).toBeGreaterThan(0);
  });

  it('falls back to the far plane rather than infinity when the horizon is in shot', () => {
    // A shallow pitch puts the top of the frustum above the horizon, where the ground
    // never closes; the far plane is the only honest bound left.
    const shallow = groundFootprint(WIDE, CAMERA.fov, CAMERA.fov / 2 - 1);
    expect(Number.isFinite(shallow.halfWidth)).toBe(true);
    expect(Number.isFinite(shallow.minZ)).toBe(true);
  });
});

describe('clampCameraTarget', () => {
  const footprint = groundFootprint(WIDE);
  const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };

  it('leaves a target in the middle of a large map alone', () => {
    const clamped = clampCameraTarget(50, 50, footprint, bounds);
    expect(clamped.x).toBeCloseTo(50);
    expect(clamped.z).toBeCloseTo(50);
  });

  it('pulls the target away from an edge the player is walking towards', () => {
    const clamped = clampCameraTarget(2, 50, footprint, bounds);
    expect(clamped.x).toBeGreaterThan(2);
  });

  it('pulls back from the far edges too', () => {
    const clamped = clampCameraTarget(98, 98, footprint, bounds);
    expect(clamped.x).toBeLessThan(98);
    expect(clamped.z).toBeLessThan(98);
  });

  it('hides the void completely when the map is big enough to allow it', () => {
    // Far enough in that the bounds clamp and the visibility clamp do not disagree.
    const clamped = clampCameraTarget(footprint.halfWidth + 1, 50, footprint, bounds);
    expect(clamped.x - footprint.halfWidth).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
  });

  it('never pushes the player out of frame to hide void (§3.2)', () => {
    // Hard into the north-west corner: the corner the two rules disagree most about.
    const clamped = clampCameraTarget(1, 1, footprint, bounds);
    expect(Math.abs(clamped.x - 1)).toBeLessThanOrEqual(footprint.halfWidthAtTarget - 2 + 1e-9);
    expect(1 - clamped.z).toBeGreaterThanOrEqual(footprint.minZ + 2 - 1e-9);
    expect(1 - clamped.z).toBeLessThanOrEqual(footprint.maxZ - 2 + 1e-9);
  });

  it('keeps the player in frame on a map smaller than the footprint', () => {
    const tiny = { minX: 0, minZ: 0, maxX: 24, maxZ: 18 };
    for (const [x, z] of [
      [1, 1],
      [23, 1],
      [1, 17],
      [23, 17],
      [12, 9],
    ]) {
      const clamped = clampCameraTarget(x!, z!, footprint, tiny);
      expect(Math.abs(clamped.x - x!)).toBeLessThanOrEqual(footprint.halfWidthAtTarget - 2 + 1e-9);
      expect(z! - clamped.z).toBeGreaterThanOrEqual(footprint.minZ + 2 - 1e-9);
      expect(z! - clamped.z).toBeLessThanOrEqual(footprint.maxZ - 2 + 1e-9);
    }
  });

  it('centres on an axis the map is too small to satisfy', () => {
    // A map narrower than the footprint shows void whatever the camera does; centring at
    // least keeps it symmetrical rather than pinning the player to one edge.
    const narrow = { minX: 0, minZ: 0, maxX: 10, maxZ: 100 };
    const left = clampCameraTarget(0, 50, footprint, narrow);
    const right = clampCameraTarget(10, 50, footprint, narrow);
    expect(left.x).toBeCloseTo(5);
    expect(right.x).toBeCloseTo(5);
  });
});

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
