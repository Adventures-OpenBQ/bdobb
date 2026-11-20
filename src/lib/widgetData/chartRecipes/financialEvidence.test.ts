// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { clippedDividendEvidence, dividendEvidence, dividendRow, emptyDividendEvidence, incomeEvidence, incomeRow, screenerEvidence } from '../../../test/fixtures/financialEvidence';
import { persistedCard } from '../persistence';
import { card } from '../../../test/fixtures';
import { datasetFromBytes } from '../../localTableData';
import { parseFinancialEvidence, projectFinancialEvidence, readFinancialEvidence } from './financialEvidence';
import { decodeLinkedChartRecipe } from './settings';

const open = (value: unknown) =>
  datasetFromBytes('source.json', new TextEncoder().encode(JSON.stringify(value)), 'source', 1);

it.each([screenerEvidence, dividendEvidence, emptyDividendEvidence, clippedDividendEvidence, incomeEvidence])(
  'decodes the provider %s example', receipt => {
    expect(parseFinancialEvidence(receipt)).toEqual(receipt);
  },
);

it.each([
  { ...screenerEvidence, diagnostics: ['invented'] },
  { ...screenerEvidence, normalized_count: 2 },
  { ...screenerEvidence, raw_count: 2, normalized_count: 2, delivered_count: 1,
    cohorts: [{ ...screenerEvidence.cohorts[0], raw_count: 2 }] },
  { ...screenerEvidence, cohorts: [{ ...screenerEvidence.cohorts[0], amount: 2 }] },
  { ...dividendEvidence, event_dates: ['2026-02-31'] },
  { ...dividendEvidence, retrieved_at: '2026-02-12T12:00:00+01:00' },
  { ...dividendEvidence, coverage: { status: 'unknown', authority: 'explicit-snapshot' } },
  { ...dividendEvidence, coverage: { ...dividendEvidence.coverage, start: '2026-01-02' } },
  { ...incomeEvidence, scale: { ...incomeEvidence.scale, authority: 'formatter' } },
  { ...incomeEvidence, scale: { ...incomeEvidence.scale, multiplier: 0 } },
  { ...incomeEvidence, periods: [{ ...incomeEvidence.periods[0], present_fields: ['netProfit'] }] },
])('rejects receipt outside the canonical closed schema %#', receipt => {
  expect(parseFinancialEvidence(receipt)).toBeUndefined();
});

it('projection_does_not_certify_empty', async () => {
  const missingProof = { ...emptyDividendEvidence, coverage: { status: 'unknown' }, diagnostics: ['unknown_coverage'] };
  const receipt = parseFinancialEvidence(missingProof)!;
  expect(projectFinancialEvidence(receipt, [])).toEqual(missingProof);
  const unknown = await open({ rows: [], chart_evidence: missingProof, completeness: 'unknown' });
  expect(readFinancialEvidence(unknown.provenance)).toMatchObject({ coverage: { status: 'unknown' } });
  await expect(open({ rows: [], chart_evidence: dividendEvidence, completeness: 'bounded' })).rejects.toThrow('Could not parse local table');
  const verified = await open({ rows: [], chart_evidence: emptyDividendEvidence, completeness: 'bounded' });
  expect(readFinancialEvidence(verified.provenance)).toMatchObject({ coverage: { status: 'verified' }, raw_count: 0 });
  const omission = projectFinancialEvidence(parseFinancialEvidence(dividendEvidence)!, []);
  expect(omission).toMatchObject({ omitted_event_dates: ['2026-02-12'], delivered_count: 1, raw_count: 1 });
  expect(projectFinancialEvidence(omission, ['2026-02-12'])).toEqual(omission);
});

it('retains full-record income coverage when the source limits the number of periods', async () => {
  const data = await open({ rows: [incomeRow], chart_evidence: incomeEvidence, completeness: 'bounded' });
  expect(readFinancialEvidence(data.provenance)).toMatchObject({
    requested_limit: 1, available_period_count: 2,
    periods: [{ period_end: '2026-06-30', record_coverage: 'full-record' }],
  });
  await expect(open({ rows: [{ ...incomeRow, period_ending: '2000-01-01' }], chart_evidence: incomeEvidence, completeness: 'bounded' }))
    .rejects.toThrow('Could not parse local table');
});

it('ignores forged saved evidence and reacquires the runtime snapshot', async () => {
  const options = { version: 1, kind: 'monthly-returns', symbol: 'SHEL.LSE', fields: { date: 'date', price: 'amount' } };
  const forged = { ...card(), provenance: { metadata: { financialEvidence: emptyDividendEvidence } },
    linkedChart: { type: 'monthly-returns', measures: [], display: 'grouped', recipe: { ...options, chart_evidence: emptyDividendEvidence } } } as unknown as ReturnType<typeof card>;
  const saved = persistedCard(forged);
  expect(saved).not.toHaveProperty('provenance');
  expect(decodeLinkedChartRecipe(saved.linkedChart!, 'monthly-returns')).toMatchObject({ ok: false });
  const raw = await open([dividendRow]);
  expect(readFinancialEvidence(raw.provenance)).toBeUndefined();
  const acquired = await open({ rows: [dividendRow], chart_evidence: dividendEvidence, completeness: 'bounded' });
  expect(readFinancialEvidence(acquired.provenance)).toMatchObject({ raw_count: 1, event_dates: ['2026-02-12'] });
  await expect(open({ rows: [dividendRow], chart_evidence: { ...dividendEvidence, hidden_amount: .2 }, completeness: 'bounded' }))
    .rejects.toThrow('Could not parse local table');
});

it('refuses a trusted snapshot whose delivered duplicates contradict its safe cohort', async () => {
  const observation = { symbol: 'FIRST.US', exchange: 'US', currency_symbol: '$', last_day_data_date: '2026-08-28',
    market_cap: 100, dividend_yield: .04, price_change_5d: .03 };
  const rows = [observation, { ...observation, market_cap: 200 }];
  const chart_evidence = { ...screenerEvidence, raw_count: 2, normalized_count: 2, delivered_count: 2,
    cohorts: [{ ...screenerEvidence.cohorts[0], raw_count: 2 }] };
  await expect(open({ rows, chart_evidence, completeness: 'paged' })).rejects.toThrow('Could not parse local table');
});

it('refuses a verified dividend receipt that leaves acquired records unaccounted for', () => {
  expect(parseFinancialEvidence({ ...dividendEvidence, raw_count: 2 })).toBeUndefined();
});
