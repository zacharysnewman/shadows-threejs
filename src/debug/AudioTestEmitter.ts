/**
 * The moving off-screen emitter Phase 4 is judged by (Cross-Cutting: debug harness).
 *
 * It circles the player at a radius outside the camera's footprint (§3.2), looping a
 * locator sound. The exit criterion is that it can be found by ear alone, which nothing
 * automated can assert — so alongside the sound it reports the two cues the player is
 * being given: how far away it is, and how far across the screen. Those numbers can be
 * checked against what the audio graph actually outputs, and against where the emitter
 * would be if it were visible.
 */

import { AUDIO_PROFILES } from '../audio/profiles';
import { attenuationAt, stereoBias } from '../audio/profiles';
import type { AudioCore, Emitter } from '../audio/AudioCore';

/** Comfortably outside the visible ground footprint, so it is only ever heard. */
const ORBIT_RADIUS = 19;
/** Seconds per revolution. Slow enough to track by ear, quick enough to be obvious. */
const ORBIT_SECONDS = 9;

export class AudioTestEmitter {
  private emitter: Emitter | null = null;
  private angle = 0;
  private x = 0;
  private z = 0;
  private distance = 0;
  private bias = 0;

  constructor(private readonly core: AudioCore) {}

  get active(): boolean {
    return this.emitter !== null;
  }

  toggle(playerX: number, playerZ: number): boolean {
    if (this.emitter) {
      this.emitter.dispose();
      this.emitter = null;
      return false;
    }

    this.emitter = this.core.createEmitter('test_ping');
    if (!this.emitter) return false;

    this.angle = 0;
    this.tick(0, playerX, playerZ);
    this.emitter.play();
    return true;
  }

  /** On the simulation clock, so pausing and time-scaling the world moves it too (§7). */
  tick(dt: number, playerX: number, playerZ: number): void {
    if (!this.emitter) return;

    this.angle = (this.angle + (dt * Math.PI * 2) / ORBIT_SECONDS) % (Math.PI * 2);
    this.x = playerX + Math.sin(this.angle) * ORBIT_RADIUS;
    this.z = playerZ + Math.cos(this.angle) * ORBIT_RADIUS;
    this.emitter.moveTo(this.x, this.z);

    const dx = this.x - playerX;
    const dz = this.z - playerZ;
    this.distance = Math.hypot(dx, dz);
    this.bias = stereoBias(dx, dz);
  }

  /** What the player should be hearing, in words: side, distance, and expected loudness. */
  describe(): string {
    if (!this.emitter) return 'off';
    const gain = attenuationAt(this.distance, AUDIO_PROFILES.default);
    const side =
      Math.abs(this.bias) < 0.15 ? 'ahead/behind' : this.bias > 0 ? 'right' : 'left';
    return (
      `${this.distance.toFixed(1)}m ${side} (${this.bias >= 0 ? '+' : ''}${this.bias.toFixed(2)}) · ` +
      `gain ${(gain * 100).toFixed(0)}%`
    );
  }
}
