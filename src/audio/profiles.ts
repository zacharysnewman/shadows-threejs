/**
 * Distance models and the cues they produce (§4.3).
 *
 * A profile is the whole of how far a sound carries: the Web Audio `linear` model with a
 * reference distance, a maximum, and a rolloff factor. §4.3 gives one, which everything on
 * the map uses; the type is a record rather than a constant so a sound that has to carry
 * differently can be given its own without threading a distance model through its caller.
 *
 * The two functions here duplicate arithmetic the audio hardware is already doing. That is
 * deliberate: "locatable by ear" is not a property a unit test can hear, so the debug
 * readout reports the loudness and the left/right bias the player *should* be getting, and
 * those numbers can be checked against what the graph actually outputs.
 */

import { AUDIO } from '../config';

export interface DistanceProfile {
  model: 'linear' | 'inverse' | 'exponential';
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
}

export type ProfileName = 'default';

export const AUDIO_PROFILES: Readonly<Record<ProfileName, DistanceProfile>> = {
  default: AUDIO.defaultProfile,
};

/**
 * Gain a source at `distance` metres should be playing at, 0–1, under the Web Audio
 * `linear` distance model: full inside the reference distance, falling in a straight line
 * to silence at the maximum.
 */
export function attenuationAt(distance: number, profile: DistanceProfile): number {
  const { refDistance, maxDistance, rolloffFactor } = profile;
  if (maxDistance <= refDistance) return distance <= refDistance ? 1 : 0;

  const clamped = Math.min(Math.max(distance, refDistance), maxDistance);
  const gain = 1 - (rolloffFactor * (clamped - refDistance)) / (maxDistance - refDistance);
  return Math.min(1, Math.max(0, gain));
}

/**
 * Left/right cue for a source, −1 hard left to +1 hard right.
 *
 * The camera never rotates (§3.2), so world `+x` is always screen-right and the bias is
 * just how much of the direction to the source lies across the screen. North and south of
 * the player sound alike — that is a real limit of stereo panning on a top-down map, not
 * an approximation here, and it is why distance has to carry the rest of the information.
 */
export function stereoBias(dx: number, dz: number): number {
  const distance = Math.hypot(dx, dz);
  return distance < 1e-6 ? 0 : dx / distance;
}
