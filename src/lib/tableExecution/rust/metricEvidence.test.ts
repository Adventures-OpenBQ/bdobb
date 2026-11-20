// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { liveMetricReceipt, liveMetricRows, metricReceipt, metricRows } from '../../../test/fixtures/metricEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { captureChartSources, readChartSource, readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { parseMetricSource } from '../../widgetData/chartRecipes/metricEvidence';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import type { LocalWorkerExecutor, Revision } from '../types';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const signal = new AbortController().signal;

async function presentedSubset(executor: LocalWorkerExecutor, revision: Revision) {
  let transfer;
  for await (const batch of executor.presented(revision, signal)) {
    transfer ??= beginSubset(batch.transferId, revision);
    appendSubset(transfer, batch);
  }
  return commitSubset(transfer!);
}

it.each(engines)('%s keeps raw metric conflicts and coordinate-only omissions through aliased filtered grandchildren', async (_, make) => {
  const receipt = { ...metricReceipt, raw_count: 3, diagnostics: ['period_conflict'],
    unsafe: { ...metricReceipt.unsafe, period_conflict: true } };
  const bytes = new TextEncoder().encode(JSON.stringify({ rows: metricRows, completeness: 'complete',
    chart_sources: { version: 1, receipts: [receipt] } }));
  let input = await datasetFromBytes('metric.json', bytes, 'root', 1);
  input.columns = input.columns.map(column => column.id === 'observation_id'
    ? { id: 'obs_alias', label: 'Vintage observation', sourceFieldId: 'observation_id' } : column);
  for (const row of input.rows) {
    row.values.obs_alias = row.values.observation_id;
    delete row.values.observation_id;
  }
  for (const id of ['root', 'child', 'grandchild']) {
    const executor = make(id);
    const revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: id === 'root' ? 'revised-report' : '', table: {} }, { kind: 'none' }, revision, signal);
      input = await presentedSubset(executor, revision);
      const fields = input.columns.map(column => column.id);
      const chart = await executor.chartData(revision, fields, signal);
      expect(chart.rows.map(row => row.values.obs_alias)).toEqual(['revised-report']);
      for (const provenance of [input.provenance, chart.provenance]) {
        expect(readChartSource(provenance, 'metric', parseMetricSource)).toEqual(receipt);
        expect(readChartSourceProjection(provenance, 'metric')).toEqual({ filtered: true, omitted: ['first-report'] });
        expect(JSON.stringify(provenance)).not.toMatch(/76\.544|chartSourceCoordinatePlan/);
      }
      const noClass = await executor.chartData(revision, fields.filter(field => field !== 'share_class'), signal);
      expect(readChartSourceProjection(noClass.provenance, 'metric')?.omitted.sort()).toEqual(['first-report', 'revised-report']);
    } finally { executor.dispose(); }
  }
  expect(input.provenance.lineage).toHaveLength(3);
});

it.each(engines)('%s carries two unknown-as-of live headlines through wide-row grandchildren only from completed acquisition', async (_, make) => {
  const context = { endpoint: '/api/v1/eodhd/equity/fundamental/metrics', selector: 'results',
    parameters: { chart_source: 'true', symbol: 'AAPL' }, retrievedAt: 1 };
  const chartSources = captureChartSources(context, { results: liveMetricRows,
    extra: { results_metadata: { chart_sources: { version: 1, receipts: [liveMetricReceipt] } } } }, liveMetricRows);
  expect(chartSources).toBeDefined();
  for (const local of [true, false]) {
    let input = local ? datasetFromRows(liveMetricRows, 'local', 1, 'localFile', undefined, [], { chartSources, completeness: 'complete' })
      : datasetFromRows(liveMetricRows, 'metrics', 1, 'backend', undefined, [], undefined, { ...context, chartSources });
    for (const id of ['root', 'child', 'grandchild']) {
      const executor = make(id);
      const revision = { widgetId: id, input: 1, model: 1, output: 1 };
      try {
        await executor.registerInput(input, 1, signal);
        await executor.applyModel({ search: '', table: {} }, { kind: 'none' }, revision, signal);
        input = await presentedSubset(executor, revision);
        expect(readChartSource(input.provenance, 'metric', parseMetricSource)).toEqual(local ? undefined : liveMetricReceipt);
        if (!local) {
          const noVintage = await executor.chartData(revision, ['symbol', 'pe_ratio'], signal);
          expect(readChartSourceProjection(noVintage.provenance, 'metric')?.omitted.sort())
            .toEqual([liveMetricReceipt.metrics.dividend_yield.observation_id, liveMetricReceipt.metrics.pe_ratio.observation_id]);
        }
      } finally { executor.dispose(); }
    }
  }
});
