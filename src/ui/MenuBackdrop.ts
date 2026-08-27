/**
 * §8.1 — the title screen's backdrop: a film of oily water, turning over behind the menu.
 *
 * **It is a budget before it is a look.** §8.1 will not have the menu spending a frame
 * budget the run needs, and the rule that keeps that true is not a fast implementation but
 * a lifetime: this runs only while the shell's screens are up, and is stopped before a run
 * is built (`TitleScreen.hide`). Nothing here is alive during play, so there is no
 * arithmetic to get wrong about what it costs then. It stops in a hidden tab for the same
 * reason, and if a device cannot draw a frame inside `MENU_BACKDROP.budgetMilliseconds` it
 * keeps the picture and stops turning it over rather than stuttering.
 *
 * **Drawn small and scaled up.** The field is evaluated per sample on the CPU, so the cost
 * is the sample count and nothing else, and `MENU_BACKDROP.resolution` is the whole of it.
 * That is affordable because water this slow has no high frequencies to lose — the
 * browser's own bilinear scale, plus the blur in the stylesheet, is a better use of the
 * pixels than computing them.
 *
 * **The swirl is domain warping, not motion.** The field is fBm looked up at a position
 * that has itself been displaced by fBm, twice, which is what gives an oil slick its folded
 * marbled sheets instead of the even lumps plain fBm gives. The animation moves the *warp
 * offsets* around circles rather than translating the field: a translated field reads as a
 * picture sliding past, and the whole point of this one is that it turns over in place.
 *
 * The field is pure arithmetic and is exported apart from the thing that draws it, so what
 * the picture is made of can be checked without a DOM or a GPU.
 */

import { MENU_BACKDROP } from '../config';

const TAU = Math.PI * 2;

/** 2D integer hash → [0, 1). `Math.imul` because the products leave a double's exact range. */
function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 0x1f1f1f1f) ^ Math.imul(iy, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Value noise, smoothstepped between lattice points, in [0, 1). */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Fractal value noise, normalised to [0, 1). Lacunarity 2 and gain 0.5 — the ordinary pair.
 * The octave count is the one worth spending, so it is the caller's and comes from
 * `MENU_BACKDROP`.
 */
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let px = x;
  let py = y;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise(px, py) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    px *= 2;
    py *= 2;
  }

  return sum / total;
}

/**
 * The first warp stage at a point: the sheet everything after it is folded out of.
 *
 * It is separate because it does not depend on time, which is most of what makes this
 * affordable — for a fixed grid it is two of the five fBm lookups, computed once at that
 * grid's size and then reused for every frame drawn on it (`MenuBackdrop.resize`).
 */
export function baseWarp(x: number, y: number, out: { x: number; y: number }): void {
  out.x = fbm(x, y, MENU_BACKDROP.warpOctaves);
  out.y = fbm(x + 5.2, y + 1.3, MENU_BACKDROP.warpOctaves);
}

/**
 * The film's thickness at a point whose first warp is already known, in [0, 1]. `churn` is
 * a phase in radians: it advances with time and with nothing else, so the same phase always
 * gives the same picture.
 */
export function swirlWarped(
  x: number,
  y: number,
  warpX: number,
  warpY: number,
  churn: number,
): number {
  const w = MENU_BACKDROP.warp;
  const dragX = x + w * warpX;
  const dragY = y + w * warpY;

  // The second warp, and the only place time enters: the offsets travel around circles at
  // rates with no common multiple, so the fold wanders instead of returning where it began.
  const rx = fbm(
    dragX + 1.7 + Math.cos(churn) * 0.9,
    dragY + 9.2 + Math.sin(churn) * 0.9,
    MENU_BACKDROP.warpOctaves,
  );
  const ry = fbm(
    dragX + 8.3 + Math.sin(churn * 0.77) * 0.9,
    dragY + 2.8 + Math.cos(churn * 0.61) * 0.9,
    MENU_BACKDROP.warpOctaves,
  );

  return fbm(x + w * rx, y + w * ry, MENU_BACKDROP.octaves);
}

/** The whole field at a point, for anything that is not walking a cached grid. */
export function swirl(x: number, y: number, churn: number): number {
  const warp = { x: 0, y: 0 };
  baseWarp(x, y, warp);
  return swirlWarped(x, y, warp.x, warp.y, churn);
}

/**
 * The thin-film sheen at a thickness, in [0, 1]. Oil on water is coloured by interference —
 * which band shows depends on how thick the film is there — and this is that reduced to one
 * channel: a cosine across the field's range, sharpened so the ridges come out thin and wet
 * rather than as a soft gradient.
 */
export function sheen(thickness: number): number {
  const band = 0.5 - 0.5 * Math.cos(TAU * MENU_BACKDROP.bands * thickness);
  return band ** MENU_BACKDROP.gloss;
}

/**
 * The field's own distribution, stretched about its median to fill [0, 1].
 *
 * fBm of a few octaves is a sum of independent samples, so it piles up around its mean:
 * nine tenths of the field lands inside a band about a third of [0, 1] wide, and the ends
 * are reached by a handful of samples or by none. Read straight, that is a picture made
 * entirely of mid-greys, which is the opposite of what §8.1 asks the menu to look like.
 *
 * Centred on `MENU_BACKDROP.midpoint` rather than on a half, because that band is not
 * centred on a half — see the constant.
 */
export function contrast(thickness: number): number {
  const stretched = (thickness - MENU_BACKDROP.midpoint) * MENU_BACKDROP.contrast + 0.5;
  return stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
}

/** The `#ffe082` of the title's own glow, as the sheen's tint. */
const AMBER = [255, 224, 130];

/** sRGB bytes for a thickness, written into `out` at `offset`. §8.1's greys. */
export function shade(thickness: number, out: Uint8ClampedArray, offset: number): void {
  const { shadow, highlight, amber } = MENU_BACKDROP;
  const film = contrast(thickness);
  // Curved, so most of the surface lies down in the blacks and the light is in the folds.
  const depth = film ** MENU_BACKDROP.depthCurve;
  const gloss = sheen(film);

  for (let channel = 0; channel < 3; channel += 1) {
    const base = shadow[channel]! + (highlight[channel]! - shadow[channel]!) * depth;
    // The title's amber, and only on the ridges: enough that the film and the words in
    // front of it read as one palette, not enough to be a second colour.
    const warm = AMBER[channel]! * amber;
    out[offset + channel] = base + gloss * (highlight[channel]! * 0.55 + warm);
  }
  out[offset + 3] = 255;
}

/**
 * Whether a run of frame costs, in milliseconds, says this device cannot afford the film.
 *
 * The median rather than the mean or the worst: the distribution is one cost with outliers
 * on it, and the outliers are the browser's rather than the field's. It answers false until
 * there are enough frames to judge, so a menu that has only just come up is never called
 * slow on the strength of the frame it came up on.
 */
export function overBudget(costs: readonly number[]): boolean {
  if (costs.length < MENU_BACKDROP.budgetSamples) return false;
  const sorted = [...costs].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return median > MENU_BACKDROP.budgetMilliseconds;
}

/**
 * The canvas the film is drawn on, and the loop that draws it.
 *
 * The element is the caller's to place; its size, its loop and its lifetime are this
 * class's. `start` and `stop` are idempotent, because the screens above it announce
 * visibility on every transition and several of those are from one shell screen to another.
 */
export class MenuBackdrop {
  readonly canvas: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private columns = 0;
  private rows = 0;
  /** The time-independent first warp, one pair per sample. See `baseWarp`. */
  private warp = new Float32Array(0);

  /** The `requestAnimationFrame` handle, or null when nothing is scheduled. */
  private pending: number | null = null;
  private churn = 0;
  /** Timestamp of the last drawn frame, for both the delta and the frame-rate cap. */
  private drawnAt = 0;
  private wanted = false;
  /** Milliseconds the most recent drawn frames took, oldest first. See `overBudget`. */
  private readonly costs: number[] = [];

  /**
   * Why the film is not turning over, or null while it is. Either the player asked their
   * system for less motion, or this device could not draw a frame inside the budget — both
   * end the same way, in a still picture rather than a stutter or a black rectangle.
   */
  private stillBecause: 'preference' | 'budget' | null = null;

  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => (document.hidden ? this.pause() : this.resume());

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'shell-water';
    // Decorative: it says nothing a reader needs, and an unlabelled canvas is announced.
    this.canvas.setAttribute('aria-hidden', 'true');

    // `alpha: false` lets the browser skip compositing a layer that is opaque anyway.
    this.context = this.canvas.getContext('2d', { alpha: false });
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.stillBecause = 'preference';
    }

    this.resize();
  }

  /** §8.1 — while the shell's screens are up, and never while a run is. */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resume();
  }

  stop(): void {
    if (!this.wanted) return;
    this.wanted = false;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.pause();
  }

  dispose(): void {
    this.stop();
    this.canvas.remove();
  }

  /** Whether a frame is scheduled: §8.1's rule about a run's frame budget, in one boolean. */
  get running(): boolean {
    return this.pending !== null;
  }

  /** Why the film is standing still, or null. Read by the debug readout (§8.3). */
  get still(): 'preference' | 'budget' | null {
    return this.stillBecause;
  }

  private resume(): void {
    if (!this.wanted || this.pending !== null || document.hidden) return;
    // A frame either way, so a still backdrop is a picture and not a black rectangle.
    this.render();
    if (this.stillBecause) return;
    this.drawnAt = 0;
    this.pending = requestAnimationFrame((now) => this.frame(now));
  }

  private pause(): void {
    if (this.pending === null) return;
    cancelAnimationFrame(this.pending);
    this.pending = null;
  }

  private frame(now: number): void {
    this.pending = requestAnimationFrame((next) => this.frame(next));

    // `rAF` hands a timestamp, not a delta. The first frame has no previous one to measure
    // against, and the clamp covers a tab that was throttled rather than stopped.
    const elapsed = this.drawnAt === 0 ? 0 : Math.min((now - this.drawnAt) / 1000, 0.25);
    if (this.drawnAt !== 0 && elapsed < 1 / MENU_BACKDROP.frameRateCap) return;
    this.drawnAt = now;

    this.churn += elapsed / MENU_BACKDROP.churnSeconds;

    // Measured on frames that were actually drawn, so this is the cost of the picture and
    // not of the page loading around it.
    const started = performance.now();
    this.render();
    this.costs.push(performance.now() - started);
    if (this.costs.length > MENU_BACKDROP.budgetSamples) this.costs.shift();
    if (overBudget(this.costs)) {
      this.stillBecause = 'budget';
      this.pause();
    }
  }

  /**
   * Size the sample grid to the screen's aspect. The canvas's *attributes* are the grid;
   * its CSS size is the screen, and the browser scales between them.
   */
  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth || 16;
    const height = this.canvas.clientHeight || window.innerHeight || 9;
    const scale = MENU_BACKDROP.resolution / Math.max(width, height);

    const columns = Math.max(2, Math.round(width * scale));
    const rows = Math.max(2, Math.round(height * scale));
    if (columns === this.columns && rows === this.rows) return;

    this.columns = columns;
    this.rows = rows;
    this.canvas.width = columns;
    this.canvas.height = rows;
    this.image = this.context?.createImageData(columns, rows) ?? null;

    // The first warp is time-independent, so it belongs to the grid rather than the frame.
    this.warp = new Float32Array(columns * rows * 2);
    const cell = this.cellSize();
    const sample = { x: 0, y: 0 };
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row * cell;
      for (let column = 0; column < columns; column += 1) {
        baseWarp(column * cell, y, sample);
        this.warp[index] = sample.x;
        this.warp[index + 1] = sample.y;
        index += 2;
      }
    }

    this.render();
  }

  /**
   * Field cells per sample, taken from the *longest* edge and applied to both, so the
   * swirls stay round instead of stretching with the window.
   */
  private cellSize(): number {
    return MENU_BACKDROP.featureScale / Math.max(this.columns, this.rows);
  }

  /** One frame of the film, at the current churn. */
  render(): void {
    const image = this.image;
    if (!this.context || !image) return;

    const { columns, rows, warp } = this;
    const cell = this.cellSize();
    const data = image.data;

    let pixel = 0;
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row * cell;
      for (let column = 0; column < columns; column += 1) {
        const thickness = swirlWarped(column * cell, y, warp[index]!, warp[index + 1]!, this.churn);
        shade(thickness, data, pixel);
        pixel += 4;
        index += 2;
      }
    }

    this.context.putImageData(image, 0, 0);
  }
}
