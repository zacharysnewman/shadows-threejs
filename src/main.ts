/**
 * Entry point: the shell a run is played inside (§6, Run Structure).
 *
 * A run is a single life over one map, and this file owns only what outlives one — the
 * renderer, the input devices, the decoded sound bank, the HUD shell and the debug
 * readout. Everything else is built by `createRun` and taken back down by its `dispose`,
 * which is what §5.3\'s "the only continuation is a new game" is made of: death and
 * victory both come back here, tear the world down, and build another.
 *
 * §8.1 — a session starts at the title, not in a run: the audio context cannot be started
 * without a user gesture (§4.3), and `Play` is the first gesture there is. §8.3 — `?debug`
 * arms the developer affordances and nothing else does, `?map=<directory>` and
 * `?seed=<word|number>` among them, so a player never lands in a test fixture or on
 * somebody else's replay.
 */

import { AudioCore } from './audio/AudioCore';
import { AssetLoader } from './core/AssetLoader';
import { Input } from './core/Input';
import { Viewport } from './core/Viewport';
import { DebugOverlay } from './debug/DebugOverlay';
import { FreeCamera } from './debug/FreeCamera';
import { MapValidationError } from './map/validate';
import { Hud } from './ui/Hud';
import { loadNotes } from './world/Notes';
import { createRun, type Run } from './Run';
import { EditorApp, PLAYTEST_KEY } from './editor/EditorApp';
import { parseShellOptions } from './core/options';
import { TitleScreen } from './ui/TitleScreen';

const DEFAULT_MAP = 'example';

/**
 * Built from `BASE_URL` rather than left document-relative: the site is served from a
 * subpath on GitHub Pages, and a relative URL would resolve against whatever path the page
 * happens to be on.
 */
function mapDirectory(name: string): string {
  return `${import.meta.env.BASE_URL}maps/${name}/`;
}

function showFatal(message: string): void {
  const panel = document.createElement('pre');
  panel.style.cssText = [
    'position:fixed',
    'inset:0',
    'margin:0',
    'padding:24px',
    'z-index:100',
    'overflow:auto',
    'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#ffb4a2',
    'background:#12060a',
    'white-space:pre-wrap',
  ].join(';');
  panel.textContent = message;
  document.body.appendChild(panel);
}

/**
 * §9.3 — a level handed straight from the editor to the game, through the browser rather
 * than through the repository. `?map=playtest` reads it; nothing else does, and a player
 * has no way to reach it.
 */
function playtestMap(): unknown | null {
  try {
    const raw = localStorage.getItem(PLAYTEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseShellOptions(window.location.search);

  if (options.edit) {
    new EditorApp();
    return;
  }

  // --- The shell ----------------------------------------------------------
  // Everything here survives a death, a victory and a restart. The rule for what belongs
  // in this list is narrow: a device the browser gave us, or a cache that is expensive to
  // rebuild and identical between runs.
  const viewport = new Viewport();
  const overlay = new DebugOverlay();
  // §8.3 — off by default. `H` still toggles it, but only once debug mode has armed the
  // keys at all, so a player has no way to summon it.
  overlay.setVisible(options.debug);
  const assets = new AssetLoader();
  const input = new Input(viewport.renderer.domElement);
  const freeCamera = new FreeCamera(viewport);
  const audio = new AudioCore(viewport.scene);
  const hud = new Hud();
  // §4.3 — the context starts suspended until the player touches something.
  audio.armGesture();

  // Decoded once. A sound that has to be fetched when it is needed arrives after the thing
  // it was meant to announce, and re-decoding the bank on every death would be worse.
  const [notes] = await Promise.all([
    loadNotes(`${import.meta.env.BASE_URL}notes.json`),
    audio.load(),
  ]);

  // §9.3 — a playtest borrows the standard tileset and brings only its own layout.
  const playtest = options.playtest ? playtestMap() : null;
  if (options.playtest && playtest === null) {
    // There is no `maps/playtest/` to fall through to, and a dev server answers a missing
    // file with the index page — so without this the designer gets a JSON parse error
    // instead of being told which browser their draft is in.
    showFatal('No playtest level in this browser.\n\nOpen the editor (?edit) and press Play.');
    return;
  }
  const directory = mapDirectory(playtest ? DEFAULT_MAP : (options.map ?? DEFAULT_MAP));
  const pinnedSeed = options.seed;
  let run: Run | null = null;
  // A run asks for the next one; the shell is what actually swaps them, because a run
  // cannot be the thing that disposes itself.
  const shell = {
    viewport,
    overlay,
    input,
    assets,
    audio,
    freeCamera,
    hud,
    notes,
    onRestart: () => void startRun(),
    // §8.1 — from the victory screen. Assigned through a getter rather than captured,
    // because the title screen is built after the shell it is handed to.
    onCredits: () => title.showCredits(),
  };

  /**
   * Tear down whatever is running and build another (§5.3, §6). The order matters: the old
   * run is disposed *before* the new one is built, so the two never coexist and a leak
   * shows up as something still in the scene rather than as a doubled frame rate cost.
   */
  async function startRun(): Promise<void> {
    run?.dispose();
    run = null;
    hud.reset();
    run = await createRun(shell, directory, pinnedSeed, playtest ?? undefined);
    if (import.meta.env.DEV) {
      (window as unknown as { shadows: unknown }).shadows = { ...run.handle, restart: startRun };
    }
  }

  /**
   * §8.1 — the title screen, and the only door into a run.
   *
   * `Play` is the user gesture the audio context is started from (§4.3), which is why
   * there is no way past this screen: a run reached without it would be a run with no
   * sound until the player happened to click something.
   */
  const title = new TitleScreen({
    onPlay: () => {
      audio.armGesture();
      void audio.resume();
      title.hide();
      void begin();
    },
    // §8.3 — the editor is a developer affordance on the title, and reachable by URL
    // regardless; what debug mode decides is whether a player is offered it.
    onEdit: options.debug ? () => { window.location.search = '?edit'; } : null,
  });

  async function begin(): Promise<void> {
    try {
      await startRun();
    } catch (error) {
      const detail = error instanceof MapValidationError ? error.message : String(error);
      showFatal(`Failed to load ${directory}\n\n${detail}`);
      throw error;
    }
  }

  // One listener for the whole session, forwarding to whichever run is current. A listener
  // per run would be a listener per death, each holding its run alive.
  // §8.3 — the debug keys exist only in debug mode: a player who presses `V` is not asking
  // for a free camera, and finding one is finding a different game.
  if (options.debug) {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      run?.debugKey(event.code);
    });
  }

  // --- Render loop --------------------------------------------------------
  let previous = performance.now();
  const frame = (now: number): void => {
    const realDelta = (now - previous) / 1000;
    previous = now;
    run?.frame(realDelta);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
