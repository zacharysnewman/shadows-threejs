/**
 * The torch the player is carrying (§4.1, §6.1).
 *
 * §4.1 says the beam is emitted at chest height, just clear of the capsule; until now that
 * was a point in empty air with a light at it. This is the object it comes out of: a barrel
 * drawn from the player's hand to that point, and a lens at the far end that glows while the
 * beam is on.
 *
 * The barrel is drawn between two positions rather than parented to the hand, because the
 * two ends are decided by different things and neither yields to the other. Where the beam
 * starts is §4.1's; where the hand is is as close to that as the arm reaches (`ArmIk`), and
 * the kit's arms are short. Spanning the gap is what lets both be right — a torch parented
 * to the hand would hold its light a hand's width behind where the light actually is.
 *
 * It casts no shadow. A torch that shadowed its own cone would put a black core down the
 * middle of the beam and a bite out of the pool it makes, which is a lighting artefact
 * rather than a thing anybody has seen a torch do.
 */

import * as THREE from 'three';
import { TORCH } from '../config';

export class TorchBody {
  readonly root = new THREE.Group();

  private readonly barrel: THREE.Mesh;
  private readonly lens: THREE.Mesh;
  private readonly lensMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.root.name = 'Torch';

    // Built one metre long and scaled per frame: the barrel's length is the distance
    // between two moving points, and rebuilding a cylinder every frame to say so would be
    // a geometry upload per frame for eight triangles' worth of torch.
    this.barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(TORCH.radius, TORCH.radius * 0.85, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.4 }),
    );

    this.lensMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff0cf,
      emissive: 0xffeecc,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    this.lens = new THREE.Mesh(
      new THREE.CylinderGeometry(TORCH.lensRadius, TORCH.lensRadius * 0.8, 0.03, 10),
      this.lensMaterial,
    );

    for (const part of [this.barrel, this.lens]) {
      part.castShadow = false;
      part.receiveShadow = false;
      this.root.add(part);
    }
    this.root.visible = false;
  }

  /**
   * Draw the torch from `grip` to `tip`, per rendered frame.
   *
   * `grip` is where the hand ended up, or null when there is no rigged hand to ask — a
   * placeholder body, or art the rig declined (§3.1). Then the barrel is simply hung off
   * the back of the beam, which is the same picture minus the hand holding it.
   *
   * `beam` is the rendered strength of the light, 0–1.
   */
  place(tip: THREE.Vector3, axis: THREE.Vector3, grip: THREE.Vector3 | null, beam: number): void {
    this.root.visible = true;

    const from = _grip.copy(grip ?? _fallback.copy(tip).addScaledVector(axis, -TORCH.minLength));
    const along = _along.subVectors(tip, from);
    const length = Math.max(along.length(), TORCH.minLength);
    if (along.lengthSq() < 1e-10) along.copy(axis);
    along.normalize();

    const turn = _turn.setFromUnitVectors(_up, along);

    this.barrel.position.copy(tip).addScaledVector(along, -length / 2);
    this.barrel.quaternion.copy(turn);
    this.barrel.scale.set(1, length, 1);

    this.lens.position.copy(tip);
    this.lens.quaternion.copy(turn);

    // §4.1 — the source is as bright as the beam it is throwing, so a battery running down
    // dims the thing in the player's hand as well as the pool on the floor.
    this.lensMaterial.emissiveIntensity = beam;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.barrel.geometry.dispose();
    this.lens.geometry.dispose();
    (this.barrel.material as THREE.Material).dispose();
    this.lensMaterial.dispose();
  }
}

const _grip = new THREE.Vector3();
const _fallback = new THREE.Vector3();
const _along = new THREE.Vector3();
const _turn = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
