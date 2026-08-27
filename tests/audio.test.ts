/**
 * The parts of the audio core that are arithmetic rather than Web Audio (§4.3).
 *
 * `AudioContext` does not exist in this environment, so `AudioCore` itself is exercised in
 * a browser rather than here. What is testable is what decides the cues: the distance
 * model's falloff, the left/right bias, the step cadence, and the placeholder synthesis.
 */

import { readFileSync } from 'node:fs';
import { mp3Facts } from '../scripts/mp3-facts.mjs';
import { wavFacts } from '../scripts/wav-facts.mjs';
import { describe, expect, it } from 'vitest';
import { AUDIO, MUSIC, PLAYER, RUN } from '../src/config';
import { FOOTFALL_METRES } from '../src/player/WalkCycle';
import { FootstepVariants } from '../src/audio/Footsteps';
import { attenuationAt, AUDIO_PROFILES, stereoBias } from '../src/audio/profiles';
import {
  isLooping,
  PLAYER_FOOTSTEPS,
  SOUND_NAMES,
  type SoundName,
  synthesise,
} from '../src/audio/SoundBank';
import { Rng } from '../src/core/rng';

const DEFAULT = AUDIO_PROFILES.default;

describe('audio profiles', () => {
  it('matches the distances §4.3 specifies', () => {
    expect(DEFAULT).toEqual({
      model: 'linear',
      refDistance: 2,
      maxDistance: 25,
      rolloffFactor: 1,
    });
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

describe('FootstepVariants (§4.3)', () => {
  const variants = (): FootstepVariants =>
    new FootstepVariants(PLAYER_FOOTSTEPS.length, new Rng(1234));

  it('never plays the same recording twice running', () => {
    const picker = variants();
    let previous = picker.next();
    for (let i = 0; i < 500; i += 1) {
      const next = picker.next();
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('stays inside the set, and reaches all of it', () => {
    const picker = variants();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const index = picker.next();
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PLAYER_FOOTSTEPS.length);
      seen.add(index);
    }
    expect(seen.size).toBe(PLAYER_FOOTSTEPS.length);
  });

  it('spreads evenly over the variants it is allowed to pick', () => {
    // Uniform over the *other* three, so each of the four lands about a quarter of the
    // time. A picker that merely avoided repeats — cycling 0,1,2,3 — would pass the test
    // above and fail this one, and a cycle is as recognisable as a repeat.
    const picker = variants();
    const counts = new Array<number>(PLAYER_FOOTSTEPS.length).fill(0);
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) counts[picker.next()]! += 1;
    const expected = draws / PLAYER_FOOTSTEPS.length;
    for (const count of counts) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.15);
  });

  it('replays a seed exactly, so a run sounds the same twice (Cross-Cutting: determinism)', () => {
    const draw = (): number[] => {
      const picker = new FootstepVariants(PLAYER_FOOTSTEPS.length, new Rng(99));
      return Array.from({ length: 40 }, () => picker.next());
    };
    expect(draw()).toEqual(draw());
    // And a different seed is a different order, or the seed is not doing anything.
    const other = new FootstepVariants(PLAYER_FOOTSTEPS.length, new Rng(100));
    expect(Array.from({ length: 40 }, () => other.next())).not.toEqual(draw());
  });

  it('survives a set of one, which is what a stripped build would leave', () => {
    const picker = new FootstepVariants(1, new Rng(1));
    for (let i = 0; i < 10; i += 1) expect(picker.next()).toBe(0);
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
    const low = synthesise('death_monster', 22050);
    const high = synthesise('death_monster', 44100);
    expect(high.data.length).toBeCloseTo(low.data.length * 2, -1);
  });

  it('marks the sounds that are meant to loop', () => {
    expect(isLooping('test_ping')).toBe(true);
    expect(isLooping('chitter')).toBe(true);
    for (const name of PLAYER_FOOTSTEPS) expect(isLooping(name)).toBe(false);
  });

});

describe('the death sounds (§5.3)', () => {
  const sampleRate = 44100;

  /** Share of a sound's energy below ~150 Hz — what survives distance. */
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

describe("the player's step recordings (§4.3)", () => {
  /**
   * The samples in a 16-bit PCM WAV, mixed to mono.
   *
   * Deliberately not built on `wavFacts`: this is the check that the shipped files are what
   * `public/audio/README.md` says they are, and a check that parses its subject with its
   * subject's own parser can only ever agree with it.
   */
  const readWav = (path: URL): { samples: Float32Array; sampleRate: number } => {
    const buffer = readFileSync(path);
    let sampleRate = 0;
    let channels = 0;
    let bits = 0;
    let samples = new Float32Array(0);

    let at = 12;
    while (at + 8 <= buffer.length) {
      const id = buffer.toString('latin1', at, at + 4);
      const size = buffer.readUInt32LE(at + 4);
      const body = at + 8;
      if (id === 'fmt ') {
        channels = buffer.readUInt16LE(body + 2);
        sampleRate = buffer.readUInt32LE(body + 4);
        bits = buffer.readUInt16LE(body + 14);
      } else if (id === 'data') {
        const frames = size / ((bits / 8) * channels);
        samples = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) {
          let sum = 0;
          for (let c = 0; c < channels; c += 1) {
            sum += buffer.readInt16LE(body + (i * channels + c) * 2) / 32768;
          }
          samples[i] = sum / channels;
        }
      }
      at = body + size + (size % 2);
    }
    return { samples, sampleRate };
  };

  const clips = PLAYER_FOOTSTEPS.map((name) => ({
    name,
    ...readWav(new URL(`../public/audio/${name}.wav`, import.meta.url)),
  }));

  it('ships a file for every variant the bank names', () => {
    // A rename that leaves a name without a file does not throw — the bank quietly falls
    // back to the synthesised placeholder, and the game keeps making a step sound that is
    // not the one anybody chose. This is the only place that failure is visible.
    for (const clip of clips) {
      expect(clip.sampleRate).toBeGreaterThan(0);
      expect(clip.samples.length).toBeGreaterThan(0);
    }
  });

  it('is mono, so the panner can place it', () => {
    for (const name of PLAYER_FOOTSTEPS) {
      const facts = wavFacts(readFileSync(new URL(`../public/audio/${name}.wav`, import.meta.url)));
      expect(facts).not.toBeNull();
      expect(facts!.channels).toBe(1);
      expect(facts!.bits).toBe(16);
    }
  });

  it('puts every variant\'s transient at the same offset', () => {
    // The property that makes a random pick safe, and the one that silently regresses if
    // the set is ever re-cut. The sources carried their step anywhere from 0.11 s to
    // 0.36 s in; picked at random that moves the footfall by up to a quarter of a second,
    // which is most of a stride. See `public/audio/README.md`.
    const peakAt = ({ samples, sampleRate }: { samples: Float32Array; sampleRate: number }) => {
      let peak = 0;
      let at = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const magnitude = Math.abs(samples[i] ?? 0);
        if (magnitude > peak) {
          peak = magnitude;
          at = i;
        }
      }
      return at / sampleRate;
    };

    const offsets = clips.map(peakAt);
    for (const offset of offsets) expect(offset).toBeCloseTo(offsets[0]!, 2);
  });

  it('finishes before the next foot lands, at the speed they land fastest', () => {
    // Derived, not hard-coded: the footfall spacing is §3.1's stride and the speed is
    // §3.1's sprint, and a tuning pass on either should not fail this for the wrong
    // reason. Sprinting is the bound — that is where the two feet are closest in time.
    const between = FOOTFALL_METRES / PLAYER.sprintSpeed;
    for (const clip of clips) {
      expect(clip.samples.length / clip.sampleRate).toBeLessThan(between);
    }
  });

  it('is level-matched across the set, so no variant reads as a stumble', () => {
    const peaks = clips.map(({ samples }) =>
      samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0),
    );
    for (const peak of peaks) expect(peak).toBeCloseTo(peaks[0]!, 2);

    // Peaks are matched exactly; loudness is allowed to vary, but not by the 2.9x the raw
    // sources did — that is the difference between four steps and four different walkers.
    const levels = clips.map(({ samples }) =>
      Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length),
    );
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(2);
  });

  it('starts and ends at silence, so a step cannot click', () => {
    for (const { samples } of clips) {
      expect(Math.abs(samples[0] ?? 1)).toBeLessThan(0.001);
      expect(Math.abs(samples[samples.length - 1] ?? 1)).toBeLessThan(0.001);
    }
  });

  it('refuses a buffer that is not a WAV rather than inventing facts about it', () => {
    expect(wavFacts(Buffer.from('this is not audio'))).toBeNull();
    expect(wavFacts(Buffer.alloc(4096))).toBeNull();
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
