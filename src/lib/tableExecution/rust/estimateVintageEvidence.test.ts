// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import file from '../../../test/fixtures/estimateVintageSnapshot.json';
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
  const receipt = { ...clean, raw_count: 7, diagnostics, unsafe: Object.fromEntries(diagnostics.map(k => [k, true])) };
  const bytes = new TextEncoder().encode(JSON.stringify({ ...file, chart_sources: { version: 1, receipts: [receipt] } }));
  let input = await datasetFromBytes('estimates.json', bytes, 'root', 1);
  expect(input.provenance.metadata?.chartSources).toEqual({ 'estimate-vintages': receipt });
  input.columns = input.columns.map(c => c.id === 'issuer' ? { ...c, id: 'issuer_alias', sourceFieldId: 'issuer' } : c);
  for (const r of input.rows) { r.values.issuer_alias = r.values.issuer; delete r.values.issuer; }
  const signal = new AbortController().signal;
  for (const id of ['root', 'child', 'grandchild', 'aggregate']) {
    const executor = make(id), revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      const table = id === 'aggregate' ? { pivot: { enabled: true, grouping: ['issuer_alias'], split: [], aggregationFns: { value: 'sum' as const } } } : {};
      await executor.applyModel({ search: id === 'root' ? 'ALFA.US' : '', table }, { kind: 'none' }, revision, signal);
      let transfer;
      for await (const batch of executor.presented(revision, signal)) {
        transfer ??= beginSubset(batch.transferId, revision);
        appendSubset(transfer, batch);
      }
      input = commitSubset(transfer!);
      const chart = await executor.chartData(revision, input.columns.map(c => c.id), signal);
      const omitted = receipt.coordinates.filter(c => id === 'aggregate' || c.issuer === 'BETA.CA')
        .map(c => [c.issuer, '2027-01-01', '2027-03-31', 'FQ', c.vintage].join('|'));
      for (const p of [input.provenance, chart.provenance]) {
        expect(p.metadata?.chartSources).toEqual({ 'estimate-vintages': receipt });
        expect(readChartSourceProjection(p, 'estimate-vintages')).toEqual({ filtered: true, omitted });
        expect(JSON.stringify(p)).not.toMatch(/2\.67543|chartSourceCoordinatePlan/);
      }
    } finally { executor.dispose(); }
  }
  expect(input.provenance.inputMayContainAggregates).toBe(true);
});
