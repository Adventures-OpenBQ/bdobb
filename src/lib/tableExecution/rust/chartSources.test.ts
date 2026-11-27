// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { sourceRows, sourceReceipt } from '../../../test/fixtures/chartSources';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromRows } from '../../localTableData';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';
import type { LocalWorkerExecutor, Revision } from '../types';

vi.mock('../../widgetData/chartRecipes/chartSourceRegistry', async () => ({
  chartSourceRegistry: (await import('../../../test/fixtures/chartSources')).fixtureSources,
}));
const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const signal = new AbortController().signal;
async function subset(executor: LocalWorkerExecutor, rev: Revision) {
  let transfer;
  for await (const batch of executor.presented(rev, signal)) {
    transfer ??= beginSubset(batch.transferId, rev);
    appendSubset(transfer, batch);
  }
  return commitSubset(transfer!);
}
it.each(engines)('%s hidden_safety_survives_grandchild and recalculation_drops_presentation_proof', async (_, make) => {
  let input = datasetFromRows(structuredClone(sourceRows), 'root', 1, 'localFile');
  input.provenance.metadata = { chartSources: { metric: sourceReceipt }, chartSourcePresentationProof: { scope: 'invented' } };
  const temporal = { executionId: 'origin-execution', queryId: 'origin-query', queryRevision: 3, resultHash: 'a'.repeat(64) };
  input.provenance.receipt = { temporal };
  input.columns[0] = { id: 'alias', sourceFieldId: 'id', label: 'Other' };
  for (const row of input.rows) {
    row.values.alias = row.values.id;
    delete row.values.id;
  }
  for (const name of ['root', 'child', 'grandchild']) {
    const executor = make(name);
    const revision = { widgetId: name, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: name === 'root' ? 'keep' : '', table: {} }, { kind: 'none' }, revision, signal);
      input = await subset(executor, revision);
      const chart = await executor.chartData(revision, ['alias'], signal);
      expect(chart.rows.map(row => row.values)).toEqual([{ alias: 'keep' }]);
      for (const provenance of [chart.provenance, input.provenance]) {
        expect(provenance.receipt?.temporal).toEqual(temporal);
        expect(provenance.metadata).toMatchObject({
          chartSources: { metric: sourceReceipt }, chartSourceFiltered: true,
          chartSourceOmissions: { metric: ['drop'] }
        });
        expect(provenance.metadata).not.toHaveProperty('chartSourcePresentationProof');
        expect(JSON.stringify(provenance)).not.toContain('777');
      }
      const hidden = await executor.chartData(revision, ['value'], signal);
      expect(hidden.provenance.metadata?.chartSourceOmissions).toEqual({ metric: ['keep', 'drop'] });
    } finally { executor.dispose(); }
  }
  expect(input.provenance.lineage).toHaveLength(3);
});

it.each(engines)('%s aggregate recalculation keeps the raw receipt and omits all source coordinates', async (_, make) => {
  const root = make('grouped');
  const revision = { widgetId: 'grouped', input: 1, model: 1, output: 1 };
  try {
    const input = datasetFromRows(structuredClone(sourceRows), 'grouped', 1, 'localFile');
    input.provenance.metadata = { chartSources: { metric: sourceReceipt }, chartSourcePresentationProof: true };
    await root.registerInput(input, 1, signal);
    await root.applyModel({ search: '', table: { pivot: { enabled: true, grouping: ['id'], split: [], aggregationFns: { value: 'sum' } } } }, { kind: 'none' }, revision, signal);
    const result = await subset(root, revision);
    expect(result.provenance.inputMayContainAggregates).toBe(true);
    expect(result.provenance.metadata).toMatchObject({ chartSources: { metric: sourceReceipt }, chartSourceOmissions: { metric: ['keep', 'drop'] } });
    expect(result.provenance.metadata).not.toHaveProperty('chartSourcePresentationProof');
  } finally { root.dispose(); }
});

it.each(engines)('%s retains only effective viewer checklist and page restrictions across a link', async (_, make) => {
  const keep = JSON.stringify(['string', 'keep']);
  for (const key of ['pivot:filter:category', 'pivot:page']) {
    const baseline = { categoryId: 'category', memberKeys: [keep] };
    const definition = { table: {}, search: '', analytical: {
      schemaVersion: 1 as const, enabled: true,
      params: { promotePage: true, filters: [{ id: 'filter', categoryId: 'category', label: 'ID', multiSelect: true }] },
      categories: [{ id: 'category', name: 'ID', sourceFieldId: 'id', transform: 'native' as const }],
      measures: [], formulas: [], resultFilters: [], subtotals: { grandTotal: false, groups: false },
      checklists: key === 'pivot:page' ? [] : [baseline],
      layout: { rows: [], columns: [], values: [], ...(key === 'pivot:page' ? { page: baseline } : {}) },
    } };
    for (const memberKeys of [null, [keep]]) {
      let input = datasetFromRows(structuredClone(sourceRows), 'root', 1, 'localFile');
      input.provenance.metadata = { chartSources: { metric: sourceReceipt } };
      for (const name of ['root', 'child']) {
        const worker = make(name);
        const revision = { widgetId: name, input: 1, model: 1, output: 1 };
        try {
          await worker.registerInput(input, 1, signal);
          const viewer = { source: 'viewer' as const, memberKeys: name === 'root' ? memberKeys : null };
          await worker.applyModel(definition, { kind: 'none' }, revision, signal, true, undefined, [], { [key]: viewer });
          input = await subset(worker, revision);
          expect(input.rows).toHaveLength(memberKeys === null ? 2 : 1);
          expect(input.provenance.metadata?.chartSources).toEqual({ metric: sourceReceipt });
          expect(input.provenance.metadata?.chartSourceFiltered).toBe(memberKeys === null ? undefined : true);
        } finally {
          worker.dispose();
        }
      }
    }
  }
});
