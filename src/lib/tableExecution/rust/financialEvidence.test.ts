// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { dividendEvidence, dividendRow, incomeEvidence, incomeRow, screenerEvidence } from '../../../test/fixtures/financialEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { createRustExecutor } from './runtime';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import { createWorkerExecutor } from '../workerClient';
import type { LocalWorkerExecutor, Revision } from '../types';
import type { WidgetDataset } from '../../widgetData/types';

const signal = new AbortController().signal;
const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const snapshot = (rows: object[], chart_evidence: unknown) => new TextEncoder().encode(JSON.stringify({ rows, chart_evidence, completeness: 'bounded' }));
async function edited(executor: LocalWorkerExecutor, name: string, input: WidgetDataset | Uint8Array, search = ''): Promise<Revision> {
  if (!('rows' in input)) await executor.importFile('source.json', input, 1, signal);
  else await executor.registerInput(input, 1, signal);
  const revision = { widgetId: name, input: 1, model: 1, output: 1 };
  await executor.applyModel({ search, table: {} }, { kind: 'none' }, revision, signal);
  return revision;
}
async function subset(executor: LocalWorkerExecutor, rev: Revision): Promise<WidgetDataset> {
  let transfer;
  for await (const batch of executor.presented(rev, signal)) {
    transfer ??= beginSubset(batch.transferId, rev);
    appendSubset(transfer, batch);
  }
  return commitSubset(transfer!);
}

it.each(engines)('%s hidden_bad_row_survives_second_link', async (_, make) => {
  const [root, child, grandchild] = ['root', 'child', 'grandchild'].map(make);
  try {
    const rows = [
      { symbol: 'KEEP.US', exchange: 'US', last_day_data_date: '2026-08-28', currency_symbol: '$' },
      { symbol: 'DROP.TO', exchange: 'TO', last_day_data_date: '2026-08-28', currency_symbol: 'CAD' },
    ];
    const chart_evidence = { ...screenerEvidence, raw_count: 2, normalized_count: 2, delivered_count: 2, diagnostics: ['mixed_denomination'],
      cohorts: [{ ...screenerEvidence.cohorts[0], raw_count: 2, denominations: ['CAD', 'USD'] }] };
    const first = await edited(root, 'root', snapshot(rows, chart_evidence), 'KEEP');
    const second = await edited(child, 'child', await subset(root, first));
    const third = await edited(grandchild, 'grandchild', await subset(child, second));
    const chart = await grandchild.chartData(third, ['symbol'], signal);
    expect(chart.rows.map(row => row.values)).toEqual([{ symbol: 'KEEP.US' }]);
    expect(chart.provenance.metadata).toMatchObject({ financialSourceFiltered: true, financialEvidence: {
      raw_count: 2, delivered_count: 2, cohorts: [{ denominations: ['CAD', 'USD'], raw_count: 2 }],
    } });
    expect(chart.provenance.lineage).toHaveLength(2);
  } finally {
    [root, child, grandchild].forEach(worker => worker.dispose());
  }
});

it.each(engines)('%s retains only the coordinate of a removed trailing dividend', async (_, make) => {
  const [root, child, grandchild] = ['root', 'child', 'grandchild'].map(make);
  try {
    const rows = [dividendRow, { ...dividendRow, ex_dividend_date: '2026-05-10', amount: .7, frequency: 'DROP' }];
    const chart_evidence = { ...dividendEvidence, raw_count: 2, normalized_count: 2, delivered_count: 2, event_dates: ['2026-02-12', '2026-05-10'] };
    const first = await edited(root, 'root', snapshot(rows, chart_evidence), 'Special');
    const second = await edited(child, 'child', await subset(root, first));
    const third = await edited(grandchild, 'grandchild', await subset(child, second));
    const chart = await grandchild.chartData(third, ['ex_dividend_date', 'amount'], signal);
    expect(chart.rows.map(row => row.values)).toEqual([{ ex_dividend_date: '2026-02-12', amount: .2 }]);
    expect(chart.provenance.metadata).toMatchObject({ financialEvidence: chart_evidence, financialOmittedEventDates: ['2026-05-10'] });
    expect(JSON.stringify(chart.provenance)).not.toContain('0.7');
  } finally {
    [root, child, grandchild].forEach(worker => worker.dispose());
  }
});

it.each(engines)('%s preserves full-record income coverage at a period-count limit', async (_, make) => {
  const root = make('root');
  try {
    const acquired = await datasetFromBytes('income.json', snapshot([incomeRow], incomeEvidence), 'root', 1);
    const rev = await edited(root, 'root', acquired);
    const chart = await root.chartData(rev, ['period_ending', 'revenue'], signal);
    expect(chart.rows.map(row => row.values)).toEqual([{ period_ending: '2026-06-30', revenue: 100 }]);
    expect(chart.provenance.metadata).toMatchObject({ financialEvidence: {
      requested_limit: 1, available_period_count: 2, periods: [{ period_end: '2026-06-30', record_coverage: 'full-record' }],
    } });
  } finally {
    root.dispose();
  }
});
