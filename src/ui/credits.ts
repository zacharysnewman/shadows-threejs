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

import { CREDITS, PREFAB_KITS } from '../config';

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

/**
 * §8.2 — the sentence under the art list. CC0 requiring nothing is worth saying, since
 * crediting it anyway is a choice; a kit with no stated terms is worth saying louder.
 */
function artNote(): string | null {
  const unstated = PREFAB_KITS.filter((kit) => kit.licence === null);
  if (unstated.length > 0) {
    const names = unstated.map((kit) => kit.kit).join(', ');
    return `${names}: no licence is stated by the author, and terms have not been confirmed.`;
  }
  return PREFAB_KITS.every((kit) => !kit.attributionRequired)
    ? 'Released under CC0, which requires no attribution.'
    : null;
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
      lines: PREFAB_KITS.map((kit) =>
        // §8.2 — a kit whose terms nobody has confirmed says so on the screen. "Licence not
        // stated" is the honest line, and it is worth a player seeing: it is the only thing
        // that keeps an unanswered question from reading as a settled one.
        line(kit.kit, kit.author, kit.licence ?? 'Licence not stated', kit.url, null),
      ),
      note: artNote(),
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
