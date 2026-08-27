/**
 * What a `.wav` is, read out of the file (§4.3).
 *
 * The same reason `mp3-facts.mjs` and `glb-facts.mjs` exist: the map indexes every tracked
 * file, and a binary's line count is the number of `\n` bytes that happen to fall inside
 * it. The player's footsteps (`public/audio/README.md`) are the first WAVs in the tree, and
 * without this their records would carry a kind and nothing else.
 *
 * A WAV is a RIFF file, so the chunks are walked rather than assumed to be in any order: an
 * encoder is free to put `LIST` or `fact` between `fmt ` and `data`, and a reader that
 * takes the header's length as gospel gets the duration wrong the first time one does.
 */

/** The facts, or null when the buffer is not a PCM WAV this can read. */
export function wavFacts(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('latin1', 8, 12) !== 'WAVE') return null;

  let format = null;
  let dataBytes = null;

  let at = 12;
  while (at + 8 <= buffer.length) {
    const id = buffer.toString('latin1', at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    const body = at + 8;

    if (id === 'fmt ' && body + 16 <= buffer.length) {
      format = {
        // 1 is PCM, 3 is IEEE float; 0xfffe is WAVE_FORMAT_EXTENSIBLE, whose real format
        // lives in the extension. Only the tag is reported, so the distinction can wait.
        tag: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      // A chunk length running past the end means a truncated file; the bytes that are
      // actually there are the honest answer.
      dataBytes = Math.min(size, buffer.length - body);
    }

    // Chunks are word-aligned: an odd length is followed by a pad byte that is not counted.
    at = body + size + (size % 2);
  }

  if (!format || dataBytes === null || !format.sampleRate || !format.channels || !format.bits) {
    return null;
  }

  const bytesPerFrame = (format.bits / 8) * format.channels;
  const seconds = bytesPerFrame > 0 ? dataBytes / bytesPerFrame / format.sampleRate : 0;

  return {
    bytes: buffer.length,
    // Three places rather than the MP3's one: these are one-shots a few hundredths of a
    // second long, and a tenth of a second rounds every one of them to the same number.
    seconds: Math.round(seconds * 1000) / 1000,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bits: format.bits,
    /** Uncompressed, so the duration is exact rather than inferred from a bitrate. */
    exact: true,
  };
}
