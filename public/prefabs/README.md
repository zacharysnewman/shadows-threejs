# Prefabs

`.glb` modules the map pipeline instances, one per `prefab` name in a map's `tileset.json`
(§1, §2). A name with no file here falls back to a procedural placeholder box, so deleting
any of these is a supported way to go back to untextured blocks.

## Source

All of these are from one kit, so the level reads as one place:

**KayKit — Dungeon Remastered 1.0**, by Kay Lousberg (<https://kaylousberg.com>),
**CC0 1.0** — see `LICENSE-kaykit.txt`. Attribution is not required; the credit here is
voluntary.

Pulled from the author's own repository at a pinned commit:
`KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0` @ `b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07`

| Our name          | Kit file                      |
| ----------------- | ----------------------------- |
| `floor_concrete`  | `floor_tile_small.gltf.glb`   |
| `floor_dirt`      | `floor_dirt_small_A.gltf.glb` |
| `wall_brick`      | `wall_half.gltf.glb`          |
| `fence_chainlink` | `barrier_half.gltf.glb`       |
| `gate_wood`       | `wall_doorway.glb`            |
| `prop_crate`      | `box_small.gltf.glb`          |

Our names are the roles the map pipeline asks for and predate the kit; they are not
descriptions of what these models look like. This kit is stone-and-timber, so
`floor_concrete` is a flagstone and `fence_chainlink` is a wooden barrier. Renaming the
roles is a map-data change (`tileset.json`), not a code one.

## Fitting

Every file is a single mesh with its texture and buffer embedded — no external URIs, so
each one is a single request. They are 1 unit = 1 m, Y-up, standard glTF.

They are *not* all authored to this project's conventions, and `AssetLoader` normalises
them on load rather than the files being edited: see `PREFAB_FIT` in `src/config.ts` and
§1 in the spec for what gets moved and why.
