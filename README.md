# shadows-threejs

A browser-based top-down horror game built on a 2D-to-3D pipeline: levels are authored as
tile JSON and turned into a lit 3D scene by a Three.js runtime, where both enemies are
defined by how they react to light.

- [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md) — the design and technical specification. It is
  the source of truth; where code and spec disagree, the spec wins.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — build order and per-phase
  exit criteria.

## Running

```bash
npm install
npm run dev        # dev server
npm run build      # typecheck + production build
npm test           # unit tests
```

A session opens on the **title screen** (§8): `Play` starts a run and is also the gesture
the audio context is started from, so there is no way past it. Debug mode is **off** — no
readout, no debug keys — until `?debug` is on the URL, which is also what unlocks `?map=`
and `?seed=` below. `?edit` opens the level editor and needs no `?debug`.

`?debug&map=<name>` selects a map from `public/maps/`:

- `/` — the 50×50 example map (default)
- `/?map=phase1-test` — a small map that deliberately contains authoring errors, to
  exercise the loader's skip-and-warn paths
- `/?map=phase2-test` — a small map built to catch the player capsule out: a diagonal
  pillar staircase, one-tile doorways, a fence run, a pit with no floor, a dead-end
  alcove, and walkable ground against every map edge for the camera clamp
- `/?map=phase3-test` — a map for the lighting: a field of free-standing props to throw
  beam shadows from, seven lamps in three groups (more than the two that may cast shadows
  at once), and a corridor no lamp reaches
- `/?map=phase5-test` — a map for navigation: a central block with a route round either
  side, a wall with one doorway to shut mid-chase, and a dead end
- `/?map=phase7-test` — a map for the spider: a long walled lane to be deterred up, a
  spider with a wall four metres behind it, a dead-end pocket with nowhere to run, open
  yard for the attack, and a lamp that deters without anyone aiming
- `/?map=poi-test` — a map for the landmarks: one of every fitted prefab, to check each is
  centred on the ground it stands on rather than on its silhouette
- `/?map=phase8-test` — a map for the Shadow Monster: a long open yard to sweep a beam
  across, a pit that light crosses and walking does not, two lamps in two groups so one
  can be sabotaged while the other stays as a control, and two spiders for the comparison

The objective chain (§6) lives on the example map, which is what `Play` loads. A run is one
life: dying or escaping ends it, and `E` or a click starts another from a clean map.

`?debug&seed=<word|number>` replays a run's randomised values; without one a seed is picked
and logged. Every map here is a **prototype**, not the level — see `CLAUDE.md`.

The `scripts/gen-*-map.mjs` generators regenerate those maps' layer data.

## Authoring a level

Levels are authored in the editor built into this project (§9) — `?edit`, on the same site,
so it works on a phone:

1. **Draw the map.** Two layers, floor and obstacles, with paint, erase and a rectangle
   tool. A building is a block of wall tiles, not a separate kind of thing.
2. **Place entities.** The spawn, the exit, switches, lamps, gates, notes, spiders and the
   Shade, each with a properties sheet for the fields §2 requires. A note or a switch mounts
   on a solid neighbour, and the editor refuses a note the camera could never read (§9.2).
3. **Watch the status bar.** It runs the game's own validator and audit on every edit, so a
   level that cannot be finished says so while you are placing the thing that broke it.
4. **`Play`** hands the level straight to the game — no file, no commit, no reload.
5. **`Copy`** puts the whole `map.json` on the clipboard when you want to keep it.

To keep a level, paste that JSON into `public/maps/<name>/map.json` and copy any existing
`tileset.json` beside it (they all define the same seven tile ids). Note text goes in
`public/notes.json`, keyed by the `noteId` you gave the note. Then `?debug&map=<name>`.

The **audit** answers the question the loader does not — can the level be finished? It
reports in the editor's status bar, in the console at load, and on the `audit` row of the
debug readout:

- a gate whose only switch is behind itself, or an exit needing more `latch` switches than
  the map has (**blocking** — the level cannot be completed)
- a switch, note, or the flashlight that no reachable tile is within interaction range of
- a `noteId` with no entry in `public/notes.json`, a light group with no switch, a switch
  naming something that does not exist
- walkable ground the player can never get to

Reachability is worked out the way a player earns it: flood from the spawn, open any gate
whose switch is in reach, flood again, repeat. `npm test` runs the same audit over every
checked-in map.

The editor autosaves a draft to the browser it is open in, so the phone's draft and the
laptop's are different levels. `Copy` is how one moves between them.

## Credits

Every art kit, its author and its licence is recorded in `PREFAB_KITS` in `src/config.ts`,
and the game's credits screen (§8.2) is generated from that list rather than typed out — a
credits screen maintained by hand is one that stops being true the first time an asset
changes, and so is a README section. That is the list to read, and the one to add to.

The vendored kit ships its licence beside the files as
`public/prefabs/LICENSE-kaykit.txt`, and `public/prefabs/README.md` records which kit file
each prefab name maps to and the commit they were pulled from.

Sound effects are synthesised at runtime with [ZzFX](https://github.com/KilledByAPixel/ZzFX)
by Frank Force (MIT).

## CI

`.github/workflows/ci.yml` runs the tests and the build on every pull request — the same
steps the deploy runs, so a PR that would break the deploy fails while it is still a PR.

## Deployment

The site is a static bundle published to GitHub Pages from this repository.
`.github/workflows/deploy.yml` runs the tests, builds, and hands the artifact to Pages on
every push to `main` — `dist/` is never committed, so the deployed site cannot drift from
the commit it was built from. `workflow_dispatch` redeploys without a new commit.

Two one-time settings, both in the repository's GitHub settings:

1. **Settings → Pages → Source → "GitHub Actions."**
2. The repository must be **public**, unless the account has GitHub Pro — the Free plan
   only serves Pages from public repositories.

It is served as a **project** site, at `https://<user>.github.io/shadows-threejs/` rather
than a domain root. That subpath is baked in at build time, so `vite.config.ts` sets `base`
to `/shadows-threejs/` and every runtime fetch is built from `import.meta.env.BASE_URL`
rather than left document-relative.

Set `BASE_PATH` to build for a different location:

```bash
BASE_PATH=/ npm run build                  # user site or custom domain
BASE_PATH=/other-repo/ npm run build       # published from a different repository
```

`base` applies in dev too, so `npm run dev` serves from the same subpath as production —
a base-path mistake shows up locally rather than as a wall of 404s after deploying.

## Debug harness

**Off by default** (§8.3). None of the keys below do anything, and no readout is drawn,
unless the URL carries `?debug` — a player who presses `V` should not find a free camera.

| Key | |
| --- | --- |
| `WASD` / arrows | move; the mouse aims |
| `Shift` | sprint — the aim locks to the way you are going |
| `V` | hand the camera to the debug free camera — `WASD` then pans, wheel zooms |
| `F` | flashlight on/off |
| `B` | drain the battery to 5%, to reach the cut-out and lockout without waiting 45 s |
| `L` | power every light group, past the switches that normally gate them |
| `O` | occluder fade (geometry between the camera and the player) |
| `Z` | orbit a test emitter off-screen — audio only, nothing to see |
| `N` | enemy paths, coloured by state |
| `X` | block/unblock the hovered tile — walkability only, the way a gate does |
| `Y` | switch the enemies off |
| `I` | draw the Shadow Monster's body — the spec says it is never drawn, so this is for debugging only |
| `K` | debug damage: one spider contact's worth (0.34) |
| `J` | heal to full |
| `G` | walkability overlay (green walkable, red blocked) |
| `C` | collider overlay — obstacles in amber, floor gaps in blue |
| `M` | entity markers |
| `P` | pause the simulation clock |
| `.` | step one simulation tick |
| `[` `]` | halve / double time scale |
| `H` | hide the readout |

A gamepad works without any setup — left stick moves, right stick aims, `A` interacts,
left stick click sprints. On
touch, the left half of the screen is a floating movement stick and the right half a
floating aim stick, with an on-screen action button; pushing the movement stick to its rim
sprints. The touch chrome only appears once a touch is seen, so a desktop session never
renders it.

**Development builds** additionally expose `window.shadows`, reachable from the console —
the clock, input, player, camera rig, flashlight, lights, audio, enemies, objectives and the
rest; `docs/ORIENTATION.md` lists what is on it, what is deliberately not, and how to drive
it. Some behaviour can only be checked through it: "a moving off-screen emitter is locatable by ear" (§4.3) is not
something a test runner can assert, but the live audio graph can be tapped from the handle
and measured. It is compiled out of production builds, so anything driving it — a console
session, a Playwright check — has to run against `npm run dev` rather than `npm run
preview`.

Hovering the map reports the tile under the cursor and whether it is walkable.

## Status

**Every code phase in `docs/IMPLEMENTATION_PLAN.md` is built** — Phases 0 to 13. The map
pipeline, the player and camera, the lighting and the flashlight's battery, spatial audio,
navigation, the shared illumination query, both enemies and their opposite reactions to
light, interaction and the objective chain, the run lifecycle, the level editor, and the
shell around it all.

The plan carries the per-phase detail: what landed, how each exit criterion was shown to be
met, and what was deliberately left for later.

One criterion is outstanding and cannot be met here: **§7's frame rates on both tiers.**
This environment renders through a software rasteriser, so any figure measured in it is
meaningless. It needs a real machine and a real phone.

## What is left, and it is not code

The remaining work is content and judgement — the four passes no one can do who is not
looking at the game.

**The level.** Every map in `public/maps/` is a prototype: `example` exercises the pipeline
at full size and each `phaseN-test` exercises one phase's mechanics. **None of them is the
level.** Author it in `?edit` (see *Authoring a level* above), and let the audit tell you
whether it can be finished before a playthrough does.

**The art.** The prefabs and both enemies are real models now, each kit recorded in
`PREFAB_KITS` with its licence. The spider is skinned and its walk cycle is driven by ground
speed rather than by a clock, so a wandering, pursuing and fleeing spider all place their
legs on the ground; its attack clip is stretched to §5.3's wind-up so re-exporting the art
cannot move when damage lands. The Shadow Monster has a model and deliberately no animation
— §5.2 never draws it, and what the model buys is the outline of its shadow.

Swapping any of it is dropping a `.glb` in: `public/prefabs/` for a static prop, and
`public/characters/` for anything skinned, which cannot be a prefab because merging a model
into one geometry destroys the skeleton. Either with no file falls back to a placeholder.
`docs/project-map.jsonl` carries each model's size, triangle count and clip names, so what
is actually in the tree is a `grep` rather than a browser session.

A caveat worth knowing: the kit is medieval stone while the prefab names say concrete and
chain-link, so the game currently looks like a dungeon. That is a `tileset.json` decision,
not a code one — swapping kits is replacing six files.

**The audio.** Every sound is synthesised at runtime by ZzFX as a placeholder. The bank
already falls back, so real files are a drop-in.

**The tuning.** Deterrence timers, attack wind-up, the flicker ramp, battery rates, enemy
speeds. Every one is a value in `src/config.ts` citing the spec section it comes from, so a
change is an edit in two places — the spec and the config — rather than thirty. Which way to
move them is a question for playing.

Two design questions are open rather than outstanding:

- **Portrait framing.** The camera frames by vertical FOV, so how much ground is visible
  sideways depends on the window's shape: 23 m across on a 16:9 desktop, 6 m on a phone held
  upright. Either the game asks for landscape, or the camera pulls back on narrow screens and
  the player shrinks.
- **Music** for the title and the credits, which §8 does not specify.

## Layout

```
src/config.ts     constants mirroring the spec — tuning happens here, not in systems
src/core/         sim clock, viewport, asset loader, character loader, input,
                  occluder fade, rng, url options
src/map/          validation, geometry, colliders, walkability, entity registry, audit
src/player/       movement, collision, camera rig, health, derived rig, arm IK
src/lighting/     flashlight, battery, environmental lights, night ambient,
                  the illumination query, volumetric shafts, the torch body
src/audio/        listener, source pool, distance profiles, sound bank
src/nav/          grid A*, line of sight
src/enemies/      shared enemy, state machine, spawning, contact check, gait, rigs
src/world/        gates, interaction, notes, objectives, props, run outcome
src/ui/           HUD, run overlays, title and credits (§8)
src/editor/       the level editor (§9)
src/debug/        overlays, tuning panel and frame stats
public/maps/      map data, one directory per map
public/prefabs/   static props; public/characters/ holds the skinned ones
scripts/          map generators, the prefab converter, the project-map generator
tests/            unit tests, including fixture tests over the checked-in maps
```

A file-by-file index — every file's summary, exports and the `§` sections it cites, plus
each model's size and clips — is `docs/project-map.jsonl`, regenerated with `npm run map`.
