/**
 * The camera rig's footprint, its lock to the player, and its damping (§3.2).
 *
 * The clamp these used to cover is gone: §3.2 no longer pulls the camera off the player to
 * hide off-map void, because §2's surround means there is none to hide. What replaced those
 * tests is the property the change was made for — the player is at the same point on screen
 * wherever they stand, which is what makes the cursor's offset from them mean one thing.
 */

import { describe, expect, it } from 'vitest';
import { CAMERA } from '../src/config';
import { CameraRig, Damped, groundFootprint } from '../src/player/CameraRig';
import type { Viewport } from '../src/core/Viewport';

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

/** Enough of a `Viewport` for the rig: an aspect to read and somewhere to report to. */
function fakeViewport(aspect = WIDE) {
  const framed = { x: Number.NaN, z: Number.NaN };
  const viewport = {
    camera: { aspect },
    frame(x: number, z: number) {
      framed.x = x;
      framed.z = z;
    },
  } as unknown as Viewport;
  return { viewport, framed };
}

describe('the rig is locked to the player (§3.2)', () => {
  it('frames exactly where the player is, including hard into a corner', () => {
    // The old clamp slid the camera off the player here, to keep the map's edge out of
    // frame. Nothing does that now: the offset from the player to the edge of the screen is
    // the same at (0, 0) as it is in the middle of the map, so the cursor means one thing.
    for (const [x, z] of [[0, 0], [50, 50], [-30, 120]]) {
      const { viewport, framed } = fakeViewport();
      new CameraRig(viewport).snapTo(x!, z!);
      expect(framed.x).toBeCloseTo(x!);
      expect(framed.z).toBeCloseTo(z!);
    }
  });

  it('settles on the player after smoothing, rather than near them', () => {
    const { viewport, framed } = fakeViewport();
    const rig = new CameraRig(viewport);
    rig.snapTo(0, 0);
    // Well past the smoothing time constant, so the spring has arrived (§3.2).
    for (let t = 0; t < CAMERA.smoothingTime * 20; t += 1 / 60) rig.update(1 / 60, 3, 4);
    expect(framed.x).toBeCloseTo(3, 3);
    expect(framed.z).toBeCloseTo(4, 3);
  });

  it('does not care how big the map is, because it no longer knows', () => {
    // The rig takes no bounds at all — the property is structural, not a tuning choice.
    expect(CameraRig.length).toBe(1);
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
