// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { acquiredOwnershipRows, unsafeOwnershipPartition } from '../../../test/fixtures/ownershipEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { readChartSource, readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { parseOwnershipSource } from '../../widgetData/chartRecipes/ownershipEvidence';
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

it.each(engines)('%s preserves raw ownership conflicts and coordinate omissions through aliased, filtered grandchildren', async (_, make) => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    rows: acquiredOwnershipRows, completeness: 'complete',
    chart_sources: { version: 1, receipts: [unsafeOwnershipPartition] },
  }));
  let input = await datasetFromBytes('ownership.json', bytes, 'root', 1);
  input.columns = input.columns.map(column => column.id === 'bucket_id'
    ? { id: 'bucket_alias', label: 'Bucket', sourceFieldId: 'bucket_id' } : column);
  for (const row of input.rows) {
    row.values.bucket_alias = row.values.bucket_id;
    delete row.values.bucket_id;
  }
  const coordinates = ['symbol', 'share_class', 'bucket_alias', 'as_of', 'denominator'];
  for (const id of ['root', 'child', 'grandchild']) {
    const executor = make(id);
    const revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: id === 'root' ? 'keep this' : '', table: {} },
        { kind: 'none' }, revision, signal);
      input = await presentedSubset(executor, revision);
      const chart = await executor.chartData(revision, [...coordinates, 'reported_share'], signal);
      expect(chart.rows.map(row => row.values.bucket_alias)).toEqual(['control']);
      for (const provenance of [input.provenance, chart.provenance]) {
        expect(readChartSource(provenance, 'ownership', parseOwnershipSource)).toEqual(unsafeOwnershipPartition);
        expect(readChartSourceProjection(provenance, 'ownership')).toEqual({ filtered: true, omitted: ['other'] });
        expect(JSON.stringify(provenance)).not.toMatch(/76\.544|chartSourceCoordinatePlan/);
      }
      const withoutClass = await executor.chartData(revision, coordinates.filter(field => field !== 'share_class'), signal);
      expect(readChartSourceProjection(withoutClass.provenance, 'ownership')).toEqual({
        filtered: true, omitted: ['control', 'other'],
      });
    } finally { executor.dispose(); }
  }
  expect(input.provenance.lineage).toHaveLength(3);
});
