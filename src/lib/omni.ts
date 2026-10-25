// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { asRecord } from "./isRecord";

/**
 * The omni widget response envelope, kept pure so OmniRenderer only dispatches.
 * OpenBB's OmniWidgetResponse is { content, data_format: { parse_as }, extra_citations,
 * citable }. `parse_as` chooses the renderer; `content`'s shape follows from it and is
 * validated by the child renderer, not here. `extra_citations` follow openbb-ai's
 * Citation model (source_info.{type,name,description,origin,...}).
 */

export type OmniParseAs = "text" | "chart" | "table";
export type NormalizedCitation = { type: string; name?: string; description?: string; origin?: string };
export type OmniResult = { parseAs: OmniParseAs; content: unknown; citations: NormalizedCitation[] };

const PARSE_AS = new Set(["text", "chart", "table"]);

// A citation needs a source_info to be worth showing; without it there is
// nothing to name or link. type falls back to "" so the badge is simply absent.
function normalizeCitation(v: unknown): NormalizedCitation | null {
  const c = asRecord(v);
  if (!c) return null;
  const si = asRecord(c.source_info);
  if (!si) return null;
  const out: NormalizedCitation = { type: typeof si.type === "string" ? si.type : "" };
  if (typeof si.name === "string") out.name = si.name;
  if (typeof si.description === "string") out.description = si.description;
  if (typeof si.origin === "string") out.origin = si.origin;
  return out;
}

/**
 * Validate the omni envelope. Returns null when it is not an omni response --
 * no data_format.parse_as, or a parse_as we do not render -- so the caller can
 * fall back to showing the raw body. `content` may be absent (a backend can
 * answer empty); the renderer handles that.
 */
export function parseOmniResponse(raw: unknown): OmniResult | null {
  const r = asRecord(raw);
  if (!r) return null;
  const df = asRecord(r.data_format);
  if (!df) return null;
  const parseAs = df.parse_as;
  if (typeof parseAs !== "string" || !PARSE_AS.has(parseAs)) return null;
  const citations = Array.isArray(r.extra_citations)
    ? r.extra_citations.map(normalizeCitation).filter((c): c is NormalizedCitation => c !== null)
    : [];
  return { parseAs: parseAs as OmniParseAs, content: r.content, citations };
}
