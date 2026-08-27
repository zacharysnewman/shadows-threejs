/**
 * The menu's backdrop (§8.1): the field the film of oily water is made of, and the rules
 * that keep it from costing a run anything.
 *
 * The picture itself is not testable here and is measured in a browser instead — what is
 * testable is everything the picture rests on: that the field is bounded and seamless, that
 * it turns over rather than jumping, that the cached half of it agrees with the whole, that
 * the greys reach black, and that a device is judged over budget on a run of frames rather
 * than on one. The last two are both regressions that already happened once.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MENU_BACKDROP } from '../src/config';
import { baseWarp, contrast, overBudget, shade, swirl, swirlWarped } from '../src/ui/MenuBackdrop';

/** The grid the film is actually drawn on, at 16:9 — the sizing in `MenuBackdrop.resize`. */
const COLUMNS = MENU_BACKDROP.resolution;
const ROWS = Math.round((MENU_BACKDROP.resolution * 9) / 16);
const CELL = MENU_BACKDROP.featureScale / COLUMNS;

/** Every sample of one frame, in row-major order. */
function frame(churn: number): number[] {
  const samples: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      samples.push(swirl(column * CELL, row * CELL, churn));
    }
  }
  return samples;
}

/** Mean absolute difference between two frames of the same grid. */
function difference(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

describe('the field (§8.1)', () => {
  const still = frame(0);

  it('stays inside [0, 1] everywhere the film is drawn', () => {
    // Everything downstream indexes a colour ramp with this. A value outside the range is a
    // clamp somewhere else, which reads as a flat patch rather than as an arithmetic bug.
    expect(Math.min(...still)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...still)).toBeLessThanOrEqual(1);
  });

  it('has no seams: it is continuous, not merely small-stepped', () => {
    // The hash is per lattice point, so a mistake in the interpolation shows up as a grid of
    // hard edges at the noise's own scale — and a bound on the step size would not catch it,
    // because at this feature scale an honest step is already a tenth of the range.
    //
    // What separates the two is how the step behaves as it shrinks. A continuous field's
    // largest step shrinks with the sampling interval; a discontinuity does not shrink at
    // all, because the jump is still there however finely it is straddled.
    const worstStep = (step: number): number => {
      let worst = 0;
      for (let row = 0; row < 40; row += 1) {
        const y = row * CELL;
        for (let column = 1; column < 400; column += 1) {
          worst = Math.max(worst, Math.abs(swirl(column * step, y, 0) - swirl((column - 1) * step, y, 0)));
        }
      }
      return worst;
    };

    const coarse = worstStep(CELL);
    expect(coarse).toBeGreaterThan(0);
    // Quarter the interval and the largest step should quarter with it, give or take.
    expect(worstStep(CELL / 4)).toBeLessThan(coarse * 0.4);
  });

  it('is a function of its phase and nothing else', () => {
    // What makes the picture reproducible, and what a screenshot of it can be compared
    // against later: the same churn is the same frame, whenever it is asked for.
    expect(frame(1.25)).toEqual(frame(1.25));
  });

  it('turns over, and turns over smoothly', () => {
    // One redraw at the cap, and one second of it. Both derived: a hard-coded delta here
    // would fail on the next tuning pass for a reason unrelated to what this checks.
    const perFrame = 1 / MENU_BACKDROP.frameRateCap / MENU_BACKDROP.churnSeconds;
    const perSecond = 1 / MENU_BACKDROP.churnSeconds;

    const step = difference(still, frame(perFrame));
    const second = difference(still, frame(perSecond));

    // It moves at all — a still picture is the failure this animation exists to avoid.
    expect(step).toBeGreaterThan(0);
    // And it moves as a liquid rather than a slideshow: a frame is a small part of a second.
    expect(step).toBeLessThan(second / 4);
  });

  it('draws the same picture from the cached first warp as from the whole field', () => {
    // `MenuBackdrop` computes the time-independent first warp once per grid and reuses it
    // for every frame — two of the five lookups, and the only reason the cost fits the
    // budget. A cache that disagrees with what it stands in for is the bug class of doing
    // that, and it would show as a picture that is subtly not the one this suite checked.
    const warp = { x: 0, y: 0 };
    for (let row = 0; row < ROWS; row += 3) {
      for (let column = 0; column < COLUMNS; column += 3) {
        const x = column * CELL;
        const y = row * CELL;
        baseWarp(x, y, warp);
        expect(swirlWarped(x, y, warp.x, warp.y, 0.4)).toBe(swirl(x, y, 0.4));
      }
    }
  });
});

describe('the greys (§8.1)', () => {
  const pixels = new Uint8ClampedArray(4);
  const shadeAt = (thickness: number): number[] => {
    shade(thickness, pixels, 0);
    return [pixels[0]!, pixels[1]!, pixels[2]!];
  };

  it('needs the contrast stretch: the raw field piles up in the middle', () => {
    // Why `contrast` is there at all. fBm is a sum of independent samples, so the extremes
    // are reached by a handful of samples and the bulk is nowhere near them — read straight,
    // that is a picture made entirely of mid-greys, which is what §8.1 asks the menu not to
    // look like. It is the distribution that says so, not the range: the range is wide and
    // almost empty at both ends.
    const sorted = [...frame(0)].sort((a, b) => a - b);
    const at = (quantile: number): number => sorted[Math.floor(quantile * (sorted.length - 1))]!;

    expect(at(0.9) - at(0.1)).toBeLessThan(0.4);
    // And the stretch opens that band out across most of the ramp.
    expect(contrast(at(0.9)) - contrast(at(0.1))).toBeGreaterThan(0.6);
  });

  it('centres the stretch where the field actually sits, not on a half', () => {
    // The bug this holds shut: `midpoint` was 0.5 and the field's median is well above it,
    // so an eighth of every frame clipped to the highlight — broad pale plateaus that read
    // as smoke rather than as water, and that no assertion about the *range* would notice.
    const sorted = [...frame(0)].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    expect(Math.abs(median - MENU_BACKDROP.midpoint)).toBeLessThan(0.05);

    const clipped = (test: (value: number) => boolean): number =>
      sorted.filter((value) => test(contrast(value))).length / sorted.length;
    expect(clipped((value) => value === 1)).toBeLessThan(0.05);
  });

  it('reaches black, and does not reach white', () => {
    // Both halves matter. Without the first the menu is grey soup; the second is the whole
    // colour brief — §4's dark, not a light-mode backdrop with the title punched out of it.
    const film = frame(0).map(shadeAt);
    const brightest = Math.max(...film.map((rgb) => Math.max(...rgb)));
    const darkest = Math.min(...film.map((rgb) => Math.min(...rgb)));

    expect(darkest).toBeLessThanOrEqual(MENU_BACKDROP.shadow[0]! + 1);
    expect(brightest).toBeGreaterThan(MENU_BACKDROP.highlight[0]!);
    expect(brightest).toBeLessThan(210);
  });

  it('is grey, with the title\'s amber only on the sheen', () => {
    // §8.1 — one palette with the words in front of it, not a second colour. The body of
    // the film is the neutral ramp; only where the sheen is strong does the warm come in,
    // and even there it is a tint rather than a hue.
    const body = shadeAt(0.5);
    expect(Math.max(...body) - Math.min(...body)).toBeLessThan(24);

    // The ramp runs from the spec's shadow to its highlight and nowhere else.
    expect(shadeAt(0)).toEqual([...MENU_BACKDROP.shadow]);
  });
});

describe('the frame budget (§8.1)', () => {
  const budget = MENU_BACKDROP.budgetMilliseconds;
  const samples = MENU_BACKDROP.budgetSamples;

  it('says nothing until it has enough frames to judge', () => {
    // A menu that has only just come up must not be called slow on the strength of the
    // frame it came up on.
    expect(overBudget([])).toBe(false);
    expect(overBudget(new Array(samples - 1).fill(budget * 10))).toBe(false);
  });

  it('does not condemn a device over one hitch', () => {
    // The bug this holds shut: the rule was one frame over budget, and on a page still
    // loading its assets exactly one frame is. The film stopped moving a second or two
    // after the menu appeared, on hardware drawing every other frame in half the budget,
    // and it looked precisely like an animation that had never been wired up.
    const costs = new Array(samples).fill(budget / 2);
    costs[3] = budget * 6;
    expect(overBudget(costs)).toBe(false);
  });

  it('condemns a device that is over budget throughout', () => {
    expect(overBudget(new Array(samples).fill(budget * 1.5))).toBe(true);
    // And it is the median, so half of them being fast is not enough to save it.
    const half = new Array(samples).fill(budget * 3);
    for (let i = 0; i < samples / 2; i += 1) half[i] = budget / 2;
    expect(overBudget(half)).toBe(true);
  });
});

describe('the backdrop is not alive during a run (§8.1)', () => {
  /** `src/ui/TitleScreen.ts` with comment lines dropped, so a mention in prose is not a use. */
  const code = readFileSync(new URL('../src/ui/TitleScreen.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

  it('stops the film on the way into a run', () => {
    // §8.1's whole claim to affordability. It is a lifetime rather than a fast draw, so it
    // is checked where a lifetime is legible: `hide` is the only path into a run.
    const hide = /hide\(\): void \{([\s\S]*?)\n  \}/.exec(code)?.[1] ?? '';
    expect(hide).toContain('this.backdrop.stop()');
    // Not vacuous — that is the method that puts the shell away.
    expect(hide).toContain('this.root.hidden = true');
  });

  it('starts it again on both of the screens it belongs to', () => {
    // The credits are reachable from the victory screen, which means from a hidden shell:
    // a backdrop only started in the constructor would be dead for the rest of the session
    // after the first run.
    for (const method of ['showTitle', 'showCredits']) {
      const body = new RegExp(`${method}\\(\\): void \\{([\\s\\S]*?)\\n  \\}`).exec(code)?.[1] ?? '';
      expect(body, method).toContain('this.backdrop.start()');
    }
  });
});
