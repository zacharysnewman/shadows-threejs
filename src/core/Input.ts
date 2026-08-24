/**
 * Input abstraction (§3.1, §3.3).
 *
 * Twin-stick: movement and aim are independent, so the player can back away while keeping
 * the beam on a threat. Three sources feed the same snapshot from the start — keyboard and
 * mouse, gamepad, and touch — because retrofitting a second input path onto a mouse-only
 * aim implementation is the expensive version of this phase.
 *
 * The class reports *intent*, not devices: consumers read a movement vector in world axes,
 * an aim vector or screen point, and edge-triggered actions. Which hardware produced them
 * is only visible through `aimSource`, which callers use to decide whether aim is a screen
 * point to project or a direction to use as-is.
 *
 * World axis convention throughout: `+x` is east, `+y` on the movement vector is world
 * `+z`, which is south — screen-down under the un-rotated camera (§3.2). `W` is `-z`.
 */

import { INPUT } from '../config';

export type AimSource = 'none' | 'pointer' | 'stick';

/**
 * Every action the game binds. Exported as a list rather than only as a union so that the
 * set is enumerable at run time: an action the player has a key for but nothing in the run
 * ever reads is invisible to the type system, and is exactly how the flashlight ended up
 * bound to `F` and reachable only from the debug harness (§8.3).
 */
export const ACTION_NAMES = ['interact', 'flashlight', 'sprint'] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

const ACTION_KEYS: Readonly<Record<ActionName, readonly string[]>> = {
  interact: ['KeyE'],
  flashlight: ['KeyF'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};

/**
 * §3.1, §3.3, §4.1 — the actions that get an on-screen button on touch, stacked in the
 * bottom-right corner with the first of them nearest the thumb.
 *
 * Every action the game asks a player to *tap* belongs here, because a touch player has no
 * other way to reach it: the flashlight was bound to `F` and to gamepad `X` and to nothing
 * on screen, which on a phone is not a control at all. `sprint` is the one deliberate
 * omission — it is held rather than tapped, and pushing the movement stick to its rim is
 * what starts it (§3.1), so a button would ask for a second thumb the player does not have
 * spare.
 */
export const TOUCH_BUTTONS: ReadonlyArray<{ action: ActionName; label: string }> = [
  { action: 'interact', label: 'E' },
  { action: 'flashlight', label: 'F' },
];

/** Standard-mapping gamepad button indices for the same actions. */
const ACTION_BUTTONS: Readonly<Record<ActionName, readonly number[]>> = {
  interact: [0], // A / cross
  flashlight: [2], // X / square
  sprint: [10], // left stick click, the usual place for it
};

const MOVE_KEYS: ReadonlyArray<{ codes: readonly string[]; x: number; z: number }> = [
  { codes: ['KeyW', 'ArrowUp'], x: 0, z: -1 },
  { codes: ['KeyS', 'ArrowDown'], x: 0, z: 1 },
  { codes: ['KeyA', 'ArrowLeft'], x: -1, z: 0 },
  { codes: ['KeyD', 'ArrowRight'], x: 1, z: 0 },
];

/**
 * Radial dead zone, rescaled so the first responsive deflection is 0 rather than the dead
 * zone value — an axial dead zone would let a stick pushed diagonally read as cardinal.
 */
export function applyDeadzone(
  x: number,
  y: number,
  deadzone: number,
): { x: number; y: number; magnitude: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0, magnitude: 0 };
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled, magnitude: scaled };
}

interface TouchStick {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class Input {
  /** Movement intent in world axes, magnitude 0–1. */
  moveX = 0;
  moveZ = 0;

  /** Aim direction in world axes, unit length, when `aimSource === 'stick'`. */
  aimX = 0;
  aimZ = 0;

  /** Pointer position in normalised device coordinates, when `aimSource === 'pointer'`. */
  pointerNdcX = 0;
  pointerNdcY = 0;

  /** Which source last expressed aim intent. `none` until the player aims at all. */
  aimSource: AimSource = 'none';

  /** True once any input has been seen — the gesture Phase 4's `AudioContext` waits on. */
  gestureSeen = false;

  private readonly held = new Set<string>();
  /** Actions pressed since the last `endFrame`, i.e. edge-triggered. */
  private readonly pressed = new Set<ActionName>();
  private readonly actionHeld = new Set<ActionName>();
  private readonly previousButtons = new Set<ActionName>();

  private moveStick: TouchStick | null = null;
  private aimStick: TouchStick | null = null;
  private touchLayer: HTMLElement | null = null;
  private touchIndicators: { move: HTMLElement; aim: HTMLElement } | null = null;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.gestureSeen = true;
    this.held.add(event.code);
    if (event.repeat) return;
    for (const [action, codes] of Object.entries(ACTION_KEYS) as [ActionName, string[]][]) {
      if (codes.includes(event.code)) this.pressed.add(action);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  /** A blurred window never sends key-ups, which would otherwise leave the player walking. */
  private readonly onBlur = (): void => {
    this.held.clear();
    this.actionHeld.clear();
    this.moveStick = null;
    this.aimStick = null;
    this.updateTouchIndicators();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.dragTouch(event);
      return;
    }
    this.gestureSeen = true;
    this.pointerNdcX = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerNdcY = -(event.clientY / window.innerHeight) * 2 + 1;
    this.aimSource = 'pointer';
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.gestureSeen = true;
    if (event.pointerType !== 'touch') return;
    this.beginTouch(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.endTouch(event);
  };

  /** `element` is the surface a touch drag starts on; only its `touch-action` is set. */
  constructor(element: HTMLElement = document.body) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // Pointer events are taken at the window rather than on the canvas: a mouse dragged
    // over the on-screen action button, or a touch that slides off the canvas, still has
    // to keep aiming. The canvas fills the viewport, so nothing is lost by listening wider.
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    // Otherwise a drag on the canvas scrolls or long-press-selects the page on mobile.
    element.style.touchAction = 'none';
  }

  /** True while the action's key or button is down, as opposed to newly pressed. */
  isHeld(action: ActionName): boolean {
    return this.actionHeld.has(action) || this.heldByKey(action);
  }

  private heldByKey(action: ActionName): boolean {
    return ACTION_KEYS[action].some((code) => this.held.has(code));
  }

  /** True if the action was pressed during the frame just sampled. Cleared by `endFrame`. */
  wasPressed(action: ActionName): boolean {
    return this.pressed.has(action);
  }

  /**
   * Sample the devices that have to be polled rather than pushed — gamepads — and fold
   * them into the same snapshot as the event-driven sources. Called once per rendered
   * frame; the sim tick reads the snapshot rather than the hardware, so a frame that runs
   * three ticks applies the same input to all three.
   */
  update(): void {
    let moveX = 0;
    let moveZ = 0;

    for (const binding of MOVE_KEYS) {
      if (binding.codes.some((code) => this.held.has(code))) {
        moveX += binding.x;
        moveZ += binding.z;
      }
    }

    // Digital input is normalised so diagonals are not 1.41× faster than cardinals.
    const keyboardMagnitude = Math.hypot(moveX, moveZ);
    if (keyboardMagnitude > 1) {
      moveX /= keyboardMagnitude;
      moveZ /= keyboardMagnitude;
    }

    if (this.moveStick) {
      const stick = applyDeadzone(this.moveStick.x, this.moveStick.y, INPUT.stickDeadzone);
      moveX += stick.x;
      moveZ += stick.y;
      // Pushed to the rim: sprint (§3.1). The alternative is a second on-screen control
      // for a thumb that is already holding the stick.
      if (stick.magnitude >= INPUT.touchSprintDeflection) this.actionHeld.add('sprint');
      else if (!this.heldByKey('sprint')) this.actionHeld.delete('sprint');
    }

    if (this.aimStick) {
      const stick = applyDeadzone(this.aimStick.x, this.aimStick.y, INPUT.stickDeadzone);
      if (stick.magnitude >= INPUT.aimDeadzone) this.setStickAim(stick.x, stick.y);
    }

    this.pollGamepad(
      (x, z) => {
        moveX += x;
        moveZ += z;
      },
    );

    const magnitude = Math.hypot(moveX, moveZ);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveZ /= magnitude;
    }
    this.moveX = moveX;
    this.moveZ = moveZ;
  }

  /** Drop this frame's edge-triggered presses. Call after everything has read them. */
  endFrame(): void {
    this.pressed.clear();
  }

  private setStickAim(x: number, z: number): void {
    const length = Math.hypot(x, z);
    if (length < 1e-6) return;
    this.aimX = x / length;
    this.aimZ = z / length;
    this.aimSource = 'stick';
  }

  private pollGamepad(addMove: (x: number, z: number) => void): void {
    const pads = navigator.getGamepads?.() ?? [];
    const down = new Set<ActionName>();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;

      const left = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, INPUT.stickDeadzone);
      if (left.magnitude > 0) {
        this.gestureSeen = true;
        addMove(left.x, left.y);
      }

      const right = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, INPUT.stickDeadzone);
      if (right.magnitude >= INPUT.aimDeadzone) {
        this.gestureSeen = true;
        // Aim persists when the stick returns to centre: releasing it should not swing the
        // beam back to a default direction.
        this.setStickAim(right.x, right.y);
      }

      for (const [action, buttons] of Object.entries(ACTION_BUTTONS) as [ActionName, number[]][]) {
        // Collected across every connected pad before anything is applied: releasing a
        // button on one pad must not cancel the same button held on another.
        if (buttons.some((index) => pad.buttons[index]?.pressed === true)) down.add(action);
      }
    }

    for (const action of Object.keys(ACTION_BUTTONS) as ActionName[]) {
      if (down.has(action)) {
        this.gestureSeen = true;
        this.actionHeld.add(action);
        if (!this.previousButtons.has(action)) this.pressed.add(action);
        this.previousButtons.add(action);
      } else {
        this.actionHeld.delete(action);
        this.previousButtons.delete(action);
      }
    }
  }

  // --- Touch ---------------------------------------------------------------
  // Left half of the screen is a floating movement stick, right half a floating aim stick:
  // both anchor wherever the thumb lands rather than at a fixed spot, which is the only
  // arrangement that works across hand sizes and orientations. The action buttons are
  // created lazily along with them, so a desktop session never renders touch chrome.

  private beginTouch(event: PointerEvent): void {
    const stick: TouchStick = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: 0,
      y: 0,
    };
    if (event.clientX < window.innerWidth / 2) {
      if (this.moveStick) return;
      this.moveStick = stick;
    } else {
      if (this.aimStick) return;
      this.aimStick = stick;
    }
    this.ensureTouchLayer();
    this.updateTouchIndicators();
  }

  private dragTouch(event: PointerEvent): void {
    const stick =
      this.moveStick?.pointerId === event.pointerId
        ? this.moveStick
        : this.aimStick?.pointerId === event.pointerId
          ? this.aimStick
          : null;
    if (!stick) return;
    const dx = (event.clientX - stick.originX) / INPUT.touchStickRadius;
    const dy = (event.clientY - stick.originY) / INPUT.touchStickRadius;
    const length = Math.hypot(dx, dy);
    stick.x = length > 1 ? dx / length : dx;
    stick.y = length > 1 ? dy / length : dy;
    this.updateTouchIndicators();
  }

  private endTouch(event: PointerEvent): void {
    if (this.moveStick?.pointerId === event.pointerId) this.moveStick = null;
    if (this.aimStick?.pointerId === event.pointerId) this.aimStick = null;
    this.updateTouchIndicators();
  }

  private ensureTouchLayer(): void {
    if (this.touchLayer) return;

    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none';

    const ring = (): HTMLElement => {
      const element = document.createElement('div');
      element.style.cssText = [
        'position:absolute',
        `width:${INPUT.touchStickRadius * 2}px`,
        `height:${INPUT.touchStickRadius * 2}px`,
        'margin:-' + INPUT.touchStickRadius + 'px 0 0 -' + INPUT.touchStickRadius + 'px',
        'border:2px solid rgba(200,230,210,0.35)',
        'border-radius:50%',
        'display:none',
      ].join(';');
      layer.appendChild(element);
      return element;
    };

    const move = ring();
    const aim = ring();

    // §3.1 — one button per tapped action, stacked up from the corner. Present only once
    // touch is in use, so a desktop session never renders any of this.
    const { touchButtonSize, touchButtonGap, touchButtonMargin } = INPUT;
    TOUCH_BUTTONS.forEach(({ action, label }, index) => {
      const button = document.createElement('button');
      button.textContent = label;
      // Named for the action rather than the key, because the key is the thing a touch
      // player does not have.
      button.setAttribute('aria-label', action);
      button.dataset['action'] = action;
      button.style.cssText = [
        'position:absolute',
        `right:${touchButtonMargin}px`,
        `bottom:${touchButtonMargin + index * (touchButtonSize + touchButtonGap)}px`,
        `width:${touchButtonSize}px`,
        `height:${touchButtonSize}px`,
        'border-radius:50%',
        'border:2px solid rgba(200,230,210,0.4)',
        'background:rgba(10,16,12,0.55)',
        'color:#cfe3d0',
        'font:20px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
        'pointer-events:auto',
        'touch-action:none',
      ].join(';');
      button.addEventListener('pointerdown', (event) => {
        // Stopped here, or the tap also lands on the window listener and anchors an aim
        // stick under the button — the beam would swing every time the torch is toggled.
        event.stopPropagation();
        this.gestureSeen = true;
        this.pressed.add(action);
      });
      layer.appendChild(button);
    });

    document.body.appendChild(layer);
    this.touchLayer = layer;
    this.touchIndicators = { move, aim };
  }

  private updateTouchIndicators(): void {
    if (!this.touchIndicators) return;
    const place = (element: HTMLElement, stick: TouchStick | null): void => {
      if (!stick) {
        element.style.display = 'none';
        return;
      }
      element.style.display = 'block';
      element.style.left = `${stick.originX}px`;
      element.style.top = `${stick.originY}px`;
    };
    place(this.touchIndicators.move, this.moveStick);
    place(this.touchIndicators.aim, this.aimStick);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.touchLayer?.remove();
    this.touchLayer = null;
    this.touchIndicators = null;
  }
}
