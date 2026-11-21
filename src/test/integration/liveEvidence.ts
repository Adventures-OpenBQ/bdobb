// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
/** Project callbacks immediately: endpoint, parameter and error text is not diagnostic evidence. */
export function widgetReadEvidence(call: { ok: boolean; rows: number }): { ok: boolean; rows: number } {
  return { ok: call.ok, rows: call.rows };
}

export function liveTurnEvidence<T extends { tool: string }>(reply: string, statuses: readonly unknown[], rounds: readonly T[], expectedTool: string) {
  return {
    has_reply: reply.trim().length > 0,
    status_count: statuses.length,
    tool_rounds: rounds.length,
    expected_tool_calls: rounds.filter(round => round.tool === expectedTool).length,
  };
}

/** Ignore Markdown list labels, preserving signed numerical claims inside each item. */
export function numericClaims(text: string): number[] {
  const claims = text.replace(/^\s*(?:\*\*|__)?\d+[.)](?:\*\*|__)?\s+/gm, "").replace(/−/g, "-");
  return (claims.match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [])
    .map(value => Number(value.replace(/,/g, ""))).filter(Number.isFinite);
}

/** Engine evidence comes from numerical values, never digits in keys or string labels. */
export function numericValues(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numericValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(numericValues);
  return [];
}

/** A single, final answer marker separates the answer from pre-tool commentary. */
export function rowCountAnswer(text: string): number | undefined {
  const matches = [...text.matchAll(/^ROWS=(\d+)\s*$/gm)];
  if (matches.length !== 1 || text.slice(matches[0].index! + matches[0][0].length).trim()) return undefined;
  const count = Number(matches[0][1]);
  return Number.isSafeInteger(count) ? count : undefined;
}
