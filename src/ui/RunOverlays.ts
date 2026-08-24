/**
 * How a run *feels* and how it ends (§3.4, §5.3, §6).
 *
 * Two jobs that belong together because they are the same surface: the damage state the
 * player reads continuously, and the screens that end the run.
 *
 * **§3.4 is emphatic that health is not a HUD element.** There is no bar and there are no
 * hearts — the state reads as a red vignette, a heartbeat, and the colour draining out of
 * the image. All three are functions of the *current value* rather than of a damage event,
 * which is what makes them fade on their own as regeneration proceeds: nothing here has to
 * be told that the player is healing.
 *
 * Done in DOM and CSS rather than as a post-process. A vignette and a saturation curve are
 * two lines of CSS over the canvas and a full render pass in a shader, and §7's budget is
 * spent on the shadow maps that are the actual mechanic. The one cost is that `filter` on
 * the canvas is a compositor operation rather than a free one, so it is applied only while
 * it is doing something — at full health the property is removed, not set to `none`.
 *
 * The two jump-scares are deliberately unalike (§5.3): the spider's is red and convulsive,
 * the monster's is a black screen with a shape arriving out of it. The player has to know
 * which mistake they made, because the two mistakes have nothing in common.
 */

import { HEALTH, RUN } from '../config';

export type DeathCause = 'SpiderEnemy' | 'ShadowMonster';

export interface VictorySummary {
  /** Simulation seconds, so time spent reading a note is not counted (§6). */
  seconds: number;
  notesRead: number;
  notesTotal: number;
}

export class RunOverlays {
  readonly root: HTMLDivElement;

  private readonly vignette: HTMLDivElement;
  private readonly scare: HTMLDivElement;
  private readonly ending: HTMLDivElement;
  private readonly endingCard: HTMLDivElement;
  private readonly canvas: HTMLElement;
  private restart: (() => void) | null = null;
  private saturated = true;

  constructor(canvas: HTMLElement, parent: HTMLElement = document.body) {
    this.canvas = canvas;

    this.root = document.createElement('div');
    this.root.className = 'run-overlays';
    this.root.innerHTML = STYLE;

    this.vignette = document.createElement('div');
    this.vignette.className = 'run-vignette';
    this.vignette.style.opacity = '0';

    this.scare = document.createElement('div');
    this.scare.className = 'run-scare';
    this.scare.hidden = true;

    this.endingCard = document.createElement('div');
    this.endingCard.className = 'run-ending-card';
    this.ending = document.createElement('div');
    this.ending.className = 'run-ending';
    this.ending.hidden = true;
    this.ending.append(this.endingCard);
    // A click anywhere on the screen starts the next run; §6 says the player may start a
    // new one and does not say they must find a button to do it with.
    this.ending.addEventListener('click', () => this.restart?.());

    this.root.append(this.vignette, this.scare, this.ending);
    parent.append(this.root);
  }

  /** Called when either end screen is dismissed (§6). */
  onRestart(handler: () => void): void {
    this.restart = handler;
  }

  /** True while an end screen is up and the interact action means "again" (§6). */
  get awaitingRestart(): boolean {
    return !this.ending.hidden;
  }

  dismiss(): void {
    if (this.awaitingRestart) this.restart?.();
  }

  /**
   * §3.4 — the whole of the health feedback, driven by the value and nothing else.
   * Returns the heartbeat rate in Hz, or 0 when the player is not low enough to hear one.
   */
  showHealth(health: number): number {
    // Strength is `1 − health`: absent at full, total at zero.
    this.vignette.style.opacity = `${Math.min(1, Math.max(0, 1 - health))}`;

    const drained = health < RUN.desaturateBelow;
    if (drained !== this.saturated) {
      // Only set while it is doing something: `filter` on a WebGL canvas costs a
      // compositor pass, and the common case is a player at full health.
      if (drained) this.canvas.style.filter = `saturate(${RUN.desaturateTo})`;
      else this.canvas.style.removeProperty('filter');
      this.saturated = drained;
    }

    if (health <= 0 || health >= HEALTH.lowThreshold) return 0;
    // Linear between the threshold and zero, so the quickening is something the player can
    // feel getting worse rather than a step change at one value.
    const progress = 1 - health / HEALTH.lowThreshold;
    return (
      RUN.heartbeatHz.atThreshold +
      (RUN.heartbeatHz.atZero - RUN.heartbeatHz.atThreshold) * progress
    );
  }

  /** §5.3 — the 1.5 s hold. Which enemy it was decides which of the two the player sees. */
  showJumpScare(cause: DeathCause): void {
    this.scare.hidden = false;
    this.scare.className = `run-scare is-${cause === 'SpiderEnemy' ? 'spider' : 'monster'}`;
    // Restarted rather than left running, so a second run's scare plays from the top.
    this.scare.style.animation = 'none';
    void this.scare.offsetWidth;
    this.scare.style.removeProperty('animation');
  }

  /** §5.3 — the jump-scare resolves to this, and there is no respawn. */
  showGameOver(cause: DeathCause): void {
    this.scare.hidden = true;
    this.endingCard.className = 'run-ending-card is-death';
    this.endingCard.innerHTML = `
      <h1>You were caught</h1>
      <p>${cause === 'SpiderEnemy' ? 'A spider reached you.' : 'It found you in the dark.'}</p>
      <p class="run-ending-hint">E or click to begin again</p>`;
    this.ending.hidden = false;
  }

  /** §6 — elapsed time and notes found, and the offer of another run. */
  showVictory(summary: VictorySummary): void {
    this.scare.hidden = true;
    const minutes = Math.floor(summary.seconds / 60);
    const seconds = (summary.seconds % 60).toFixed(1).padStart(4, '0');
    this.endingCard.className = 'run-ending-card is-victory';
    this.endingCard.innerHTML = `
      <h1>Out</h1>
      <p>${minutes}:${seconds} &middot; ${summary.notesRead} of ${summary.notesTotal} notes found</p>
      <p class="run-ending-hint">E or click to begin again</p>`;
    this.ending.hidden = false;
  }

  /** Back to a run that has not started ending yet. */
  reset(): void {
    this.scare.hidden = true;
    this.ending.hidden = true;
    this.vignette.style.opacity = '0';
    this.canvas.style.removeProperty('filter');
    this.saturated = false;
  }

  dispose(): void {
    this.canvas.style.removeProperty('filter');
    this.root.remove();
  }
}

const STYLE = `<style>
.run-overlays { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  font: 500 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: #e8e4dc; }
.run-overlays [hidden] { display: none !important; }

/* §3.4 — tightens as health drops: the clear centre shrinks as the layer comes up. */
.run-vignette { position: absolute; inset: 0; transition: opacity 180ms linear;
  background: radial-gradient(ellipse at center,
    rgba(120, 8, 8, 0) 22%, rgba(120, 8, 8, 0.42) 58%, rgba(58, 0, 0, 0.9) 100%); }

.run-scare { position: absolute; inset: 0; display: grid; place-items: center; }
.run-scare.is-spider { background: #7d0d0d; animation: scare-spider 1.5s steps(3, end) both; }
.run-scare.is-spider::after { content: ''; width: 46vmin; height: 46vmin; border-radius: 50%;
  background: radial-gradient(circle at 40% 38%, #2a0505 0 32%, #4a0a0a 55%, rgba(74,10,10,0) 72%);
  box-shadow: 0 0 22vmin 8vmin rgba(0,0,0,0.55) inset; }
.run-scare.is-monster { background: #000; animation: scare-monster 1.5s ease-in both; }
.run-scare.is-monster::after { content: ''; width: 30vmin; height: 62vmin; border-radius: 44%;
  background: radial-gradient(ellipse at 50% 40%, rgba(214,210,200,0.9) 0 34%, rgba(120,118,112,0.25) 72%, rgba(0,0,0,0) 100%); }
@keyframes scare-spider {
  0% { transform: scale(0.35); opacity: 0.2; }
  100% { transform: scale(1.35); opacity: 1; }
}
@keyframes scare-monster {
  0% { transform: scale(0.15); opacity: 0; }
  70% { opacity: 1; }
  100% { transform: scale(2.4); opacity: 1; }
}

.run-ending { position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(3, 4, 7, 0.88); pointer-events: auto; cursor: pointer; }
.run-ending-card { text-align: center; padding: 40px 56px; border-radius: 12px;
  background: #14171d; border: 1px solid rgba(232, 228, 220, 0.18);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.7); }
.run-ending-card h1 { margin: 0 0 10px; font-size: 30px; font-weight: 600; letter-spacing: 0.02em; }
.run-ending-card.is-death h1 { color: #ff9a8f; }
.run-ending-card.is-victory h1 { color: #8ff0b4; }
.run-ending-card p { margin: 0; color: #cdc7bb; }
.run-ending-hint { margin-top: 20px !important; font-size: 13px; color: #7d8592; letter-spacing: 0.05em; }
</style>`;
