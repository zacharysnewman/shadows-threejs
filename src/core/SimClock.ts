/**
 * Fixed-timestep simulation clock (§7).
 *
 * Every timer in the game — battery drain, deterrence timers, sabotage dwell, attack
 * cooldowns — runs on this clock, so behaviour is identical at 30 fps and 144 fps. It is
 * deliberately independent of the renderer: it can be paused (note modals, §6), stepped
 * one tick at a time (debugging), and time-scaled (tuning), and nothing that reads sim
 * time needs to know which of those is happening.
 */

import { SIM } from '../config';

export type TickListener = (dt: number, tick: number) => void;

export class SimClock {
  readonly tickRate: number;
  readonly tickSeconds: number;

  /** Simulation ticks elapsed since construction. Does not advance while paused. */
  private _tick = 0;
  /** Simulation time in seconds; `_tick * tickSeconds`, kept as a field for cheap reads. */
  private _elapsed = 0;
  private accumulator = 0;
  private _paused = false;
  private _timeScale = 1;

  private readonly listeners = new Set<TickListener>();

  constructor(tickRate: number = SIM.tickRate) {
    this.tickRate = tickRate;
    this.tickSeconds = 1 / tickRate;
  }

  get tick(): number {
    return this._tick;
  }

  get elapsed(): number {
    return this._elapsed;
  }

  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    if (this._paused === value) return;
    this._paused = value;
    // Drop partial time so unpausing does not immediately burn a stale tick.
    if (value) this.accumulator = 0;
  }

  /** 1.0 is real time. Debug tuning aid; never used by gameplay code. */
  get timeScale(): number {
    return this._timeScale;
  }

  set timeScale(value: number) {
    this._timeScale = Math.max(0, value);
  }

  /**
   * Fraction of the way into the next pending tick, in 0..1. Rendering interpolates
   * positions with this so a 60 Hz simulation still looks smooth above 60 fps.
   */
  get alpha(): number {
    return this._paused ? 0 : Math.min(1, this.accumulator / this.tickSeconds);
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Feed real elapsed time and run however many fixed ticks it buys. Returns the number
   * of ticks run so the debug overlay can show when frames are dropping ticks.
   */
  advance(realDeltaSeconds: number): number {
    if (this._paused) return 0;

    // §7 — a backgrounded tab returns with a multi-second delta; clamping it keeps the
    // accumulator from spiralling into a freeze while it catches up.
    const clamped = Math.min(Math.max(realDeltaSeconds, 0), SIM.maxFrameSeconds);
    this.accumulator += clamped * this._timeScale;

    let ticks = 0;
    while (this.accumulator >= this.tickSeconds) {
      this.accumulator -= this.tickSeconds;
      this.runTick();
      ticks += 1;
    }
    return ticks;
  }

  /** Run exactly one tick regardless of pause state. Debug stepping. */
  stepOnce(): void {
    this.runTick();
  }

  private runTick(): void {
    this._tick += 1;
    this._elapsed += this.tickSeconds;
    for (const listener of this.listeners) listener(this.tickSeconds, this._tick);
  }

  reset(): void {
    this._tick = 0;
    this._elapsed = 0;
    this.accumulator = 0;
  }
}
