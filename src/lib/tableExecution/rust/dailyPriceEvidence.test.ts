// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { backend, widget } from '../../../test/fixtures';
import { dailyPriceParameters } from '../../../test/fixtures/chartSources';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { startMockServer } from '../../../test/mockServer';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { fetchWidgetData } from '../../dataClient';
import { collectPresentedExport, toJsonRows } from '../../export';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { LABEL_FIELD } from '../../pivotTable';
import { parseTableSnapshot, tableRows } from '../../tableRowValues';
import { readChartSourceProjection } from '../../widgetData/chartRecipes/chartSourceContracts';
import { readLiveDailyPriceSource } from '../../widgetData/chartRecipes/dailyPriceEvidence';
import type { BackendAcquisition } from '../../widgetData/chartRecipes/financialEvidence';
import { admitReturnSummary } from '../../widgetData/chartRecipes/priceSamples';
import { runRecipe } from '../../widgetData/chartRecipes/run';
import type { PriceBindings, RecipeOptions, ReturnSummaryOptions } from '../../widgetData/chartRecipes/types';
import type { WidgetDataset } from '../../widgetData/types';
import { appendSubset, beginSubset, commitSubset } from '../subsetTransfer';
import type { LocalWorkerExecutor, Revision } from '../types';
import { createWorkerExecutor } from '../workerClient';
import { createRustExecutor } from './runtime';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

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
const finalFilteredPrice = 456789.654321;
const rows = [
  { date: date(13), adjusted_close: 100 }, { date: date(15), adjusted_close: 25 },
  { date: date(16), adjusted_close: 50 }, { date: date(19), adjusted_close: 100 },
  { date: date(20), adjusted_close: firstFilteredPrice }, { date: date(21), adjusted_close: 25 },
  { date: date(22), adjusted_close: 50 }, { date: date(23), adjusted_close: 100 },
  { date: date(26), adjusted_close: secondFilteredPrice }, { date: date(27), adjusted_close: 200 },
  { date: date(28), adjusted_close: 400 }, { date: date(29), adjusted_close: 800 },
].map(row => ({ ...row, tag: row.date === date(20) ? 'removed at root' : row.date === date(26) ? 'kept until child' : 'kept always' }));
const peerRows = [
  { date: date(12), adjusted_close: 400, tag: 'kept always' },
  { date: date(13), adjusted_close: 200, tag: 'kept always' },
  { date: date(19), adjusted_close: 100, tag: 'kept always' },
  { date: date(27), adjusted_close: 300, tag: 'kept always' },
  { date: date(29), adjusted_close: finalFilteredPrice, tag: 'kept until child' },
];
const omissions: [string, string][] = [[symbol, date(14)]];

const singleFields = { date: 'session', price: 'adjusted' };
const multiFields = { ...singleFields, symbol: 'listing' };
const nativeFields = { date: 'date', price: 'adjusted_close' };
const context = { theme: 'light', today: '2026-11-21', maxDecimals: 2 } as const;

function priceViewOptions(fields: PriceBindings, symbols: string[]) {
  return {
    distribution: { version: 1, kind: 'return-distribution', fields, symbol, bins: 5 },
    drawdown: { version: 1, kind: 'drawdown', fields, symbols },
    panels: { version: 1, kind: 'small-multiples', fields, symbols },
  } satisfies Record<string, RecipeOptions>;
}

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

const httpVariants = new Map<string, { status?: number; headers?: Record<string, string> }>([
  ['partial HTTP status', { status: 206 }],
  ['HTTP content range', { headers: { 'Content-Range': 'items 0-57/100' } }],
  ['unquoted next link', { headers: { Link: '</prices?page=2>; rel=Next' } }],
  ['quoted next link', { headers: { Link: '</help>; rel="help", </prices?page=2>; title="More, please"; rel="prev next"' } }],
  ['benign link', { headers: { Link: '</help;rel=next>; rel="help"; title="Example; rel=next, details"' } }],
]);

describe.each(engines)('%s daily-price evidence', (_, make) => {
  it.each([
    'qualified', 'partial response', 'result cursor', 'extra pagination', 'result completeness',
    ...httpVariants.keys(), 'preview prefixed response',
    'nested snapshot', 'wrong selector snapshot', 'wrong route snapshot', 'invalidated snapshot',
    'yes snapshot', 'on snapshot', 'y snapshot', 't snapshot', 'yes live response',
    'plain rows', 'plain snapshot', 'off snapshot', 'local snapshot',
  ] as const)('checks %s from acquisition through linked chart data', async variant => {
    const endpoint = '/api/v1/eodhd/equity/price/historical';
    const { body, query } = JSON.parse(readFileSync(
      'e2e/fixtures/installed-observed-returns/75a9026/public-demo.json', 'utf8',
    )).routes[endpoint];
    const { start_date, end_date, interval } = query;
    const snapshot = { rows: body.results, completeness: 'complete', receipt: { start_date, end_date, interval } };
    const isSnapshot = variant.endsWith('snapshot');
    if (isSnapshot) body.results = snapshot;
    if (variant === 'plain rows' || variant === 'plain snapshot' || variant === 'invalidated snapshot') delete query.chart_source;
    if (['yes snapshot', 'on snapshot', 'y snapshot', 't snapshot', 'off snapshot'].includes(variant)) {
      query.chart_source = variant.split(' ')[0];
    }
    if (variant === 'yes live response') query.chart_source = 'yes';
    if (variant === 'partial response') body.isPartial = true;
    if (variant === 'result cursor') body.extra.results_metadata.nextCursor = 'page-2';
    if (variant === 'extra pagination') body.extra.pagination = { page: 1 };
    if (variant === 'result completeness') body.extra.results_metadata.completeness = 'partial';

    let input: WidgetDataset;
    if (variant === 'local snapshot') {
      input = await datasetFromBytes('prices.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'root', 1);
    } else {
      let path = endpoint;
      if (variant === 'wrong route snapshot') path = '/other/prices';
      if (variant === 'preview prefixed response') path = '/api' + endpoint;
      const dataKey = variant === 'wrong selector snapshot' ? 'results.rows' : 'results';
      const transport = httpVariants.get(variant);
      const server = await startMockServer({ [path]: transport
        ? { __status: transport.status ?? 200, __headers: transport.headers, __body: body }
        : body });
      try {
        let acquisition: BackendAcquisition | undefined;
        const selected = await fetchWidgetData(backend({ baseUrl: server.url }), widget({ endpoint: path, dataKey }),
          query, undefined, undefined, undefined, value => { acquisition = value; });
        if (transport && variant !== 'benign link')
          expect(acquisition?.chartSources?.['daily-price']).toBeUndefined();
        const parsed = parseTableSnapshot(selected);
        input = datasetFromRows(tableRows(parsed.data)!, 'root', 1, 'backend', undefined, [], parsed.snapshot, acquisition);
      } finally { await server.close(); }
    }
    if (variant === 'invalidated snapshot') {
      // The registration boundary will strip this recognized receipt without its required coordinate ledger.
      input.provenance.metadata = { ...input.provenance.metadata,
        chartSources: { 'daily-price': body.extra.results_metadata.chart_sources.receipts[0] } };
    }

    const fields = { ...nativeFields, symbol: 'symbol' };
    const symbols = ['AAPL.US', 'MCD.US'];
    const views = [
      { kind: 'return-distribution', version: 1, fields, symbol: symbols[0], bins: 12 },
      { kind: 'drawdown', version: 1, fields, symbols },
      { kind: 'small-multiples', version: 1, fields, symbols },
      { kind: 'return-summary', version: 1, fields, symbols, view: 'box', window: own },
      { kind: 'return-summary', version: 1, fields, symbols, view: 'violin', window: own },
    ] satisfies RecipeOptions[];
    const qualified = variant === 'qualified' || variant === 'benign link';
    const ordinarySnapshot = variant === 'plain snapshot' || variant === 'off snapshot';
    const ordinary = variant === 'plain rows' || ordinarySnapshot || variant === 'local snapshot';
    const context = { theme: 'light', today: '2026-11-21', maxDecimals: 2 } as const;
    for (const widgetId of ['root', 'child']) {
      const executor = make(widgetId);
      const revision = { widgetId, input: 1, model: 1, output: 1 };
      try {
        await executor.registerInput(input, 1, signal);
        await executor.applyModel({ search: '', table: {} }, { kind: 'none' }, revision, signal);
        const chart = await executor.chartData(revision, Object.values(fields), signal);
        expect(chart.rows).toHaveLength(58);
        expect(chart.completeness.kind).toBe(isSnapshot ? 'complete' : 'unknown');
        expect(Boolean(readLiveDailyPriceSource(chart))).toBe(qualified);
        for (const options of views) {
          const snapshotAllowed = variant === 'local snapshot' || ordinarySnapshot && options.kind !== 'return-summary';
          const result = runRecipe(chart, options, context);
          expect(result, options.kind).toMatchObject(qualified || snapshotAllowed ? { ok: true } : { ok: false, refused: true });
          if (qualified && options.kind === 'return-summary' && result.ok) {
            expect(result.returnSummary?.series.map(({ samples }) => samples.length)).toEqual([28, 28]);
          }
        }
        expect(chart.provenance.metadata?.dailyPriceRejected).toBe(qualified || ordinary ? undefined : true);
        if (widgetId === 'root') {
          if (variant === 'nested snapshot' || qualified) {
            const exported = await collectPresentedExport(executor, revision, signal);
            const json = toJsonRows(exported.rows, exported.columns);
            expect(JSON.parse(json)).toEqual(snapshot.rows);
            expect(json).not.toMatch(/chartSources|chart_sources|dailyPriceCoordinates|dailyPriceRejected|chartSourceOmissions/);
          }
          input = await linkedSubset(executor, revision);
        }
      } finally { executor.dispose(); }
    }
  });

  it.each([
    ['close', 'box'], ['close', 'violin'],
    ['revenue_adjusted', 'box'], ['revenue_adjusted', 'violin'],
  ] as const)('runs live returns with the %s alias in the %s view', async (price, view) => {
    const priceRows = Array.from({ length: 21 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      adjusted_close: 100 + (index % 5) * 10,
    }));
    const input = liveDailyPriceDataset(priceRows, [symbol]);
    const fields = { ...singleFields, price };
    aliasColumns(input, fields);
    const executor = make('root');
    const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: '', table: {} }, { kind: 'none' }, revision, signal);
      const chart = await executor.chartData(revision, Object.values(fields), signal);
      expect(chart.columns.find(column => column.id === price)?.sourceFieldId).toBe('adjusted_close');
      const admitted = admitReturnSummary(chart, fields, [symbol], own);
      if (!admitted.ok) throw new Error(admitted.message);
      const options = { version: 1, kind: 'return-summary', fields, symbols: [symbol], view, window: own } satisfies ReturnSummaryOptions;
      const result = runRecipe(chart, options, context);
      if (!result.ok) throw new Error(result.message);
      const samples = result.returnSummary?.series[0].samples;
      expect(result.returnSummary?.view).toBe(view);
      expect(samples).toEqual(admitted.value.series[0].samples);
      expect(samples).toHaveLength(20);
      expect(runRecipe({ ...chart, provenance: { ...chart.provenance, metadata: undefined } }, options, context)).toMatchObject({
        ok: false, refused: true, message: expect.stringContaining(`Field ${price} cannot supply adjusted price`),
      });
    } finally { executor.dispose(); }
  });

  it.each([false, true])('renders live price views with both types of gap through a linked grandchild (multiple listings: %s)', async multiple => {
    const selected = multiple ? [peer, symbol] : [symbol];
    const fields: PriceBindings = { ...(multiple ? multiFields : singleFields), price: 'close' };
    const inputRows = multiple
      ? [...rows.map(row => ({ ...row, symbol })), ...peerRows.map(row => ({ ...row, symbol: peer }))]
      : rows;
    let input = liveDailyPriceDataset(inputRows.map(row => ({ ...row, open: 11 })), selected, { bounds, omissions });
    const delivered = inputRows.map(row => ['symbol' in row ? row.symbol : symbol, row.date]);
    aliasColumns(input, fields);
    // The real adjusted series looks unadjusted, and the unadjusted field claims its name.
    input.columns = input.columns.map(column => column.id === 'open'
      ? { ...column, id: 'adjusted_close', label: 'Adjusted Close', sourceFieldId: 'open' } : column);
    for (const row of input.rows) {
      row.values.adjusted_close = row.values.open;
      delete row.values.open;
    }
    const columnOrder = ['adjusted_close', ...Object.values(fields).reverse()];
    const names = ['root', 'child', 'grandchild'];
    for (const [index, widgetId] of names.entries()) {
      const executor = make(widgetId);
      const revision: Revision = { widgetId, input: 1, model: 1, output: 1 };
      try {
        await executor.registerInput(input, 1, signal);
        const table = index === 0 ? { columnOrder, columnFilters: [{ id: 'tag', value: 'kept' }] }
          : index === 2 ? { sorting: [{ id: fields.date, desc: true }] } : {};
        await executor.applyModel({ search: index === 1 ? 'kept always' : '', table }, { kind: 'none' }, revision, signal);
        const chart = await executor.chartData(revision, columnOrder, signal);
        const filteredCoordinates = [[symbol, date(20)]];
        if (index > 0) {
          filteredCoordinates.push([symbol, date(26)]);
          if (multiple) filteredCoordinates.push([peer, date(29)]);
        }
        const expectedOmissions = filteredCoordinates.map(point => JSON.stringify(point));
        expect(readLiveDailyPriceSource(chart)).toMatchObject({ symbols: selected, rawOmissions: omissions });
        expect(readChartSourceProjection(chart.provenance, 'daily-price')).toEqual({ filtered: true, omitted: expectedOmissions });
        expect(chart.completeness).toMatchObject({ kind: 'unknown', acquiredRowCount: inputRows.length });
        expect(chart.provenance.metadata?.dailyPriceCoordinates).toEqual(delivered);
        const evidence = JSON.stringify(chart.provenance);
        for (const price of [firstFilteredPrice, secondFilteredPrice, finalFilteredPrice]) expect(evidence).not.toContain(String(price));
        expect(evidence).not.toMatch(/chartSourceCoordinatePlan|priceOmissions/);
        if (index < 2) {
          input = await linkedSubset(executor, revision);
          expect(input.columns.slice(0, columnOrder.length).map(column => column.id)).toEqual(columnOrder);
          expect(readLiveDailyPriceSource(input)).toMatchObject({ rawOmissions: omissions });
          expect(readChartSourceProjection(input.provenance, 'daily-price')?.omitted).toEqual(expectedOmissions);
          continue;
        }
        expect(chart.provenance.lineage).toEqual(['root', 'child'].map(widgetId => ({ widgetId, resultRevision: 1, outputRevision: 1 })));
        expect(chart.columns.map(column => [column.id, column.sourceFieldId])).toEqual([
          ['adjusted_close', 'open'], ...(multiple ? [['listing', 'symbol']] : []),
          ['close', 'adjusted_close'], ['session', 'date'],
        ]);
        expect(chart.rows.filter(row => !fields.symbol || row.values[fields.symbol] === symbol).map(row => row.values.session))
          .toEqual([29, 28, 27, 23, 22, 21, 19, 16, 15, 13].map(date));
        const result = admitReturnSummary(chart, fields, [symbol], own);
        if (!result.ok) throw new Error(result.message);
        expect(result.value.series[0]).toMatchObject({
          samples: [16, 19, 22, 23, 28, 29].map(day => ({ date: date(day), value: 1 })),
          gapCount: 3, excludedOpportunities: 6,
        });
        const gapNotes = [
          'Preserved 1 price gap(s) from provider omissions.',
          `Preserved ${multiple ? 3 : 2} price gap(s) from table filtering.`,
        ];
        expect(result.notes).toEqual(expect.arrayContaining(gapNotes));

        const views = priceViewOptions(fields, selected);
        for (const options of Object.values(views)) {
          const wrongFields = { ...fields, price: 'adjusted_close' };
          expect(runRecipe(chart, { ...options, fields: wrongFields }, context)).toMatchObject({
            ok: false, refused: true, message: expect.stringContaining('source-documented adjusted-price field'),
          });
        }

        expect(runRecipe(chart, views.distribution, context)).toMatchObject({
          ok: true,
          notes: expect.arrayContaining([
            ...gapNotes, 'Observed quote-to-quote returns; exchange-session completeness unknown.',
            `N = 6 observed quote-to-quote returns for ${symbol} from ${date(16)} to ${date(29)}.`,
          ]),
          figure: { data: [{ type: 'bar', y: [6] }] },
        });

        const drawdown = runRecipe(chart, views.drawdown, context);
        expect(drawdown).toMatchObject({ ok: true, notes: expect.arrayContaining([
          ...gapNotes,
          'Drawdown uses observed adjusted prices in the loaded history; exchange-session completeness and peaks during missing observations are unknown.',
        ]) });
        if (!drawdown.ok) throw new Error(drawdown.message);
        expect(drawdown.figure.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: symbol, connectgaps: false,
            x: [13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29].map(date),
            y: [0, null, -.75, -.5, 0, null, -.75, -.5, 0, null, 0, 0, 0] }),
          expect.objectContaining({ legendgroup: symbol, fill: 'toself', connectgaps: false,
            y: [0, 0, 0, null, 0, -.75, -.5, 0, 0, null, 0, -.75, -.5, 0, 0, null, 0, 0, 0, 0, 0] }),
        ]));

        const end = multiple ? date(27) : date(29);
        expect(runRecipe(chart, views.panels, context)).toMatchObject({
          ok: true,
          notes: expect.arrayContaining([
            ...gapNotes, 'Indexed observed adjusted prices; exchange-session completeness unknown.',
            `Shared baseline 100 on ${date(13)}. All panels end on ${end}.`,
          ]),
          figure: {
            data: [
              ...(multiple ? [{ name: peer, x: [13, 19, 27].map(date), y: [100, 50, 150], connectgaps: false }] : []),
              { name: symbol, connectgaps: false,
                x: [13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, ...(multiple ? [] : [28, 29])].map(date),
                y: [100, null, 25, 50, 100, null, 25, 50, 100, null, 200, ...(multiple ? [] : [400, 800])] },
            ],
            layout: { xaxis: { range: [date(13), end] }, ...(multiple ? { xaxis2: { range: [date(13), end] } } : {}) },
          },
        });
      } finally { executor.dispose(); }
    }
  });

  it('names a fully filtered listing in drawdown and refuses its small-multiple panel', async () => {
    const selected = [peer, symbol];
    const inputRows = [...rows.map(row => ({ ...row, symbol })), ...peerRows.map(row => ({ ...row, symbol: peer }))];
    const input = liveDailyPriceDataset(inputRows, selected, { bounds, omissions });
    const fields = { ...nativeFields, symbol: 'symbol' };
    const executor = make('root');
    const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: '', table: { columnFilters: [{ id: 'symbol', value: symbol }] } },
        { kind: 'none' }, revision, signal);
      const chart = await executor.chartData(revision, Object.values(fields), signal);
      expect(readLiveDailyPriceSource(chart)).toMatchObject({ symbols: selected });
      expect(readChartSourceProjection(chart.provenance, 'daily-price')).toEqual({
        filtered: true, omitted: peerRows.map(row => JSON.stringify([peer, row.date])),
      });
      const views = priceViewOptions(fields, selected);
      expect(runRecipe(chart, views.drawdown, context)).toMatchObject({
        ok: true, notes: expect.arrayContaining([expect.stringMatching(/Omitted.*BBB\.US.*no valid daily prices/)]),
        figure: { data: [{ legendgroup: symbol, showlegend: false }, { name: symbol }] },
      });
      expect(runRecipe(chart, views.panels, context)).toMatchObject({
        ok: false, refused: true, message: expect.stringMatching(/No usable delivered daily price series.*BBB\.US/),
      });
    } finally { executor.dispose(); }
  });

  it('exports only visible rows and invalidates chart tickets when the export replaces the source', async () => {
    const input = liveDailyPriceDataset(rows, [symbol], { bounds, omissions });
    const executor = make('root');
    const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
    const replacement = { widgetId: 'root', input: 2, model: 2, output: 2 };
    const fields = Object.values(nativeFields);
    const views = Object.values(priceViewOptions(nativeFields, [symbol]));
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: 'kept always', table: {} }, { kind: 'none' }, revision, signal);
      const live = await executor.chartData(revision, fields, signal);
      for (const options of views) expect(runRecipe(live, options, context)).toMatchObject({ ok: true });

      const exported = await collectPresentedExport(executor, revision, signal);
      const json = toJsonRows(exported.rows, exported.columns);
      expect(JSON.parse(json)).toEqual(rows.filter(row => row.tag === 'kept always'));
      expect(json).not.toMatch(/chartSources|chart_sources|dailyPriceCoordinates|dailyPriceRejected|chartSourceOmissions|priceOmissions/);

      await executor.importFile('prices.json', new TextEncoder().encode(json), replacement.input, signal);
      await expect(executor.chartData(revision, fields, signal)).rejects.toMatchObject({
        descriptor: { code: 'INVALID_REQUEST', message: 'No calculated view' },
      });
      await executor.applyModel({ search: '', table: {} }, { kind: 'none' }, replacement, signal);
      await expect(executor.chartData(revision, fields, signal)).rejects.toMatchObject({
        descriptor: { code: 'REVISION_MISMATCH' },
      });
      const imported = await executor.chartData(replacement, fields, signal);
      expect(imported.rows.map(row => row.values)).toEqual(live.rows.map(row => row.values));
      expect(imported.provenance.sourceKind).toBe('localFile');
      expect(imported.provenance).not.toHaveProperty('metadata.chartSources');
      expect(imported.provenance).not.toHaveProperty('metadata.dailyPriceCoordinates');
      expect(readLiveDailyPriceSource(imported)).toBeUndefined();
      for (const options of views) expect(runRecipe(imported, options, context)).toMatchObject({ ok: false, refused: true });
    } finally { executor.dispose(); }
  });

  it.each([
    ['Code', 'AAA', 'BBB'], ['Ticker', 'AAA.US', 'BBB.US'], ['Exchange', 'US', 'TO'],
    ['nextCursor', null, 'page2'], ['isPartial', null, true],
    ['interval', '1d', '1W'], ['period', 'd', 'w'], ['currency', 'USD', 'EUR'], ['unit', 'dollars', 'cents'],
  ])('checks the %s source origin before a worker filter removes the contradictory row', async (origin, stable, conflict) => {
    const input = liveDailyPriceDataset(rows, [symbol], { bounds });
    aliasColumns(input, singleFields);
    input.columns.push({ id: 'code', label: 'Code', sourceFieldId: 'code' });
    for (const row of input.rows) row.values.code = 'AAA';
    input.columns.push({ id: 'declaration', label: 'Declaration', sourceFieldId: origin });
    for (const row of input.rows) row.values.declaration = row.values.tag === 'removed at root' ? conflict : stable;
    const executor = make('root');
    const revision: Revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
    try {
      await executor.registerInput(input, 1, signal);
      await executor.applyModel({ search: '', table: { columnFilters: [{ id: 'tag', value: 'kept' }] } },
        { kind: 'none' }, revision, signal);
      const chart = await executor.chartData(revision, Object.values(singleFields), signal);
      expect(chart.rows).toHaveLength(rows.length - 1);
      expect(chart.columns.map(column => column.id)).not.toContain('declaration');
      expect(chart.provenance.metadata?.chartSources).toBeUndefined();
      expect(admitReturnSummary(chart, singleFields, [symbol], own)).toMatchObject({ ok: false, refused: true });
    } finally { executor.dispose(); }
  });

  it.each([
    'raw conflicting duplicate', 'mixed listing identity', 'mixed acquired sources', 'ambiguous date origins', 'ambiguous price origins', 'aggregate',
  ] as const)(
    'refuses %s after table presentation', async variant => {
      const conflicting = variant === 'raw conflicting duplicate';
      const mixed = variant === 'mixed listing identity';
      const original = mixed ? rows.map((row, index) => index === 4 ? { ...row, ticker: peer } : row) : rows;
      const withConflict = [...original, { ...rows[0], adjusted_close: 999, tag: 'removed at root' }];
      const input = liveDailyPriceDataset(conflicting ? withConflict : original, [symbol], {
        bounds, omissions, unsafe: conflicting ? { conflicting_duplicates: true } : {},
      });
      if (variant === 'mixed acquired sources') {
        const unrelated = liveDailyPriceDataset([{ ...rows[4], date: date(12) }], [peer], { bounds });
        input.rows[4].values = unrelated.rows[0].values;
        expect(readLiveDailyPriceSource(input)).toBeUndefined();
      }
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
        const fields = variant === 'aggregate' ? { ...nativeFields, date: LABEL_FIELD } : nativeFields;
        const chart = await executor.chartData(revision, Object.values(fields), signal);
        expect(chart.rows.length).toBeGreaterThan(6);
        if (conflicting || mixed || variant === 'mixed acquired sources') {
          expect(chart.rows.some(row => row.values.adjusted_close === 999 || row.values.adjusted_close === firstFilteredPrice)).toBe(false);
          expect(chart.provenance.metadata?.chartSources).toBeUndefined();
        }
        if (variant === 'aggregate') expect(chart.provenance.inputMayContainAggregates).toBe(true);
        expect(readLiveDailyPriceSource(chart)).toBeUndefined();
        expect(admitReturnSummary(chart, fields, [symbol], own)).toMatchObject({ ok: false, refused: true });
        for (const options of Object.values(priceViewOptions(fields, [symbol]))) {
          expect(runRecipe(chart, options, context)).toMatchObject({ ok: false, refused: true });
        }
      } finally { executor.dispose(); }
    },
  );
});
