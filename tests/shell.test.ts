/**
 * The shell (§8): what the credits claim, and what the URL is allowed to turn on.
 *
 * Both are rules that hold until somebody adds a convenience. A dependency arrives and the
 * credits quietly stop being true; a test map gets easier to reach and debug mode leaks
 * into what a player sees. Neither failure is visible in a screenshot, so both are checked
 * here.
 *
 * And the same rule read the other way round: what debug mode is allowed to be the *only*
 * way to reach. A key the player has been given has to work without `?debug`, and the debug
 * chrome has to be reachable by nothing else — both are wiring questions rather than
 * behavioural ones, so they are checked against the source.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDITS, PREFAB_KITS } from '../src/config';
import { ACTION_NAMES } from '../src/core/Input';
import { parseShellOptions } from '../src/core/options';
import { creditSections, creditsText } from '../src/ui/credits';

describe('the credits (§8.2)', () => {
  it('names the designer first', () => {
    const [first] = creditSections();
    expect(first?.heading).toBe('Game design');
    expect(first?.lines[0]?.name).toBe('Zack Newman');
  });

  it('names every art kit, its author and where it came from, after design', () => {
    const [, art] = creditSections();
    expect(art?.heading).toBe('Art');
    expect(art?.lines.length).toBe(PREFAB_KITS.length);

    PREFAB_KITS.forEach((kit, index) => {
      expect(art?.lines[index]?.name).toBe(kit.kit);
      expect(art?.lines[index]?.by).toBe(kit.author);
      expect(art?.lines[index]?.url).toBe(kit.url);
    });
  });

  it('credits every kit, including the ones that require nothing (§8.2)', () => {
    // A project that credits only what it is forced to has misunderstood why the licence is
    // free, so a CC0 kit is listed exactly like an attribution-required one — and nothing
    // on the screen says which is which.
    const [, art] = creditSections();
    for (const kit of PREFAB_KITS) {
      expect(art?.lines.some((entry) => entry.name === kit.kit), `${kit.kit} not listed`)
        .toBe(true);
    }
  });

  it('says nothing about licence terms (§8.2)', () => {
    // The screen is attributions. Licences are a developer's question and are answered in
    // `PREFAB_KITS`, in the vendored kits' own licence files, and in the debug readout's
    // `assets` row — not beside a person's name, where they sort the thanks by legal
    // obligation and say that instead of who did the work.
    const rendered = `${creditsText()}\n${JSON.stringify(creditSections())}`;

    for (const licence of [
      ...PREFAB_KITS.map((kit) => kit.licence),
      ...CREDITS.libraries.map((library) => library.licence),
      ...CREDITS.tools.map((tool) => tool.licence),
    ]) {
      if (licence) expect(rendered, `${licence} on the credits screen`).not.toContain(licence);
    }
    expect(rendered).not.toMatch(/licen[cs]e|attribution|public domain/i);
  });

  it('credits every package the project actually ships or builds with (§8.2)', () => {
    // The rule §8.2 states — "generated from the same constants the game loads by, not
    // typed out separately" — is only true if something notices when it stops being. This
    // is that something: add a dependency without crediting it and this fails, naming it.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const credited = new Set<string>([
      ...CREDITS.libraries.map((library) => library.package),
      ...CREDITS.tools.map((tool) => tool.package),
    ]);

    const shipped = Object.keys(manifest.dependencies ?? {});
    const built = Object.keys(manifest.devDependencies ?? {})
      // Type stubs are not libraries: nothing of theirs is in the bundle or the build, and
      // crediting `@types/three` beside three.js would be crediting the same people twice.
      .filter((name) => !name.startsWith('@types/'));

    const missing = [...shipped, ...built].filter((name) => !credited.has(name));
    expect(missing).toEqual([]);
  });

  it('renders every section as text without losing a line', () => {
    const text = creditsText();
    for (const section of creditSections()) {
      expect(text).toContain(section.heading);
      for (const entry of section.lines) expect(text).toContain(entry.name);
    }
  });
});

describe('debug mode (§8.3)', () => {
  it('is off with no query string at all', () => {
    const options = parseShellOptions('');
    expect(options.debug).toBe(false);
    expect(options.map).toBeNull();
    expect(options.seed).toBeNull();
  });

  it('ignores ?map= and ?seed= unless debug is armed', () => {
    // §8.3 — these unlock *with* debug mode. A player following a link with a test map in
    // it is playing a fixture, and one with a pinned seed is replaying somebody else's run.
    const player = parseShellOptions('?map=phase7-test&seed=hello');
    expect(player.map).toBeNull();
    expect(player.seed).toBeNull();

    const developer = parseShellOptions('?debug&map=phase7-test&seed=hello');
    expect(developer.map).toBe('phase7-test');
    expect(developer.seed).toBe('hello');
  });

  it('refuses a map name that could climb out of maps/', () => {
    expect(parseShellOptions('?debug&map=../../etc/passwd').map).toBeNull();
    expect(parseShellOptions('?debug&map=a/b').map).toBeNull();
    expect(parseShellOptions('?debug&map=phase8-test').map).toBe('phase8-test');
  });

  it('reads the editor hand-off as its own thing, not as a map directory (§9.3)', () => {
    const playtest = parseShellOptions('?map=playtest&debug=1');
    expect(playtest.playtest).toBe(true);
    expect(playtest.map).toBeNull();
    expect(playtest.debug).toBe(true);
  });

  it('is off when the URL writes the flag out as off, not only when it is absent', () => {
    // §8.3 — `?debug=0` is how somebody turns a flag off, and a flag that read presence
    // alone made it unsayable: every value below armed the whole harness.
    for (const off of ['0', 'false', 'off', 'no', 'OFF', ' False ']) {
      const options = parseShellOptions(`?debug=${encodeURIComponent(off)}&map=phase7-test`);
      expect(options.debug, off).toBe(false);
      expect(options.map, off).toBeNull();
      expect(options.overlay, off).toBe(false);
    }

    for (const on of ['', '=1', '=yes', '=true']) {
      expect(parseShellOptions(`?debug${on}`).debug, on).toBe(true);
    }

    expect(parseShellOptions('?edit=0').edit).toBe(false);
    expect(parseShellOptions('?edit').edit).toBe(true);
  });

  it('starts the readout hidden on ?overlay=0 without disarming anything else (§8.3)', () => {
    // The point of it: `?map=` is debug-only, so a custom map on a phone used to come with
    // a readout over it and no key to press.
    const quiet = parseShellOptions('?debug&map=phase7-test&overlay=0');
    expect(quiet.overlay).toBe(false);
    expect(quiet.debug).toBe(true);
    expect(quiet.map).toBe('phase7-test');

    expect(parseShellOptions('?debug').overlay).toBe(true);
    // Nothing to show when the harness is not armed at all.
    expect(parseShellOptions('?overlay=1').overlay).toBe(false);
  });

  it('opens the editor without arming the debug harness (§9)', () => {
    // Authoring a level is not debugging a run: the editor is reachable on its own.
    const options = parseShellOptions('?edit');
    expect(options.edit).toBe(true);
    expect(options.debug).toBe(false);
  });
});

describe("the player's keys are not the debug harness's (§8.3)", () => {
  /** `src/Run.ts` with comment lines dropped, so a mention in prose is not a use. */
  function runCode(): string {
    return readFileSync(new URL('../src/Run.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
  }

  it('reads every action it binds a key for, from the run and not from `debugKey`', () => {
    // The bug this holds shut: `flashlight` was bound to `F` and to gamepad `X`, and
    // nothing outside `debugKey` ever read it. `main.ts` attaches the debug listener only
    // under `?debug`, so the torch had no key at all in normal play — an action the type
    // system is perfectly happy with, because a `Set` nobody queries still type-checks.
    const code = runCode();

    for (const action of ACTION_NAMES) {
      const consumed =
        code.includes(`wasPressed('${action}')`) || code.includes(`isHeld('${action}')`);
      expect(consumed, `nothing in the run reads the '${action}' action`).toBe(true);
    }
  });

  it('does not also toggle the torch from the debug keys', () => {
    // Both paths at once is not a harmless duplicate: `debugKey` is a second listener, so
    // under `?debug` one press would toggle twice and the beam would never come on.
    const debugKeys = runCode().split('function debugKey(')[1] ?? '';
    expect(debugKeys).not.toContain('KeyF');
    // Not vacuous — the other debug keys are still in there.
    expect(debugKeys).toContain('KeyB');
  });
});

describe('the readout\'s touch controls are debug-only (§8.3)', () => {
  /** `src/main.ts` with comment lines dropped, so a mention in prose is not a use. */
  function shellCode(): string {
    return readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
  }

  it('arms the tap targets only under debug, and never for a player', () => {
    // The readout is built either way and hidden for a player, so the buttons that toggle
    // it would be too — a `dbg` handle sitting over the corner of a player's screen, with
    // the whole harness one tap behind it. Nothing else may call this.
    const code = shellCode();
    const calls = code.match(/enableTouchToggle\(\)/g) ?? [];
    expect(calls.length).toBe(1);
    expect(code).toContain('if (options.debug) overlay.enableTouchToggle();');
  });

  it('starts the readout from `overlay`, which is false whenever debug is off', () => {
    // `setVisible(options.debug)` would ignore `?overlay=0` and put the readout back up.
    expect(shellCode()).toContain('overlay.setVisible(options.overlay)');
    expect(parseShellOptions('?overlay=1').overlay).toBe(false);
  });
});

describe('the readout fits the screen it is on (§8.3)', () => {
  const source = readFileSync(new URL('../src/debug/DebugOverlay.ts', import.meta.url), 'utf8');

  it('wraps its rows instead of running them off the side of a phone', () => {
    // The bug this holds shut: `white-space:pre` does not wrap, so any row longer than the
    // box ran off the right of the glass and took its value with it — on a phone that was
    // most of the interesting rows, and it read as the readout simply not reporting them.
    expect(source).toContain('white-space:pre-wrap');
    expect(source).not.toContain("'white-space:pre'");
    // And the box itself is bounded by the viewport, not only by a character count: 46ch
    // is wider than a phone.
    expect(source).toContain('max-width:min(46ch, calc(100vw - 24px))');
  });

  it('hangs a folded row under its value, not under its label', () => {
    // Every row is an 8-character label, a space, then a value. A fold that resumed at
    // column 0 would read as a new row with a blank label.
    expect(source).toContain('padding-left:9ch;text-indent:-9ch');
  });
});

describe('rows that outlive a run (§8.3)', () => {
  it('does not clear the shell\'s rows when a run clears its own', () => {
    // `Run.dispose` calls `clearRows` because a run's rows close over its objects and must
    // go when it does. The shell's close over things that outlive every run — the menu's
    // music among them — so clearing those deletes the readout's only view of them after
    // the first restart, which reads as the row never having worked.
    const overlay = readFileSync(new URL('../src/debug/DebugOverlay.ts', import.meta.url), 'utf8');
    const clear = /clearRows\(\): void \{([^}]*)\}/.exec(overlay)?.[1] ?? '';
    expect(clear).toContain('this.rows.clear()');
    expect(clear).not.toContain('shellRows');
    // And the readout actually reads them, or a persistent row is one nobody ever sees.
    expect(overlay).toContain('...this.rows, ...this.shellRows');
  });

  it('puts the music on the shell rows and the shell handle, not on a run', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("overlay.addShellRow('music'");
    // Published before the first run: the music plays on the title screen, and a handle
    // that only existed inside a run could not reach it.
    expect(main).toContain('const shellHandle = {');
    const run = readFileSync(new URL('../src/Run.ts', import.meta.url), 'utf8');
    expect(run).not.toContain('addShellRow');
  });
});
