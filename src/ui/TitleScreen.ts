/**
 * The screens outside a run (§8.1): the title, and the credits.
 *
 * **This is where the audio context is armed** (§4.3, §8.1). Browsers refuse to start an
 * `AudioContext` without a user gesture, and pressing `Play` is the first gesture a session
 * has — which is why a run must not begin without passing through here, however convenient
 * a `?skip` would be. The gesture is handed to the caller rather than acted on: the title
 * screen has no business knowing what an `AudioContext` is.
 *
 * Plain DOM over the canvas, like the HUD (§6) and for the same reason. The one thing that
 * moves is §8.1's backdrop — the film of oily water behind both screens — and it is stopped
 * here, on the way into a run, rather than being trusted to be cheap: §8.1 will not have the
 * menu spending a frame budget the run needs, and a title screen that drops frames is a
 * promise about the game behind it.
 */

import { CREDITS, MENU_BACKDROP } from '../config';
import { MenuBackdrop } from './MenuBackdrop';
import { creditSections } from './credits';

export class TitleScreen {
  readonly root: HTMLDivElement;

  /** §8.1 — behind both screens, and running only while one of them is up. */
  readonly backdrop: MenuBackdrop;

  private readonly title: HTMLDivElement;
  private readonly credits: HTMLDivElement;

  constructor(
    private readonly handlers: {
      onPlay: () => void;
      /** Debug only (§8.3): the level editor, which is a tool rather than a screen. */
      onEdit?: (() => void) | null;
      /**
       * §8.1 — whether these screens are on show, so the menu's music can follow them.
       * A callback rather than the music itself: the title screen has no more business
       * knowing what an `HTMLAudioElement` is than what an `AudioContext` is.
       */
      onVisible?: ((visible: boolean) => void) | null;
    },
    parent: HTMLElement = document.body,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'shell';
    this.root.innerHTML = STYLE;

    this.backdrop = new MenuBackdrop();
    // The scrim is a sibling rather than a background on the screens themselves: the
    // credits scroll and the title does not, and neither should be able to lose it.
    const scrim = document.createElement('div');
    scrim.className = 'shell-scrim';

    this.title = this.buildTitle();
    this.credits = this.buildCredits();
    this.credits.hidden = true;

    this.root.append(this.backdrop.canvas, scrim, this.title, this.credits);
    parent.append(this.root);

    // The canvas has no size until it is in the document, and the grid is sized from it.
    this.backdrop.resize();
    this.backdrop.start();

    // §8.1 — a session opens on the title without anything calling `showTitle`, so the
    // first "these screens are up" has to be said here or the music is never asked for.
    // Asking is all this does: waiting for the gesture a browser needs before it will play
    // is the audio layer's problem, and it is solved there rather than with a listener on
    // this screen (`Music.start`).
    this.handlers.onVisible?.(true);
  }

  private buildTitle(): HTMLDivElement {
    const screen = document.createElement('div');
    screen.className = 'shell-screen shell-title';

    const heading = document.createElement('h1');
    heading.textContent = CREDITS.title;

    const play = button('Play', 'shell-play', () => this.handlers.onPlay());
    const credits = button('Credits', 'shell-credits-link', () => this.showCredits());

    const actions = document.createElement('div');
    actions.className = 'shell-actions';
    actions.append(play, credits);

    if (this.handlers.onEdit) {
      // §8.3 — a developer affordance, so it appears only where the rest of them do.
      actions.append(button('Editor', 'shell-edit', this.handlers.onEdit));
    }

    screen.append(heading, actions);
    return screen;
  }

  private buildCredits(): HTMLDivElement {
    const screen = document.createElement('div');
    screen.className = 'shell-screen shell-creditsscreen';

    const sheet = document.createElement('div');
    sheet.className = 'shell-sheet';

    for (const section of creditSections()) {
      const heading = document.createElement('h2');
      heading.textContent = section.heading;
      sheet.append(heading);

      for (const entry of section.lines) {
        const row = document.createElement('div');
        row.className = 'shell-credit';

        const name = document.createElement('span');
        name.className = 'shell-credit-name';
        if (entry.url) {
          const link = document.createElement('a');
          link.href = entry.url;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          link.textContent = entry.name;
          name.append(link);
        } else {
          name.textContent = entry.name;
        }
        row.append(name);

        const detail = [entry.by, entry.role].filter(Boolean).join(' · ');
        if (detail) {
          const meta = document.createElement('span');
          meta.className = 'shell-credit-meta';
          meta.textContent = detail;
          row.append(meta);
        }
        sheet.append(row);
      }
    }

    // §8.1 — the credits return to the title, from wherever they were opened.
    screen.append(sheet, button('Back', 'shell-back', () => this.showTitle()));
    return screen;
  }

  /** §8.1 — the title, which is also where a session starts. */
  showTitle(): void {
    this.root.hidden = false;
    this.title.hidden = false;
    this.credits.hidden = true;
    this.backdrop.start();
    this.handlers.onVisible?.(true);
  }

  /** §8.1 — reachable from the title and from the victory screen. */
  showCredits(): void {
    this.root.hidden = false;
    this.title.hidden = true;
    this.credits.hidden = false;
    this.backdrop.start();
    this.handlers.onVisible?.(true);
  }

  /** Out of the way, so the run underneath is the only thing on screen (§8.1). */
  hide(): void {
    this.root.hidden = true;
    // §8.1 — the backdrop's whole claim to being affordable is that it is not running while
    // a run is. Stopping it is this line, not an assumption about how cheap it is.
    this.backdrop.stop();
    this.handlers.onVisible?.(false);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    this.backdrop.dispose();
    this.root.remove();
  }
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `shell-button ${className}`;
  element.textContent = label;
  element.dataset['name'] = className;
  element.addEventListener('click', onClick);
  return element;
}

/** The scrim's opacity at the centre of the screen, at the mid ring, and at the edge. */
const SCRIM = {
  centre: MENU_BACKDROP.centreScrim,
  ring: MENU_BACKDROP.centreScrim * 0.5,
  edge: Math.min(1, MENU_BACKDROP.centreScrim * 1.12),
};

const STYLE = `<style>
.shell { position: fixed; inset: 0; z-index: 20; background: #04060a; }
.shell[hidden] { display: none; }
/* §8.1 — the film of oily water. Drawn at a fraction of the screen's resolution and scaled
   up by the browser; the blur is what turns a bilinear upscale back into a liquid, and the
   overscan keeps the blur from pulling the transparent outside of the element into frame. */
.shell-water {
  position: absolute; inset: 0; width: 100%; height: 100%;
  filter: blur(0.55vmax);
  transform: scale(1.06);
}
/* Between the film and the words. The centre is scrimmed hardest because that is where the
   words are; the ring where it lifts is the only place the film is meant to be looked at. */
.shell-scrim {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 40%,
    rgba(3, 5, 8, ${SCRIM.centre.toFixed(2)}) 0%,
    rgba(3, 5, 8, ${SCRIM.ring.toFixed(2)}) 46%,
    rgba(2, 3, 5, ${SCRIM.edge.toFixed(2)}) 100%);
}
.shell-screen {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 28px; padding: 32px;
  color: #e8ecf2;
  font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
}
.shell-screen[hidden] { display: none; }
/* The credits are a wall of text over a moving picture, which is the one place the film
   makes something harder to read; it gets its own sheet of black rather than a lighter
   scrim, which would take the film off the title screen too. */
.shell-creditsscreen { background: rgba(4, 6, 9, 0.78); }
@media (prefers-reduced-motion: reduce) {
  /* The canvas draws one still frame in this case (MenuBackdrop); nothing to do here but
     stop the blur pass, which is a compositor cost for a picture that is not changing. */
  .shell-water { filter: none; }
}
.shell-title h1 {
  margin: 0; font-size: clamp(48px, 16vw, 104px); font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: #f4f6fa;
  /* The one flourish: the title lit the way the game is (§4). */
  text-shadow: 0 0 42px rgba(255, 224, 130, 0.28), 0 0 6px rgba(255, 224, 130, 0.15);
}
.shell-actions { display: flex; flex-direction: column; align-items: stretch; gap: 12px; min-width: 220px; }
.shell-button {
  appearance: none; min-height: 48px; padding: 12px 28px;
  font: inherit; font-size: 17px; letter-spacing: 0.06em; text-transform: uppercase;
  color: #e8ecf2;
  /* Over a moving picture a translucent fill reads as a hole rather than a control, so the
     buttons carry their own dark rather than borrowing the screen's. Not a backdrop-filter:
     that is a blur pass per button per frame over a backdrop that is already moving. */
  background: rgba(9, 12, 17, 0.82);
  border: 1px solid rgba(232, 236, 242, 0.22); border-radius: 8px; cursor: pointer;
}
.shell-button:hover { background: rgba(22, 28, 36, 0.75); }
.shell-play { background: rgba(50, 42, 22, 0.7); border-color: rgba(255, 224, 130, 0.42); }
.shell-play:hover { background: rgba(68, 57, 28, 0.8); }
.shell-creditsscreen { justify-content: flex-start; padding-top: 48px; gap: 20px; }
.shell-sheet {
  width: min(560px, 100%); overflow-y: auto;
  /* In a flex column an auto-height child will not shrink below its content, so without
     this the list overflows the screen instead of scrolling inside it. */
  flex: 1 1 auto; min-height: 0; padding-bottom: 12px;
  /* A row cut in half by the scroll edge reads as broken; faded, it reads as more below. */
  mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
}
.shell-sheet h2 {
  margin: 26px 0 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; color: #ffe082;
}
.shell-sheet h2:first-child { margin-top: 0; }
.shell-credit { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; padding: 4px 0; }
.shell-credit-name { font-size: 17px; }
.shell-credit-name a { color: inherit; }
.shell-credit-meta { color: #9aa4b2; font-size: 14px; }
</style>`;
