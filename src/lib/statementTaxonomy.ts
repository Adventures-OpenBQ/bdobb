// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { VOCABULARY } from "./statementModel/vocabulary";

/**
 * Which section of a financial statement each line item belongs to, for the
 * quick Statement view. The lists are statementModel/vocabulary.ts's: the same
 * ones Statement template 1.1.0 is built from, so the view and the template
 * cannot disagree about where a line goes. That file names where each
 * provider's field names came from (FMP and EODHD, yfinance, SEC).
 * OpenBB's standard statement models carry only the three period fields;
 * every line item is a provider field, which is why this lives in the app.
 *
 * Object insertion order is display order, for sections and for the fields
 * inside them. A field not listed lands in OTHER_SECTION, so a provider that
 * adds a line is shown, not hidden. Per-share and share-count income lines
 * (EPS, weighted-average shares) have their own Per share section: they are
 * not dollar lines and read wrong under Profit.
 */
export type Statement = "income" | "balance" | "cash";

export const OTHER_SECTION = "Other";

/** Never a line item, whatever its type: the row's identity, not its content. */
export const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "symbol", "cik", "period", "period_ending", "fiscal_period", "fiscal_year",
  "filing_date", "accepted_date", "reported_currency", "currency", "currency_symbol", "date",
]);

export const TAXONOMY: Record<Statement, Record<string, readonly string[]>> = {
  income: VOCABULARY.income,
  balance: VOCABULARY.balance,
  cash: VOCABULARY.cashflow,
};

/**
 * Which statement a row set is, from the union of its keys. Cash flow is
 * tested first because its rows carry `net_income` too; the balance sheet
 * next; income last. Null for any other table -- the Pivot mode is then
 * simply not offered.
 */
export function detectStatement(fields: Iterable<string>): Statement | null {
  const has = new Set(fields);
  // `operating_cash_flow` is yfinance's anchor for the same statement the FMP
  // name marks; neither the balance sheet nor the income statement carries
  // either, so the cash-first order is unaffected.
  if (has.has("net_cash_from_operating_activities") || has.has("operating_cash_flow")) return "cash";
  if (has.has("total_assets")) return "balance";
  if (has.has("revenue") || has.has("net_income")) return "income";
  return null;
}
