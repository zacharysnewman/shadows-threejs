/**
 * What §7's targets are actually met by (Cross-Cutting: debug harness).
 *
 * §7 asks for 60 fps on mid-range desktop and a 30 fps floor on recent mobile, and it is
 * the one exit criterion in the whole plan that cannot be checked where the game is built:
 * a software rasteriser renders this at single-digit frame rates, so a number measured
 * there means nothing. What *can* be built here is the instrument — so whoever runs it on
 * real hardware reads a figure instead of forming an impression.
 *
 * **Percentiles rather than an average.** A run that averages 60 fps and stutters to 20 for
 * one frame in fifty is not a run that hit the target; the frame that matters is the slow
 * one. The 95th and 99th percentiles of frame time are what say whether the game is smooth,
 * and the mean is what says whether it is fast.
 *
 * The draw-call and triangle counts come from the renderer rather than from a guess, and
 * they are here because §7's instancing rule is stated as a number — "a 50×50 map is 2,500
 * floor tiles and must not be 2,500 draw calls" — which is a claim you can check.
 */

import * as THREE from 'three';

/** Frames kept for the percentiles. At 60 fps this is the last ten seconds. */
const WINDOW = 600;

/**
 * Deltas above this are not frames anybody drew — a backgrounded tab, a stalled debugger,
 * an automated harness holding the main thread — and folding them into the percentiles
 * would say the game stutters when what happened is that it was not running. Well above
 * §7's worst plausible frame, so a genuinely terrible one still counts against the budget.
 */
const NOT_A_FRAME_SECONDS = 1;

export interface FrameReport {
  frames: number;
  /** Milliseconds. */
  mean: number;
  median: number;
  p95: number;
  p99: number;
  worst: number;
  /** Frames slower than the two budgets §7 names, as a percentage of the window. */
  over16ms: number;
  over33ms: number;
  /** From the renderer, for the frame just drawn. */
  drawCalls: number;
  triangles: number;
  programs: number;
}

export class FrameStats {
  private readonly times = new Float32Array(WINDOW);
  private count = 0;
  private next = 0;
  /** Deltas thrown out as "the page was not being drawn"; reported so it is not silent. */
  private skipped = 0;
  private drawCalls = 0;
  private triangles = 0;
  private programs = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /**
   * Record the frame just drawn. Called after `render`, so the renderer's counters are the
   * ones for the frame being timed rather than the one before it.
   */
  sample(realDelta: number): void {
    if (!Number.isFinite(realDelta) || realDelta <= 0 || realDelta > NOT_A_FRAME_SECONDS) {
      this.skipped += 1;
      return;
    }
    this.times[this.next] = realDelta * 1000;
    this.next = (this.next + 1) % WINDOW;
    this.count = Math.min(WINDOW, this.count + 1);

    const info = this.renderer.info;
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs?.length ?? 0;
  }

  /** Start the window again — after a load, or when the reader asks for a clean run. */
  reset(): void {
    this.count = 0;
    this.next = 0;
    this.skipped = 0;
  }

  /** How many deltas were discarded as stalls rather than frames. */
  get skippedCount(): number {
    return this.skipped;
  }

  report(): FrameReport {
    const sorted = Array.from(this.times.subarray(0, this.count)).sort((a, b) => a - b);
    const at = (fraction: number): number =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
    const total = sorted.reduce((sum, ms) => sum + ms, 0);
    const over = (limit: number): number =>
      sorted.length === 0 ? 0 : (sorted.filter((ms) => ms > limit).length / sorted.length) * 100;

    return {
      frames: sorted.length,
      mean: sorted.length === 0 ? 0 : total / sorted.length,
      median: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      worst: sorted[sorted.length - 1] ?? 0,
      // 16.7 ms is §7's desktop target and 33.3 ms its mobile floor.
      over16ms: over(1000 / 60),
      over33ms: over(1000 / 30),
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      programs: this.programs,
    };
  }

  /** One line for the readout: the shape of the window, and the two budgets it missed. */
  summary(): string {
    const r = this.report();
    if (r.frames === 0) return 'warming up';
    return (
      `p50 ${r.median.toFixed(1)}ms · p95 ${r.p95.toFixed(1)}ms · p99 ${r.p99.toFixed(1)}ms · ` +
      `over 60fps budget ${r.over16ms.toFixed(0)}% · over 30fps ${r.over33ms.toFixed(0)}% ` +
      `(${r.frames} frames${this.skipped > 0 ? `, ${this.skipped} stall(s) ignored` : ''})`
    );
  }

  /** The §7 numbers that are not about time: what one frame costs to draw. */
  costSummary(): string {
    const r = this.report();
    return `${r.drawCalls} draw calls · ${(r.triangles / 1000).toFixed(1)}k triangles · ${r.programs} programs`;
  }
}
