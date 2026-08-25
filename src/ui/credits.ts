/**
 * What the credits screen says (§8.2).
 *
 * Derived from the constants the game already loads its assets and its bundle by, rather
 * than written out again: `PREFAB_KITS` is where the art actually comes from, and
 * `CREDITS.libraries` is what the bundle actually contains. A credits screen maintained by
 * hand is one that stops being true the first time a dependency changes, and nobody
 * notices, because nothing is watching a paragraph of prose.
 *
 * **Attributions, not licence terms.** The screen says who made what, and stops there.
 * Printing licence names beside each entry sorts the thanks by legal obligation, which is a
 * smaller thing to say than who did the work and says it more loudly. The terms are a
 * developer's question and are answered where a developer looks: `PREFAB_KITS` records each
 * kit's licence, the vendored kits ship their own licence files, and the debug readout's
 * `assets` row names the terms of everything loaded (§8.3).
 *
 * Pure, and with no DOM in it, so what the screen *claims* can be checked without one.
 */

import { CREDITS, PREFAB_KITS } from '../config';

export interface CreditLine {
  /** What is being credited. */
  name: string;
  /** Who made it, or null where the entry is the credit itself. */
  by: string | null;
  /** A link a reader can follow, where there is one. */
  url: string | null;
  /** What it does here — omitted for entries that need no explaining. */
  role: string | null;
}

export interface CreditSection {
  heading: string;
  lines: CreditLine[];
}

const line = (
  name: string,
  by: string | null = null,
  url: string | null = null,
  role: string | null = null,
): CreditLine => ({ name, by, url, role });

/** §8.2 — design, then art, then code, in that order. */
export function creditSections(): CreditSection[] {
  return [
    {
      heading: 'Game design',
      lines: [line(CREDITS.designer)],
    },
    {
      heading: 'Art',
      // §8.2 — every kit, including the ones whose licence asks for nothing. A project that
      // credits only what it is forced to has misunderstood why the licence is free.
      lines: PREFAB_KITS.map((kit) => line(kit.kit, kit.author, kit.url, null)),
    },
    {
      heading: 'Code',
      lines: [
        ...CREDITS.libraries.map((library) =>
          line(library.name, library.author, null, library.role),
        ),
        ...CREDITS.tools.map((tool) => line(tool.name, null, null, 'build')),
      ],
    },
  ];
}

/** The whole screen as text, for a console, a README, or a test that reads it. */
export function creditsText(): string {
  return creditSections()
    .map((section) => {
      const body = section.lines
        .map((entry) => [entry.name, entry.by].filter(Boolean).join(' — '))
        .join('\n');
      return `${section.heading}\n${body}`;
    })
    .join('\n\n');
}
