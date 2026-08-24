/**
 * Analog stick conditioning shared by gamepad and touch input, and the touch scheme's
 * coverage of the actions the player has (§3.1).
 *
 * The buttons themselves are a DOM concern and are checked in a browser; what is checked
 * here is the rule that decides which of them exist at all.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_NAMES, applyDeadzone, TOUCH_BUTTONS } from '../src/core/Input';

describe('applyDeadzone', () => {
  it('reads a resting stick as no input', () => {
    expect(applyDeadzone(0.1, -0.05, 0.22)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });

  it('starts from zero at the edge of the dead zone rather than jumping to it', () => {
    const justOutside = applyDeadzone(0.23, 0, 0.22);
    expect(justOutside.magnitude).toBeGreaterThan(0);
    expect(justOutside.magnitude).toBeLessThan(0.02);
  });

  it('reaches full deflection at the edge of the stick', () => {
    expect(applyDeadzone(1, 0, 0.22).magnitude).toBeCloseTo(1);
  });

  it('is radial, so a diagonal push stays diagonal', () => {
    // An axial dead zone would zero one component here and turn this into a cardinal.
    const diagonal = applyDeadzone(0.5, 0.5, 0.22);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
    expect(diagonal.magnitude).toBeGreaterThan(0);
  });

  it('never exceeds full deflection, whatever the hardware reports', () => {
    // Some pads report a corner deflection greater than 1 on the diagonal.
    const corner = applyDeadzone(1, 1, 0.22);
    expect(corner.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(corner.x, corner.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('the touch controls reach every action (§3.1)', () => {
  /** `src/Run.ts` with comment lines dropped, so a mention in prose is not a use. */
  const runCode = readFileSync(new URL('../src/Run.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

  it('gives an on-screen button to every action the player taps', () => {
    // The rule: an action the run reads as an *edge* is a tap, and a tap with no button is
    // an action a touch player cannot perform at all — which is what the flashlight was.
    // An action read as *held* is a stick gesture instead; see the next test.
    const withButton = new Set(TOUCH_BUTTONS.map((button) => button.action));

    for (const action of ACTION_NAMES) {
      if (!runCode.includes(`wasPressed('${action}')`)) continue;
      expect(withButton.has(action), `'${action}' is tapped but has no on-screen button`).toBe(
        true,
      );
    }
  });

  it('leaves the held actions to the sticks', () => {
    // Sprint is held, not tapped, and lives on the movement stick's rim (§3.1). A button
    // for it would ask for a thumb the player has already committed to the stick.
    for (const { action } of TOUCH_BUTTONS) {
      expect(runCode.includes(`isHeld('${action}')`), `'${action}' is held, not tapped`).toBe(
        false,
      );
    }
    // Not vacuous — sprint really is read as a held action.
    expect(runCode).toContain("isHeld('sprint')");
  });

  it('labels each button and names no action twice', () => {
    const actions = TOUCH_BUTTONS.map((button) => button.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const { label } of TOUCH_BUTTONS) expect(label).not.toBe('');
  });
});
