// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import files from '../../../test/fixtures/overlaySnapshots.json';
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

it.each(engines)('%s retains pre-drop conflicts and per-series omissions through a linked grandchild and aggregate', async (_, make) => {
  const file = files['price-eps'], clean = file.chart_sources.receipts[0];
  const source = { ...clean, raw_count: 3, unsafe: { ...clean.unsafe, basis_conflict: true }, diagnostics: ['basis_conflict'] };
  const bytes = new TextEncoder().encode(JSON.stringify({ ...file, chart_sources: { version: 1, receipts: [source] } }));
  let input = await datasetFromBytes('pair.json', bytes, 'acquisition', 1);
  expect(input.provenance.metadata?.chartSources).toEqual({ overlay: source });
  input.columns = input.columns.map(c => c.id === 'series' ? { ...c, id: 'series_alias', sourceFieldId: 'series' } : c);
  for (const r of input.rows) {
    r.values.series_alias = r.values.series;
    delete r.values.series;
  }
  const signal = new AbortController().signal;
  const leftId = 'adjusted_close|2026-11-02', rightId = 'reported_diluted_eps|2026-11-02T21:02:01.123456Z';
  for (const id of ['root', 'child', 'grandchild', 'aggregate']) {
    const executor = make(id), revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      const table = id === 'aggregate' ? { pivot: { enabled: true, grouping: ['series_alias', 'date'], split: [], aggregationFns: { value: 'sum' as const } } } : {};
      await executor.applyModel({ search: id === 'root' ? 'adjusted_close' : '', table }, { kind: 'none' }, revision, signal);
      let transfer;
      for await (const batch of executor.presented(revision, signal)) {
        transfer ??= beginSubset(batch.transferId, revision);
        appendSubset(transfer, batch);
      }
      input = commitSubset(transfer!);
      const fields = id === 'aggregate' ? input.columns.map(c => c.id) : ['series_alias', 'date', 'available_at', 'value'];
      const chart = await executor.chartData(revision, fields, signal);
      for (const p of [input.provenance, chart.provenance]) {
        expect(p.metadata?.chartSources).toEqual({ overlay: source });
        expect(readChartSourceProjection(p, 'overlay')).toEqual({ filtered: true, omitted: id === 'aggregate' ? [leftId, rightId] : [rightId] });
        expect(JSON.stringify(p)).not.toMatch(/1\.98765|chartSourceCoordinatePlan/);
      }
      if (id !== 'aggregate') expect(chart.rows.map(r => r.values.series_alias)).toEqual(['adjusted_close']);
    } finally { executor.dispose(); }
  }
  expect(input.provenance.inputMayContainAggregates).toBe(true);
});
