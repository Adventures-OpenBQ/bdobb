// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from 'vitest';
import { dividendEvidence, dividendRow, emptyDividendEvidence, screenerEvidence } from '../../../test/fixtures/financialEvidence';
import { datasetFromRows } from '../../localTableData';
import { createRecipeWorker, type RecipeRequest } from './workerClient';
import { drawdownOptions, priceDataset } from './fixtures';
import { parseFinancialEvidence } from './financialEvidence';

const dataset = priceDataset([{ date: '2026-01-02', adjusted_close: 20, symbol: 'A' }]);
const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
class Port extends EventTarget {
  postMessage = vi.fn<(request: RecipeRequest) => void>();
  terminate = vi.fn();
  reply(request: RecipeRequest, changes = {}) {
    this.dispatchEvent(new MessageEvent('message', { data: { ...request.identity, ...changes, result: { ok: false, refused: true, message: 'current' } } }));
  }
}
afterEach(() => vi.unstubAllGlobals());
it('publishes only the newest request even if the old reply arrives last', async () => {
  const ports: Port[] = [];
  const client = createRecipeWorker(() => { const p = new Port(); ports.push(p); return p as unknown as Worker; });
  const start = () => client.run(dataset, drawdownOptions, context, new AbortController().signal);
  const published: number[] = [];
  const a = start();
  const old = ports[0].postMessage.mock.calls[0][0];
  const first = a.then(() => published.push(old.identity.requestId), e => expect(e.name).toBe('AbortError'));
  const b = start();
  const port = ports.at(-1)!;
  const current = port.postMessage.mock.lastCall![0];
  expect(current.identity.requestId).toBeGreaterThan(old.identity.requestId);
  port.reply(current);
  await b.then(() => published.push(current.identity.requestId));
  ports[0].reply(old);
  await first;
  expect(published).toEqual([current.identity.requestId]);
  client.dispose();
  expect(port.terminate).toHaveBeenCalledTimes(1);
});
it('rejects mismatched revision replies and explains worker errors; abort and dispose release live requests', async () => {
  const ports: Port[] = [];
  const client = createRecipeWorker(() => { const p = new Port(); ports.push(p); return p as unknown as Worker; });
  const start = (signal = new AbortController().signal) => client.run(dataset, drawdownOptions, context, signal);
  const first = start();
  const port = ports[0];
  const request = port.postMessage.mock.lastCall![0];
  expect(request.identity).toMatchObject({ sourceWidgetId: 'source', resultRevision: dataset.resultRevision, outputRevision: dataset.outputRevision });
  port.reply(request, { outputRevision: 404 });
  await expect(first).rejects.toThrow(/revision|identity/i);
  const error = start();
  ports.at(-1)!.dispatchEvent(new ErrorEvent('error', { message: 'module unavailable' }));
  await expect(error).rejects.toThrow(/module unavailable/);
  const abort = new AbortController();
  const cancelled = start(abort.signal);
  const active = ports.at(-1)!;
  const remove = vi.spyOn(active, 'removeEventListener');
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  expect(active.terminate).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
  const pending = start();
  client.dispose(); client.dispose();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(ports.at(-1)!.terminate).toHaveBeenCalledTimes(1);
  await expect(start()).rejects.toThrow(/disposed/i);
});
it('runs the actual worker entry and posts a structured-cloneable chart with its request identity', async () => {
  const scope = { onmessage: undefined as ((event: { data: RecipeRequest }) => void) | undefined, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./recipe.worker');
  const identity = { requestId: 10, sourceWidgetId: 'source', resultRevision: 1, outputRevision: 1 };
  scope.onmessage!({ data: { identity, dataset, options: drawdownOptions, context } });
  const reply = structuredClone(scope.postMessage.mock.lastCall![0]);
  expect(reply.result.notes).toContain('Presented observation dates: 2026-01-02 to 2026-01-02.');
  expect(reply).toMatchObject({ ...identity, result: { ok: true, figure: { data: expect.arrayContaining([expect.objectContaining({ y: [0] })]) } } });
});

it('dispatches the bubble recipe through the actual worker without the legacy observation-date note', async () => {
  const scope = { onmessage: undefined as ((event: { data: RecipeRequest }) => void) | undefined, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./recipe.worker');
  const identity = { requestId: 11, sourceWidgetId: 'screen', resultRevision: 1, outputRevision: 1 };
  const source = datasetFromRows([{
    symbol: 'A.US', last_day_data_date: '2026-08-28', dividend_yield: 0,
    price_change_5d: .02, market_cap: 10, exchange: 'US', currency_symbol: '$',
  }], 'screen', 1, 'localFile', undefined, [], { completeness: 'paged', financialEvidence: parseFinancialEvidence(screenerEvidence) });
  scope.onmessage!({ data: structuredClone({
    identity, dataset: source, context,
    options: { kind: 'bubble-regression', version: 1, priceDate: 'latest', regression: true,
      fields: { symbol: 'symbol', date: 'last_day_data_date', dividendYield: 'dividend_yield',
        priceChange: 'price_change_5d', marketCap: 'market_cap', exchange: 'exchange', currency: 'currency_symbol' } },
  } satisfies RecipeRequest) });
  const reply = structuredClone(scope.postMessage.mock.lastCall![0]);
  expect(reply).toMatchObject({ ...identity, result: { ok: true,
    figure: { data: [expect.objectContaining({ mode: 'markers', x: [0], y: [.02] })] } } });
  expect(reply.result.notes.join(' ')).toMatch(/Price-data date 2026-08-28/);
  expect(reply.result.notes.join(' ')).not.toMatch(/Presented observation dates/);
});

it('dispatches verified dividends through the actual worker, including a covered empty refresh', async () => {
  const scope = { onmessage: undefined as ((event: { data: RecipeRequest }) => void) | undefined, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./recipe.worker');
  const identity = { requestId: 12, sourceWidgetId: 'dividends', resultRevision: 1, outputRevision: 1 };
  const send = (rows: typeof dividendRow[], receipt: unknown) => {
    const source = datasetFromRows(rows, 'dividends', 1, 'localFile', undefined, [], {
      completeness: 'bounded', financialEvidence: parseFinancialEvidence(receipt),
    });
    scope.onmessage!({ data: structuredClone({
      identity, dataset: source, context: { ...context, today: '2026-02-12' },
      options: { kind: 'dividend-steps', version: 1, instrument: 'SHEL.LSE',
        fields: { date: 'ex_dividend_date', amount: 'amount', currency: 'currency', frequency: 'frequency' } },
    } satisfies RecipeRequest) });
    return structuredClone(scope.postMessage.mock.lastCall![0]);
  };
  const history = send([dividendRow], dividendEvidence);
  expect(history).toMatchObject({ ...identity, result: { ok: true,
    figure: { data: [expect.objectContaining({ mode: 'markers', x: ['2026-02-12'], y: [.2] })] } } });
  expect(history.result.notes.join(' ')).toMatch(/observed.*2026-02-12/i);
  expect(history.result.notes.join(' ')).not.toMatch(/Presented observation dates/);
  const empty = send([], emptyDividendEvidence);
  expect(empty).toMatchObject({ ...identity, result: { ok: true, figure: { data: [] } } });
  expect(empty.result.notes.join(' ')).toMatch(/no dividend events were supplied.*2026-01-01.*2026-06-30/i);
});

it('sends layout width in context and fences a superseded arrangement of the same source revision', async () => {
  const ports: Port[] = [];
  const client = createRecipeWorker(() => { const port = new Port(); ports.push(port); return port as unknown as Worker; });
  const options = { ...drawdownOptions, kind: 'small-multiples' } as const;
  const run = (viewportWidth: number) => client.run(dataset, options, { ...context, viewportWidth }, new AbortController().signal);
  const cancelled = expect(run(500)).rejects.toMatchObject({ name: 'AbortError' });
  const current = run(1000);
  const first = ports[0].postMessage.mock.calls[0][0];
  const second = ports[1].postMessage.mock.calls[0][0];
  expect(first.options).toEqual(second.options);
  expect(first.identity).toEqual({ ...second.identity, requestId: first.identity.requestId });
  expect(first.identity.requestId).not.toBe(second.identity.requestId);
  expect(second.context.viewportWidth).toBe(1000);
  ports[1].reply(second);
  ports[0].reply(first);
  await cancelled;
  await expect(current).resolves.toMatchObject({ message: 'current' });
  client.dispose();
});

it('refuses executable options before a structured clone can invoke the accessor', async () => {
  const client = createRecipeWorker(() => { throw new Error('Refused options must never reach a worker port'); });
  const options = { version: 1, kind: 'income-sankey', get periodColumn(): string { throw new Error('Accessor ran'); } } as const;
  await expect(client.run(dataset, options, context, new AbortController().signal))
    .resolves.toMatchObject({ ok: false, refused: true });
  client.dispose();
});
