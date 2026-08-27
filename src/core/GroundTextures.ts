/**
 * The ground the game is played on, built rather than loaded (§2).
 *
 * Every floor tile and every metre of §2's surround is textured from here: one earth
 * surface, generated as three maps — colour, normal and roughness — as pixels at load and
 * handed to the same `MeshStandardMaterial` the rest of the world is lit by. `floor_grass`
 * and `floor_dirt` are two roles a map can place (§2), the way `fence_chainlink` is a
 * wooden barrier in this kit — but both wear the same earth, because a generated turf
 * surface was tried here and cut: at the resolution a floor tile actually renders at, the
 * blade detail read as noise rather than as grass, and a good-looking dirt beat a
 * bad-looking lawn.
 *
 * **Built, for the same reason the small tree is (`GeneratedPrefabs`): it is cheaper
 * described than authored.** A ground texture that tiles without a seam, at a resolution
 * that survives a flashlight lying across it, is a large file, and the kit's own floor art
 * is a slab atlas that was never meant to be walked over by the acre. What the arithmetic
 * here costs instead is a few hundred milliseconds of load and no bytes at all.
 *
 * **The normal map is the point of it, not the colour.** §4 plays out entirely in a torch
 * beam raking across the floor at a low angle, and a flat surface takes that light flatly:
 * the beam reads as a bright patch rather than as light falling on ground. Relief is what
 * makes it read — clods, grain, and the pebbles that catch a highlight on one side and cast
 * a scrap of shade on the other. It is the one map that has to be right.
 *
 * **Seamless is a property of the noise, not of a fix-up pass.** Every octave is a lattice
 * whose period divides the texture, so the field is *periodic by construction* and the last
 * column is already the neighbour of the first. Blending the edges of a non-tiling texture
 * is the usual alternative and it produces a soft band the eye finds instantly — at the
 * scale a ground repeats here, that band would be a grid across the whole map.
 *
 * **World-space UVs, not the mesh's.** The floor is one instanced mesh drawn a thousand
 * times (§7), so every tile shares one set of UVs: mapped the ordinary way, every tile shows
 * the *same* patch of ground and the map is a chequerboard of one square metre repeated. The
 * material therefore derives its UV from world X/Z in the vertex shader, which makes the
 * texture continuous across tiles, across the map's edge, and across §2's surround plane
 * without any of them agreeing on anything but where they are.
 *
 * The pixel arithmetic is pure and knows nothing about Three.js, so it can be measured
 * without a GPU — which is how "seamless" is checked at all: the seam is a number.
 */

import * as THREE from 'three';
import { GROUND } from '../config';

/** §2 — the one generated ground. Every floor role and the surround wear it. */
export type GroundSurface = 'dirt';

export interface GroundMaps {
  /** Side of every map, in pixels. */
  size: number;
  /** Base colour, sRGB, RGBA. */
  albedo: Uint8Array;
  /** Tangent-space normal, RGBA, `z` up in blue. */
  normal: Uint8Array;
  /** Roughness in the green channel, where Three reads it. */
  roughness: Uint8Array;
}

/* ------------------------------------------------------------------ noise */

/**
 * A hash of two lattice coordinates, 0–1.
 *
 * Integer arithmetic throughout (`Math.imul` keeps the multiply 32-bit) so the field is
 * *exactly* reproducible: the same ground every run, on every machine, with no seed to
 * thread through and nothing for `Rng` to own. Textures are not gameplay randomness.
 */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep on the lattice cell, so the field has no creases along the grid. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise on a lattice of `period × period` cells over the unit square.
 *
 * The wrap is the whole reason it is written this way: lattice coordinates are taken modulo
 * the period, so the cell at `period − 1` has the cell at `0` for its neighbour and the
 * field is continuous across the edge of the texture. Every caller passes an integer period,
 * and every octave doubles it, so the sum is periodic too.
 */
function noise(u: number, v: number, period: number, salt: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);

  const xa = ((x0 % period) + period) % period;
  const ya = ((y0 % period) + period) % period;
  const xb = (xa + 1) % period;
  const yb = (ya + 1) % period;

  const n00 = hash(xa, ya, salt);
  const n10 = hash(xb, ya, salt);
  const n01 = hash(xa, yb, salt);
  const n11 = hash(xb, yb, salt);

  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * ty;
}

/** Octaves of the above, halving in amplitude as they double in frequency. */
function fbm(u: number, v: number, period: number, octaves: number, salt: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise(u, v, period << octave, salt + octave * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum / total;
}

/* ---------------------------------------------------------------- pebbles */

/**
 * Height and mask of the stones lying on the ground, at one point.
 *
 * Scattered on a jittered lattice of `GROUND.pebbleCells` cells, one candidate per cell, and
 * the neighbouring cells are searched with wrapped indices — which is what carries a stone
 * across the edge of the texture instead of clipping it in half there.
 *
 * The profile is a dome rather than a step. A stone with a vertical wall has a normal that
 * turns through 90° in one texel, which the lighting resolves as a ring of black pixels; a
 * dome turns its normal gradually and catches the beam down one side, which is the thing
 * that reads as a pebble at all.
 */
function pebbleAt(u: number, v: number, out: { height: number; mask: number; tint: number }): void {
  const cells = GROUND.pebbleCells;
  const cx = Math.floor(u * cells);
  const cy = Math.floor(v * cells);
  out.height = 0;
  out.mask = 0;
  out.tint = 0;

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = cx + ox;
      const gy = cy + oy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;

      // Most cells hold no stone: a ground paved with them is shingle, not earth.
      if (hash(wx, wy, 7717) > GROUND.pebbleCoverage) continue;

      const jx = (gx + hash(wx, wy, 1301)) / cells;
      const jy = (gy + hash(wx, wy, 2803)) / cells;
      const metres =
        GROUND.pebbleRadius.min +
        hash(wx, wy, 4441) * (GROUND.pebbleRadius.max - GROUND.pebbleRadius.min);
      const radius = metres / GROUND.metresPerRepeat;

      const dx = u - jx;
      const dy = v - jy;
      // A little noise on the outline: a field of perfect circles reads as bubbles on the
      // surface rather than as stones in it, and the give-away is the silhouette.
      const lumpy = radius * (0.85 + 0.3 * noise(u, v, GROUND.pebbleCells * 4, 5501));
      const distance = Math.hypot(dx, dy);
      if (distance >= lumpy) continue;

      const dome = Math.sqrt(1 - (distance / lumpy) ** 2);
      if (dome <= out.mask) continue;
      out.mask = dome;
      out.height = dome * metres * GROUND.pebbleRelief;
      // Every stone its own colour, drawn once for the whole stone rather than per texel:
      // one grey repeated is the same failure as one footstep recording repeated (§4.3).
      out.tint = hash(wx, wy, 6229);
    }
  }
}

/* ----------------------------------------------------------------- ground */

interface Sample {
  /** Relief in *metres*, which is what makes the normal a real slope rather than a guess. */
  height: number;
  /** Base colour, linear 0–1. */
  r: number;
  g: number;
  b: number;
  roughness: number;
}

const _pebble = { height: 0, mask: 0, tint: 0 };

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function channel(colour: number, shift: number): number {
  return ((colour >> shift) & 0xff) / 255;
}

/** Dirt: clods, a grain over them, and the odd dark hollow. */
function dirtAt(u: number, v: number, out: Sample): void {
  const clods = fbm(u, v, GROUND.clodPeriod, 4, 53);
  const grain = fbm(u, v, GROUND.grainPeriod, 2, 71);
  const damp = fbm(u, v, GROUND.patchPeriod, 2, 83);

  out.height = (clods * (1 - GROUND.grainRelief) + grain * GROUND.grainRelief) * GROUND.dirtRelief;
  const shade = 0.78 + clods * 0.3 + grain * 0.12;
  for (const [shift, key] of CHANNELS) {
    const earth = mix(channel(GROUND.dirtDark, shift), channel(GROUND.dirtLight, shift), clods);
    out[key] = mix(earth, channel(GROUND.dirtDamp, shift), Math.max(0, damp - 0.55) * 1.6) * shade;
  }
  out.roughness = GROUND.dirtRoughness;
}

const CHANNELS = [
  [16, 'r'],
  [8, 'g'],
  [0, 'b'],
] as const;

/** One point of the ground: dirt, with the stones lying on top of it. */
export function groundAt(u: number, v: number, out: Sample): void {
  dirtAt(u, v, out);

  // The stones lie *on* the ground, so they are added last.
  pebbleAt(u, v, _pebble);
  if (_pebble.mask <= 0) return;
  out.height += _pebble.height;
  const stone = _pebble.mask * GROUND.pebbleOpacity;
  for (const [shift, key] of CHANNELS) {
    const grey = mix(
      channel(GROUND.pebbleDark, shift),
      channel(GROUND.pebblePale, shift),
      _pebble.tint,
    );
    out[key] = mix(out[key], grey, stone);
  }
  // A wet-looking stone is what tells it apart from the earth it sits in under a beam.
  out.roughness = mix(out.roughness, GROUND.pebbleRoughness, stone);
}

/**
 * The three maps for one surface, as pixels.
 *
 * The height field is evaluated once per texel and read three times — for the colour, for
 * the gradient the normal is, and for the roughness — because it is by far the most
 * expensive thing here and all three want the same number.
 *
 * The normal is a central difference *with the wrap included*: the gradient at column 0
 * looks at the last column, not at itself. Getting that wrong is a seam that appears only
 * under a moving light, which is the hardest kind to find and the only kind this game has.
 */
export function buildGroundMaps(size = GROUND.textureSize): GroundMaps {
  const heights = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const sample: Sample = { height: 0, r: 0, g: 0, b: 0, roughness: 1 };
  const texelMetres = GROUND.metresPerRepeat / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      groundAt(x / size, y / size, sample);
      const i = y * size + x;
      heights[i] = sample.height;
      albedo[i * 4] = Math.round(Math.min(1, Math.max(0, sample.r)) * 255);
      albedo[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, sample.g)) * 255);
      albedo[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, sample.b)) * 255);
      albedo[i * 4 + 3] = 255;
      const rough = Math.round(Math.min(1, Math.max(0, sample.roughness)) * 255);
      // Three reads roughness from green and metalness from blue; the rest is padding.
      roughness[i * 4 + 1] = rough;
      roughness[i * 4 + 3] = 255;
    }
  }

  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      // A *slope*, not a pixel difference: the height field is in metres and so is the
      // ground a texel covers, so the gradient is metres per metre and means the same thing
      // at any resolution. Taking the raw difference instead is what makes a hand-rolled
      // normal map come out almost flat — two adjacent texels of a 2 cm bump differ by
      // fractions of a millimetre, and the answer looks like a bug in the lighting.
      const dx = ((heights[row + right]! - heights[row + left]!) / (2 * texelMetres)) *
        GROUND.normalStrength;
      const dy = ((heights[down + x]! - heights[up + x]!) / (2 * texelMetres)) *
        GROUND.normalStrength;
      // The surface normal of a height field is (−∂h/∂x, −∂h/∂y, 1), normalised, and
      // encoded as an unsigned byte around 128. Green is up, which is the convention Three
      // and every tool that writes a normal map agree on.
      const length = Math.hypot(dx, dy, 1);
      const i = (row + x) * 4;
      normal[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }

  return { size, albedo, normal, roughness };
}

/* --------------------------------------------------------------- material */

let cached: THREE.MeshStandardMaterial | null = null;

function texture(data: Uint8Array, size: number, colourSpace: string): THREE.DataTexture {
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = colourSpace;
  // Trilinear with mipmaps: the far end of a 12 m beam is most of a screen away, and
  // unfiltered ground at that distance is a field of crawling noise (§7).
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = GROUND.anisotropy;
  map.needsUpdate = true;
  return map;
}

/**
 * The material the ground is drawn with, built once and shared.
 *
 * Shared deliberately: the floor is instanced (§7) and the surround is one plane, so this
 * is the one material every ground role in a run points at. Nothing sets a per-instance
 * flag on it — the trap `CharacterLoader` documents — because nothing about a patch of
 * ground differs from the next patch except where it is.
 *
 * Takes a `GroundSurface` for the callers that name one (`AssetLoader`, `Surround`), even
 * though there is only ever the one value — the ground a floor tile gets is still a
 * decision made by role rather than by accident, and the type is what keeps that decision
 * visible at the call site instead of every caller reaching for a bare function.
 */
export function groundMaterial(_surface: GroundSurface = 'dirt'): THREE.MeshStandardMaterial {
  if (cached) return cached;

  const maps = buildGroundMaps();
  const material = new THREE.MeshStandardMaterial({
    map: texture(maps.albedo, maps.size, THREE.SRGBColorSpace),
    normalMap: texture(maps.normal, maps.size, THREE.NoColorSpace),
    roughnessMap: texture(maps.roughness, maps.size, THREE.NoColorSpace),
    // White, because the texture carries the colour. A tint here would be a second place
    // the ground's colour is decided, and the spec would no longer be the only one.
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  });
  material.normalScale.set(GROUND.normalScale, GROUND.normalScale);
  material.name = 'ground:dirt';
  applyWorldUv(material);
  cached = material;
  return material;
}

/**
 * Drive the material's UVs from world X/Z instead of the mesh's own.
 *
 * §7 draws the whole floor as one `InstancedMesh`, so the mesh's UVs are the *tile's* UVs
 * and every instance of it has the same ones. Textured that way, a map is one square metre
 * of ground stamped two thousand times, and the eye reads the grid instantly — which is the
 * exact failure this whole file exists to avoid, arrived at from the other direction.
 *
 * So the UV is the vertex's world position on the ground plane, divided by the metres one
 * repeat of the texture covers. The instance matrix has to be applied by hand here because
 * this runs before Three's own chunk does it, and `modelMatrix` alone would put every tile
 * back on top of the same patch.
 *
 * Assigning the three `v*Uv` varyings rather than replacing the sampler calls leaves every
 * standard chunk intact — including the one that derives a tangent frame from the screen
 * derivatives of `vNormalMapUv`, which is what makes the normal map light correctly without
 * a tangent attribute on geometry that has none.
 */
function applyWorldUv(material: THREE.MeshStandardMaterial): void {
  const scale = 1 / GROUND.metresPerRepeat;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vec4 groundWorld = vec4( position, 1.0 );
      #ifdef USE_INSTANCING
        groundWorld = instanceMatrix * groundWorld;
      #endif
      groundWorld = modelMatrix * groundWorld;
      vec2 groundUv = groundWorld.xz * ${scale.toFixed(6)};
      vMapUv = groundUv;
      vNormalMapUv = groundUv;
      vRoughnessMapUv = groundUv;`,
    );
  };
  // Two materials with the same program cache key share a compiled program, and these
  // differ from a stock standard material only in the source above — which the key does
  // not see. Without this they would be handed the untouched program.
  material.customProgramCacheKey = () => `ground-world-uv:${scale}`;
}

/** Tests and the debug harness; a run builds this once and keeps it. */
export function disposeGroundMaterials(): void {
  if (!cached) return;
  cached.map?.dispose();
  cached.normalMap?.dispose();
  cached.roughnessMap?.dispose();
  cached.dispose();
  cached = null;
}
