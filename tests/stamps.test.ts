/**
 * Stamps (§9.4) — the expansion, and the rotation arithmetic inside it.
 *
 * The whole design rests on a stamp leaving *nothing* behind: what lands in the map is
 * tiles and entities indistinguishable from hand-drawn ones. So what is worth checking is
 * that the expansion produces exactly that, and that rotating one does not quietly put half
 * a soccer field outside its own footprint — which is the failure a person would notice as
 * "the second goal is in the wrong place" rather than as a coordinate bug.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_STAMPS,
  type Stamp,
  expandStamp,
  rotateCell,
  rotatedFootprint,
  stampFits,
} from '../src/editor/stamps';

const field = BUILT_IN_STAMPS.find((stamp) => stamp.id === 'soccer-field')!;

describe('rotating a stamp cell (§9.4)', () => {
  it('leaves everything alone at no rotation', () => {
    expect(rotateCell(3, 5, 12, 8, 0)).toEqual({ x: 3, y: 5 });
  });

  it('comes back to itself after four quarter turns', () => {
    for (const [x, y] of [
      [0, 0],
      [11, 7],
      [3, 5],
    ]) {
      let cell: { x: number; y: number } = { x: x!, y: y! };
      let w = field.width;
      let h = field.height;
      for (let i = 0; i < 4; i += 1) {
        cell = rotateCell(cell.x, cell.y, w, h, 1);
        [w, h] = [h, w];
      }
      expect(cell).toEqual({ x, y });
    }
  });

  it('normalises negative and over-large turns', () => {
    expect(rotateCell(3, 5, 12, 8, -1)).toEqual(rotateCell(3, 5, 12, 8, 3));
    expect(rotateCell(3, 5, 12, 8, 6)).toEqual(rotateCell(3, 5, 12, 8, 2));
  });

  it('keeps every cell inside the rotated footprint', () => {
    // The bug this catches: an expression that forgets the footprint's axes swap on odd
    // turns puts half a 12-wide pitch outside an 8-wide one, and it reads on screen as
    // scattered tiles rather than as arithmetic.
    for (let turns = 0; turns < 4; turns += 1) {
      const size = rotatedFootprint(field, turns);
      for (const tile of field.tiles) {
        const cell = rotateCell(tile.x, tile.y, field.width, field.height, turns);
        expect(cell.x, `x at ${turns} turns`).toBeGreaterThanOrEqual(0);
        expect(cell.y, `y at ${turns} turns`).toBeGreaterThanOrEqual(0);
        expect(cell.x, `x at ${turns} turns`).toBeLessThan(size.width);
        expect(cell.y, `y at ${turns} turns`).toBeLessThan(size.height);
      }
    }
  });

  it('swaps the footprint on odd turns and not on even ones', () => {
    expect(rotatedFootprint(field, 0)).toEqual({ width: 12, height: 8 });
    expect(rotatedFootprint(field, 1)).toEqual({ width: 8, height: 12 });
    expect(rotatedFootprint(field, 2)).toEqual({ width: 12, height: 8 });
    expect(rotatedFootprint(field, 3)).toEqual({ width: 8, height: 12 });
  });
});

describe('expanding a stamp (§9.4)', () => {
  it('produces ordinary tiles and entities, and nothing that names the stamp', () => {
    const out = expandStamp(field, 4, 6, 0);

    expect(out.tiles.length).toBe(field.tiles.length);
    expect(out.entities.length).toBe(field.entities.length);

    // Nothing in the result refers back: no id, no group, no marker of any kind. This is
    // the property §2's flatness depends on.
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('soccer-field');
    expect(serialised).not.toContain('stamp');
  });

  it('places everything relative to the origin it was dropped on', () => {
    const out = expandStamp(field, 10, 20, 0);
    const xs = out.tiles.map((tile) => tile.x);
    const ys = out.tiles.map((tile) => tile.y);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(20);
    expect(Math.max(...xs)).toBe(10 + field.width - 1);
    expect(Math.max(...ys)).toBe(20 + field.height - 1);
  });

  it('turns the entities with the stamp, not just their positions', () => {
    // §9.4 — the goals face each other across the pitch. Rotating the field must keep them
    // facing each other, which only happens if `rotation` rotates too. Positions alone
    // would give a field with both goals facing the same way.
    const straight = expandStamp(field, 0, 0, 0);
    const turned = expandStamp(field, 0, 0, 1);

    const facing = (out: typeof straight) =>
      out.entities
        .filter((entity) => entity.properties['prefab'] === 'prop_goal')
        .map((entity) => Number(entity.properties['rotation']));

    const before = facing(straight);
    const after = facing(turned);
    expect(before.length).toBe(2);
    // Both moved by the same quarter turn, so they still face each other.
    expect(after[0]).toBe((before[0]! + 90) % 360);
    expect(after[1]).toBe((before[1]! + 90) % 360);
    expect(Math.abs(after[0]! - after[1]!)).toBe(180);
  });

  it('keeps rotations inside 0–359 whatever the turn count', () => {
    for (const turns of [-3, -1, 0, 1, 2, 3, 7]) {
      for (const entity of expandStamp(field, 0, 0, turns).entities) {
        const rotation = Number(entity.properties['rotation']);
        expect(rotation, `${turns} turns`).toBeGreaterThanOrEqual(0);
        expect(rotation, `${turns} turns`).toBeLessThan(360);
      }
    }
  });
});

describe('where a stamp may be placed (§9.4)', () => {
  it('refuses to hang off the map rather than clipping', () => {
    // Half a soccer field is not a thing anybody meant to place.
    expect(stampFits(field, 0, 0, 0, 32, 32)).toBe(true);
    expect(stampFits(field, 20, 24, 0, 32, 32)).toBe(true);
    expect(stampFits(field, 21, 24, 0, 32, 32)).toBe(false);
    expect(stampFits(field, -1, 0, 0, 32, 32)).toBe(false);
  });

  it('accounts for the axes swapping when rotated', () => {
    // 12 × 8 fits at x = 20 on a 32-wide map; turned it is 8 × 12 and fits further right
    // but not as far down.
    expect(stampFits(field, 20, 24, 0, 32, 32)).toBe(true);
    expect(stampFits(field, 20, 24, 1, 32, 32)).toBe(false);
    expect(stampFits(field, 24, 20, 1, 32, 32)).toBe(true);
  });
});

describe('the stamps themselves (§9.4)', () => {
  it('names each one once and gives each a footprint its contents fit inside', () => {
    const ids = BUILT_IN_STAMPS.map((stamp: Stamp) => stamp.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const stamp of BUILT_IN_STAMPS) {
      expect(stamp.width, `${stamp.id} width`).toBeGreaterThan(0);
      expect(stamp.height, `${stamp.id} height`).toBeGreaterThan(0);
      for (const item of [...stamp.tiles, ...stamp.entities]) {
        expect(item.x, `${stamp.id} x`).toBeGreaterThanOrEqual(0);
        expect(item.y, `${stamp.id} y`).toBeGreaterThanOrEqual(0);
        expect(item.x, `${stamp.id} x`).toBeLessThan(stamp.width);
        expect(item.y, `${stamp.id} y`).toBeLessThan(stamp.height);
      }
    }
  });

  it('only places entity types §2 defines', () => {
    // A stamp writing a type the loader does not know is a stamp that lays down entities
    // the game logs and skips — visible in the editor, invisible in the run.
    for (const stamp of BUILT_IN_STAMPS) {
      for (const entity of stamp.entities) {
        expect(entity.type, `${stamp.id}`).toBe('Landmark');
        expect(entity.properties?.['prefab'], `${stamp.id} prefab`).toBeTruthy();
      }
    }
  });
});
