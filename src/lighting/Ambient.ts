/**
 * The darkness the lighting mechanics act on (§4).
 *
 * Phases 0–2 lit the scene flat so the map was legible as geometry. From Phase 3 on the
 * map is dark, because everything in §4 and §5 is about what light does: a spider is
 * repelled by it, the Shadow Monster is frozen by it, and neither means anything on a
 * scene that is already lit.
 *
 * Not pure black, though. At zero ambient an unlit room renders as a blank screen rather
 * than a dark one, and the Shadow Monster is trackable only by a shadow it casts onto
 * ground with some light on it (§5.2).
 */

import * as THREE from 'three';
import { AMBIENT, MOON, RENDER } from '../config';

export interface NightRig {
  ambient: THREE.HemisphereLight;
  moon: THREE.DirectionalLight;
  /** Keeps the moon's shadow camera over the player. Called per rendered frame. */
  follow(x: number, z: number): void;
  dispose(): void;
}

export function addNightAmbient(scene: THREE.Scene): NightRig {
  const ambient = new THREE.HemisphereLight(
    AMBIENT.skyColor,
    AMBIENT.groundColor,
    AMBIENT.intensity,
  );
  ambient.name = 'NightAmbient';

  const moon = new THREE.DirectionalLight(MOON.color, MOON.intensity);
  moon.name = 'Moon';
  moon.castShadow = true;
  moon.shadow.mapSize.set(RENDER.moonShadowMapSize, RENDER.moonShadowMapSize);

  const camera = moon.shadow.camera;
  camera.left = -MOON.shadowExtent;
  camera.right = MOON.shadowExtent;
  camera.top = MOON.shadowExtent;
  camera.bottom = -MOON.shadowExtent;
  camera.near = 1;
  camera.far = MOON.shadowHeight * 2;
  // A directional light's shadows come from far away and graze the ground, which is where
  // acne lives; the normal bias costs a little contact fidelity and buys a clean floor.
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.08;

  scene.add(ambient, moon, moon.target);

  const offset = new THREE.Vector3(MOON.direction.x, MOON.direction.y, MOON.direction.z)
    .normalize()
    .multiplyScalar(MOON.shadowHeight);

  return {
    ambient,
    moon,
    follow(x: number, z: number): void {
      moon.target.position.set(x, 0, z);
      moon.position.set(x + offset.x, offset.y, z + offset.z);
      moon.target.updateMatrixWorld();
    },
    dispose(): void {
      moon.dispose();
      scene.remove(ambient, moon, moon.target);
    },
  };
}
