// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DividendFinancialEvidence, IncomeFinancialEvidence, ScreenerFinancialEvidence } from './financialEvidence';
import type { RecipeRefusal } from './types';

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
export const duplicateDividendDate = 'Multiple distributions share the same ex-dividend date. Acquire an unambiguous event source.';

export function admitDividendWindow(evidence: DividendFinancialEvidence) {
  const { unsafe, coverage, requested_start: start, requested_end: end } = evidence;
  if (unsafe.instrument_conflict) return refuse('The acquired dividend records have conflicting instrument identities. Repair the source.');
  if (unsafe.amount_basis_conflict) return refuse('The acquired dividend records have a conflicting amount basis. Use split-adjusted amounts.');
  if (unsafe.invalid_ex_date) return refuse('The acquired dividend records include a missing or invalid ex-dividend date. Repair the source.');
  if (evidence.duplicate_dates.length) return refuse(duplicateDividendDate);
  if (unsafe.currency_conflict) return refuse('The acquired dividends have conflicting payment currencies. Use one payment currency.');
  const [currency] = evidence.payment_currencies;
  if (unsafe.unknown_payment_currency || (evidence.raw_count > 0 && !currency))
    return refuse('The acquired dividends have an unknown payment currency. Use a source that supplies the payment currency.');
  if (unsafe.outside_requested_window) return refuse('The acquired dividend dates fall outside the verified window. Repair the source.');
  if (!start || !end || start > end) return refuse('Acquire dividends with explicit inclusive start and end dates.');
  if (coverage.status === 'unknown') return refuse('Dividend coverage is unknown. Load a snapshot with a verified inclusive acquisition window.');
  if (coverage.status === 'clipped')
    return refuse(`Dividend coverage is clipped. The acquired interval ${coverage.start} to ${coverage.end} does not cover the full requested window ${start} to ${end}.`);
  return { ok: true, coverage, start, end, currency } as const;
}

export function screenerIssue(evidence: ScreenerFinancialEvidence) {
  const { unsafe } = evidence;
  if (unsafe.unassignable_identity) return 'The acquired screener includes an unassignable listing identity. Repair the source.';
  if (unsafe.unassignable_date) return 'The acquired screener includes an unassignable price-data date. Repair the source.';
  if (unsafe.unit_conflict) return 'The acquired screener has conflicting field units. Repair the source.';
}

export function cohortIssue(cohort: ScreenerFinancialEvidence['cohorts'][number]) {
  const date = cohort.price_date;
  const [denomination] = cohort.denominations;
  if (cohort.denominations.length > 1) return `The acquired ${date} price-data cohort has mixed market-cap denominations. Use a single-denomination screen.`;
  if (cohort.unknown_denomination || !denomination)
    return `The acquired ${date} price-data cohort has an unknown market-cap denomination. Use a source with verified listing currencies.`;
  if (cohort.conflicting_duplicates)
    return `The acquired ${date} price-data cohort contains conflicting duplicate listings. Repair the source.`;
}

export function admitIncomeUnits(evidence: IncomeFinancialEvidence) {
  if (evidence.unsafe.invalid_period_identity) return refuse('The income acquisition contains invalid period identities.');
  if (evidence.scale.status !== 'verified' || evidence.unsafe.scale_conflict) return refuse('Verify one monetary scale for the acquired income statement.');
  if (!evidence.reporting_currency) return refuse('Verify the income statement reporting currency.');
  return { ok: true, currency: evidence.reporting_currency, scale: evidence.scale } as const;
}

export function incomePeriodIssue(acquired: IncomeFinancialEvidence['periods'][number]) {
  if (acquired.record_coverage !== 'full-record') return 'Acquire a complete income statement record for the selected period.';
  if (acquired.currency_conflict || acquired.scale_conflict || acquired.identity_conflict || acquired.field_origin_conflict)
    return 'The selected income statement period has conflicting currency, scale, identity or field origins.';
}
