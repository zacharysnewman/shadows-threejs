/**
 * Sound assets, and the placeholders standing in for them (§4.3).
 *
 * Same arrangement as the prefab loader: try for a real file, fall back to something
 * procedural so the systems above can be built and heard before any audio exists. A sound
 * bank of synthesised blips is not a soundtrack, but it is enough to answer this phase's
 * question — can an unseen source be located by ear — and swapping real files in later
 * changes nothing above this file.
 *
 * The synthesis itself is deliberately kept out of Web Audio: it fills a `Float32Array`
 * with plain arithmetic, so it can be exercised in tests where no `AudioContext` exists,
 * and it is seeded so two runs produce byte-identical buffers (Cross-Cutting:
 * determinism).
 */

export const SOUND_NAMES = ['test_ping', 'footstep_light', 'footstep_heavy', 'chitter'] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export interface SynthesisedSound {
  data: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Whether the sound is meant to be played as a loop. */
  loop: boolean;
}

/** Small deterministic PRNG, so "noise" is the same noise every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole low-pass. Turns white noise into something with a body rather than a hiss. */
function lowPass(data: Float32Array<ArrayBuffer>, coefficient: number): void {
  let previous = 0;
  for (let i = 0; i < data.length; i += 1) {
    previous += coefficient * ((data[i] ?? 0) - previous);
    data[i] = previous;
  }
}

function normalise(data: Float32Array<ArrayBuffer>, peak = 0.9): void {
  let max = 0;
  for (const sample of data) max = Math.max(max, Math.abs(sample));
  if (max < 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < data.length; i += 1) data[i] = (data[i] ?? 0) * scale;
}

interface Recipe {
  seconds: number;
  loop: boolean;
  seed: number;
  render(data: Float32Array<ArrayBuffer>, sampleRate: number, random: () => number): void;
}

const RECIPES: Readonly<Record<SoundName, Recipe>> = {
  /**
   * The locator: two short chirps and a gap, looping. Broadband and rhythmic on purpose —
   * a continuous tone gives the ear far less to work with than repeated onsets do.
   */
  test_ping: {
    seconds: 1.0,
    loop: true,
    seed: 1,
    render(data, sampleRate) {
      for (const [start, frequency] of [
        [0, 900],
        [0.14, 1350],
      ] as const) {
        const offset = Math.floor(start * sampleRate);
        const length = Math.floor(0.09 * sampleRate);
        for (let i = 0; i < length && offset + i < data.length; i += 1) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 26);
          data[offset + i] = (data[offset + i] ?? 0) + Math.sin(2 * Math.PI * frequency * t) * envelope;
        }
      }
    },
  },

  /** The player's own step: a short, bright scuff. */
  footstep_light: {
    seconds: 0.16,
    loop: false,
    seed: 2,
    render(data, sampleRate, random) {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / sampleRate;
        data[i] = (random() * 2 - 1) * Math.exp(-t * 42);
      }
      lowPass(data, 0.5);
    },
  },

  /**
   * The Shadow Monster's step (§5.2): heavy, slow, and with a low thump under the scuff,
   * because it is heard long before it is seen.
   */
  footstep_heavy: {
    seconds: 0.42,
    loop: false,
    seed: 3,
    render(data, sampleRate, random) {
      for (let i = 0; i < data.length; i += 1) {
        const t = i / sampleRate;
        const thump = Math.sin(2 * Math.PI * 58 * t) * Math.exp(-t * 11);
        const scuff = (random() * 2 - 1) * Math.exp(-t * 20) * 0.6;
        data[i] = thump + scuff;
      }
      lowPass(data, 0.18);
    },
  },

  /** The spider (§5.1): a run of dry clicks. */
  chitter: {
    seconds: 0.5,
    loop: true,
    seed: 4,
    render(data, sampleRate, random) {
      let cursor = 0;
      while (cursor < data.length) {
        const length = Math.floor((0.004 + random() * 0.006) * sampleRate);
        for (let i = 0; i < length && cursor + i < data.length; i += 1) {
          const t = i / sampleRate;
          data[cursor + i] = (random() * 2 - 1) * Math.exp(-t * 320);
        }
        cursor += length + Math.floor((0.02 + random() * 0.06) * sampleRate);
      }
      lowPass(data, 0.75);
    },
  },
};

/** Render a placeholder sound to raw mono samples. No Web Audio involved. */
export function synthesise(name: SoundName, sampleRate: number): SynthesisedSound {
  const recipe = RECIPES[name];
  const data = new Float32Array(Math.max(1, Math.floor(recipe.seconds * sampleRate)));
  recipe.render(data, sampleRate, mulberry32(recipe.seed));
  normalise(data);
  return { data, sampleRate, loop: recipe.loop };
}

export function isLooping(name: SoundName): boolean {
  return RECIPES[name].loop;
}

/**
 * Decoded buffers by name, fetched where a real file exists and synthesised where it does
 * not. Everything is prepared up front: a sound that has to be fetched at the moment it is
 * needed arrives after the thing it was meant to announce.
 */
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
