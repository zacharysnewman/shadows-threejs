/**
 * One axis of critically damped smoothing, shared by anything easing a scalar towards a
 * moving target over the render delta (§3.2, §4.1).
 *
 * Critically damped rather than a simple lerp: an underdamped follow overshoots, and for
 * something read as position — the camera's target, the flashlight's pitch distance — an
 * overshoot reads as the thing itself moving rather than the follow settling. Solved
 * analytically so the result is identical at any frame rate, rather than integrated.
 */
export class Damped {
  velocity = 0;

  constructor(public value: number = 0) {}

  snap(target: number): void {
    this.value = target;
    this.velocity = 0;
  }

  step(target: number, timeConstant: number, dt: number): number {
    if (dt <= 0) return this.value;
    if (timeConstant <= 1e-6) {
      this.snap(target);
      return this.value;
    }

    const omega = 1 / timeConstant;
    const decay = Math.exp(-omega * dt);
    const offset = this.value - target;
    const scaled = this.velocity + omega * offset;

    this.value = target + (offset + scaled * dt) * decay;
    this.velocity = (this.velocity - omega * scaled * dt) * decay;
    return this.value;
  }
}
