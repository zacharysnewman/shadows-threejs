/**
 * §2 — the look values every loaded model is surfaced with, on top of what it was authored
 * with (`MODELS`).
 *
 * The kit brings its own albedo and the defaults leave it exactly alone: a white tint, no
 * lift, scales of one. What this buys is a knob. The game is played at §4's night ambient,
 * where a surface is its own colour multiplied by very little, and "is this kit too dark to
 * read or is the ambient too low" cannot be answered by looking at either one on its own —
 * it needs one moved against the other while the run is in front of you (§8.3).
 *
 * **The authored values are kept on the material, not in a registry here.** A module-level
 * map of every material the loader has ever built is a map that outlives the run that built
 * them, and re-pushing a tuned value then writes to materials nothing is drawing. They go in
 * `userData` instead, which `Material.copy` carries through a `clone()` — so a material
 * cloned to be made per-instance (the trap `CharacterLoader` documents, and what
 * `Enemy.attachCharacter` does with it) is still re-pushed correctly.
 *
 * **Characters are deliberately not surfaced here.** The player's body has its own
 * readability allowance (§3.1, `PLAYER.readabilityLift`) written to the same `emissive`,
 * and two owners of one channel is a value that depends on which of them ran last.
 */

import * as THREE from 'three';
import { MODELS } from '../config';

/** What a model was authored with, kept so a re-push is from the art rather than compounded. */
interface AuthoredLook {
  colour: [number, number, number];
  emissive: [number, number, number];
  roughness: number;
  metalness: number;
}

/** Survives `JSON.parse(JSON.stringify(...))`, which is how Three clones `userData`. */
const LOOK_KEY = 'modelLook';

const _tint = new THREE.Color();
const _lift = new THREE.Color();

/**
 * Surface one loaded material, remembering what it came with the first time.
 *
 * Idempotent: called again on a material it has already seen, it re-derives from the
 * authored values rather than from whatever the last call left behind — which is what makes
 * dragging a slider a series of absolute answers instead of a compounding one.
 */
export function applyModelLook(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;

  const stored = material.userData[LOOK_KEY] as AuthoredLook | undefined;
  const authored: AuthoredLook = stored ?? {
    colour: [material.color.r, material.color.g, material.color.b],
    emissive: [material.emissive.r, material.emissive.g, material.emissive.b],
    roughness: material.roughness,
    metalness: material.metalness,
  };
  if (!stored) material.userData[LOOK_KEY] = authored;

  material.color.setRGB(...authored.colour).multiply(_tint.setHex(MODELS.albedoTint));
  // A fraction of the surface's *own* colour, added to whatever the art already glowed with
  // — so a lift of zero is the authored emissive and nothing else, and a lit fixture in a
  // kit model keeps being lit.
  material.emissive
    .setRGB(...authored.emissive)
    .add(_lift.copy(material.color).multiplyScalar(MODELS.readabilityLift));
  material.roughness = clamp01(authored.roughness * MODELS.roughnessScale);
  material.metalness = clamp01(authored.metalness * MODELS.metalnessScale);
}

/**
 * Re-push the look onto everything in a scene that carries an authored record (§8.3).
 *
 * Walks the graph rather than a list of what has been loaded, because that is the set that
 * is actually being drawn: a prefab's material is shared by every instance of it, a cloned
 * one belongs to one enemy, and both are reachable from the scene the moment they matter.
 */
export function refreshModelLook(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of [node.material].flat()) {
      if (material.userData?.[LOOK_KEY]) applyModelLook(material);
    }
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
