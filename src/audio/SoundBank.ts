/**
 * Sound assets, and the placeholders standing in for them (§4.3).
 *
 * Same arrangement as the prefab loader: try for a real file, fall back to something
 * procedural so the systems above can be built and heard before any audio exists. Swapping
 * real files in later changes nothing above this file.
 *
 * **The synthesis is ZzFX's** (MIT, Frank Force) — a parameter set per sound rather than
 * bespoke DSP per sound. Its `buildSamples` is a pure function from twenty-one numbers to
 * an array of samples: no audio device, no side effects, callable in a test. That is the
 * only part of the library used. ZzFX's own `play` is not, because §4.3 needs every sound
 * to come out of a `THREE.PositionalAudio` — a threat that cannot be seen has to be
 * locatable by ear, and ZzFX plays mono to a context of its own.
 *
 * **Every parameter set has `randomness` at 0.** ZzFX jitters the pitch of each shot by
 * default; here each sound is built once into a buffer and replayed from it, so the jitter
 * would not vary anything between plays — it would only make the buffer differ between
 * runs, which is exactly what Cross-Cutting's determinism rule forbids.
 *
 * **Loops are composed rather than synthesised.** ZzFX makes one-shots, and a one-shot with
 * a decay tail clicks when a `THREE.Audio` repeats it. A looping sound here is a fixed-length
 * buffer with shots placed inside it — which is what a chitter and a failing ballast
 * actually are.
 */

import { ZZFX } from 'zzfx';

export const SOUND_NAMES = [
  'test_ping',
  'footstep_light',
  'footstep_heavy',
  'chitter',
  'lamp_buzz',
  'heartbeat',
  'death_spider',
  'death_monster',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export interface SynthesisedSound {
  data: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Whether the sound is meant to be played as a loop. */
  loop: boolean;
}

/**
 * **`filter` is a high-pass when positive and a low-pass when negative, and its corner is
 * twice the number.** ZzFX builds one biquad from `sign(filter)` — `b0 = (1 + sign · cos)/2`
 * is the high-pass form — so reaching for a positive number to darken a sound removes its
 * bottom instead, which is the opposite of what was wanted and reads as the sound simply
 * being thin.
 *
 * One ZzFX shot placed in a buffer. The parameter order is ZzFX's own:
 * `volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
 * deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
 * sustainVolume, decay, tremolo, filter`.
 */
interface Shot {
  /** Offset into the buffer, in seconds. */
  at: number;
  params: number[];
}

interface Recipe {
  seconds: number;
  loop: boolean;
  shots: Shot[];
}

/** Shapes, by ZzFX's numbering, named so a parameter set can be read. */
const SINE = 0;
const TRIANGLE = 1;
const SAW = 2;
const NOISE_SHAPE = 3;

const RECIPES: Readonly<Record<SoundName, Recipe>> = {
  /**
   * The locator (Cross-Cutting: debug harness): two short chirps and a gap, looping.
   * Broadband and rhythmic on purpose — a continuous tone gives the ear far less to work
   * with than repeated onsets do, and §4.3 is judged on whether a source can be placed.
   */
  test_ping: {
    seconds: 1.0,
    loop: true,
    shots: [
      { at: 0.0, params: [1, 0, 900, 0.01, 0.04, 0.12, SINE, 1.6, -220, 0, 0, 0, 0, 0.1, 0, 0, 0, 1, 0, 0, 0] },
      { at: 0.16, params: [0.8, 0, 1200, 0.01, 0.03, 0.1, SINE, 1.6, -300, 0, 0, 0, 0, 0.1, 0, 0, 0, 1, 0, 0, 0] },
    ],
  },

  /** The player's step (§4.3): a light scuff with a short body. */
  footstep_light: {
    seconds: 0.3,
    loop: false,
    shots: [
      { at: 0, params: [1, 0, 260, 0.002, 0.02, 0.09, TRIANGLE, 1.2, -60, 0, 0, 0, 0, 1.4, 0, 0, 0, 0.6, 0.05, 0, 900] },
    ],
  },

  /**
   * The Shadow Monster's step (§5.2, §4.3): the same gesture an octave and a half down,
   * with a long tail. Low frequencies are what survive distance, and being tracked by ear
   * before it is seen is the whole of how this creature is played against.
   */
  footstep_heavy: {
    seconds: 0.55,
    loop: false,
    shots: [
      // Almost no noise: at anything above a trace it swamps the fundamental, and the
      // low end is the whole point — measured, a noisy version puts 4% of its energy
      // below 150 Hz where this puts 14%.
      { at: 0, params: [1, 0, 55, 0.005, 0.08, 0.34, SINE, 0.9, -18, 0, 0, 0, 0, 0.03, 0, 0, 0, 0.7, 0.1, 0, 0] },
    ],
  },

  /** The spider (§5.1): a run of dry clicks, looping. */
  chitter: {
    seconds: 0.5,
    loop: true,
    shots: [0.0, 0.06, 0.1, 0.19, 0.24, 0.28, 0.36, 0.43].map((at, index) => ({
      at,
      params: [
        0.8 + (index % 3) * 0.06,
        0,
        1500 + (index % 4) * 260,
        0.001,
        0.004,
        0.02,
        NOISE_SHAPE,
        1,
        0, 0, 0, 0, 0,
        2.4,
        0, 0, 0, 1, 0, 0,
        2600,
      ],
    })),
  },

  /**
   * A lamp under strain (§4.2): mains hum with a failing ballast's rasp over it. Twice
   * mains is what a magnetic ballast actually sings at, and §4.2 makes the buzz half of
   * the tell that says where the monster is when the lamp is off screen.
   */
  lamp_buzz: {
    seconds: 0.6,
    loop: true,
    shots: [
      { at: 0, params: [0.7, 0, 100, 0, 0.6, 0, SAW, 1, 0, 0, 0, 0, 0, 0.12, 0, 0, 0, 1, 0, 0.08, 700] },
      { at: 0, params: [0.35, 0, 200, 0, 0.6, 0, TRIANGLE, 1, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 1, 0, 0.12, 900] },
    ],
  },

  /**
   * §3.4 — the player's own heart, which is the only feedback the spec gives for health.
   * Two thumps, the second softer, and nothing high enough to be heard on top of the map's
   * audio rather than underneath it.
   */
  heartbeat: {
    seconds: 0.5,
    loop: false,
    shots: [
      { at: 0.0, params: [1, 0, 58, 0.002, 0.03, 0.14, SINE, 0.8, -30, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.5, 0.1, 0, 180] },
      { at: 0.17, params: [0.55, 0, 52, 0.002, 0.025, 0.12, SINE, 0.8, -26, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.5, 0.1, 0, 180] },
    ],
  },

  /**
   * §5.3 — the spider's kill. Bright, dry and convulsive: three stabs on an uneven beat,
   * the same shape the scare draws. High and noisy on purpose — it is the half of the pair
   * that must never be mistaken for the other, and the other is all bottom end.
   */
  death_spider: {
    seconds: 1.0,
    loop: false,
    shots: [
      { at: 0.0, params: [1, 0, 1250, 0.001, 0.05, 0.2, SAW, 1.5, -140, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0.08, 0, 0] },
      { at: 0.11, params: [0.9, 0, 1620, 0.001, 0.04, 0.16, SAW, 1.6, -180, 0, 0, 0, 0, 0.65, 0, 0, 0, 0.45, 0.06, 0, 0] },
      { at: 0.27, params: [0.85, 0, 1080, 0.001, 0.07, 0.3, SAW, 1.4, -110, 0, 0, 0, 0, 0.45, 0, 0, 0, 0.5, 0.1, 0, 0] },
    ],
  },

  /**
   * §5.3 — the monster's kill. One low impact with a long decay, and nothing bright in it
   * at all: the scare is the light going out, and a sound with a top end would be a second
   * thing arriving rather than everything leaving. It runs the length of the hold.
   */
  death_monster: {
    seconds: 1.5,
    loop: false,
    shots: [
      { at: 0.0, params: [1, 0, 38, 0.03, 0.32, 1.1, SINE, 0.7, -9, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.3, 0, -90] },
      // A little body over the sub, low-passed hard so it reads as weight and not as a tone.
      { at: 0.0, params: [0.45, 0, 70, 0.02, 0.14, 0.6, TRIANGLE, 0.9, -20, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.22, 0, -70] },
    ],
  },
};

function normalise(data: Float32Array<ArrayBuffer>, peak = 0.9): void {
  let max = 0;
  for (const sample of data) max = Math.max(max, Math.abs(sample));
  if (max < 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < data.length; i += 1) data[i] = (data[i] ?? 0) * scale;
}

/**
 * Build one sound. Deterministic: every parameter set pins ZzFX's `randomness` to 0, so
 * two runs produce byte-identical buffers (Cross-Cutting: determinism).
 *
 * ZzFX reads its sample rate off the shared object, so it is set here rather than assumed
 * — a context running at 22.05 kHz has to get a buffer built for 22.05 kHz or every sound
 * plays at the wrong pitch.
 */
export function synthesise(name: SoundName, sampleRate: number): SynthesisedSound {
  const recipe = RECIPES[name];
  const data = new Float32Array(Math.max(1, Math.floor(recipe.seconds * sampleRate)));

  const previousRate = ZZFX.sampleRate;
  ZZFX.sampleRate = sampleRate;
  try {
    for (const shot of recipe.shots) {
      const samples = ZZFX.buildSamples(...shot.params);
      const offset = Math.floor(shot.at * sampleRate);
      // Mixed rather than written, so overlapping shots layer — which is what the lamp's
      // hum and its harmonic are — and so a tail running past the end is simply cut.
      for (let i = 0; i < samples.length && offset + i < data.length; i += 1) {
        data[offset + i] = (data[offset + i] ?? 0) + (samples[i] ?? 0);
      }
    }
  } finally {
    ZZFX.sampleRate = previousRate;
  }

  normalise(data);
  return { data, sampleRate, loop: recipe.loop };
}

export function isLooping(name: SoundName): boolean {
  return RECIPES[name].loop;
}

export class SoundBank {
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly missing = new Set<SoundName>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly baseUrl = `${import.meta.env.BASE_URL}audio/`,
  ) {}

  /** Names that fell back to a placeholder, for the debug readout. */
  get placeholders(): readonly SoundName[] {
    return [...this.missing];
  }

  get(name: SoundName): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  async loadAll(): Promise<void> {
    await Promise.all(SOUND_NAMES.map((name) => this.load(name)));
  }

  private async load(name: SoundName): Promise<void> {
    const buffer = (await this.fetchBuffer(name)) ?? this.synthesiseBuffer(name);
    this.buffers.set(name, buffer);
  }

  private async fetchBuffer(name: SoundName): Promise<AudioBuffer | null> {
    const url = `${this.baseUrl}${name}.mp3`;
    try {
      // Same content-type check the prefab loader uses: a dev server answers an unknown
      // path with `index.html` and a 200, so the status alone proves nothing.
      const response = await fetch(url);
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || contentType.includes('text/html')) return null;
      return await this.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private synthesiseBuffer(name: SoundName): AudioBuffer {
    this.missing.add(name);
    const sound = synthesise(name, this.context.sampleRate);
    const buffer = this.context.createBuffer(1, sound.data.length, sound.sampleRate);
    buffer.copyToChannel(sound.data, 0);
    return buffer;
  }
}
