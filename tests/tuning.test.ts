/**
 * The balance tuner's model (§8.3): what it stores, what it refuses to trust, and the two
 * rules that make it safe to have at all — it is debug-only, and it never becomes the game.
 *
 * The sliders are DOM and are driven in a browser. What is here is everything that decides
 * *which* numbers the game ends up running on, which is worth checking exactly: a tuner
 * that silently applies a stale stored value is a tuner that makes every later measurement
 * a lie about the spec.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ENEMY, FLASHLIGHT, PLAYER } from '../src/config';
import { ENEMY_PROFILES } from '../src/enemies/Enemy';
import {
  TUNABLES,
  TUNING_STORAGE_KEY,
  applyTuning,
  coerce,
  currentTuning,
  defaultFor,
  loadTuning,
  overriddenTuning,
  resetTuning,
  saveTuning,
} from '../src/debug/Tuning';

/** A `Storage` that lives in a variable, so nothing here needs a browser. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** One that throws on everything — a private window, or data blocked for the site. */
function hostileStorage(): Storage {
  const throws = (): never => {
    throw new Error('denied');
  };
  return {
    get length(): number {
      return throws();
    },
    clear: throws,
    getItem: throws,
    key: throws,
    removeItem: throws,
    setItem: throws,
  } as unknown as Storage;
}

const tunable = (key: string) => {
  const found = TUNABLES.find((entry) => entry.key === key);
  if (!found) throw new Error(`no tunable "${key}"`);
  return found;
};

// Every test in here moves live config, so every test has to put it back.
afterEach(() => resetTuning());

describe('the tunables (§8.3)', () => {
  it('names each value once, and brackets the spec on both sides', () => {
    const keys = TUNABLES.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of TUNABLES) {
      const value = defaultFor(entry.key)!;
      expect(entry.min, `${entry.key} min`).toBeLessThan(entry.max);
      // A slider that cannot reach the shipped value cannot show it to you, and one that
      // sits at an end has nowhere to go in the direction you wanted.
      expect(value, `${entry.key} below its range`).toBeGreaterThanOrEqual(entry.min);
      expect(value, `${entry.key} above its range`).toBeLessThanOrEqual(entry.max);
      expect(entry.step, `${entry.key} step`).toBeGreaterThan(0);
    }
  });

  it('keeps each group\'s knobs together', () => {
    // `TuningPanel` writes a heading whenever the group changes as it walks the list, so a
    // knob filed under `Player` but sitting between the light ones prints a second PLAYER
    // heading half a panel down. Nothing throws; the panel just looks broken.
    const seen = new Set<string>();
    let current = '';
    for (const entry of TUNABLES) {
      if (entry.group === current) continue;
      expect(seen.has(entry.group), `${entry.group} is split in two`).toBe(false);
      seen.add(entry.group);
      current = entry.group;
    }
  });

  it('covers the values a balance pass actually reaches for', () => {
    // Not an exhaustive list — a claim that the ones asked for are there, so a rename
    // cannot quietly drop one.
    for (const key of [
      'player.walk',
      'player.sprint',
      'spider.pursue',
      'spider.fleeDelayMin',
      'spider.fleeDelayMax',
      'monster.pursue',
      // §4 — the look values this pass is for: how thick the air in a beam is, and how far
      // the player's own body is lifted off black.
      'torch.haze',
      'night.lampHaze',
      'player.readable',
      // §2 — the surfaces the same pass reaches for: the ground it is played on, the wood
      // at the edge of it, and the kit's own art over the top of what it was authored with.
      'ground.dirtLight',
      'ground.dirtRelief',
      'trees.canopy',
      'models.tint',
    ]) {
      expect(TUNABLES.map((entry) => entry.key)).toContain(key);
    }
  });

  it('keeps every colour a whole `0xrrggbb`, whatever it is handed', () => {
    // A colour is stored as the number `config.ts` writes, so everything that persists,
    // compares and copies a tunable is unchanged by it — but a *fractional* one is not a
    // colour at all: the swatch cannot show it and the game runs on a value nothing
    // displays. A hand-edited entry is the way one arrives.
    for (const entry of TUNABLES.filter((t) => t.kind === 'colour')) {
      expect(entry.min).toBe(0);
      expect(entry.max).toBe(0xffffff);
      expect(Number.isInteger(defaultFor(entry.key)), `${entry.key} default`).toBe(true);
      expect(coerce(entry, 0x4a3a2b + 0.5)).toBe(0x4a3a2c);
      expect(coerce(entry, -12)).toBe(0);
      expect(coerce(entry, 0xffffff * 3)).toBe(0xffffff);
    }
  });

  it('carries a colour through storage as the hex it was', () => {
    const earth = tunable('ground.dirtLight');
    earth.set(0x123456);
    const storage = fakeStorage();
    saveTuning(overriddenTuning(), storage);
    resetTuning();
    expect(earth.get()).toBe(defaultFor('ground.dirtLight'));
    applyTuning(loadTuning(storage));
    expect(earth.get()).toBe(0x123456);
  });

  it('writes through to the config the game reads, not to a copy', () => {
    tunable('player.walk').set(5.5);
    expect(PLAYER.walkSpeed).toBe(5.5);

    tunable('spider.fleeDelayMax').set(7);
    expect(ENEMY.spider.light.fleeDelaySeconds.max).toBe(7);

    tunable('torch.range').set(20);
    expect(FLASHLIGHT.range).toBe(20);
  });

  it('moves an enemy speed in both of its homes', () => {
    // `ENEMY_PROFILES` snapshots the speeds at module load and every enemy of a kind shares
    // the one profile object, so a speed written to only one of them is a speed that looks
    // changed in the panel and does nothing in the game.
    tunable('spider.pursue').set(4.2);
    expect(ENEMY.spider.pursueSpeed).toBe(4.2);
    expect(ENEMY_PROFILES.SpiderEnemy.pursueSpeed).toBe(4.2);

    tunable('monster.pursue').set(3.1);
    expect(ENEMY_PROFILES.ShadowMonster.pursueSpeed).toBe(3.1);
    // §5 gives the monster no flee speed; the profile keeps them equal so the field is
    // never a lie about a state it cannot enter.
    expect(ENEMY_PROFILES.ShadowMonster.fleeSpeed).toBe(3.1);
  });

  it('puts everything back to what config.ts ships with', () => {
    const before = currentTuning();
    tunable('player.walk').set(7);
    tunable('spider.pursue').set(7);
    expect(currentTuning()).not.toEqual(before);

    resetTuning();
    expect(currentTuning()).toEqual(before);
    expect(ENEMY_PROFILES.SpiderEnemy.pursueSpeed).toBe(ENEMY.spider.pursueSpeed);
  });
});

describe('what the tuner stores (§8.3)', () => {
  it('stores only what was moved off the spec', () => {
    expect(overriddenTuning()).toEqual({});
    tunable('player.sprint').set(6);
    expect(overriddenTuning()).toEqual({ 'player.sprint': 6 });
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    tunable('player.walk').set(4.4);
    saveTuning(overriddenTuning(), storage);
    resetTuning();

    expect(PLAYER.walkSpeed).toBe(defaultFor('player.walk'));
    applyTuning(loadTuning(storage));
    expect(PLAYER.walkSpeed).toBe(4.4);
  });

  it('clamps a stored value into the slider it belongs to', () => {
    // Hand-edited storage, or a range that has since been narrowed. Neither should be able
    // to put the game on a number the panel cannot show.
    const entry = tunable('player.walk');
    const storage = fakeStorage({
      [TUNING_STORAGE_KEY]: JSON.stringify({ 'player.walk': 9999 }),
    });
    expect(loadTuning(storage)['player.walk']).toBe(entry.max);
    expect(coerce(entry, -50)).toBe(entry.min);
  });

  it('ignores junk rather than failing a run over it', () => {
    expect(loadTuning(fakeStorage({ [TUNING_STORAGE_KEY]: 'not json' }))).toEqual({});
    expect(loadTuning(fakeStorage({ [TUNING_STORAGE_KEY]: '"a string"' }))).toEqual({});
    expect(loadTuning(fakeStorage({ [TUNING_STORAGE_KEY]: 'null' }))).toEqual({});
    expect(loadTuning(fakeStorage())).toEqual({});
    // A key nobody defines any more, and a value that is not a number.
    const mixed = fakeStorage({
      [TUNING_STORAGE_KEY]: JSON.stringify({ 'gone.away': 3, 'player.walk': 'fast' }),
    });
    expect(loadTuning(mixed)).toEqual({});
  });

  it('survives a browser that refuses storage entirely', () => {
    // A private window throws on `localStorage` rather than returning null, and a debug
    // panel is not worth taking a run down for.
    expect(() => loadTuning(hostileStorage())).not.toThrow();
    expect(loadTuning(hostileStorage())).toEqual({});
    expect(() => saveTuning({ 'player.walk': 4 }, hostileStorage())).not.toThrow();
    expect(() => loadTuning(null)).not.toThrow();
  });

  it('applies only what it was given, and reports it', () => {
    const applied = applyTuning({ 'player.walk': 4.4, 'nope.missing': 3 });
    expect(applied).toEqual({ 'player.walk': 4.4 });
    expect(PLAYER.sprintSpeed).toBe(defaultFor('player.sprint'));
  });
});

describe('the tuner is debug-only (§8.3)', () => {
  it('is built by the shell only under ?debug, so a player runs on the spec', () => {
    // The whole safety of writing to live config rests on this: nothing constructs the
    // panel — and so nothing reads this browser's stored values — without `?debug`. A
    // structural check, because there is no behaviour to observe when it is absent.
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/options\.debug\s*\?\s*new TuningPanel\(\)\s*:\s*null/);

    // And nothing outside the debug module writes through the config's readonly types.
    const offenders = ['src/Run.ts', 'src/main.ts', 'src/config.ts'].filter((path) =>
      readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').includes(
        'as unknown as Record<string, number>',
      ),
    );
    expect(offenders).toEqual([]);
  });
});
