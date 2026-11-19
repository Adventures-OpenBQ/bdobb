// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { drawdownOptions, priceDataset, priceFields } from './fixtures';
import { preparePrices, recipeEligibility } from './input';

const sample = () => priceDataset([{ date: '2026-01-02', symbol: 'A', adjusted_close: 100 }]);
const refusal = { ok: false, refused: true };
it.each(['complete', 'bounded'] as const)('accepts a documented %s daily acquisition', kind => {
  const data = sample();
  data.completeness.kind = kind;
  data.provenance.parameters = data.provenance.receipt;
  delete data.provenance.receipt;
  expect(recipeEligibility(data, drawdownOptions)).toBeNull();
  expect(preparePrices(data, priceFields)).toMatchObject({ ok: true, scope: { start: '2026-01-01', end: '2026-01-31', interval: '1d' } });
});
it.each(['partial', 'paged', 'sample', 'unknown'] as const)('refuses %s even if all presented and acquired counts agree', kind => {
  const data = sample();
  data.completeness.kind = kind;
  expect(recipeEligibility(data, drawdownOptions)).toMatch(/fully loaded/i);
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
});
it.each([
  {}, { interval: '1d' }, { start_date: '2026-01-01', end_date: '2026-01-31' },
  { interval: '1wk', start_date: '2026-01-01', end_date: '2026-01-31' },
  { interval: '1d', start_date: '2026-02-30', end_date: '2026-03-01' },
])('refuses incomplete or invalid bounded acquisition evidence', receipt => {
  const data = sample();
  data.completeness.kind = 'bounded';
  data.provenance.receipt = receipt;
  expect(recipeEligibility(data, drawdownOptions)).not.toBeNull();
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
});
it('refuses dates outside the acquisition window and conflicting acquisition evidence', () => {
  const data = sample();
  data.provenance.parameters = { interval: '1wk' };
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
  delete data.provenance.parameters;
  data.rows[0].values.date = '2026-02-01';
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
});
it('refuses grouped or aggregated rows including aggregation inherited through a subset', () => {
  const data = sample();
  data.rows[0].groupPath = [{ field: 'symbol', value: 'A' }];
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
  delete data.rows[0].groupPath;
  data.columns.find(c => c.id === 'adjusted_close')!.aggregation = 'mean';
  expect(recipeEligibility(data, drawdownOptions)).toMatch(/raw|aggregate/i);
  delete data.columns.find(c => c.id === 'adjusted_close')!.aggregation;
  data.provenance.inputMayContainAggregates = true;
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
});
it('sorts by the authored calendar date, collapses identical observations and counts gaps', () => {
  const data = priceDataset([
    ['2026-01-05', Infinity], ['2026-01-02T23:30:00-05:00', 100], ['2026-01-04', 0],
    ['2026-01-02', 100], ['2026-01-03', null], ['2026-01-06', -3],
  ].map(([date, adjusted_close]) => ({ symbol: 'A', date, adjusted_close })));
  const result = preparePrices(data, priceFields);
  expect(result).toMatchObject({ ok: true, series: [{ symbol: 'A', points: [
    { date: '2026-01-02', price: 100 }, { date: '2026-01-03', price: null }, { date: '2026-01-04', price: null },
    { date: '2026-01-05', price: null }, { date: '2026-01-06', price: null },
  ] }] });
  if (result.ok) {
    expect(result.notes.join(' ')).toMatch(/duplicate/i);
    expect(result.notes.join(' ')).toMatch(/4.*gap/i);
  }
});
it('invalidates only the conflicting symbol and refuses if none survive', () => {
  const rows = [100, 101].map(adjusted_close => ({ symbol: 'A', date: '2026-01-02', adjusted_close }));
  const result = preparePrices(priceDataset([...rows, { ...rows[0], symbol: 'B' }]), priceFields);
  expect(result).toMatchObject({ ok: true, series: [{ symbol: 'B' }] });
  if (result.ok) expect(result.notes.join(' ')).toMatch(/conflict.*A|A.*conflict/i);
  expect(preparePrices(priceDataset(rows), priceFields)).toMatchObject(refusal);
});
it('uses one proven symbol when there is no symbol binding and refuses mixed identities', () => {
  const fields = { date: 'date', price: 'adjusted_close' };
  const data = priceDataset([{ date: '2026-01-02', adjusted_close: 100 }]);
  expect(preparePrices(data, fields)).toMatchObject(refusal);
  data.provenance.parameters = { symbol: 'A' };
  expect(preparePrices(data, fields)).toMatchObject({ ok: true, series: [{ symbol: 'A' }] });
  data.provenance.parameters.symbol = 'A,B';
  expect(preparePrices(data, fields)).toMatchObject(refusal);
  const mixed = sample();
  mixed.provenance.parameters = { symbol: 'B' };
  expect(preparePrices(mixed, priceFields)).toMatchObject(refusal);
  mixed.rows[0].values.symbol = null;
  expect(preparePrices(mixed, priceFields)).toMatchObject(refusal);
});
it('requires the presented adjusted-price binding and refuses mixed currency or unit declarations', () => {
  const data = sample();
  data.columns = data.columns.filter(c => c.id !== 'adjusted_close');
  data.columns.push({ id: 'close', label: 'Close' });
  data.rows[0].values.close = 101;
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
  expect(preparePrices(data, { ...priceFields, price: 'close' })).toMatchObject(refusal);
  for (const field of ['currency', 'unit']) {
    const mixed = priceDataset(['USD', 'EUR'].map((value, i) => ({
      date: '2026-01-0' + (2 + i), symbol: 'A', adjusted_close: 100, [field]: value,
    })));
    expect(preparePrices(mixed, priceFields)).toMatchObject(refusal);
  }
});
it('refuses a reduced transfer without omitted-observation coordinates', () => {
  const data = sample();
  data.completeness.acquiredRowCount = 3;
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
});

it('refuses conflicting exchange identity for the same symbol but admits different venues for different symbols', () => {
  const rows = ['XNYS', 'XLON'].map((exchange, i) => ({ symbol: 'A', exchange, date: '2026-01-0' + (i + 2), adjusted_close: 100 }));
  expect(preparePrices(priceDataset(rows), priceFields)).toMatchObject(refusal);
  rows[1].symbol = 'B';
  expect(preparePrices(priceDataset(rows), priceFields)).toMatchObject({ ok: true });
});
it('refuses unverified price dimensions in a chart transfer from another executor', () => {
  const projected = { ...sample(), kind: 'chartData' };
  expect(preparePrices(projected, priceFields)).toMatchObject(refusal);
});
it('refuses a computed price binding and a source with no valid prices', () => {
  const data = sample();
  data.columns.find(c => c.id === 'adjusted_close')!.analytical = { kind: 'formula', name: 'Scaled price', definitionId: 'p', scope: 'source' };
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
  expect(preparePrices(priceDataset([{ date: '2026-01-02', symbol: 'A', adjusted_close: 0 }]), priceFields)).toMatchObject(refusal);
});

it('requires distinct date and symbol fields when the source has a custom identity column', () => {
  const data = priceDataset([{ date: '2026-01-02', instrument: 'A', adjusted_close: 100 }]);
  expect(preparePrices(data, { ...priceFields, symbol: 'date' })).toMatchObject(refusal);
});

it('accepts a directly supplied raw daily acquisition without an optional row count', () => {
  const data = sample();
  delete data.completeness.acquiredRowCount;
  delete data.completeness.totalRowCount;
  expect(preparePrices(data, priceFields)).toMatchObject({ ok: true });
});

it('requires inclusive calendar-date acquisition bounds and refuses contradictory observation intervals', () => {
  const data = sample();
  data.provenance.receipt!.end_date = '2026-01-31T09:00:00Z';
  expect(preparePrices(data, priceFields)).toMatchObject(refusal);
  const weekly = priceDataset([{ date: '2026-01-02', symbol: 'A', adjusted_close: 100, interval: '1wk' }]);
  expect(preparePrices(weekly, priceFields)).toMatchObject(refusal);
});
