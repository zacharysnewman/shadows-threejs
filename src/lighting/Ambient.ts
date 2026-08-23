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
import { AMBIENT } from '../config';

export function addNightAmbient(scene: THREE.Scene): THREE.Light {
  const ambient = new THREE.HemisphereLight(
    AMBIENT.skyColor,
    AMBIENT.groundColor,
    AMBIENT.intensity,
  );
  ambient.name = 'NightAmbient';
  scene.add(ambient);
  return ambient;
}
