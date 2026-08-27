/**
 * The parts of the audio core that are arithmetic rather than Web Audio (§4.3).
 *
 * `AudioContext` does not exist in this environment, so `AudioCore` itself is exercised in
 * a browser rather than here. What is testable is what decides the cues: the distance
 * model's falloff, the left/right bias, the step cadence, and the placeholder synthesis.
 */

import { readFileSync } from 'node:fs';
import { mp3Facts } from '../scripts/mp3-facts.mjs';
import { describe, expect, it } from 'vitest';
import { AUDIO, MUSIC, RUN } from '../src/config';
import { FootstepCadence } from '../src/audio/Footsteps';
import { attenuationAt, AUDIO_PROFILES, stereoBias } from '../src/audio/profiles';
import { isLooping, SOUND_NAMES, type SoundName, synthesise } from '../src/audio/SoundBank';

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
    //
    // Measured across the part of the buffer that is *sounding*, not across the whole of
    // it. The monster's step is both lower and longer, and a rate taken over the padded
    // length would count its silence against it — which reads as the low sound being the
    // high one.
    const crossingRate = (name: 'footstep_light' | 'footstep_heavy'): number => {
      const { data } = synthesise(name, sampleRate);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      const floor = peak * 0.01;

      let count = 0;
      let sounding = 0;
      for (let i = 1; i < data.length; i += 1) {
        if (Math.abs(data[i] ?? 0) < floor) continue;
        sounding += 1;
        if ((data[i - 1] ?? 0) <= 0 !== (data[i] ?? 0) <= 0) count += 1;
      }
      return count / (sounding / sampleRate);
    };
    expect(crossingRate('footstep_heavy')).toBeLessThan(crossingRate('footstep_light'));
  });

  it('puts the monster\'s step where distance cannot take it: below 150 Hz', () => {
    // The crossing rate above is a weak proxy — broadband noise dominates it, and both
    // steps read around 2.5 kHz by it. What §4.3 actually claims is that the low end is
    // what survives distance, so measure the low end: the share of a sound's energy that
    // makes it through a one-pole low-pass at roughly 150 Hz.
    const lowShare = (name: 'footstep_light' | 'footstep_heavy'): number => {
      const { data } = synthesise(name, sampleRate);
      // One-pole coefficient for a ~150 Hz corner at this rate.
      const coefficient = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
      let filtered = 0;
      let lowEnergy = 0;
      let totalEnergy = 0;
      for (const sample of data) {
        filtered += coefficient * (sample - filtered);
        lowEnergy += filtered * filtered;
        totalEnergy += sample * sample;
      }
      return totalEnergy === 0 ? 0 : lowEnergy / totalEnergy;
    };

    const heavy = lowShare('footstep_heavy');
    expect(heavy).toBeGreaterThan(lowShare('footstep_light') * 2);
    expect(heavy).toBeGreaterThan(0.1);
  });
});

describe('the death sounds (§5.3)', () => {
  const sampleRate = 44100;

  /** Share of a sound's energy below ~150 Hz, as `footstep_heavy` is measured above. */
  const lowShare = (name: SoundName): number => {
    const { data } = synthesise(name, sampleRate);
    const coefficient = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
    let filtered = 0;
    let low = 0;
    let total = 0;
    for (const sample of data) {
      filtered += coefficient * (sample - filtered);
      low += filtered * filtered;
      total += sample * sample;
    }
    return total === 0 ? 0 : low / total;
  };

  /** The complement, above ~1 kHz: what "bright" means for the pair below. */
  const highShare = (name: SoundName): number => {
    const { data } = synthesise(name, sampleRate);
    const coefficient = 1 - Math.exp((-2 * Math.PI * 1000) / sampleRate);
    let filtered = 0;
    let high = 0;
    let total = 0;
    for (const sample of data) {
      filtered += coefficient * (sample - filtered);
      const above = sample - filtered;
      high += above * above;
      total += sample * sample;
    }
    return total === 0 ? 0 : high / total;
  };

  it('gives the two causes sounds that are not confusable, the way the overlays are not', () => {
    // §5.3 — the player has to know which mistake they made, and the sound is half of what
    // tells them. Asserted in both directions, because one of them alone can be satisfied
    // by a sound that is merely quiet: the monster's is bottom and the spider's is top.
    expect(lowShare('death_monster')).toBeGreaterThan(lowShare('death_spider') * 5);
    expect(highShare('death_spider')).toBeGreaterThan(highShare('death_monster') * 5);
    // And each is decisively one thing rather than both: a sound split evenly across the
    // spectrum reads as neither.
    expect(lowShare('death_monster')).toBeGreaterThan(0.3);
    expect(highShare('death_spider')).toBeGreaterThan(0.5);
  });

  it("covers the monster's hold, so the screen does not go quiet before it goes black", () => {
    // §5.3's hold is 1.5 s and the monster's scare ends on full black; a sound that stopped
    // early would leave the last of it silent.
    expect(synthesise('death_monster', sampleRate).data.length).toBeGreaterThanOrEqual(
      sampleRate * RUN.jumpScareSeconds,
    );
  });

  it('plays the scare through the world being silenced, not through a suspended context', () => {
    // The bug this holds shut: `setPaused(true)` suspends the whole `AudioContext`, so a
    // death sound played beside it is never heard. The world stops; the context does not.
    const run = readFileSync(new URL('../src/Run.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    const death = run.split('if (player.health.dead) {')[1]?.split('return;')[0] ?? '';
    expect(death).not.toBe('');
    expect(death).toContain('audio.silenceWorld()');
    expect(death).not.toContain('setPaused(true)');
    expect(death).toContain('death_spider');
    expect(death).toContain('death_monster');
  });
});

describe('pool sizing', () => {
  it('is big enough that footsteps cannot starve a tracked threat', () => {
    // Entities hold their own emitters, so the pool only covers one-shots — but it still
    // has to survive a handful of them landing together.
    expect(AUDIO.poolSize).toBeGreaterThanOrEqual(8);
  });
});

describe('the menu music (§8.1)', () => {
  const file = new URL(`../public/audio/music/${MUSIC.file}`, import.meta.url);

  it('is the track the config names, and is read from the file rather than guessed at', () => {
    // The map used to index this as 30,065 "lines" — the `\n` bytes that happen to fall
    // inside compressed audio — with `§` citations scraped out of the same. A binary's
    // facts have to be measured or not stated.
    const facts = mp3Facts(readFileSync(file));
    expect(facts).not.toBeNull();
    expect(facts!.exact).toBe(true);
    expect(facts!.seconds).toBeGreaterThan(280);
    expect(facts!.seconds).toBeLessThan(300);
  });

  it('is far too long to decode, which is why it streams', () => {
    // §8.1 — `decodeAudioData` holds the whole thing as PCM. The number below is what that
    // would cost, and it is the entire reason `Music` uses a media element at all: this is
    // the check that fails if somebody later moves the track into the `SoundBank`.
    const facts = mp3Facts(readFileSync(file))!;
    const decodedBytes = facts.seconds * facts.sampleRate * facts.channels * 4;
    expect(decodedBytes).toBeGreaterThan(100_000_000);
    expect(SOUND_NAMES).not.toContain(MUSIC.file.replace('.mp3', ''));
  });

  it('refuses a buffer that is not MPEG audio rather than inventing facts about it', () => {
    expect(mp3Facts(Buffer.from('this is not audio'))).toBeNull();
    expect(mp3Facts(Buffer.alloc(4096))).toBeNull();
  });

  it('fades out over less time than it fades in (§8.1)', () => {
    // A run beginning should not have the menu still audible under it; arriving can take
    // its time.
    expect(MUSIC.fadeOutSeconds).toBeLessThan(MUSIC.fadeInSeconds);
    expect(MUSIC.volume).toBeGreaterThan(0);
    expect(MUSIC.volume).toBeLessThan(1);
  });
});
