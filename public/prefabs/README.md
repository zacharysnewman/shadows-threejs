# Prefabs

`.glb` modules the map pipeline instances, one per `prefab` name in a map's `tileset.json`
(§1, §2). A name with no file here falls back to a procedural placeholder box, so deleting
any of these is a supported way to go back to untextured blocks.

## Sources

`PREFAB_KITS` in `src/config.ts` is the machine-readable version of this, and the credits
screen (§8.2) is generated from it. This file is the long form.

> **Attribution is required for some of these.** `prop_tree` is used under a licence that
> requires the author be credited, and that credit is a condition rather than a courtesy.
> It is on the in-game credits screen and it must stay there. See below.

### KayKit — Dungeon Remastered 1.0 · CC0

The walls, floors, fence, gate and crate — one kit, so the level reads as one place.

By Kay Lousberg (<https://kaylousberg.com>), **CC0 1.0** — see `LICENSE-kaykit.txt`.
Attribution is not required; the credit is voluntary.

Pulled from the author's own repository at a pinned commit:
`KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0` @ `b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07`

| Our name          | Kit file                      |
| ----------------- | ----------------------------- |
| `floor_grass`  | `floor_tile_small.gltf.glb`   |
| `floor_dirt`      | `floor_dirt_small_A.gltf.glb` |
| `wall_brick`      | `wall_half.gltf.glb`          |
| `fence_chainlink` | `barrier_half.gltf.glb`       |
| `gate_wood`       | `wall_doorway.glb`            |
| `prop_crate`      | `box_small.gltf.glb`          |

### yurikokuun — 3D Low Poly Tree · attribution required

`prop_tree`. <https://yurikokuun.itch.io/3d-low-poly-tree>

**The author requires credit.** Unlike everything above, this is a term of use and not a
courtesy: shipping the game without naming yurikokuun would be shipping in breach. The
credit lives on the §8.2 credits screen, generated from `PREFAB_KITS`, and
`tests/shell.test.ts` fails if an attribution-required kit stops being named there.

### Stanisko — Playground Props Collection · terms unconfirmed

`prop_goal`, `prop_hoop`, `prop_net`, `prop_slide`, `prop_swing`.
<https://stanisko.itch.io/playground-props-collection-low-poly-game-ready>

**The pack ships no licence file and the page states no terms.** That is recorded as
`licence: null`, treated as attribution-required, and shown on the credits screen as
"Licence not stated". An unstated licence is an unanswered question rather than a
permissive one, and it is **outstanding before release**: the terms have to be confirmed
with the author.

### Fitting and naming

Our names are the roles the map pipeline asks for and predate the kit; they are not
descriptions of what these models look like. This kit is stone-and-timber, so
`fence_chainlink` is a wooden barrier, and `floor_grass` is not grass — see below. Renaming
the roles is a map-data change (`tileset.json`), not a code one.

**The floor prefabs bring their shape and not their surface.** Both are re-surfaced on load
with the ground texture the game generates (§2, `GroundTextures`), so what the kit's
flagstone contributes is a slab of the right size sitting at the right height — the earth on
top of it is ours. `floor_grass` and `floor_dirt` wear the same generated ground: a turf
surface was tried for the former and cut, because at the resolution a floor tile actually
renders at the blade detail read as noise rather than as grass. The role name stays for map
authoring; the two are visually identical today.

## Fitting

Every file is a single mesh with its texture and buffer embedded — no external URIs, so
each one is a single request. They are 1 unit = 1 m, Y-up, standard glTF.

They are *not* all authored to this project's conventions, and `AssetLoader` normalises
them on load rather than the files being edited: see `PREFAB_FIT` in `src/config.ts` and
§1 in the spec for what gets moved and why.
