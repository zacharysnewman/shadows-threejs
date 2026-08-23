/**
 * The parts of the audio core that are arithmetic rather than Web Audio (§4.3).
 *
 * `AudioContext` does not exist in this environment, so `AudioCore` itself is exercised in
 * a browser rather than here. What is testable is what decides the cues: the distance
 * model's falloff, the left/right bias, the step cadence, and the placeholder synthesis.
 */

import { describe, expect, it } from 'vitest';
import { AUDIO } from '../src/config';
import { FootstepCadence } from '../src/audio/Footsteps';
import { attenuationAt, AUDIO_PROFILES, stereoBias } from '../src/audio/profiles';
import { isLooping, SOUND_NAMES, synthesise } from '../src/audio/SoundBank';

const DEFAULT = AUDIO_PROFILES.default;
const MONSTER = AUDIO_PROFILES.monsterFootsteps;

describe('audio profiles', () => {
  it('matches the distances §4.3 specifies', () => {
    expect(DEFAULT).toEqual({
      model: 'linear',
      refDistance: 2,
      maxDistance: 25,
      rolloffFactor: 1,
    });
    expect(MONSTER.refDistance).toBe(4);
    expect(MONSTER.maxDistance).toBe(35);
  });

  it('is at full volume inside the reference distance', () => {
    expect(attenuationAt(0, DEFAULT)).toBe(1);
    expect(attenuationAt(DEFAULT.refDistance, DEFAULT)).toBe(1);
  });

  it('falls linearly to silence at the maximum distance', () => {
    const midpoint = (DEFAULT.refDistance + DEFAULT.maxDistance) / 2;
    expect(attenuationAt(midpoint, DEFAULT)).toBeCloseTo(0.5);
    expect(attenuationAt(DEFAULT.maxDistance, DEFAULT)).toBeCloseTo(0);
    expect(attenuationAt(1000, DEFAULT)).toBe(0);
  });

  it('carries the monster further than anything else on the map (§4.3)', () => {
    // The whole point of its own profile: at a distance where everything else has gone
    // quiet, its footsteps are still there.
    for (const distance of [10, 20, 24]) {
      expect(attenuationAt(distance, MONSTER)).toBeGreaterThan(attenuationAt(distance, DEFAULT));
    }
    expect(attenuationAt(30, DEFAULT)).toBe(0);
    expect(attenuationAt(30, MONSTER)).toBeGreaterThan(0);
  });

  it('reads left and right off the screen axis, and centres what is north or south', () => {
    expect(stereoBias(10, 0)).toBeCloseTo(1);
    expect(stereoBias(-10, 0)).toBeCloseTo(-1);
    // Directly ahead or behind the player: the same cue, which is the honest limit of
    // stereo on a top-down map.
    expect(stereoBias(0, -10)).toBeCloseTo(0);
    expect(stereoBias(0, 10)).toBeCloseTo(0);
    expect(stereoBias(0, 0)).toBe(0);
  });

  it('reports partial bias for a diagonal source', () => {
    const bias = stereoBias(5, -5);
    expect(bias).toBeCloseTo(Math.SQRT1_2);
    expect(Math.abs(bias)).toBeLessThan(1);
  });
});

describe('FootstepCadence', () => {
  it('lands a step every stride of ground covered', () => {
    const cadence = new FootstepCadence(1);
    expect(cadence.tick(0.5)).toBe(false);
    expect(cadence.tick(0.4)).toBe(false);
    expect(cadence.tick(0.2)).toBe(true);
  });

  it('makes no noise when the player is not moving', () => {
    const cadence = new FootstepCadence(1);
    for (let i = 0; i < 100; i += 1) expect(cadence.tick(0)).toBe(false);
  });

  it('keeps an even cadence at speed rather than drifting', () => {
    // Walk 3 m/s for 10 s at 60 Hz with a 1 m stride: 30 steps, give or take the first.
    const cadence = new FootstepCadence(1);
    let steps = 0;
    for (let i = 0; i < 600; i += 1) if (cadence.tick(3 / 60)) steps += 1;
    expect(steps).toBeGreaterThanOrEqual(29);
    expect(steps).toBeLessThanOrEqual(30);
  });

  it('does not swallow strides when one tick covers several', () => {
    const cadence = new FootstepCadence(1);
    expect(cadence.tick(2.5)).toBe(true);
    // The remainder carries, so the next step lands 0.5 m later rather than 1 m later.
    expect(cadence.tick(0.5)).toBe(true);
  });
});

describe('placeholder synthesis', () => {
  const sampleRate = 44100;

  it('renders every named sound to audible samples', () => {
    for (const name of SOUND_NAMES) {
      const sound = synthesise(name, sampleRate);
      expect(sound.sampleRate).toBe(sampleRate);
      expect(sound.data.length).toBeGreaterThan(sampleRate * 0.1);

      let peak = 0;
      for (const sample of sound.data) peak = Math.max(peak, Math.abs(sample));
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic, so a run sounds the same as the last one', () => {
    const first = synthesise('chitter', sampleRate);
    const second = synthesise('chitter', sampleRate);
    expect(Array.from(first.data.slice(0, 500))).toEqual(Array.from(second.data.slice(0, 500)));
  });

  it('follows the sample rate it is given', () => {
    const low = synthesise('footstep_heavy', 22050);
    const high = synthesise('footstep_heavy', 44100);
    expect(high.data.length).toBeCloseTo(low.data.length * 2, -1);
  });

  it('marks the sounds that are meant to loop', () => {
    expect(isLooping('test_ping')).toBe(true);
    expect(isLooping('chitter')).toBe(true);
    expect(isLooping('footstep_light')).toBe(false);
  });

  it('gives the monster a heavier step than the player, where "heavier" means lower', () => {
    // Not a mix note: §5.2 is tracked by ear before it is seen, and low frequencies are
    // what survive distance. Compared by zero crossings, which is cheap and enough.
    const crossings = (name: 'footstep_light' | 'footstep_heavy'): number => {
      const { data } = synthesise(name, sampleRate);
      let count = 0;
      for (let i = 1; i < data.length; i += 1) {
        if ((data[i - 1] ?? 0) <= 0 !== (data[i] ?? 0) <= 0) count += 1;
      }
      return count / (data.length / sampleRate);
    };
    expect(crossings('footstep_heavy')).toBeLessThan(crossings('footstep_light'));
  });
});

describe('pool sizing', () => {
  it('is big enough that footsteps cannot starve a tracked threat', () => {
    // Entities hold their own emitters, so the pool only covers one-shots — but it still
    // has to survive a handful of them landing together.
    expect(AUDIO.poolSize).toBeGreaterThanOrEqual(8);
  });
});
