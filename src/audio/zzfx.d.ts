/**
 * Types for `zzfx` (MIT, Frank Force), which ships as plain JavaScript.
 *
 * Only the pure half is declared: `buildSamples` turns a parameter set into an array of
 * samples and touches no audio device. ZzFX's own `play` is deliberately not used — §4.3
 * needs every sound to come out of a `THREE.PositionalAudio` so an unseen thing can be
 * located by ear, and ZzFX plays mono to its own destination.
 */
declare module 'zzfx' {
  export const ZZFX: {
    /** Master scale ZzFX applies inside `buildSamples`. */
    volume: number;
    /** Read by `buildSamples`; set it to the context's rate before building. */
    sampleRate: number;
    /** Created at import. Unused here, and stubbed away under the test runner. */
    audioContext: unknown;
    buildSamples(...parameters: number[]): number[];
  };
}
