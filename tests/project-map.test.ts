/**
 * `docs/project-map.jsonl` has to be current, and a convention nobody can check is a
 * convention that is wrong within a week.
 *
 * So the map is derived, and this is what makes "regenerate it when a file changes" a fact
 * rather than a hope: regenerate it here and compare. Adding a file, deleting one, renaming
 * one, or editing a doc comment all move the output, and all fail this until
 * `npm run map` has been run.
 *
 * The generator is deterministic — sorted by path, no timestamps — which is the property
 * this depends on.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const MAP = resolve(ROOT, 'docs/project-map.jsonl');

interface Record {
  path: string;
  kind: string;
  lines: number;
  summary?: string;
  exports?: string[];
  spec?: string[];
}

function readMap(): Record[] {
  return readFileSync(MAP, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record);
}

describe('docs/project-map.jsonl', () => {
  it('is up to date with the tree', () => {
    const checkedIn = readFileSync(MAP, 'utf8');
    execFileSync('node', ['scripts/gen-project-map.mjs'], { cwd: ROOT, stdio: 'pipe' });
    const regenerated = readFileSync(MAP, 'utf8');

    // Put the file back exactly as it was found, whatever the result. Written back rather
    // than restored with `git checkout`, which cannot restore a file that is not tracked
    // yet and would turn a stale map into a confusing git error. And written back rather
    // than left regenerated, deliberately: a test that quietly fixes what it is checking
    // is a test that passes on the second run and tells you nothing on the first.
    writeFileSync(MAP, checkedIn);

    expect(
      regenerated === checkedIn ? 'current' : 'stale — run `npm run map` and commit the result',
    ).toBe('current');
  });

  it('covers every tracked file, and nothing that is not tracked', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        // The same two exclusions the generator makes, and for the same reasons: a
        // lockfile says nothing, and the map cannot describe itself without its own line
        // count making every regeneration differ from the last.
        .filter(
          (path) =>
            path.length > 0 && path !== 'package-lock.json' && path !== 'docs/project-map.jsonl',
        ),
    );
    const mapped = new Set(readMap().map((record) => record.path));

    const missing = [...tracked].filter((path) => !mapped.has(path));
    const extra = [...mapped].filter((path) => !tracked.has(path));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('is one JSON object per line, so it can be read a record at a time', () => {
    for (const [index, line] of readFileSync(MAP, 'utf8').split('\n').entries()) {
      if (line.length === 0) continue;
      expect(() => JSON.parse(line), `line ${index + 1} is not JSON`).not.toThrow();
      expect(line.includes('\n')).toBe(false);
    }
  });

  it('says what every source file is for', () => {
    // The summaries come from each file's leading doc comment, so a source file with no
    // summary is a source file that does not say what it is — which this repo's
    // conventions already forbid, and which the map makes visible.
    const undocumented = readMap()
      .filter((record) => record.kind === 'source' && !record.summary)
      .map((record) => record.path);
    expect(undocumented).toEqual([]);
  });

  it('records the spec sections a file cites, exactly and in order', () => {
    // Re-derived from the file rather than compared against a list written here: what the
    // map owes is that its `spec` field is what the file actually cites, not that any
    // particular file cites any particular section.
    const records = readMap();
    for (const path of [
      'src/lighting/Illumination.ts',
      'src/enemies/Spider.ts',
      'src/world/Objectives.ts',
    ]) {
      const record = records.find((r) => r.path === path);
      const text = readFileSync(resolve(ROOT, path), 'utf8');
      const cited = [
        ...new Set([...text.matchAll(/§(\d+(?:\.\d+)?)/g)].map((match) => match[1] ?? '')),
      ]
        .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
        .map((section) => `§${section}`);
      expect(record?.spec ?? []).toEqual(cited);
    }
  });

  it('is a usable index: the spec sections lead back to the code that implements them', () => {
    const bySection = new Map<string, string[]>();
    for (const record of readMap()) {
      if (record.kind !== 'source') continue;
      for (const section of record.spec ?? []) {
        bySection.set(section, [...(bySection.get(section) ?? []), record.path]);
      }
    }
    // §4.1's shared light query, §5.1's spider and §6's objectives are each findable from
    // the map alone, which is the whole point of carrying the field.
    expect(bySection.get('§4.1')).toContain('src/lighting/Illumination.ts');
    expect(bySection.get('§5.1')).toContain('src/enemies/Spider.ts');
    expect(bySection.get('§6')).toContain('src/world/Objectives.ts');
  });
});
