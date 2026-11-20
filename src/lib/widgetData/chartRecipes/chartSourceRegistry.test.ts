// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { sourceEnvelope, sourceReceipt, sourceRows } from '../../../test/fixtures/chartSources';
import { parseTableSnapshot } from '../../tableRowValues';
import { datasetFromBytes } from '../../localTableData';
import { readChartSource, validatedChartProvenance } from './chartSourceContracts';
vi.mock('./chartSourceRegistry', async () => ({ chartSourceRegistry: (await import('../../../test/fixtures/chartSources')).fixtureSources }));
const snapshot = { rows: sourceRows, chart_sources: sourceEnvelope, completeness: 'bounded' };
it('remote_snapshot_cannot_bypass_request', () => {
  expect(parseTableSnapshot(snapshot)).toEqual({ data: sourceRows, snapshot: { completeness: 'unknown' } });
});
it('accepts a strict explicit local snapshot and checks delivered rows and scope', async () => {
  const parse = (value: unknown) => datasetFromBytes('test.json', new TextEncoder().encode(JSON.stringify(value)), 'x', 1);
  const local = await parse(snapshot);
  expect(local.provenance.metadata?.chartSources).toEqual({ metric: sourceReceipt });
  expect(readChartSource(local.provenance, 'metric', () => sourceReceipt)).toEqual(sourceReceipt);
  for (const invalid of [{ ...snapshot, rows: [sourceRows[1]] }, { ...snapshot, completeness: 'sample' }, { ...snapshot, proof: true }])
    await expect(parse(invalid)).rejects.toThrow('Could not parse local table');
});
it('revalidates raw facts and monotonic omission supplements on read', () => {
  const base = { sourceWidgetId: 'x', metadata: { chartSources: { metric: sourceReceipt } } };
  for (const extra of [{ chartSourceFiltered: false }, { chartSourceOmissions: { metric: ['invented'] } },
  { chartSourceOmissions: { other: [] } }, { chartSourceOmissions: { metric: ['keep', 'keep'] } }]) {
    const provenance = { ...base, metadata: { ...base.metadata, ...extra } };
    expect(readChartSource(provenance, 'metric', () => sourceReceipt)).toBeUndefined();
    expect(validatedChartProvenance(provenance).metadata).not.toHaveProperty('chartSources');
  }
});

it('exposes only validated presentation restrictions and treats accessors as invalid input', async () => {
  const { readChartSourceProjection } = await import('./chartSourceContracts');
  const base = { sourceWidgetId: 'x', metadata: { chartSources: { metric: sourceReceipt }, chartSourceOmissions: { metric: ['drop'] }, chartSourceFiltered: true } };
  expect(readChartSourceProjection(base, 'metric')).toEqual({ filtered: true, omitted: ['drop'] });
  const metadata = { get chartSources(): never { throw Error('getter ran'); } };
  expect(readChartSource({ sourceWidgetId: 'x', metadata }, 'metric', () => sourceReceipt)).toBeUndefined();
});

it('refuses a label alias, ambiguous bindings and calculated coordinates', async () => {
  const { projectChartSources } = await import('./chartSourceContracts');
  const base = { sourceWidgetId: 'x', metadata: { chartSources: { metric: sourceReceipt } } };
  const rows = [{ id: 'r', values: { id: 'keep', alias: 'keep' } }];
  for (const columns of [
    [{ id: 'alias', label: 'id' }],
    [{ id: 'id', label: 'id' }, { id: 'alias', sourceFieldId: 'id', label: 'alias' }],
    [{ id: 'alias', label: 'id', sourceFieldId: 'id', measureId: 'calculated' }],
  ]) expect(projectChartSources(base, columns, rows).metadata?.chartSourceOmissions).toEqual({ metric: ['keep', 'drop'] });
});

it('requires completed request facts when rechecking a backend acquisition beside edited rows', async () => {
  const { datasetFromRows } = await import('../../localTableData');
  const { sourcePath } = await import('../../../test/fixtures/chartSources');
  const source = {
    chartSources: { metric: sourceReceipt }, endpoint: sourcePath, selector: 'results.rows',
    parameters: { symbol: 'A', chart_source: 'true' }, retrievedAt: 1
  };
  const make = (context: typeof source, rows = sourceRows) =>
    datasetFromRows(structuredClone(rows), 'x', 1, 'backend', undefined, [], undefined, context).provenance.metadata?.chartSources;
  expect(make(source)).toEqual(source.chartSources);
  expect(make({ ...source, endpoint: '/wrong' })).toBeUndefined();
  expect(make({ ...source, parameters: { symbol: 'A', chart_source: 'false' } })).toBeUndefined();
  expect(make(source, [...sourceRows].reverse())).toBeUndefined();
});
