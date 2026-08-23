# Working in this repository

A browser-based top-down horror game: tile JSON in, lit 3D scene out, with both enemies
defined by how they react to light.

## The spec is the source of truth

`docs/GAME_SPEC.md` is the design. `docs/IMPLEMENTATION_PLAN.md` is the build order and the
per-phase exit criteria. Code implements the spec; it does not define it.

**Any change to how the game behaves must land in the spec in the same change that lands in
the code.** That includes:

- A value the spec does not give — a radius, a delay, a rate. Add it to the spec and to
  `src/config.ts` together, with the section it belongs to.
- A question the spec does not answer. If a phase turns one up, fix the spec rather than
  deciding it in code and moving on.
- A design decision made or reversed in conversation. Get it into the spec before or with
  the code, so the spec never describes a game that no longer exists.

A pull request that changes behaviour and not the spec is incomplete. `docs/` is not
documentation of the code — it is the thing the code is trying to be.

When the spec and the code disagree, the spec wins and the code is the bug.

### Write the spec as it stands, not as it got here

Reasoning earns its place in the spec only when a reader would otherwise make the change
back: a value that looks arbitrary but is load-bearing, a rule that reads like an oversight
until you know what it prevents. Most edits need none of it. A wrong number, a stale
sentence, a decision that has been reversed — correct the text and move on. Do not leave a
trail of "this was first X, then changed to Y": git has the history, and the spec's job is
to describe the game as it is now. A spec that argues with its own past is harder to read
than one that simply states the design.

The same goes for reversals in `docs/IMPLEMENTATION_PLAN.md`. A phase's Status note records
what landed and what it sent back to the spec — not the sequence of minds changed getting
there.

## Recording progress

Each finished phase carries a **Status** note in `docs/IMPLEMENTATION_PLAN.md` saying what
landed, how the exit criteria were shown to be met, what was deliberately left to a later
phase, and what went back into the spec. A phase is not done because the code exists; it is
done when its exit criteria are demonstrable, and the note says how to re-check them.

State plainly what could not be verified. An exit criterion that cannot be met in this
environment (frame rate on a software renderer, for instance) is recorded as outstanding,
not quietly dropped.

## Constants

`src/config.ts` mirrors the spec's values, each citing the section it comes from. Nothing in
`src/` should hard-code a number that belongs there — Phase 11's tuning pass should be an
edit in two places (the spec and the config), not thirty.

## Commands

```bash
npm install
npm run dev        # dev server — also the only build with the window.shadows debug handle
npm run build      # typecheck + production build
npm test           # unit tests
npm run preview    # serve the production build
```

`?map=<name>` loads a map from `public/maps/`; `?seed=<word|number>` replays a run's
randomised values. The `scripts/gen-*-map.mjs` generators rebuild the checked-in maps.

## Verifying

Tests are the floor, not the whole story. Anything a test runner structurally cannot assert
— what a scene looks like, what a player hears — gets driven in a browser instead, through
`window.shadows` where needed, and the measurements go in the PR. Chromium and Playwright
are available; this environment renders through a software rasteriser, so frame rate
measured here means nothing.

## Maps

The maps in `public/maps/` are prototypes: `example` exercises the pipeline at full size and
the `phaseN-test` maps each exercise one phase's mechanics. **None of them is the level.**
The real level is authored in the 2D editor tooling in Phase 11 (§1), so map content is
scaffolding to build systems against and should never constrain a system's design.

## Layout

```
src/config.ts     constants mirroring the spec
src/core/         sim clock, viewport, asset loader, input, occluder fade, rng
src/map/          validation, geometry, colliders, walkability, entity registry
src/player/       movement, collision, camera rig, health
src/lighting/     flashlight, battery, environmental lights, night ambient
src/audio/        listener, source pool, distance profiles, sound bank
src/nav/          grid A*, line of sight
src/enemies/      shared enemy, state machine, spawning, contact check
src/debug/        overlays and debug visualisations
```

## Conventions

- Simulation runs on the fixed clock (`SimClock`, §7); anything with a timer ticks on it.
  Rendering interpolates. Presentation effects (camera smoothing, beam placement) run on
  the render delta instead, and follow the interpolated position.
- Randomness comes from `Rng` seeded per run, never `Math.random`, so a run can be replayed.
- Systems are built so their arithmetic can be tested without Three.js, the DOM, or a GPU.
- Comments explain why a thing is the way it is, and cite the spec section that required
  it. They do not restate what the line does.
