// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { dailyPriceRows } from '../../widgetData/chartRecipes/fixtures';
import { admitReturnSummary, prepareSelectedPrices } from '../../widgetData/chartRecipes/priceSamples';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import type { LocalWorkerExecutor, Revision } from '../types';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const signal = new AbortController().signal;
const fields = { date: 'session', price: 'adjusted', symbol: 'listing' };
const rows = dailyPriceRows([100, 200, 765432.12345, 400, 800, 1600, 3200, 6400, 12800, 987654.321], 'AAA.US')
  .map((row, i) => ({ ...row, symbol: i === 9 ? 'BBB.US' : row.symbol, currency: 'USD',
    observation_date: '2026-01-31', ticker: i === 2 ? ' AAA.US ' : i === 9 ? 'BBB.US' : row.symbol, tag: i === 2 || i === 9 ? 'root-drop' : i === 8 ? 'keep child-drop' : 'keep always' }));
type Variants = 'safe' | 'conflicting duplicate' | 'instrument alias conflict' | 'out-of-window date';
const receipt = { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' };

async function linkedChart(make: (id: string) => LocalWorkerExecutor, variant: Variants) {
  const inputRows = structuredClone(rows);
  if (variant === 'conflicting duplicate') inputRows[2].date = inputRows[1].date;
  if (variant === 'instrument alias conflict') inputRows[2].ticker = 'BBB.US';
  if (variant === 'out-of-window date') inputRows[2].date = '2025-12-31';
  const bytes = new TextEncoder().encode(JSON.stringify({ rows: inputRows, receipt, completeness: 'bounded' }));
  let input = await datasetFromBytes('prices.json', bytes, 'root', 1);
  for (const [origin, alias] of [['date', fields.date], ['adjusted_close', fields.price], ['ticker', fields.symbol]]) {
    input.columns = input.columns.map(column => column.id === origin ? { ...column, id: alias, sourceFieldId: origin } : column);
    for (const row of input.rows) {
      row.values[alias] = row.values[origin];
      delete row.values[origin];
    }
  }
  const executors = ['root', 'child', 'grandchild'].map(make);
  try {
    for (const [index, executor] of executors.entries()) {
      const revision: Revision = { widgetId: ['root', 'child', 'grandchild'][index], input: 1, model: 1, output: 1 };
      await executor.registerInput(input, 1, signal);
      const table = index === 0 ? { hidden: ['symbol', 'currency'], columnFilters: [{ id: 'tag', value: 'keep' }] } : {};
      await executor.applyModel({ search: index === 1 ? 'keep always' : '', table }, { kind: 'none' }, revision, signal);
      if (index === 2) {
        const chart = await executor.chartData(revision, Object.values(fields), signal);
        return chart;
      }
      let transfer;
      for await (const batch of executor.presented(revision, signal)) {
        transfer ??= beginSubset(batch.transferId, revision);
        appendSubset(transfer, batch);
      }
      input = commitSubset(transfer!);
      expect(JSON.stringify(input.provenance)).not.toContain('priceCoordinatePlan');
    }
    throw new Error('Missing grandchild');
  } finally { executors.forEach(executor => executor.dispose()); }
}

it.each(engines)('%s accumulates coordinate-only omissions without joining across filtered gaps', async (_, make) => {
  const chart = await linkedChart(make, 'safe');
  expect(chart.provenance.lineage).toHaveLength(2);
  expect(chart.completeness.acquiredRowCount).toBe(10);
  expect(chart.provenance.metadata?.priceOmissions).toMatchObject({
    acquired: 10, delivered: 7, dateField: 'session', symbolFields: ['listing'],
    points: [['AAA.US', '2026-01-03'], ['BBB.US', '2026-01-10'], ['AAA.US', '2026-01-09']],
  });
  expect(chart.rows.map(row => row.values.session)).toEqual(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']);
  expect(JSON.stringify(chart.provenance)).not.toMatch(/765432\.12345|987654\.321|priceCoordinatePlan/);
  const result = admitReturnSummary(chart, fields, ['AAA.US'], { mode: 'own' });
  if (!result.ok) throw new Error(result.message);
  expect(result.value.series[0]).toMatchObject({
    samples: [2, 5, 6, 7, 8].map(day => ({ date: `2026-01-0${day}`, value: 1 })),
    gapCount: 2, excludedOpportunities: 3,
  });
});

it.each(engines)('%s retains a hidden duplicate conflict, alias conflict and invalid date through linked recalculation', async (_, make) => {
  for (const [variant, message] of [
    ['conflicting duplicate', /conflicting duplicate/i],
    ['instrument alias conflict', /mixed or missing price symbol/i],
    ['out-of-window date', /out-of-window|continuity/i],
  ] as const) {
    const chart = await linkedChart(make, variant);
    expect(chart.rows.map(row => row.values.listing)).toEqual(Array(7).fill('AAA.US'));
    expect(prepareSelectedPrices(chart, fields, ['AAA.US'])).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(message) });
  }
});

it.each(engines)('%s denies admission after grouping acquired daily observations', async (_, make) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ rows, receipt, completeness: 'bounded' }));
  const root = make('root');
  const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
  try {
    await root.importFile('prices.json', bytes, 1, signal);
    await root.applyModel({ search: '', table: { pivot: {
      enabled: true, grouping: ['symbol', 'date'], split: [], aggregationFns: { adjusted_close: 'sum' },
    } } }, { kind: 'none' }, revision, signal);
    let transfer;
    for await (const batch of root.presented(revision, signal)) {
      transfer ??= beginSubset(batch.transferId, revision);
      appendSubset(transfer, batch);
    }
    const subset = commitSubset(transfer!);
    expect(subset.provenance.inputMayContainAggregates).toBe(true);
    expect(subset.provenance.metadata).not.toHaveProperty('priceOmissions');
    expect(admitReturnSummary(subset, { date: 'date', price: 'adjusted_close', symbol: 'symbol' }, ['AAA.US'], { mode: 'own' }))
      .toMatchObject({ ok: false, refused: true });
  } finally { root.dispose(); }
});
