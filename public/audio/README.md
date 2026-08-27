# Audio

Sound files the `SoundBank` loads by name (§4.3), plus the menu track (§8.1).

A name in `SOUND_NAMES` with no file here falls back to a ZzFX-synthesised placeholder, so
deleting any of these is a supported way to hear what the game sounded like before it had
assets. Most names are still in that state; the player's footsteps are not.

## `footstep_light_1…4.wav` — the player's step (§4.3)

Four variants, one chosen per footfall and never the same one twice running
(`FootstepVariants` in `src/audio/Footsteps.ts`). Mono, 48 kHz, 16-bit PCM; 40 KB for the
set.

WAV rather than MP3 deliberately. An MP3 decoder prepends encoder padding, and the whole
point of the cut below is that every variant's strike lands at the same offset — a format
that adds a variable head start to each one gives back the problem the alignment solved.
Uncompressed, a one-shot this short costs about 10 KB, so there is nothing to buy by
compressing it.

### What was done to the sources

The sources are four 1.056 s stereo recordings of soft footsteps on dirt. They could not be
used as they arrived, for three reasons, all measured:

| | source 1 | source 2 | source 3 | source 4 |
| --- | --- | --- | --- | --- |
| Strike lands at | 0.136 s | 0.130 s | 0.110 s | **0.354 s** |
| Peak amplitude | 0.32 | 0.24 | **0.11** | 0.25 |
| Footfalls in the file | 2 | 1 (+ scatter) | **2** | 1 |

1. **The strike sits at a different offset in each.** A 0.95 m stride at 3.0 m/s is a step
   every 317 ms, so picking source 4 at random puts that footfall 354 ms after the foot
   actually landed — after the *next* step was due. Random selection across offsets that
   far apart is not variation, it is a cadence that wanders.
2. **A 2.9× spread in level.** One variant in four landing 9 dB down reads as a stumble.
3. **Two of them contain more than one footfall**, which turns one step into two.

So each was cut to a single footfall: aligned on its own strike with 40 ms of the natural
scuff kept ahead of it, ended where the sound decays into the noise floor *or* where the
next footfall begins, whichever comes first; 5 ms fade in and 20 ms fade out so an edge
cannot click; mixed to mono, since the content was already all-but-mono (L and R RMS within
1%) and a `PositionalAudio` panner needs mono to place a source at all; and normalised to a
common **0.5** peak.

That peak is a mix decision with a spec reason behind it. §4.3 requires the player's steps
to be quieter than the Shadow Monster's, and the player's play at zero distance and never
attenuate — there is no distance left to make them quieter, so the asset has to be. The
monster's step normalises to 0.9.

The result is four one-shots of 0.078–0.118 s, each with its strike at 40 ms, matched in
peak and within 1.6× in RMS. `tests/audio.test.ts` asserts all of it against the shipped
files, so a re-cut that loses a property fails rather than quietly changing how walking
sounds.

## `music/falling-through-glass.mp3` — the menu track (§8.1)

Streamed through a media element rather than decoded into the bank: at 4:48 it would cost
around 110 MB held as PCM. See `src/audio/Music.ts`.
