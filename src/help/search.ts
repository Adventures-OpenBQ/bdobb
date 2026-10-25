// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Topic } from "./index";

export type Hit = { slug: string; title: string; snippet: string; score: number };

/** Long enough to place a match in context, short enough for a nav-list line. */
const SNIPPET_LENGTH = 100;

/** Stops one topic that merely repeats a word from burying the topic about it. */
const MAX_BODY_CONTRIBUTION = 5;

/** A title hit is worth more than any number of body hits. */
const TITLE_WEIGHT = 10;

// Terms are never empty, so split counts non-overlapping hits.
const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * 100 characters of body around the first occurrence of the first term, cut
 * back to word boundaries, with an ellipsis on whichever side was cut.
 * Rendered as PLAIN TEXT by the dialog, never as markdown, so a leftover
 * backtick or hash is literal and harmless.
 *
 * The search always runs past the leading `# Title` line -- every topic's
 * body starts with one -- so a query that only matches the title (e.g.
 * "tables" against the Tables topic) doesn't produce a snippet that starts
 * with `# Tables`.
 */
function snippetFor(rawBody: string, term: string): string {
  const body = rawBody.replace(/^#{1,6}[^\n]*\n+/, "");
  const lower = body.toLowerCase();
  const at = lower.indexOf(term);
  const centre = at === -1 ? 0 : at;
  const rawStart = Math.max(0, centre - Math.floor((SNIPPET_LENGTH - term.length) / 2));
  const rawEnd = Math.min(body.length, rawStart + SNIPPET_LENGTH);

  // Pull each edge inward to a space, but never past the match itself.
  let start = rawStart;
  if (start > 0) {
    const space = body.indexOf(" ", start);
    if (space !== -1 && space < centre) start = space + 1;
  }
  let end = rawEnd;
  if (end < body.length) {
    const space = body.lastIndexOf(" ", end);
    if (space > centre + term.length) end = space;
  }

  const text = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < body.length ? "…" : ""}`;
}

/**
 * Pure, with no index built ahead of time. Nineteen topics of a few kilobytes
 * is roughly 60 KB of text; scanning all of it per keystroke is not
 * measurable, and substring matching beats stemmed tokenisation for this
 * corpus specifically -- `refet` must find `refetchInterval` (D3).
 *
 * An empty query returns [], which the dialog reads as "show the full ordered
 * list", so an empty result and an empty query are never confused.
 */
export function searchTopics(topics: Topic[], query: string): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t !== "");
  if (terms.length === 0) return [];

  const hits: Hit[] = [];
  for (const topic of topics) {
    const title = topic.title.toLowerCase();
    const body = topic.body.toLowerCase();
    const haystack = `${title}\n${body}`;

    if (!terms.every((term) => haystack.includes(term))) continue;

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += TITLE_WEIGHT;
      score += Math.min(countOccurrences(body, term), MAX_BODY_CONTRIBUTION);
    }

    hits.push({
      slug: topic.slug,
      title: topic.title,
      snippet: snippetFor(topic.body, terms[0]),
      score,
    });
  }

  // Array.prototype.sort is stable in every engine this app runs on, so
  // pushing in TOPIC_ORDER above and sorting by score alone is the whole
  // tie-break rule.
  return hits.sort((a, b) => b.score - a.score);
}
