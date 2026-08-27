/**
 * Types for `mp3-facts.mjs`, which the tests and the map generator both consume.
 *
 * Declared here rather than by converting the script to TypeScript, for the same reason
 * `glb-facts.d.mts` is: the generators run under bare `node` with no build step between
 * writing one and running it, and that is the point of them.
 */

export interface Mp3Facts {
  /** File size on disk. */
  bytes: number;
  /** Playing time in seconds, to one decimal. */
  seconds: number;
  sampleRate: number;
  channels: number;
  /** Whether `seconds` came from the file's stated frame count rather than from a bitrate. */
  exact: boolean;
}

/** The facts, or null when the buffer is not MPEG Layer III audio. */
export function mp3Facts(buffer: Buffer): Mp3Facts | null;
