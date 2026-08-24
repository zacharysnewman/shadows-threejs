/**
 * Regenerates `docs/project-map.jsonl` — one JSON record per tracked file.
 *
 * The map is *derived*, never hand-written, because a hand-written index of a hundred and
 * twenty files is a document that is wrong within a week. Every field comes from the file
 * itself: the summary from its leading doc comment, the spec sections from the `§` refs it
 * cites, the exports from its declarations. That is only possible because this repo's
 * convention is that every file opens by saying what it is and which section of
 * `GAME_SPEC.md` required it — the map is that convention, collected.
 *
 * Deterministic: records are sorted by path and carry no timestamps, so regenerating it
 * against an unchanged tree produces a byte-identical file. `tests/project-map.test.ts`
 * depends on that to tell a stale map from a current one.
 *
 *   node scripts/gen-project-map.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/project-map.jsonl');

/**
 * Files the map does not describe.
 *
 * A lockfile is ten thousand lines of noise standing in for one fact `package.json`
 * already states. The map itself is excluded for a harder reason: its own record carries a
 * line count, so including it makes regenerating change the file, which changes the count,
 * which changes the file. There is no fixed point, and the staleness check never passes.
 */
const SKIP = new Set(['package-lock.json', 'docs/project-map.jsonl']);

/** What a file is, decided by where it lives. Order matters: the first match wins. */
const KINDS = [
  [/^src\/.*\.d\.ts$/, 'types'],
  [/^src\/.*\.ts$/, 'source'],
  [/^tests\/.*\.ts$/, 'test'],
  [/^scripts\/.*\.mjs$/, 'script'],
  [/^public\/maps\/[^/]+\/map\.json$/, 'map'],
  [/^public\/maps\/[^/]+\/tileset\.json$/, 'tileset'],
  [/^public\/.*\.json$/, 'data'],
  [/\.md$/, 'doc'],
  [/^\.github\//, 'ci'],
];

function kindOf(path) {
  for (const [pattern, kind] of KINDS) if (pattern.test(path)) return kind;
  return 'config';
}

/**
 * The first paragraph of a file's leading `/** ... *\/` comment, as one line.
 *
 * The first paragraph rather than the whole comment: these headers run to thirty lines of
 * reasoning, and what an index wants is the sentence that says which thing this is.
 */
function summaryOf(text) {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text);
  if (!match) return null;
  const lines = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd());
  const paragraph = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const summary = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  return summary.length > 0 ? summary : null;
}

/** Every `§N` or `§N.N` the file cites, deduplicated and in numeric order. */
function specRefs(text) {
  const found = new Set();
  for (const match of text.matchAll(/§(\d+(?:\.\d+)?)/g)) found.add(match[1]);
  return [...found].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).map((s) => `§${s}`);
}

/** Top-level named exports. Enough to answer "what lives in here" without parsing TypeScript. */
function exportsOf(text) {
  const found = new Set();
  for (const match of text.matchAll(
    /^export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    found.add(match[1]);
  }
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) found.add(name);
    }
  }
  return [...found].sort();
}

/** Markdown headings, so the two design documents are navigable from the map. */
function headingsOf(text) {
  return [...text.matchAll(/^##?\s+(.+)$/gm)].map((m) => m[1].trim());
}

/** What a map file is, without opening it in the game. */
function mapFacts(text) {
  try {
    const data = JSON.parse(text);
    const counts = {};
    for (const entity of data.entities ?? []) {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    }
    return {
      width: data.width,
      height: data.height,
      tileSize: data.tileSize,
      entities: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    };
  } catch {
    return null;
  }
}

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((path) => path.length > 0 && !SKIP.has(path))
  .sort();

const records = files.map((path) => {
  const text = readFileSync(resolve(ROOT, path), 'utf8');
  const kind = kindOf(path);
  const record = { path, kind, lines: text.split('\n').length };

  const summary = summaryOf(text);
  if (summary) record.summary = summary;

  if (kind === 'source' || kind === 'test' || kind === 'script' || kind === 'types') {
    const exported = exportsOf(text);
    if (exported.length > 0) record.exports = exported;
  }

  if (kind === 'doc') {
    const headings = headingsOf(text);
    if (headings.length > 0) record.sections = headings;
  }

  if (kind === 'map') {
    const facts = mapFacts(text);
    if (facts) Object.assign(record, facts);
  }

  const spec = specRefs(text);
  if (spec.length > 0 && extname(path) !== '.md') record.spec = spec;

  return record;
});

writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${OUT} (${records.length} records)`);
