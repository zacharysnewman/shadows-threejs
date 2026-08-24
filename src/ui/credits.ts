/**
 * What the credits screen says (§8.2).
 *
 * Derived from the constants the game already loads its assets and its bundle by, rather
 * than written out again: `PREFAB_SOURCE` is where the art actually comes from, and
 * `CREDITS.libraries` is what the bundle actually contains. A credits screen maintained by
 * hand is one that stops being true the first time a dependency changes, and nobody
 * notices, because nothing is watching a paragraph of prose.
 *
 * Pure, and with no DOM in it, so what the screen *claims* can be checked without one.
 */

import { CREDITS, PREFAB_SOURCE } from '../config';

export interface CreditLine {
  /** What is being credited. */
  name: string;
  /** Who made it, or null where the entry is the credit itself. */
  by: string | null;
  /** Licence, where one applies. */
  licence: string | null;
  /** A link a reader can follow, where there is one. */
  url: string | null;
  /** What it does here — omitted for entries that need no explaining. */
  role: string | null;
}

export interface CreditSection {
  heading: string;
  lines: CreditLine[];
  /** Prose under the heading, where the section needs a sentence rather than a list. */
  note: string | null;
}

const line = (
  name: string,
  by: string | null = null,
  licence: string | null = null,
  url: string | null = null,
  role: string | null = null,
): CreditLine => ({ name, by, licence, url, role });

/** §8.2 — design, then art, then code, in that order. */
export function creditSections(): CreditSection[] {
  return [
    {
      heading: 'Game design',
      lines: [line(CREDITS.designer)],
      note: null,
    },
    {
      heading: 'Art',
      lines: [
        line(
          PREFAB_SOURCE.kit,
          PREFAB_SOURCE.author,
          PREFAB_SOURCE.licence,
          PREFAB_SOURCE.url,
          null,
        ),
      ],
      // §8.2 — the licence asks for nothing. Saying so is the point of crediting it anyway.
      note: PREFAB_SOURCE.attributionRequired
        ? null
        : 'Released under CC0, which requires no attribution.',
    },
    {
      heading: 'Code',
      lines: [
        ...CREDITS.libraries.map((library) =>
          line(library.name, library.author, library.licence, null, library.role),
        ),
        ...CREDITS.tools.map((tool) => line(tool.name, null, tool.licence, null, 'build')),
      ],
      note: null,
    },
  ];
}

/** The whole screen as text, for a console, a README, or a test that reads it. */
export function creditsText(): string {
  return creditSections()
    .map((section) => {
      const body = section.lines
        .map((entry) =>
          [entry.name, entry.by, entry.licence].filter(Boolean).join(' — '),
        )
        .join('\n');
      return `${section.heading}\n${body}${section.note ? `\n${section.note}` : ''}`;
    })
    .join('\n\n');
}
