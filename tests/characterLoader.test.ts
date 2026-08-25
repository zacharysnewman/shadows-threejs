/**
 * Placing a loaded character (§1).
 *
 * A kit's origin is wherever the artist left it, and nothing about a `.glb` says where the
 * feet are. `CharacterLoader` answers that from the bounds, and the answer is easy to get
 * half-right: ground the model and forget to centre it, and it stands correctly on a floor
 * a metre and a half from the thing it is supposed to be.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clipKey, standOn } from '../src/core/CharacterLoader';

const at = (min: [number, number, number], max: [number, number, number]): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

describe('standing a model on its own origin (§1)', () => {
  it('leaves a model that is already there alone', () => {
    const offset = standOn(at([-0.3, 0, -0.2], [0.3, 1.8, 0.2]));
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeCloseTo(0);
    expect(offset.z).toBeCloseTo(0);
  });

  it('grounds a model whose origin is at its waist', () => {
    expect(standOn(at([-0.3, -0.9, -0.2], [0.3, 0.9, 0.2])).y).toBeCloseTo(0.9);
  });

  it('centres a model authored beside its origin', () => {
    // The player's kit, as it ships: one character out of a bundle laid along x, so its
    // model sits 1.5 m from the origin the game puts the player at. Grounding alone leaves
    // the body walking through walls the collider stopped at.
    const offset = standOn(at([0.838, 0, -0.155], [2.172, 1.86, 0.138]));
    expect(offset.x).toBeCloseTo(-1.505, 3);
    expect(offset.y).toBeCloseTo(0);
    expect(offset.z).toBeCloseTo(0.0085, 4);
  });

  it('puts the model on the origin whatever its bounds were', () => {
    for (const box of [
      at([0.838, 0, -0.155], [2.172, 1.86, 0.138]),
      at([-2.967, -0.02, -2.324], [2.967, 1.931, 2.708]),
      at([3, 5, 7], [4, 6, 8]),
    ]) {
      const moved = box.clone().translate(standOn(box));
      expect(moved.min.y).toBeCloseTo(0);
      expect(moved.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
      expect(moved.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    }
  });
});

describe('naming a clip (§5.1)', () => {
  it('drops the exporter\'s rig name and the kind prefix', () => {
    expect(clipKey('HumanArmature|Spider_Walk')).toBe('walk');
    expect(clipKey('Armature|Ghoul_Attack')).toBe('attack');
  });
});
