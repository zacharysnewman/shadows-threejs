/**
 * What an `.mp3` is, read out of the file (§8.1).
 *
 * The same reason `glb-facts.mjs` exists: the map indexes every tracked file, and a binary's
 * line count is the number of `\n` bytes that happen to fall inside it. For the music that
 * came out as 30,065 "lines" and a set of `§` citations scraped out of compressed audio —
 * an index answering a real question with a meaningless number, which is worse than one that
 * says nothing, because somebody eventually believes it.
 *
 * What is worth knowing about a track without opening a player is how long it is, how big it
 * is, and what it will cost to play. The last one is the reason this bothers with duration:
 * a file this length must be streamed rather than decoded, because `decodeAudioData` holds
 * the whole thing as PCM and the memory that costs is `duration × rate × channels × 4`
 * bytes — around 110 MB for this one (see `src/audio/Music.ts`).
 *
 * **Duration comes from the frame count where the file states one.** A VBR encoder writes a
 * Xing or Info header into the first frame carrying the total number of frames, which is
 * exact. Dividing the file size by a bitrate is only right for CBR, and is the fallback.
 */

/** Bitrates in kbps by version and layer, indexed by the header's 4-bit field. */
const BITRATES = {
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

/** Samples per frame: MPEG-1 Layer III carries 1152, MPEG-2/2.5 Layer III half that. */
const SAMPLES_PER_FRAME = { 1: 1152, 2: 576, 2.5: 576 };

/** Skip an ID3v2 tag, whose size is four 7-bit bytes. */
function audioStart(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size =
    ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
  return 10 + size;
}

/** Parse the frame header at `at`, or null if that is not a frame sync. */
function frameHeader(buffer, at) {
  if (at + 4 > buffer.length) return null;
  if (buffer[at] !== 0xff || (buffer[at + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (buffer[at + 1] >> 3) & 0x03;
  const layerBits = (buffer[at + 1] >> 1) & 0x03;
  // Layer III only: it is what an `.mp3` is, and the rest would be guesswork nobody needs.
  if (layerBits !== 0x01) return null;

  const version = { 0: 2.5, 2: 2, 3: 1 }[versionBits];
  if (version === undefined) return null;

  const rate = RATES[version][(buffer[at + 2] >> 2) & 0x03];
  const table = BITRATES[version === 1 ? '1-3' : '2-3'];
  const bitrate = table[(buffer[at + 2] >> 4) & 0x0f] * 1000;
  if (!rate || !bitrate) return null;

  const padding = (buffer[at + 2] >> 1) & 0x01;
  const channelMode = (buffer[at + 3] >> 6) & 0x03;
  const samples = SAMPLES_PER_FRAME[version];
  return {
    version,
    rate,
    bitrate,
    channels: channelMode === 3 ? 1 : 2,
    samples,
    // Layer III frame length in bytes, which is where a Xing header is looked for.
    length: Math.floor((samples / 8) * (bitrate / rate)) + padding,
  };
}

/** The frame count a Xing/Info header states, or null when the file carries none. */
function statedFrames(buffer, frameAt, header) {
  const end = Math.min(buffer.length, frameAt + header.length);
  const window = buffer.toString('latin1', frameAt, end);
  const tagAt = Math.max(window.indexOf('Xing'), window.indexOf('Info'));
  if (tagAt < 0) return null;

  const at = frameAt + tagAt;
  if (at + 12 > buffer.length) return null;
  const flags = buffer.readUInt32BE(at + 4);
  // Bit 0 is "frames present"; the count follows the flags when it is set.
  if ((flags & 0x01) === 0) return null;
  return buffer.readUInt32BE(at + 8);
}

/** The facts, or null when the buffer is not an MPEG audio file this can read. */
export function mp3Facts(buffer) {
  const start = audioStart(buffer);

  // Encoders pad; scan a little for the first sync rather than demanding one at the offset.
  let frameAt = -1;
  let header = null;
  for (let at = start; at < Math.min(buffer.length - 4, start + 8192); at += 1) {
    const candidate = frameHeader(buffer, at);
    if (candidate) {
      frameAt = at;
      header = candidate;
      break;
    }
  }
  if (!header) return null;

  const frames = statedFrames(buffer, frameAt, header);
  const seconds =
    frames !== null
      ? (frames * header.samples) / header.rate
      : ((buffer.length - start) * 8) / header.bitrate;

  return {
    bytes: buffer.length,
    seconds: Math.round(seconds * 10) / 10,
    sampleRate: header.rate,
    channels: header.channels,
    /** True when the duration came from the file's own frame count rather than a bitrate. */
    exact: frames !== null,
  };
}
