/**
 * The buzz of a lamp under strain (§4.2).
 *
 * §4.2 makes the flicker the clearest information the player ever gets about where the
 * Shadow Monster is, and the buzz is the half of that tell which works when the lamp is
 * off screen. A held emitter per lamp, started when it begins to strain and stopped when
 * it fails or recovers — never running otherwise, because a lamp that hummed all the time
 * would tell the player nothing at all.
 *
 * Presentation only, on the render loop: nothing here is read back by §4.2's lifecycle,
 * and a run with no audio device sabotages identically.
 */

import type { AudioCore, Emitter } from '../audio/AudioCore';
import type { EnvironmentLamp, EnvironmentLights } from './EnvironmentLights';

export class LampVoices {
  private readonly voices = new Map<EnvironmentLamp, Emitter>();

  constructor(audio: AudioCore, lights: EnvironmentLights) {
    for (const lamp of lights.lamps) {
      const emitter = audio.createEmitter('lamp_buzz');
      if (!emitter) continue;
      // Lamps do not move, so this is the only placement it ever needs.
      emitter.moveTo(lamp.entity.wx, lamp.entity.wz, 2.5);
      this.voices.set(lamp, emitter);
    }
  }

  get buzzingCount(): number {
    let count = 0;
    for (const emitter of this.voices.values()) if (emitter.playing) count += 1;
    return count;
  }

  update(): void {
    for (const [lamp, emitter] of this.voices) {
      if (lamp.sabotage === 'strain') emitter.play();
      else emitter.stop();
    }
  }

  dispose(): void {
    for (const emitter of this.voices.values()) emitter.dispose();
    this.voices.clear();
  }
}
