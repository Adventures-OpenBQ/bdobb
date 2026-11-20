// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { context, extremeRows, extremeSource, rawUnsafe, rows } from '../../../test/fixtures/etfHierarchyEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromRows } from '../../localTableData';
import { captureChartSources, readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;

describe.each([
  { scenario: 'dropped raw conflicts', source: rawUnsafe, acquired: rows },
  { scenario: 'finite weights above the sum range', source: extremeSource, acquired: extremeRows },
])('$scenario', ({ source, acquired: rows }) => {
  const hidden = source.holding_keys.filter(symbol => symbol !== 'AAPL.US');
  it.each(engines)('%s keeps pre-drop unsafe facts after aliases, filtering and grandchild re-projection', async (_, make) => {
    const signal = new AbortController().signal;
    const result = { results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [source] } } } };
    const chartSources = captureChartSources(context, result, rows);
    expect(chartSources).toEqual({ 'etf-hierarchy': source });
    let input = datasetFromRows(structuredClone(rows), 'root', 1, 'backend', undefined, [], undefined, { ...context, chartSources });
    input.columns = input.columns.map(c => c.id === 'symbol' ? { ...c, id: 'ticker_alias', sourceFieldId: 'symbol' } : c);
    for (const row of input.rows) {
      row.values.ticker_alias = row.values.symbol;
      delete row.values.symbol;
    }
    for (const id of ['root','child','grandchild']) {
      const worker = make(id);
      const revision = { widgetId: id, input: 1, model: 1, output: 1 };
      try {
        await worker.registerInput(input, 1, signal);
        await worker.applyModel({ search: id === 'root' ? 'keep this' : '', table: {} }, { kind: 'none' }, revision, signal);
        let transfer;
        for await (const batch of worker.presented(revision, signal)) {
          transfer ??= beginSubset(batch.transferId, revision);
          appendSubset(transfer, batch);
        }
        input = commitSubset(transfer!);
        const fields = ['fund_symbol', 'snapshot', 'ticker_alias', 'sector', 'weight'];
        const chart = await worker.chartData(revision, fields, signal);
        expect(chart.rows.map(r => r.values.ticker_alias)).toEqual(['AAPL.US']);
        for (const p of [input.provenance, chart.provenance]) {
          expect(readChartSourceProjection(p, 'etf-hierarchy')).toEqual({ filtered: true, omitted: hidden });
          expect(p.metadata?.chartSources).toEqual({ 'etf-hierarchy': source });
          expect(JSON.stringify(p)).not.toMatch(/0\.002345|1\.7e\+306|chartSourceCoordinatePlan/);
        }
        const incomplete = await worker.chartData(revision, fields.filter(f => f !== 'snapshot'), signal);
        expect(readChartSourceProjection(incomplete.provenance, 'etf-hierarchy')?.omitted).toEqual(source.holding_keys);
      } finally { worker.dispose(); }
    }
    expect(input.provenance.lineage).toHaveLength(3);
  });
});

it.each(engines)('%s keeps raw acquisition scope and removes every constituent coordinate from an aggregate', async (_, make) => {
  const signal = new AbortController().signal;
  const result = { results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [rawUnsafe] } } } };
  const chartSources = captureChartSources(context, result, rows);
  const input = datasetFromRows(structuredClone(rows), 'root', 1, 'backend', undefined, [], undefined, { ...context, chartSources });
  const executor = make('aggregate');
  const revision = { widgetId: 'aggregate', input: 1, model: 1, output: 1 };
  try {
    await executor.registerInput(input, 1, signal);
    await executor.applyModel({ search: '', table: { pivot: {
      enabled: true, grouping: ['fund_symbol','snapshot','symbol'], split: [], aggregationFns: { weight: 'sum' },
    } } }, { kind: 'none' }, revision, signal);
    let transfer;
    for await (const batch of executor.presented(revision, signal)) {
      transfer ??= beginSubset(batch.transferId, revision);
      appendSubset(transfer, batch);
    }
    const p = commitSubset(transfer!).provenance;
    expect(p.inputMayContainAggregates).toBe(true);
    expect(p.metadata?.chartSources).toEqual({ 'etf-hierarchy': rawUnsafe });
    expect(readChartSourceProjection(p, 'etf-hierarchy')?.omitted).toEqual(['AAPL.US','AAYA.F']);
  } finally { executor.dispose(); }
});
