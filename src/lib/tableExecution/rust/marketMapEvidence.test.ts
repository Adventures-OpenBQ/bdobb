// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import file from '../../../test/fixtures/marketMapIndex.json';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;

it.each(engines)('%s retains acquisition conflicts after aliasing, filtering, two links and aggregation', async (_, make) => {
  const clean = file.chart_sources.receipts[0];
  const diagnostics = Object.keys(clean.unsafe);
  const receipt = { ...clean, raw_count: 3, rejected_count: 1, diagnostics, unsafe: Object.fromEntries(diagnostics.map(k => [k, true])) };
  const bytes = new TextEncoder().encode(JSON.stringify({ ...file, rows: [file.rows[0], { ...file.rows[1], change: 0.43217654 }], chart_sources: { version: 1, receipts: [receipt] } }));
  let input = await datasetFromBytes('market.json', bytes, 'root', 1);
  expect(input.provenance.metadata?.chartSources).toEqual({ 'market-map': receipt });
  input.columns = input.columns.map(c => c.id === 'listing' ? { ...c, id: 'listing_alias', sourceFieldId: 'listing' } : c);
  for (const r of input.rows) { r.values.listing_alias = r.values.listing; delete r.values.listing; }
  const signal = new AbortController().signal;
  for (const id of ['root', 'child', 'grandchild', 'aggregate']) {
    const executor = make(id), revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      const table = id === 'aggregate' ? { pivot: { enabled: true, grouping: ['listing_alias'], split: [], aggregationFns: { area: 'sum' as const } } } : {};
      await executor.applyModel({ search: id === 'root' ? 'ALFA.US' : '', table }, { kind: 'none' }, revision, signal);
      let transfer;
      for await (const batch of executor.presented(revision, signal)) {
        transfer ??= beginSubset(batch.transferId, revision);
        appendSubset(transfer, batch);
      }
      input = commitSubset(transfer!);
      const chart = await executor.chartData(revision, input.columns.map(c => c.id), signal);
      const omitted = id === 'aggregate' ? ['ALFA.US', 'BETA.US'] : ['BETA.US'];
      for (const p of [input.provenance, chart.provenance]) {
        expect(p.metadata?.chartSources).toEqual({ 'market-map': receipt });
        expect(readChartSourceProjection(p, 'market-map')).toEqual({ filtered: true, omitted });
        expect(JSON.stringify(p)).not.toMatch(/0\.43217654|chartSourceCoordinatePlan/);
      }
    } finally { executor.dispose(); }
  }
  expect(input.provenance.inputMayContainAggregates).toBe(true);
});
