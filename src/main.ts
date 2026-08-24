/**
 * Entry point: the shell a run is played inside (§6, Run Structure).
 *
 * A run is a single life over one map, and this file owns only what outlives one — the
 * renderer, the input devices, the decoded sound bank, the HUD shell and the debug
 * readout. Everything else is built by `createRun` and taken back down by its `dispose`,
 * which is what §5.3\'s "the only continuation is a new game" is made of: death and
 * victory both come back here, tear the world down, and build another.
 *
 * `?map=<directory>` selects which map under `maps/` to load, so the per-phase test maps
 * are reachable without a rebuild. `?seed=<word|number>` pins the run\'s randomness; with
 * one pinned, every restart replays identically, and without one each life draws a fresh
 * seed and logs it.
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

const DEFAULT_MAP = 'example';

function selectedMap(): string {
  const requested = new URLSearchParams(window.location.search).get('map');
  // Directory name only — no traversal out of `maps/`.
  const safe = requested && /^[\w-]+$/.test(requested) ? requested : DEFAULT_MAP;
  // Built from BASE_URL rather than left document-relative: the site is served from a
  // subpath on GitHub Pages, and a relative URL would resolve against whatever path the
  // page happens to be on.
  return `${import.meta.env.BASE_URL}maps/${safe}/`;
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

async function main(): Promise<void> {
  // --- The shell ----------------------------------------------------------
  // Everything here survives a death, a victory and a restart. The rule for what belongs
  // in this list is narrow: a device the browser gave us, or a cache that is expensive to
  // rebuild and identical between runs.
  const viewport = new Viewport();
  const overlay = new DebugOverlay();
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

  const directory = selectedMap();
  const pinnedSeed = new URLSearchParams(window.location.search).get('seed');
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
    run = await createRun(shell, directory, pinnedSeed);
    if (import.meta.env.DEV) {
      (window as unknown as { shadows: unknown }).shadows = { ...run.handle, restart: startRun };
    }
  }

  try {
    await startRun();
  } catch (error) {
    const detail = error instanceof MapValidationError ? error.message : String(error);
    showFatal(`Failed to load ${directory}\n\n${detail}`);
    throw error;
  }

  // One listener for the whole session, forwarding to whichever run is current. A listener
  // per run would be a listener per death, each holding its run alive.
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    run?.debugKey(event.code);
  });

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
