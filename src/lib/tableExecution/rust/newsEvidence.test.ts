// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { newsReceipt, newsSnapshot } from '../../../test/fixtures/newsEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
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

it.each(engines)('%s preserves acquired unsafe news through an alias, filter and linked grandchild', async (_, make) => {
  const bytes = new TextEncoder().encode(JSON.stringify(newsSnapshot));
  let input = await datasetFromBytes('news.json', bytes, 'root', 1);
  input.columns = input.columns.map(column => column.id === 'url'
    ? { id: 'article', label: 'Article link', sourceFieldId: 'url' } : column);
  for (const row of input.rows) {
    row.values.article = row.values.url;
    delete row.values.url;
  }
  const kept = newsReceipt.coordinates[0].article_id;
  const hidden = newsReceipt.coordinates.slice(1).map(coordinate => coordinate.article_id);
  for (const id of ['root', 'child', 'grandchild']) {
    const executor = make(id);
    const revision = { widgetId: id, input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: id === 'root' ? 'keep this' : '', table: {} }, { kind: 'none' }, revision, signal);
      input = await presentedSubset(executor, revision);
      const chart = await executor.chartData(revision, ['article', 'polarity'], signal);
      expect(chart.rows.map(row => row.values)).toEqual([{ article: kept, polarity: 0 }]);
      for (const provenance of [input.provenance, chart.provenance]) {
        expect(provenance.metadata?.chartSources).toEqual({ news: newsReceipt });
        expect(readChartSourceProjection(provenance, 'news')).toEqual({ filtered: true, omitted: hidden });
        expect(JSON.stringify(provenance)).not.toMatch(/0\.7654321|synthetic body|chartSourceCoordinatePlan/);
      }
      const withoutArticle = await executor.chartData(revision, ['polarity'], signal);
      expect(readChartSourceProjection(withoutArticle.provenance, 'news')).toEqual({
        filtered: true, omitted: newsReceipt.coordinates.map(coordinate => coordinate.article_id),
      });
    } finally { executor.dispose(); }
  }
  expect(input.provenance.lineage).toHaveLength(3);
});

it.each(engines)('%s pivot aggregation can never witness raw article identity', async (_, make) => {
  const bytes = new TextEncoder().encode(JSON.stringify(newsSnapshot));
  const input = await datasetFromBytes('news.json', bytes, 'root', 1);
  const executor = make('pivot');
  const revision = { widgetId: 'pivot', input: 1, model: 1, output: 1 };
  try {
    await executor.registerInput(input, 1, signal);
    await executor.applyModel({ search: '', table: { pivot: {
      enabled: true, grouping: ['url'], split: [], aggregationFns: { polarity: 'sum' },
    } } }, { kind: 'none' }, revision, signal);
    const result = await presentedSubset(executor, revision);
    expect(result.provenance.inputMayContainAggregates).toBe(true);
    expect(result.provenance.metadata?.chartSources).toEqual({ news: newsReceipt });
    expect(readChartSourceProjection(result.provenance, 'news')?.omitted)
      .toEqual(newsReceipt.coordinates.map(coordinate => coordinate.article_id));
  } finally { executor.dispose(); }
});
