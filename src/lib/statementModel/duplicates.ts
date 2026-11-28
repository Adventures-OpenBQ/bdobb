// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lines that repeat another line's figures. A provider can report one figure
 * under two names (Yahoo's interest income arrives as `interest_income` and
 * again as `interest_income_non_operating`); shown twice it reads as two
 * things. A line is a repeat when an earlier line, in display order, has the
 * same value in every period on screen and a number in at least one.
 *
 * Found from the figures in front of the user, never from a list of names: two
 * lines that happen to agree today are repeats today, and not the day they
 * differ. A total or subtotal is never a repeat, whatever it equals -- Apple's
 * total revenue is its operating revenue, and a statement without its total
 * revenue is not one. Agreement is still only evidence, so the Statement view
 * shows repeats until the user asks to hide them, and says how many there are.
 */
type Line = { field: string; values: unknown[]; errors?: unknown[]; emphasis?: string };

export function repeatedLines(sections: readonly { items: readonly Line[] }[]): Set<string> {
  const seen = new Map<string, string>();
  const repeats = new Set<string>();
  for (const section of sections) {
    for (const line of section.items) {
      // A line with a calculation error, or with no figure at all, is not evidence of anything.
      if (line.errors?.some((e) => e !== undefined) || !line.values.some((v) => typeof v === "number")) continue;
      if (!line.values.every((v) => v === null || v === undefined || typeof v === "number")) continue;
      const key = JSON.stringify(line.values.map((v) => (typeof v === "number" ? v : null)));
      if (!seen.has(key)) seen.set(key, line.field);
      else if (line.emphasis === undefined) repeats.add(line.field);
    }
  }
  return repeats;
}
