// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { acquiredOwnershipPartition, acquiredOwnershipRows } from '../../../test/fixtures/ownershipEvidence';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { captureChartSources, chartRequestContext, readChartSource } from './chartSourceContracts';
import { parseOwnershipSource } from './ownershipEvidence';

const common = {
  version: 1, kind: 'ownership', origin: 'acquired-snapshot', issuer: 'EXAMPLE.US', share_class: 'Class-A',
  retrieved_at: '2026-11-20T04:16:46Z', raw_count: 1, normalized_count: 1, delivered_count: 1,
  diagnostics: [], unsafe: { identity_conflict: false, unit_conflict: false, date_conflict: false, partition_conflict: false },
};
const measure = { unit: 'percent-points', basis: 'shares-outstanding', as_of: null };
const bars = {
  ...common,
  measures: { insiders: measure, institutions: { ...measure, unit: 'fraction', as_of: '2026-09-30' }, freeFloat: measure },
  field_origins: { insiders: 'insider_pct', institutions: 'institution_ratio', freeFloat: 'free_float' },
  partition: { status: 'unavailable' },
};
const barsRows = [{ symbol: 'EXAMPLE.US', share_class: 'Class-A', insider_pct: 0.5, institution_ratio: 0.5, free_float: 50 }];
const partition = acquiredOwnershipPartition;
const partitionRows = acquiredOwnershipRows;
const file = (receipt: unknown, rows: unknown[], completeness = 'complete') =>
  ({ rows, completeness, chart_sources: { version: 1, receipts: [receipt] } });
const load = (receipt: unknown, rows: unknown[]) => datasetFromBytes('ownership.json',
  new TextEncoder().encode(JSON.stringify(file(receipt, rows))), 'ownership', 1);
const read = async (receipt: unknown, rows: unknown[]) =>
  readChartSource((await load(receipt, rows)).provenance, 'ownership', parseOwnershipSource);

it('binds independent bars to explicit origins, units and measurement dates', async () => {
  expect(await read(bars, barsRows)).toEqual(bars);
  expect(await read(bars, [{ ...barsRows[0], insider_pct: 0, institution_ratio: null }])).toEqual(bars);
  expect(await read(bars, [{ ...barsRows[0], insider_pct: null, institution_ratio: 0.5 }])).toEqual(bars);
  expect(await read({ ...bars, share_class: null }, [{ ...barsRows[0], share_class: null }])).toMatchObject({ share_class: null });
  expect(parseOwnershipSource({ ...bars, partition: partition.partition })).toBeUndefined();
  expect(parseOwnershipSource({ ...bars, partition: { status: 'unavailable', exclusive: true } })).toBeUndefined();
});

it('does not guess units or dates or accept forged receipt keys', async () => {
  for (const receipt of [
    { ...bars, issuer: 'EXAMPLE' }, { ...bars, share_class: undefined }, { ...bars, retrieved_at: '2026-11-20' },
    { ...bars, measures: { insiders: { ...measure, as_of: undefined } }, field_origins: { insiders: 'insider_pct' } },
    { ...bars, measures: { insiders: { ...measure, as_of: '2026-02-30' } }, field_origins: { insiders: 'insider_pct' } },
    { ...bars, measures: { insiders: { ...measure, unit: '%' } }, field_origins: { insiders: 'insider_pct' } },
    { ...bars, diagnostics: ['unit_conflict'] }, { ...bars, extra: true }, { ...bars, delivered_count: 0 },
    { ...bars, field_origins: { ...bars.field_origins, freeFloat: 'insider_pct' } },
  ]) expect(parseOwnershipSource(receipt)).toBeUndefined();
  for (const row of [
    { ...barsRows[0], symbol: 'EXAMPLE.LSE' }, { ...barsRows[0], share_class: 'Class-C' },
    { ...barsRows[0], insider_pct: '0.5' }, { ...barsRows[0], institution_ratio: 50 },
    { ...barsRows[0], free_float: 101 }, { ...barsRows[0], free_float: -0.1 },
    { ...barsRows[0], free_float: undefined },
  ]) await expect(load(bars, [row])).rejects.toThrow();
});

it('requires acquired partition coordinates, measurement dates, class and denominator', async () => {
  expect(await read(partition, partitionRows)).toEqual(partition);
  for (const receipt of [
    { ...partition, share_class: null }, { ...partition, bucket_keys: ['control', 'control'] },
    { ...partition, bucket_keys: ['23.456', 'other'] }, { ...partition, normalized_count: 3 },
    { ...partition, partition: { ...partition.partition, exhaustive: false } },
    { ...partition, partition: { ...partition.partition, rounding_bound_percent: -0.01 } },
    { ...partition, partition: { ...partition.partition, as_of: null } },
  ]) expect(parseOwnershipSource(receipt)).toBeUndefined();
  for (const second of [
    { ...partitionRows[1], bucket_id: 'control' }, { ...partitionRows[1], bucket_id: 'missing' },
    { ...partitionRows[1], as_of: '2026-09-29' }, { ...partitionRows[1], share_class: 'Class-C' },
    { ...partitionRows[1], denominator: 'free-float' }, { ...partitionRows[1], reported_share: 101 },
  ]) await expect(load(partition, [partitionRows[0], second])).rejects.toThrow();
  expect(() => parseTableSnapshot(file(partition, partitionRows, 'sample'), 'local-file')).toThrow('Invalid table snapshot');
});

it('retains declared raw contradictions after normalization and requires a reason for dropped rows', async () => {
  const raw = { ...partition, raw_count: 3, diagnostics: ['identity_conflict', 'date_conflict', 'partition_conflict'],
    unsafe: { ...common.unsafe, identity_conflict: true, date_conflict: true, partition_conflict: true } };
  expect(await read(raw, partitionRows)).toEqual(raw);
  expect(parseOwnershipSource({ ...partition, raw_count: 3 })).toBeUndefined();
  expect(parseOwnershipSource({ ...raw, unsafe: common.unsafe })).toBeUndefined();
});

it('requires local acquisition and ignores backend snapshots and saved certification', () => {
  const snapshot = file(partition, partitionRows);
  expect(parseTableSnapshot(snapshot).snapshot).toEqual({ completeness: 'unknown' });
  expect(parseTableSnapshot({ rows: partitionRows, completeness: 'complete' }, 'local-file').snapshot).toEqual({ completeness: 'unknown' });
  const url = new URL('https://backend.example/api/v1/equity/ownership/share_statistics?symbol=EXAMPLE.US&provider=eodhd&chart_source=true');
  expect(chartRequestContext(url, 'results.rows', 1)).toBeUndefined();
});

const live = {
  ...common, origin: 'eodhd-share-statistics', issuer: 'AAPL.US', share_class: null,
  measures: {
    insiders: { unit: 'percent-points', basis: null, as_of: null },
    institutions: { unit: 'percent-points', basis: null, as_of: null },
  },
  field_origins: { insiders: 'percent_insiders', institutions: 'percent_institutions' },
  partition: { status: 'unavailable' },
};
const results = [{ symbol: 'AAPL.US', date: '2026-11-19', percent_insiders: 1.687,
  percent_institutions: 66.375, free_float: 99.827 }];
const mirror = '/api/v1/eodhd/equity/ownership/share_statistics';
const standard = '/api/v1/equity/ownership/share_statistics';
const context = { endpoint: mirror, selector: 'results', retrievedAt: 1, parameters: { symbol: 'aapl', chart_source: 'true' } };
const response = (receipt: unknown, rows = results) =>
  ({ results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } } });

it('requires the completed qualified primary US request, exact selector and acquired raw headline results', () => {
  expect(captureChartSources(context, response(live), results)).toEqual({ ownership: live });
  const params = { ...context.parameters, provider: 'eodhd', symbol: 'AAPL.US' };
  expect(captureChartSources({ ...context, endpoint: standard, parameters: params }, response(live), results)).toEqual({ ownership: live });
  for (const request of [
    { ...context, endpoint: standard }, { ...context, endpoint: '/api/v1/equity/ownership/major_holders' },
    { ...context, selector: 'results.rows' },
    ...[{ symbol: 'AAPL.LSE' }, { exchange: 'LSE' }, { symbol: 'MSFT' },
      { chart_source: 'false' }, { provider: 'fmp' }, { window: '1' }].map(p => ({
      ...context, parameters: { ...context.parameters, ...p },
    })),
  ]) expect(captureChartSources(request, response(live), results)).toBeUndefined();
  expect(captureChartSources(context, response(live), [...results])).toBeUndefined();
  expect(captureChartSources(context, response(partition), results)).toBeUndefined();
  expect(captureChartSources(context, { results }, results)).toBeUndefined();
  const wrongRows = [{ ...results[0], symbol: 'AAPL' }];
  expect(captureChartSources(context, response(live, wrongRows), wrongRows)).toBeUndefined();
  for (const d of [
    { ...live, share_class: 'Class-A' }, { ...live, measures: { ...live.measures, freeFloat: measure } },
    { ...live, measures: { ...live.measures, insiders: { ...measure, as_of: '2026-11-19' } } },
  ]) expect(parseOwnershipSource(d)).toBeUndefined();
  const positive = { ...context, chartSources: captureChartSources(context, response(live), results) };
  expect(datasetFromRows(results, 'backend', 1, 'backend', undefined, [], undefined, positive)
    .provenance.metadata?.chartSources).toEqual({ ownership: live });
  expect(datasetFromRows(results, 'backend', 1, 'backend').provenance.metadata?.chartSources).toBeUndefined();
});
