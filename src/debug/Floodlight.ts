/**
 * Flood the scene with light, for looking at things the game keeps dark (§8.3).
 *
 * The game is played in a torch beam on an unlit map (§4), which is right for the game and
 * useless for judging anything the beam is not currently on. Ground texture is the case
 * that forced this: §2's three surfaces cover every square metre of the world and, at
 * night, roughly none of them can be seen at once. Checking that a change to one of them
 * did what was intended meant walking the beam over it a patch at a time, which cannot show
 * how a surface reads *across* a map — whether it tiles visibly, whether one ground meets
 * another in a line, whether a texture that looks right under a torch looks like carpet
 * under an even light.
 *
 * **It is a view, never a lighting state.** The ambient is turned up and the fog is taken
 * off; nothing else moves. It changes no material, no light the game owns, and nothing any
 * enemy consults — `Illumination` answers exactly as it did with this off (§4), so a
 * monster is no more frozen and a spider no more repelled under it. That matters: a debug
 * light that entered the illumination query would be a debug tool that changes the game
 * while you look at it.
 *
 * Debug builds only, like everything else in this directory.
 */

import type * as THREE from 'three';
import { AMBIENT, FLOODLIGHT } from '../config';
import type { NightRig } from '../lighting/Ambient';

export class Floodlight {
  private on = false;
  /** The scene's own fog, kept so putting it back is exact rather than rebuilt. */
  private fog: THREE.Scene['fog'] = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly night: NightRig,
  ) {}

  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    if (value === this.on) return;
    this.on = value;
    if (value) {
      this.fog = this.scene.fog;
      this.scene.fog = null;
      this.night.ambient.intensity = FLOODLIGHT.ambientIntensity;
      return;
    }
    this.scene.fog = this.fog;
    this.night.ambient.intensity = AMBIENT.intensity;
  }

  toggle(): boolean {
    this.enabled = !this.on;
    return this.on;
  }
}
