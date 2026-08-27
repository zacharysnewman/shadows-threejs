/**
 * Types for `wav-facts.mjs`, which the tests and the map generator both consume.
 *
 * Declared here rather than by converting the script to TypeScript, for the same reason
 * `mp3-facts.d.mts` is: the generators run under bare `node` with no build step between
 * writing one and running it, and that is the point of them.
 */

export interface WavFacts {
  /** File size on disk. */
  bytes: number;
  /** Playing time in seconds, to three decimals — these are one-shots, not tracks. */
  seconds: number;
  sampleRate: number;
  channels: number;
  /** Bit depth, from the `fmt ` chunk. */
  bits: number;
  /** Always true: a WAV is uncompressed, so the duration is counted rather than inferred. */
  exact: boolean;
}

/** The facts, or null when the buffer is not a PCM WAV. */
export function wavFacts(buffer: Buffer): WavFacts | null;
