---
name: drive
description: Launch this game in a real browser and measure or screenshot it. Use when a change has to be checked by looking at it rather than by a test — how something is lit, where a model sits, what a shadow does, whether a beam reaches — or when asked to run, start, or screenshot the game. Covers the dev server, the Chromium launch this container needs, getting past the title screen to the debug handle, and capturing what you find.
---

# Driving the game in a browser

The unit suite is pure by design: no GPU, no DOM. It can assert that a beam's cone angle is
what §4.1 says and it cannot assert that the beam looks like a beam. Everything in the second
category is measured here, and the measurements belong in the PR and in the phase's Status
note (`docs/IMPLEMENTATION_PLAN.md`).

**This file is the procedure. It is not the facts.** What is on the debug handle, which map
exercises which mechanic, which key does what, and the traps that have already cost somebody
an afternoon all live in `docs/ORIENTATION.md` — read *Driving the game in a browser* there
before writing a script, and put anything you learn back into it rather than here.

## 1. Dependencies and the server

```bash
npm install                    # a fresh container has no node_modules
npm run dev                    # http://localhost:5173/shadows-threejs/ — leave it running
```

`npm run dev` is the **only** build with the `window.shadows` debug handle; it is compiled
out of production, so `npm run preview` cannot be driven.

Playwright is deliberately not a dependency of this repository — install it outside the tree,
in a scratch directory:

```bash
cd "$SCRATCH" && npm init -y && npm install playwright
```

Chromium is already on disk. **Never run `playwright install`.**

## 2. The launch

```js
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));   // the game logs its seed here
```

Rendering goes through a software rasteriser. **Any frame rate measured here is meaningless**
(§7's targets need real hardware, and the plan records them as outstanding) — but geometry,
placement, colour and lighting are exact, and those are what this is for.

## 3. Into a run

```js
await page.goto('http://localhost:5173/shadows-threejs/?debug&map=phase3-test');
await page.click('.shell-play');                  // §8.1 — the only door into a run
await page.waitForFunction(() => window.shadows?.player);
await page.keyboard.press('KeyH');                // the readout covers a third of the screen
```

`?debug` is what arms the handle, the overlays and the debug keys; `?map=` and `?seed=`
need it. Pick the map that exercises the mechanic — the table is in `ORIENTATION.md`.

## 4. Measuring

Everything runs through `window.shadows` inside `page.evaluate`. Two rules save the most
time:

- **Drive the game's own modules rather than reimplementing them.** Vite compiles TypeScript
  on the way through, so a dynamic import gets you the real loader, the real query, the real
  arithmetic — and the answer the game would act on rather than one that agrees with it by
  construction. Every in-page path carries the base: `/shadows-threejs/src/…`, not `/src/…`.
- **Hold the world still** with `clock.timeScale = 0` while you measure. It keeps rendering.

```js
const measured = await page.evaluate(async () => {
  const { CharacterLoader } = await import('/shadows-threejs/src/core/CharacterLoader.ts');
  const character = await new CharacterLoader().load('spider');
  return { authoredHeight: character.authoredHeight, clips: [...character.clips.keys()] };
});
```

A model's size, triangle count and clip names are already in `docs/project-map.jsonl`
(`npm run map` re-derives them) — check there before opening a browser for them. The browser
is for the model *in the scene*: how it reads at its game scale, what its shadow does, where
the beam catches it.

## 5. Screenshots and differencing

```js
await page.screenshot({ path: `${SCRATCH}/after.png` });
```

How the look values were settled: capture with a value at 0 and at its default, difference
per pixel, and report **the max as well as the mean** — a leak is local, and a mean hides it.
`pngjs` reads the captures; there is no PIL in this container.

Write captures to the scratch directory, never into the repository.

## 6. Report what you measured

Numbers and screenshot names go in the PR, and into the Status note of whatever phase the
change belongs to. State plainly anything that could not be checked here — a frame rate, a
phone — as outstanding rather than dropping it.
