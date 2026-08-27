/**
 * The screens outside a run (§8.1): the title, and the credits.
 *
 * **This is where the audio context is armed** (§4.3, §8.1). Browsers refuse to start an
 * `AudioContext` without a user gesture, and pressing `Play` is the first gesture a session
 * has — which is why a run must not begin without passing through here, however convenient
 * a `?skip` would be. The gesture is handed to the caller rather than acted on: the title
 * screen has no business knowing what an `AudioContext` is.
 *
 * Plain DOM over the canvas, like the HUD (§6) and for the same reason. Nothing animates:
 * §8.1 is explicit that the menu must not spend a frame budget the run needs, and a title
 * screen that drops frames is a promise about the game behind it.
 */

import { CREDITS } from '../config';
import { creditSections } from './credits';

export class TitleScreen {
  readonly root: HTMLDivElement;

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

    this.title = this.buildTitle();
    this.credits = this.buildCredits();
    this.credits.hidden = true;

    this.root.append(this.title, this.credits);
    parent.append(this.root);

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
    this.handlers.onVisible?.(true);
  }

  /** §8.1 — reachable from the title and from the victory screen. */
  showCredits(): void {
    this.root.hidden = false;
    this.title.hidden = true;
    this.credits.hidden = false;
    this.handlers.onVisible?.(true);
  }

  /** Out of the way, so the run underneath is the only thing on screen (§8.1). */
  hide(): void {
    this.root.hidden = true;
    this.handlers.onVisible?.(false);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
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

const STYLE = `<style>
.shell { position: fixed; inset: 0; z-index: 20; }
.shell[hidden] { display: none; }
.shell-screen {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 28px; padding: 32px;
  background: radial-gradient(120% 90% at 50% 40%, #10141c 0%, #05070a 70%);
  color: #e8ecf2;
  font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
}
.shell-screen[hidden] { display: none; }
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
  color: #e8ecf2; background: rgba(232, 236, 242, 0.06);
  border: 1px solid rgba(232, 236, 242, 0.22); border-radius: 8px; cursor: pointer;
}
.shell-button:hover { background: rgba(232, 236, 242, 0.12); }
.shell-play { background: rgba(255, 224, 130, 0.14); border-color: rgba(255, 224, 130, 0.42); }
.shell-play:hover { background: rgba(255, 224, 130, 0.22); }
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
