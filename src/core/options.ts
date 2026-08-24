/**
 * What the URL is allowed to change (§8.3).
 *
 * **Debug is off by default, and it is the key to everything else.** `?map=` and `?seed=`
 * are developer affordances in the same sense the readout is: a player who lands on a link
 * with `?map=phase7-test` in it is playing a test fixture, and a player with a pinned seed
 * is playing a run somebody else already knows the shape of. So they are read only when
 * `?debug` is present, and ignored otherwise.
 *
 * Pure, and taking a query string rather than reading `window`, so the rules can be checked
 * without a browser — which matters more here than usual, because "off by default" is
 * exactly the kind of thing that is true until somebody adds a convenience.
 */

/** Directory name only, so nothing can traverse out of `maps/`. */
const MAP_NAME = /^[\w-]+$/;

export interface ShellOptions {
  /** §8.3 — the readout, the debug keys, the overlays and the free camera. */
  debug: boolean;
  /** §9 — boot the level editor instead of the game. */
  edit: boolean;
  /** Map directory under `maps/`, or null for the level. Debug only. */
  map: string | null;
  /** §9.3 — the editor's hand-off, which is a debug affordance of its own. */
  playtest: boolean;
  /** Pinned run seed, or null. Debug only. */
  seed: string | null;
}

export function parseShellOptions(search: string): ShellOptions {
  const params = new URLSearchParams(search);
  const debug = params.has('debug');
  const requestedMap = params.get('map');
  const map = debug && requestedMap && MAP_NAME.test(requestedMap) ? requestedMap : null;

  return {
    debug,
    // The editor is a tool, not a screen of the game, and it is reachable without arming
    // the debug harness — a designer authoring a level is not debugging a run (§9).
    edit: params.has('edit'),
    map: map === 'playtest' ? null : map,
    playtest: map === 'playtest',
    seed: debug ? params.get('seed') : null,
  };
}
