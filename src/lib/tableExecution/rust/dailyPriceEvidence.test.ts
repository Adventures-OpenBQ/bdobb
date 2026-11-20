// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { dailyPriceParameters } from '../../../test/fixtures/chartSources';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { readLiveDailyPriceSource } from '../../widgetData/chartRecipes/dailyPriceEvidence';
import { admitReturnSummary } from '../../widgetData/chartRecipes/priceSamples';
import type { PriceBindings } from '../../widgetData/chartRecipes/types';
import type { WidgetDataset } from '../../widgetData/types';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import type { LocalWorkerExecutor, Revision } from '../types';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const signal = new AbortController().signal;
const date = (day: number) => `2026-10-${day}`;
const symbol = 'AAA.US';
const peer = 'BBB.US';
const bounds = { start_date: dailyPriceParameters.start_date, end_date: dailyPriceParameters.end_date };
const own = { mode: 'own' } as const;
const firstFilteredPrice = 765432.12345;
const secondFilteredPrice = 987654.321;
const rows = [
  { date: date(13), adjusted_close: 100 }, { date: date(15), adjusted_close: 121 },
  { date: date(16), adjusted_close: 242 }, { date: date(19), adjusted_close: 484 },
  { date: date(20), adjusted_close: firstFilteredPrice }, { date: date(21), adjusted_close: 968 },
  { date: date(22), adjusted_close: 1936 }, { date: date(23), adjusted_close: 3872 },
  { date: date(26), adjusted_close: secondFilteredPrice }, { date: date(27), adjusted_close: 7744 },
  { date: date(28), adjusted_close: 15488 }, { date: date(29), adjusted_close: 30976 },
].map(row => ({ ...row, tag: row.date === date(20) ? 'removed at root' : row.date === date(26) ? 'kept until child' : 'kept always' }));
const omissions: [string, string][] = [[symbol, date(14)]];

const singleFields = { date: 'session', price: 'adjusted' };
const multiFields = { ...singleFields, symbol: 'listing' };
const nativeFields = { date: 'date', price: 'adjusted_close' };

function aliasColumns(input: WidgetDataset, fields: PriceBindings) {
  const aliases = new Map([['date', fields.date], ['adjusted_close', fields.price], ['symbol', fields.symbol]]);
  input.columns = input.columns.map(column => {
    const id = aliases.get(column.id);
    return id ? { ...column, id, label: id, sourceFieldId: column.id } : column;
  });
  for (const row of input.rows) {
    for (const [original, alias] of aliases) {
      if (!alias) continue;
      row.values[alias] = row.values[original];
      delete row.values[original];
    }
  }
}

async function linkedSubset(executor: LocalWorkerExecutor, revision: Revision) {
  let transfer;
  for await (const batch of executor.presented(revision, signal)) {
    transfer ??= beginSubset(batch.transferId, revision);
    appendSubset(transfer, batch);
  }
  return commitSubset(transfer!);
}

describe.each(engines)('%s daily-price evidence', (_, make) => {
  it.each([false, true])('retains raw and projected omissions through a linked grandchild (multiple listings: %s)', async multiple => {
    const selected = multiple ? [peer, symbol] : [symbol];
    const fields: PriceBindings = multiple ? multiFields : singleFields;
    const inputRows = multiple
      ? [...rows.map(row => ({ ...row, symbol })), ...rows.slice(0, 1).map(row => ({ ...row, symbol: peer }))]
      : rows;
    let input = liveDailyPriceDataset(inputRows, selected, { bounds, omissions });
    const delivered = inputRows.map(row => ['symbol' in row ? row.symbol : symbol, row.date]);
    aliasColumns(input, fields);
    const columnOrder = Object.values(fields).reverse();
    const names = ['root', 'child', 'grandchild'];
    for (const [index, widgetId] of names.entries()) {
      const executor = make(widgetId);
      const revision: Revision = { widgetId, input: 1, model: 1, output: 1 };
      try {
        await executor.registerInput(input, 1, signal);
        const table = index === 0 ? { columnOrder, columnFilters: [{ id: 'tag', value: 'kept' }] } : {};
        await executor.applyModel({ search: index === 1 ? 'kept always' : '', table }, { kind: 'none' }, revision, signal);
        const chart = await executor.chartData(revision, columnOrder, signal);
        const omittedDates = index === 0 ? [date(20)] : [date(20), date(26)];
        const expectedOmissions = omittedDates.map(day => JSON.stringify([symbol, day]));
        expect(readLiveDailyPriceSource(chart)).toMatchObject({ symbols: selected, rawOmissions: omissions });
        expect(readChartSourceProjection(chart.provenance, 'daily-price')).toEqual({ filtered: true, omitted: expectedOmissions });
        expect(chart.completeness).toMatchObject({ kind: 'unknown', acquiredRowCount: inputRows.length });
        expect(chart.provenance.metadata?.dailyPriceCoordinates).toEqual(delivered);
        expect(JSON.stringify(chart.provenance)).not.toMatch(/765432\.12345|987654\.321|chartSourceCoordinatePlan|priceOmissions/);
        if (index < 2) {
          input = await linkedSubset(executor, revision);
          expect(input.columns.slice(0, columnOrder.length).map(column => column.id)).toEqual(columnOrder);
          expect(readLiveDailyPriceSource(input)).toMatchObject({ rawOmissions: omissions });
          expect(readChartSourceProjection(input.provenance, 'daily-price')?.omitted).toEqual(expectedOmissions);
          continue;
        }
        expect(chart.provenance.lineage).toHaveLength(2);
        expect(chart.columns.map(column => [column.id, column.sourceFieldId])).toEqual(columnOrder.map(alias => [
          alias, alias === fields.date ? 'date' : alias === fields.price ? 'adjusted_close' : 'symbol',
        ]));
        expect(chart.rows.filter(row => !fields.symbol || row.values[fields.symbol] === symbol).map(row => row.values.session))
          .toEqual([13, 15, 16, 19, 21, 22, 23, 27, 28, 29].map(date));
        const result = admitReturnSummary(chart, fields, [symbol], own);
        if (!result.ok) throw new Error(result.message);
        expect(result.value.series[0]).toMatchObject({
          samples: [16, 19, 22, 23, 28, 29].map(day => ({ date: date(day), value: 1 })),
          gapCount: 3, excludedOpportunities: 6,
        });
        expect(result.notes).toEqual(expect.arrayContaining([
          expect.stringMatching(/1.*provider/i), expect.stringMatching(/2.*table/i),
        ]));
      } finally { executor.dispose(); }
    }
  });

  it.each(['raw conflicting duplicate', 'mixed listing identity', 'ambiguous date origins', 'ambiguous price origins', 'aggregate'] as const)(
    'refuses %s after table presentation', async variant => {
      const conflicting = variant === 'raw conflicting duplicate';
      const mixed = variant === 'mixed listing identity';
      const original = mixed ? rows.map((row, index) => index === 4 ? { ...row, ticker: peer } : row) : rows;
      const withConflict = [...original, { ...rows[0], adjusted_close: 999, tag: 'removed at root' }];
      const input = liveDailyPriceDataset(conflicting ? withConflict : original, [symbol], {
        bounds, omissions, unsafe: conflicting ? { conflicting_duplicates: true } : {},
      });
      if (variant === 'ambiguous date origins' || variant === 'ambiguous price origins') {
        const field = variant === 'ambiguous date origins' ? 'date' : 'adjusted_close';
        input.columns.push({ id: 'copy', label: 'Copy', sourceFieldId: field });
        for (const row of input.rows) row.values.copy = row.values[field];
      }
      const executor = make('root');
      const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
      try {
        await executor.registerInput(input, 1, signal);
        const table = variant === 'aggregate'
          ? { pivot: { enabled: true, grouping: ['date'], split: [], aggregationFns: { adjusted_close: 'sum' as const } } }
          : { columnFilters: [{ id: 'tag', value: 'kept' }] };
        await executor.applyModel({ search: '', table }, { kind: 'none' }, revision, signal);
        const chart = variant === 'aggregate' ? await linkedSubset(executor, revision)
          : await executor.chartData(revision, Object.values(nativeFields), signal);
        expect(chart.rows.length).toBeGreaterThan(6);
        if (conflicting || mixed) {
          expect(chart.rows.some(row => row.values.adjusted_close === 999 || row.values.adjusted_close === firstFilteredPrice)).toBe(false);
          expect(chart.provenance.metadata?.chartSources).toBeUndefined();
        }
        if (variant === 'aggregate') expect(chart.provenance.inputMayContainAggregates).toBe(true);
        expect(readLiveDailyPriceSource(chart)).toBeUndefined();
        expect(admitReturnSummary(chart, nativeFields, [symbol], own)).toMatchObject({ ok: false, refused: true });
      } finally { executor.dispose(); }
    },
  );
});
