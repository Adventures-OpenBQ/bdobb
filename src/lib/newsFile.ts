// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { safeUrl } from "./safeUrl";
import type { NewsCardState, NewsFeed } from "./types";

/** The default name of an exported News card configuration. */
export const NEWS_FILE_NAME = "rss-agg.json";

/** Bounds on a file somebody sent you: hostile input, like the wire. */
const MAX_FEEDS = 200;
const MAX_TEXT = 200;

/** The card's configuration as the file holds it: the state, verbatim. */
export function serializeNewsState(state: NewsCardState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export type NewsFileResult = { ok: true; state: NewsCardState } | { ok: false; refusal: string };

function str(v: unknown, max = MAX_TEXT): string | null {
  return typeof v === "string" && v.length <= max ? v.trim() : null;
}

/**
 * Read a configuration back. Every field is checked by type and size and
 * every URL by scheme; one bad row refuses the whole file, so an import is
 * all or nothing and never half-replaces the card.
 */
export function parseNewsFile(text: string): NewsFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, refusal: "Not a JSON file." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, refusal: "Not an rss-agg.json file: expected an object with feeds." };
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.feeds) || o.feeds.length === 0) {
    return { ok: false, refusal: "Not an rss-agg.json file: no feeds." };
  }
  if (o.feeds.length > MAX_FEEDS) {
    return { ok: false, refusal: `File lists ${o.feeds.length} feeds; the limit is ${MAX_FEEDS}.` };
  }
  const feeds: NewsFeed[] = [];
  for (const [i, f] of o.feeds.entries()) {
    if (typeof f !== "object" || f === null) return { ok: false, refusal: `Feed ${i + 1} is not an object.` };
    const row = f as Record<string, unknown>;
    const url = str(row.url, 2048);
    if (url === null || safeUrl(url) === null) {
      return { ok: false, refusal: `Feed ${i + 1} has no http or https URL.` };
    }
    const name = row.name === undefined ? "" : str(row.name);
    const tab = row.tab === undefined ? "" : str(row.tab);
    if (name === null || tab === null) return { ok: false, refusal: `Feed ${i + 1} has a bad name or tab.` };
    feeds.push({ url, name, tab });
  }
  const state: NewsCardState = { feeds };
  const lists = [["highlights", "Highlights must be a list of words."], ["tabOrder", "Tab order must be a list of tab names."]] as const;
  for (const [field, refusal] of lists) {
    const list = o[field];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.some((x) => str(x) === null)) return { ok: false, refusal };
    const kept = list.map((x) => (x as string).trim()).filter((x) => x !== "");
    if (kept.length > 0) state[field] = kept;
  }
  return { ok: true, state };
}
