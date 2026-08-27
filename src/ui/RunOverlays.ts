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
 * which mistake they made, because the two mistakes have nothing in common — but the shape
 * is the same silhouette in both, because §5.2 makes that outline the monster's entire
 * visual design and the player has spent the run learning it.
 */

import { HEALTH, RUN } from '../config';

export type DeathCause = 'SpiderEnemy' | 'ShadowMonster';

export interface VictorySummary {
  /** Simulation seconds, so time spent reading a note is not counted (§6). */
  seconds: number;
  notesRead: number;
  notesTotal: number;
}

/**
 * The shape both jump-scares are made of (§5.2, §5.3).
 *
 * A spider, because that is the silhouette the run teaches: §5.2 gives the Shadow Monster
 * the spider's model at twice the size and says the silhouette is its entire visual design,
 * so the shape that arrives out of the black has to be one the player half-recognises. The
 * two scares differ in colour, scale and how they move, not in what they are of.
 *
 * Inline SVG rather than art: it is a silhouette, it has to be crisp at any size on any
 * screen, and it is one flat colour driven by `currentColor` — which is how the same markup
 * serves a near-black shape on red and a pure-black one on a dying glow.
 */
const SPIDER_SILHOUETTE = `
<svg class="run-scare-shape" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"
     stroke-linejoin="round">
    <path d="M43 41 L24 23 L7 27" /><path d="M41 47 L17 40 L1 47" />
    <path d="M41 54 L18 59 L3 71" /><path d="M44 59 L27 72 L16 88" />
    <path d="M57 41 L76 23 L93 27" /><path d="M59 47 L83 40 L99 47" />
    <path d="M59 54 L82 59 L97 71" /><path d="M56 59 L73 72 L84 88" />
  </g>
  <ellipse cx="50" cy="63" rx="14" ry="17" fill="currentColor" />
  <ellipse cx="50" cy="43" rx="9.5" ry="9" fill="currentColor" />
  <path d="M44 36 L39 27 M56 36 L61 27" stroke="currentColor" stroke-width="3.5"
        stroke-linecap="round" />
</svg>`;

export class RunOverlays {
  readonly root: HTMLDivElement;

  private readonly vignette: HTMLDivElement;
  private readonly scare: HTMLDivElement;
  private readonly ending: HTMLDivElement;
  private readonly endingCard: HTMLDivElement;
  private readonly canvas: HTMLElement;
  private restart: (() => void) | null = null;
  private credits: (() => void) | null = null;
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
    // §5.2 — the shape is the spider's, because the silhouette is the whole visual design
    // of the monster and it is the one the player has spent the run learning. Built once
    // and re-coloured by the class, so a death does not construct anything.
    this.scare.innerHTML = `<div class="run-scare-glow"></div>${SPIDER_SILHOUETTE}`;

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
    // Restarted rather than left running, so a second run's scare plays from the top. The
    // layer itself no longer animates — scaling it would scale the black it is drawn on,
    // and §5.3 wants the screen black *and then* the shape arriving out of it.
    for (const element of this.scare.querySelectorAll<HTMLElement>('*')) {
      element.style.animation = 'none';
      void element.offsetWidth;
      element.style.removeProperty('animation');
    }
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

    // §8.1 — the credits are reachable from here as well as from the title, because
    // finishing the game is the moment somebody wants to know who made it.
    if (this.credits) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'run-ending-credits';
      link.dataset['name'] = 'ending-credits';
      link.textContent = 'Credits';
      // The whole ending is a restart target (§6); this one child is not.
      link.addEventListener('click', (event) => {
        event.stopPropagation();
        this.credits?.();
      });
      this.endingCard.append(link);
    }
    this.ending.hidden = false;
  }

  /** §8.1 — what the victory screen's credits link does, or null for no link. */
  onCredits(handler: (() => void) | null): void {
    this.credits = handler;
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

/* §5.3 — the two scares are unalike on purpose: the player has to read which mistake they
   made. Both are the same silhouette (§5.2); what differs is the colour, the ground it
   arrives on, and how it moves. The layer itself never animates — scaling it would scale
   the ground with it, and both of these are a shape moving against a still ground. */
.run-scare { position: absolute; inset: 0; overflow: hidden; }
.run-scare-shape { position: absolute; left: 50%; top: 50%; width: 96vmin; height: 96vmin;
  margin: -48vmin 0 0 -48vmin; transform-origin: 50% 52%; }
.run-scare-glow { position: absolute; inset: 0; }

/* Red and convulsive: it is already on you, and it is thrashing. The steps() is the
   convulsion — an eased scale reads as a zoom, which is a camera move, not an animal. */
.run-scare.is-spider { background: #6e0c0c; animation: scare-flash 0.25s steps(2, end) 6 both; }
.run-scare.is-spider .run-scare-glow {
  background: radial-gradient(circle at 50% 46%, rgba(255,90,60,0.30) 0 22%,
    rgba(120,10,10,0) 62%); }
.run-scare.is-spider .run-scare-shape { color: #170202;
  animation: scare-spider 1.5s steps(6, end) both; }

/* A black screen with a shape arriving out of it. The shape is pure black and is visible
   only where it crosses the last of the light, so it does not fade in — it occludes, and by
   the time it fills the screen there is nothing left to see. That is the monster: the only
   way it was ever visible was as a shadow, and this is the last one. */
.run-scare.is-monster { background: #000; }
.run-scare.is-monster .run-scare-glow {
  background: radial-gradient(circle at 50% 48%, rgba(176,198,214,0.34) 0 14%,
    rgba(96,120,140,0.14) 38%, rgba(20,26,32,0) 70%);
  animation: scare-glow 1.5s ease-in both; }
.run-scare.is-monster .run-scare-shape { color: #000;
  animation: scare-monster 1.5s cubic-bezier(0.55, 0, 0.85, 0.35) both; }

@keyframes scare-spider {
  0%   { transform: scale(0.9) translate(0, 0) rotate(-2deg); }
  25%  { transform: scale(1.25) translate(-3%, 2%) rotate(3deg); }
  50%  { transform: scale(1.15) translate(4%, -2%) rotate(-4deg); }
  75%  { transform: scale(1.5) translate(-2%, 3%) rotate(2deg); }
  100% { transform: scale(1.9) translate(2%, -1%) rotate(-1deg); }
}
@keyframes scare-flash {
  0%   { background-color: #6e0c0c; }
  100% { background-color: #9d1414; }
}
/* One accelerating rush, out of nothing and into the whole screen. */
@keyframes scare-monster {
  0%   { transform: scale(0.12); }
  100% { transform: scale(4.2); }
}
/* The light it was arriving out of, going with it. */
@keyframes scare-glow {
  0%   { opacity: 1; }
  70%  { opacity: 0.85; }
  100% { opacity: 0; }
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
.run-ending-credits {
  appearance: none; margin-top: 18px; min-height: 44px; padding: 10px 22px;
  font: inherit; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;
  color: #e8ecf2; background: rgba(232, 236, 242, 0.06);
  border: 1px solid rgba(232, 236, 242, 0.22); border-radius: 8px; cursor: pointer;
}
</style>`;
