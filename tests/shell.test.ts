/**
 * The shell (§8): what the credits claim, and what the URL is allowed to turn on.
 *
 * Both are rules that hold until somebody adds a convenience. A dependency arrives and the
 * credits quietly stop being true; a test map gets easier to reach and debug mode leaks
 * into what a player sees. Neither failure is visible in a screenshot, so both are checked
 * here.
 *
 * And the same rule read the other way round: what debug mode is allowed to be the *only*
 * way to reach. A key the player has been given has to work without `?debug`, which is a
 * wiring question rather than a behavioural one, so it is checked against the source.
 *
 * And the same rule read the other way: what debug mode is allowed to be the *only* way to
 * reach. A key the player is given has to work without `?debug`, which is a wiring question
 * rather than a behavioural one, so it is checked against the source.
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

  it('names every art kit, its author and its licence, in order after design', () => {
    const [, art] = creditSections();
    expect(art?.heading).toBe('Art');
    expect(art?.lines.length).toBe(PREFAB_KITS.length);

    PREFAB_KITS.forEach((kit, index) => {
      expect(art?.lines[index]?.name).toBe(kit.kit);
      expect(art?.lines[index]?.by).toBe(kit.author);
      // §8.2 — a kit with no stated terms must not render as a blank licence, which reads
      // as "none needed". It says what is actually true: nobody has stated one.
      expect(art?.lines[index]?.licence).toBe(kit.licence ?? 'Licence not stated');
    });
  });

  it('names every kit whose licence requires the credit (§8.2)', () => {
    // A CC0 credit is a courtesy and reads like one. An attribution-required kit is a
    // *condition*, and a screen that does not distinguish them invites somebody to trim
    // the line that could not be trimmed.
    const [, art] = creditSections();
    const required = PREFAB_KITS.filter((kit) => kit.attributionRequired && kit.licence !== null);

    for (const kit of required) {
      expect(art?.lines.some((line) => line.name === kit.kit), `${kit.kit} not listed`).toBe(true);
      expect(art?.note, `${kit.kit} not named in the note`).toContain(kit.kit);
    }
    if (required.length > 0) expect(art?.note).toMatch(/as the licence requires/i);
  });

  it('says on screen when a kit\'s terms have not been confirmed (§8.2)', () => {
    const [, art] = creditSections();
    const unstated = PREFAB_KITS.filter((kit) => kit.licence === null);

    if (unstated.length > 0) {
      // The note has to name them. An unanswered licence question that is not visible is
      // one nobody will answer before release.
      for (const kit of unstated) expect(art?.note).toContain(kit.kit);
      expect(art?.note).toMatch(/not been confirmed/i);
    }
    // And CC0 is still said out loud, so the courtesy credits do not read as obligations.
    if (PREFAB_KITS.some((kit) => !kit.attributionRequired)) {
      expect(art?.note).toMatch(/requires no attribution/i);
    }
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
    // nothing outside `debugKey` ever read it. `main.ts` registers the debug listener only
    // under `?debug`, so the torch had no key at all in normal play — a state the type
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
