/**
 * Two-bone inverse kinematics, and the arm it drives (§3.1, §4.1).
 *
 * The flashlight's position is decided by §4.1 and by nothing else: chest height, just
 * clear of the capsule, declined onto the floor. The arm's job is to be where that is —
 * **the hand follows the light, never the reverse.** Driving it the other way would make
 * the beam's placement depend on the body's walk cycle, and §4.1's mounting rule is the
 * reason the player is not standing inside their own shadow.
 *
 * That is also why this is IK rather than a pose. The hips rise and fall twice a stride
 * (§3.1), so a fixed arm rotation would swing the hand through several centimetres every
 * step while the beam it is supposed to be holding sat perfectly still. Solving for the
 * hand instead makes the torch the fixed thing and the shoulder the thing that moves under
 * it, which is what carrying something looks like.
 *
 * **The reach is short, and that is not a bug to hide.** The kit's arms are about 0.5 m on
 * a 1.8 m body, and §4.1's mount is far enough forward and high enough that the hand cannot
 * always get there. An over-extended arm resolves to a straight one pointing at the target
 * and stopping where it runs out, rather than stretching to meet it — and `TorchBody` draws
 * the torch from wherever the hand ended up out to where the beam starts, so the two always
 * meet.
 */

import * as THREE from 'three';
import type { ArmChain } from './autoRig';
import { PLAYER_RIG } from '../config';

export interface TwoBoneSolution {
  /** Where the elbow ends up. */
  elbow: THREE.Vector3;
  /** Where the hand ends up — the target, or as close to it as the arm reaches. */
  hand: THREE.Vector3;
  /** False when the target was out of reach and the arm is straight. */
  reached: boolean;
}

/**
 * Place an elbow and a hand, given a shoulder and somewhere to put the hand.
 *
 * `pole` is a unit direction the elbow is pushed towards. Two bones and a target leave the
 * elbow free anywhere on a circle around the shoulder-to-target line, and nothing in the
 * lengths decides where on it: without a pole the arm is as likely to bend upwards, and a
 * player carrying a torch with their elbow by their ear is the failure this argument exists
 * to prevent.
 *
 * Pure arithmetic on vectors, so the geometry can be checked without a skeleton (§ testing).
 */
export function solveTwoBone(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  upperLength: number,
  lowerLength: number,
  pole: THREE.Vector3,
  out: TwoBoneSolution,
): TwoBoneSolution {
  const reach = upperLength + lowerLength;
  const toTarget = _toTarget.subVectors(target, shoulder);
  const distance = toTarget.length();

  // Degenerate: the target is the shoulder. Fold the arm along the pole rather than
  // dividing by zero — any answer is arbitrary here, and this one is at least continuous.
  if (distance < 1e-6) {
    out.elbow.copy(shoulder).addScaledVector(pole, upperLength);
    out.hand.copy(out.elbow).addScaledVector(pole, -lowerLength);
    out.reached = false;
    return out;
  }

  const direction = _direction.copy(toTarget).divideScalar(distance);

  if (distance >= reach) {
    // Out of reach: a straight arm pointing at the target, stopping where it stops. The
    // alternative is scaling the bones, which reads as the character's arm growing.
    out.elbow.copy(shoulder).addScaledVector(direction, upperLength);
    out.hand.copy(shoulder).addScaledVector(direction, reach);
    out.reached = false;
    return out;
  }

  // Too close to straighten out: the arm folds as far as it can and the hand overshoots.
  const shortest = Math.abs(upperLength - lowerLength);
  const span = Math.max(distance, shortest + 1e-6);

  // Where along the shoulder-to-target line the elbow sits, and how far off it.
  const along = (upperLength * upperLength - lowerLength * lowerLength + span * span) / (2 * span);
  const off = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));

  // Only the part of the pole across the line can move the elbow; the part along it would
  // just slide the elbow up and down a line it is already on.
  const across = _across.copy(pole).addScaledVector(direction, -pole.dot(direction));
  if (across.lengthSq() < 1e-10) {
    // The pole is parallel to the arm and says nothing. Any perpendicular will do, and
    // taking it from the smallest component of the direction keeps it well conditioned.
    across.copy(smallestAxis(direction)).cross(direction).normalize();
  } else {
    across.normalize();
  }

  out.elbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(across, off);
  out.hand.copy(target);
  out.reached = true;
  return out;
}

/** The world axis the direction leans on least — the safest one to take a cross with. */
function smallestAxis(direction: THREE.Vector3): THREE.Vector3 {
  const x = Math.abs(direction.x);
  const y = Math.abs(direction.y);
  const z = Math.abs(direction.z);
  if (x <= y && x <= z) return _axisX;
  return y <= z ? _axisY : _axisZ;
}

/**
 * One arm, solved onto a world-space target and written back to its bones.
 *
 * Everything is measured in world space at solve time rather than from the rest pose,
 * because the character is scaled to §3.1's height on load: a length taken from the model's
 * own units is the wrong length by that factor, and the arm would reach too far or not far
 * enough by however much the kit's author disagreed with 1.8 m.
 */
export class Arm {
  private readonly solution: TwoBoneSolution = {
    elbow: new THREE.Vector3(),
    hand: new THREE.Vector3(),
    reached: false,
  };

  constructor(private readonly chain: ArmChain) {}

  /** Where the hand is right now, in world space. */
  handPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return this.chain.hand.getWorldPosition(out);
  }

  /**
   * Reach for `target`. `outward` is the direction away from the body's centreline on this
   * arm's side, which is half of where the elbow gets pushed; the other half is down.
   */
  reachFor(target: THREE.Vector3, outward: THREE.Vector3): void {
    const shoulder = this.chain.upper.getWorldPosition(_shoulder);
    const elbow = this.chain.lower.getWorldPosition(_elbow);
    const hand = this.chain.hand.getWorldPosition(_hand);

    const upperLength = shoulder.distanceTo(elbow);
    const lowerLength = elbow.distanceTo(hand);
    if (upperLength < 1e-6 || lowerLength < 1e-6) return;

    // Mostly down, a little out: an elbow directly under the hand looks pinned to the ribs,
    // and one straight out to the side looks like a chicken wing.
    const pole = _pole
      .set(0, -1, 0)
      .multiplyScalar(PLAYER_RIG.elbowDrop)
      .addScaledVector(outward, 1 - PLAYER_RIG.elbowDrop)
      .normalize();

    solveTwoBone(shoulder, target, upperLength, lowerLength, pole, this.solution);

    this.aim(this.chain.upper, this.chain.upperAxis, _direction.subVectors(this.solution.elbow, shoulder));
    this.chain.upper.updateMatrixWorld(true);
    this.aim(this.chain.lower, this.chain.lowerAxis, _direction.subVectors(this.solution.hand, this.solution.elbow));
    this.chain.lower.updateMatrixWorld(true);
  }

  /**
   * Hang the arm along `direction` with the elbow straight — what an arm does when it is
   * not holding anything (§3.1). The kit is authored with its arms out level, and from
   * §3.2's camera that is the most visible pose a body has.
   */
  rest(direction: THREE.Vector3): void {
    this.aim(this.chain.upper, this.chain.upperAxis, _direction.copy(direction));
    this.chain.lower.quaternion.identity();
    this.chain.upper.updateMatrixWorld(true);
  }

  /**
   * Turn one bone so the direction it points in at rest ends up along `worldDirection`.
   *
   * A bone's rest axis lives in its own space, and the space is its parent's rotated by its
   * own quaternion — so the quaternion wanted is the one taking the rest axis to the target
   * direction expressed in the *parent's* frame. Minimal rotation, which leaves the twist
   * about the arm unconstrained; nothing in a two-bone arm has an opinion about it, and at
   * §3.2's distance nothing can see it either.
   */
  private aim(bone: THREE.Bone, restAxis: THREE.Vector3, worldDirection: THREE.Vector3): void {
    if (worldDirection.lengthSq() < 1e-12) return;
    worldDirection.normalize();

    const parent = bone.parent;
    if (parent) {
      parent.getWorldQuaternion(_parentRotation);
      worldDirection.applyQuaternion(_parentRotation.invert());
      worldDirection.normalize();
    }
    bone.quaternion.setFromUnitVectors(restAxis, worldDirection);
  }
}

const _toTarget = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _across = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _parentRotation = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);
