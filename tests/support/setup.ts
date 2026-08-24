/**
 * Test-runner setup.
 *
 * ZzFX constructs an `AudioContext` at import time — it keeps one for its own playback,
 * which this project never uses (§4.3 routes every sound through a `THREE.PositionalAudio`
 * instead). Node has no such constructor, so importing the sound bank would throw before a
 * single test ran.
 *
 * A stub rather than a jsdom environment: the only thing needed is for the constructor to
 * exist, and nothing under test touches the object. Making the whole suite run in a fake
 * DOM to satisfy one unused field would be a much larger claim about what these tests need.
 */
if (!('AudioContext' in globalThis)) {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    // ZzFX only ever reads `sampleRate` off its context if asked to play, which it is not.
    readonly sampleRate = 44100;
  };
}
