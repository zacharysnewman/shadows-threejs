/**
 * The two-bone arm that holds the flashlight (§3.1, §4.1).
 *
 * Three things here are silently wrong in ways that look like bad art rather than bad
 * arithmetic: an arm whose bones change length to reach, an elbow that bends the wrong way,
 * and a NaN from a degenerate target that quietly deletes the whole character. The first two
 * are what this pins; the third is why the degenerate cases are in here at all.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone, type TwoBoneSolution } from '../src/player/ArmIk';

const UPPER = 0.3;
const LOWER = 0.25;

function solve(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  pole = new THREE.Vector3(0, -1, 0),
  upper = UPPER,
  lower = LOWER,
): TwoBoneSolution {
  return solveTwoBone(shoulder, target, upper, lower, pole, {
    elbow: new THREE.Vector3(),
    hand: new THREE.Vector3(),
    reached: false,
  });
}

describe('reaching something the arm can get to', () => {
  const shoulder = new THREE.Vector3(0, 1.4, 0);
  const target = new THREE.Vector3(0.2, 1.3, 0.3);

  it('puts the hand exactly on the target', () => {
    const { hand, reached } = solve(shoulder, target);
    expect(reached).toBe(true);
    expect(hand.distanceTo(target)).toBeCloseTo(0, 10);
  });

  it('keeps both bones exactly as long as they were', () => {
    // The alternative — scaling a bone to reach — reads as the character's arm growing,
    // which is the one failure mode of a solver nobody mistakes for anything else.
    const { elbow, hand } = solve(shoulder, target);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 10);
    expect(hand.distanceTo(elbow)).toBeCloseTo(LOWER, 10);
  });

  it('bends the elbow towards the pole and not away from it', () => {
    // Nothing in the lengths decides which way round the elbow goes, so without this the
    // player carries the torch with their elbow above their ear half the time.
    const pole = new THREE.Vector3(0, -1, 0);
    const { elbow } = solve(shoulder, target, pole);

    const direction = target.clone().sub(shoulder).normalize();
    const offset = elbow.clone().sub(shoulder);
    offset.addScaledVector(direction, -offset.dot(direction));
    expect(offset.dot(pole)).toBeGreaterThan(0);
  });

  it('follows the pole when the pole turns round', () => {
    const down = solve(shoulder, target, new THREE.Vector3(0, -1, 0)).elbow.y;
    const up = solve(shoulder, target, new THREE.Vector3(0, 1, 0)).elbow.y;
    expect(up).toBeGreaterThan(down);
  });
});

describe('reaching something the arm cannot get to (§4.1)', () => {
  // The kit's arms are short and §4.1's mount is far enough forward that this is the
  // ordinary case, not the edge case: the torch is drawn from the hand out to the beam.
  const shoulder = new THREE.Vector3(0, 1.35, 0);
  const target = new THREE.Vector3(0, 1.6, 0.55);

  it('says so', () => {
    expect(solve(shoulder, target).reached).toBe(false);
  });

  it('straightens the arm along the line to the target and stops', () => {
    const { elbow, hand } = solve(shoulder, target);
    expect(hand.distanceTo(shoulder)).toBeCloseTo(UPPER + LOWER, 10);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 10);

    // On the line, so the gap the torch has to span is a gap and not a bend.
    const direction = target.clone().sub(shoulder).normalize();
    const along = hand.clone().sub(shoulder);
    expect(along.clone().addScaledVector(direction, -along.dot(direction)).length()).toBeCloseTo(0, 10);
  });

  it('never overshoots the target', () => {
    const { hand } = solve(shoulder, target);
    expect(hand.distanceTo(shoulder)).toBeLessThanOrEqual(shoulder.distanceTo(target) + 1e-9);
  });
});

describe('the degenerate cases that would delete the character', () => {
  const finite = (v: THREE.Vector3): boolean =>
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

  it('survives a pole pointing straight along the arm', () => {
    // The pole says nothing here: every elbow position is equally on it. Any answer will
    // do; a NaN will not, because one NaN vertex takes the whole skinned mesh with it.
    const shoulder = new THREE.Vector3(0, 1.4, 0);
    const target = new THREE.Vector3(0, 1.0, 0);
    const { elbow, hand } = solve(shoulder, target, new THREE.Vector3(0, -1, 0));
    expect(finite(elbow)).toBe(true);
    expect(finite(hand)).toBe(true);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 10);
    expect(hand.distanceTo(elbow)).toBeCloseTo(LOWER, 10);
  });

  it('survives a target sitting on the shoulder', () => {
    const shoulder = new THREE.Vector3(1, 1.4, 2);
    const { elbow, hand, reached } = solve(shoulder, shoulder.clone());
    expect(reached).toBe(false);
    expect(finite(elbow)).toBe(true);
    expect(finite(hand)).toBe(true);
  });

  it('survives a target closer than the arm can fold', () => {
    // Bones of very different lengths cannot fold below their difference; the hand
    // overshoots rather than the solver producing an imaginary triangle.
    const shoulder = new THREE.Vector3(0, 1.4, 0);
    const target = new THREE.Vector3(0, 1.4, 0.02);
    const { elbow, hand } = solve(shoulder, target, new THREE.Vector3(0, -1, 0), 0.4, 0.1);
    expect(finite(elbow)).toBe(true);
    expect(finite(hand)).toBe(true);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(0.4, 6);
  });
});
