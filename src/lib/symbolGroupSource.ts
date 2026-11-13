// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Symbol groups fed by a table (docs: 2026-11-13-bdobb-symbol-group-sources-design.md).
 * The pure half: what a column becomes, when it is written, and which tables may feed a group.
 */
import { isWorkerTableProducer } from "./tableExecution/eligibility";
import type { Dashboard } from "./types";
import type { DatasetColumn } from "./widgetData/types";

/** The most tickers a fed group holds (G8). Art's Charts draws the first five. */
export const SYMBOL_GROUP_CAP = 500;

/**
 * A column of the source's presented output as a group value (spec §1): each cell as text,
 * trimmed and upper-cased; nulls, blanks and cells holding a comma dropped (a comma would split
 * one row into two list positions); duplicates kept in place; the first SYMBOL_GROUP_CAP kept.
 */
export function buildSymbolList(values: readonly unknown[]): { list: string; capped: boolean } {
  const tickers = values.flatMap((value) => {
    const text = value === null || value === undefined ? "" : String(value).trim().toUpperCase();
    return text === "" || text.includes(",") ? [] : [text];
  });
  return { list: tickers.slice(0, SYMBOL_GROUP_CAP).join(","), capped: tickers.length > SYMBOL_GROUP_CAP };
}

/** Only a real change, and never an empty list: a loading or empty source leaves the last one. */
export function shouldWrite(current: string | undefined, next: string): boolean {
  return next !== "" && next !== current;
}

/** The columns offered as the ticker column: text, or untyped. */
export function tickerColumns(columns: readonly DatasetColumn[]): DatasetColumn[] {
  return columns.filter((c) => c.dtype === undefined || c.dtype === "text");
}

/** G5: the first offered column named `symbol` or `ticker`, by id or label, any case. */
export function defaultTickerColumn(columns: readonly DatasetColumn[]): string | undefined {
  return tickerColumns(columns).find((c) => [c.id, c.label].some((name) => /^(symbol|ticker)$/i.test(name.trim())))?.id;
}

/**
 * Whether `cardId` may feed `groupId`: a table that publishes worker output, the rule a linked
 * chart's source already passes, and not one whose own parameters are bound to that group --
 * its next fetch would follow the list it just wrote. `groupId` undefined is a new group.
 */
export function canFeedGroup(dashboard: Dashboard, groupId: string | undefined, cardId: string): boolean {
  const card = dashboard.tabs.flatMap((t) => t.cards).find((c) => c.id === cardId);
  return !!card && isWorkerTableProducer(card) && !card.bindings?.some((b) => b.groupId === groupId);
}

/** "<title> — <tab>", the linked-widget picker's naming; undefined when the card is not on the dashboard. */
export function tableLabel(dashboard: Dashboard, cardId: string): string | undefined {
  for (const tab of dashboard.tabs) {
    const card = tab.cards.find((c) => c.id === cardId);
    if (card) return `${card.title ?? card.widgetId} — ${tab.name}`;
  }
  return undefined;
}
