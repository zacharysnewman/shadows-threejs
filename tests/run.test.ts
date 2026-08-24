/**
 * How a run ends (§5.3, §6): the outcome state machine, and the health feedback curves it
 * is read through (§3.4).
 *
 * The DOM is not here. What is testable — and what actually goes wrong — is the ordering:
 * that input goes away before the jump-scare rather than after it, that the hold is real
 * time because the world has stopped, and that a run cannot end twice.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEALTH, RUN } from '../src/config';
import { Health } from '../src/player/Health';
import { RunOutcome } from '../src/world/RunOutcome';

const TICK = 1 / 60;

describe('the outcome state machine (§5.3, §6)', () => {
  it('starts playing, with input and the world live', () => {
    const outcome = new RunOutcome();
    expect(outcome.state).toBe('playing');
    expect(outcome.inputEnabled).toBe(true);
    expect(outcome.simulating).toBe(true);
    expect(outcome.awaitingRestart).toBe(false);
  });

  it('takes input and the world away on the same call that starts the scare', () => {
    const outcome = new RunOutcome();
    expect(outcome.die('SpiderEnemy')).toBe(true);
    // §5.3 — input is disabled, and the world has stopped, before anything is drawn.
    expect(outcome.inputEnabled).toBe(false);
    expect(outcome.simulating).toBe(false);
    expect(outcome.state).toBe('scare');
    expect(outcome.cause).toBe('SpiderEnemy');
  });

  it('holds the scare for 1.5 s of real time, then shows the game over', () => {
    const outcome = new RunOutcome();
    outcome.die('ShadowMonster');

    for (let t = 0; t < RUN.jumpScareSeconds - TICK; t += TICK) outcome.tick(TICK);
    expect(outcome.state).toBe('scare');
    expect(outcome.awaitingRestart).toBe(false);

    outcome.tick(2 * TICK);
    expect(outcome.state).toBe('over');
    expect(outcome.awaitingRestart).toBe(true);
    // The cause survives into the game-over screen: it is what the player is told.
    expect(outcome.cause).toBe('ShadowMonster');
  });

  it('never ends twice: the first thing to arrive is the one that counts', () => {
    const outcome = new RunOutcome();
    expect(outcome.die('SpiderEnemy')).toBe(true);
    // A second spider landing in the same second, and the exit tile underfoot.
    expect(outcome.die('ShadowMonster')).toBe(false);
    expect(outcome.win()).toBe(false);
    expect(outcome.cause).toBe('SpiderEnemy');
    expect(outcome.state).toBe('scare');
  });

  it('cannot be won after it has been lost, or lost after it has been won', () => {
    const won = new RunOutcome();
    expect(won.win()).toBe(true);
    expect(won.die('ShadowMonster')).toBe(false);
    expect(won.state).toBe('won');
    // §6 — victory disables input too, and offers the restart immediately: there is no
    // jump-scare to sit through.
    expect(won.inputEnabled).toBe(false);
    expect(won.awaitingRestart).toBe(true);
  });

  it('does not run the scare timer when there is no scare', () => {
    const outcome = new RunOutcome();
    for (let t = 0; t < 5; t += TICK) outcome.tick(TICK);
    expect(outcome.state).toBe('playing');

    outcome.win();
    for (let t = 0; t < 5; t += TICK) outcome.tick(TICK);
    expect(outcome.state).toBe('won');
  });
});

describe('the health feedback curves (§3.4)', () => {
  /** The heartbeat rate the overlays compute, as arithmetic without the DOM. */
  function heartbeatHz(health: number): number {
    if (health <= 0 || health >= HEALTH.lowThreshold) return 0;
    const progress = 1 - health / HEALTH.lowThreshold;
    return (
      RUN.heartbeatHz.atThreshold +
      (RUN.heartbeatHz.atZero - RUN.heartbeatHz.atThreshold) * progress
    );
  }

  it('is silent above the low threshold and quickens below it', () => {
    expect(heartbeatHz(1)).toBe(0);
    expect(heartbeatHz(HEALTH.lowThreshold)).toBe(0);
    expect(heartbeatHz(HEALTH.lowThreshold - 0.001)).toBeCloseTo(RUN.heartbeatHz.atThreshold, 2);
    expect(heartbeatHz(HEALTH.lowThreshold / 2)).toBeCloseTo(
      (RUN.heartbeatHz.atThreshold + RUN.heartbeatHz.atZero) / 2,
      2,
    );
    expect(heartbeatHz(0.001)).toBeGreaterThan(RUN.heartbeatHz.atZero - 0.02);
  });

  it('desaturates only in the lowest band, which one spider hit does not reach', () => {
    // One hit from full is 0.66; two is 0.32. Neither drains the colour — three is death.
    expect(HEALTH.max - HEALTH.spiderDamage).toBeGreaterThan(RUN.desaturateBelow);
    expect(HEALTH.max - 2 * HEALTH.spiderDamage).toBeGreaterThan(RUN.desaturateBelow);
    // The band is reachable, though: it is where regeneration starts from after two hits.
    expect(RUN.desaturateBelow).toBeLessThan(HEALTH.lowThreshold);
    expect(RUN.desaturateBelow).toBeGreaterThan(0);
  });

  it('fades on its own as the pool refills, because it reads the value not the event', () => {
    const health = new Health();
    health.damage(HEALTH.spiderDamage);
    health.damage(HEALTH.spiderDamage);
    const hurt = heartbeatHz(health.value);
    expect(hurt).toBeGreaterThan(0);

    // Past the delay, and long enough to climb back over the threshold.
    for (let t = 0; t < HEALTH.regenDelay + 4; t += TICK) health.tick(TICK);
    expect(health.value).toBeGreaterThan(HEALTH.lowThreshold);
    expect(heartbeatHz(health.value)).toBe(0);
  });
});

describe('what a run remembers (§6, Run Structure)', () => {
  it('is nothing: a fresh outcome carries no cause from the last one', () => {
    const first = new RunOutcome();
    first.die('ShadowMonster');
    for (let t = 0; t < RUN.jumpScareSeconds + 0.1; t += TICK) first.tick(TICK);
    expect(first.state).toBe('over');

    // A restart is a new object, not a reset one — there is nothing to forget to clear.
    const second = new RunOutcome();
    expect(second.state).toBe('playing');
    expect(second.cause).toBeNull();
  });
});

describe('the frame loop (§7)', () => {
  it('is owned by the shell alone: a run never drives itself', () => {
    // §7 — two drivers on one clock scale every speed in §3.1 and §5 by however many
    // drivers there are, and `requestAnimationFrame` hands its callback a *timestamp*, so
    // a self-driving run also feeds `performance.now()` into a parameter measured in
    // seconds. Both are invisible in a unit test and obvious in a source file, so this is
    // checked where it is legible.
    const run = readFileSync(new URL('../src/Run.ts', import.meta.url), 'utf8');
    const code = run
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toContain('requestAnimationFrame');
    // And the guard is not vacuous: the string is what the bug looked like.
    expect('requestAnimationFrame(frame);').toContain('requestAnimationFrame');

    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main.match(/requestAnimationFrame/g)?.length).toBe(2); // the loop, and its start
  });
});
