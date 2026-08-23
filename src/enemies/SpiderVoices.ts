/**
 * The spiders' chittering (§5.1).
 *
 * One looping emitter per spider, riding its interpolated position, so a spider you cannot
 * see is a spider you can place. That matters more in this phase than in any before it:
 * §5.1's lifecycle is mostly *not* happening in the beam — a deterred spider runs off into
 * the dark, and whether it is still coming back is a question the player answers by ear.
 *
 * Held rather than borrowed from the one-shot pool (§4.3): a burst of footsteps must never
 * be able to silence the thing the player is tracking.
 *
 * Presentation only. Nothing here is on the simulation clock, and nothing here is read
 * back by the AI — a spider with no audio device behaves identically to one with.
 */

import type { AudioCore, Emitter } from '../audio/AudioCore';
import type { Enemy } from './Enemy';
import { Spider } from './Spider';

export class SpiderVoices {
  private readonly voices = new Map<Spider, Emitter>();

  constructor(audio: AudioCore, enemies: readonly Enemy[]) {
    for (const enemy of enemies) {
      if (!(enemy instanceof Spider)) continue;
      const emitter = audio.createEmitter('chitter');
      if (!emitter) continue;
      this.voices.set(enemy, emitter);
    }
  }

  get count(): number {
    return this.voices.size;
  }

  /**
   * Follow the bodies, on the render delta like every other presentation effect. Position
   * is taken from the scene node rather than from the simulation so the sound sits on the
   * spider the player can see rather than on the tick behind it.
   *
   * A frozen or recoiling spider goes quiet: §5.1's stun is total, and a stationary source
   * still chittering would be the one cue that gives away a spider holding in the dark
   * that the player has not found yet.
   */
  update(): void {
    for (const [spider, emitter] of this.voices) {
      const moving = spider.state !== 'frozen' && spider.state !== 'recoil';
      if (moving) emitter.play();
      else emitter.stop();
      emitter.moveTo(spider.object.position.x, spider.object.position.z, 0.3);
    }
  }

  dispose(): void {
    for (const emitter of this.voices.values()) emitter.dispose();
    this.voices.clear();
  }
}
