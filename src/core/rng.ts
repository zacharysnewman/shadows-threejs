/**
 * Seeded random numbers (Cross-Cutting: determinism).
 *
 * Every randomised value in the game — wander targets now, the spider's deterrence timer
 * and the Shadow Monster's flicker later (§5.1, §5.2) — is drawn from here rather than
 * from `Math.random`, so a run can be replayed. With one life per run (§6), a bug that
 * only surfaces deep into a run is otherwise expensive to reach twice.
 *
 * The generator is mulberry32: small, fast, and good enough for gameplay jitter. It is not
 * a source of anything that needs to be unpredictable.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a run can be seeded with a word rather than a number. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Rng {
  private next: () => number;

  constructor(readonly seed: number) {
    this.next = mulberry32(seed);
  }

  /** Seed from a word or a number; a blank seed picks one and reports it. */
  static from(seed: string | number | null | undefined): Rng {
    if (typeof seed === 'number') return new Rng(seed >>> 0);
    if (typeof seed === 'string' && seed.length > 0) return new Rng(hashSeed(seed));
    return new Rng((Math.random() * 0xffffffff) >>> 0);
  }

  /** 0 ≤ x < 1. */
  float(): number {
    return this.next();
  }

  /** `min` ≤ x < `max`. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in `0 ≤ x < count`. */
  int(count: number): number {
    return Math.min(count - 1, Math.floor(this.next() * count));
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(items.length)];
  }

  /**
   * A named sub-stream. Two systems drawing from one generator make each other's sequences
   * depend on call order, so a change to wander targets would silently re-roll every
   * deterrence timer. A stream per system keeps them independent under the same run seed.
   */
  stream(name: string): Rng {
    return new Rng((this.seed ^ hashSeed(name)) >>> 0);
  }
}
