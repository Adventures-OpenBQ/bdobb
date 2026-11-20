// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from 'vitest';
import { liveMetricReceipt, liveMetricRows } from '../../../test/fixtures/metricEvidence';
import { datasetFromRows } from '../../localTableData';
import { captureChartSources } from '../chartRecipes/chartSourceContracts';
import type { LinkedKpiOptions } from './types';
import { createKpiWorker, type KpiReply, type KpiRequest } from './workerClient';

const options: LinkedKpiOptions = {
  version: 1, metric: 'dividend_yield', valueField: 'dividend_yield', observation: { mode: 'latest' }, view: 'card',
};
function live(retrievedAt = liveMetricReceipt.retrieved_at, input = 1) {
  const receipt = { ...liveMetricReceipt, retrieved_at: retrievedAt, metrics: {
    dividend_yield: { ...liveMetricReceipt.metrics.dividend_yield, vintage: retrievedAt, observation_id: 'dividend_yield:' + retrievedAt },
  } };
  const rows = [{ ...liveMetricRows[0], metric_vintage: retrievedAt, dividend_yield: .04 }];
  const context = { endpoint: '/api/v1/eodhd/equity/fundamental/metrics', selector: 'results',
    parameters: { chart_source: 'true', symbol: 'AAPL' }, retrievedAt: input };
  const chartSources = captureChartSources(context, { results: rows, extra: {
    results_metadata: { chart_sources: { version: 1, receipts: [receipt] } },
  } }, rows);
  const dataset = datasetFromRows(rows, 'source', input, 'backend', undefined, [], undefined, { ...context, chartSources });
  return { ...dataset, revision: { widgetId: 'source', input, model: 0, output: input } };
}

class Port extends EventTarget {
  postMessage = vi.fn<(request: KpiRequest) => void>();
  terminate = vi.fn();
  reply(identity: KpiRequest['identity'], changes = {}) {
    this.dispatchEvent(new MessageEvent('message', {
      data: { ...identity, ...changes, result: { ok: false, refused: true, message: 'current' } },
    }));
  }
}
afterEach(() => vi.unstubAllGlobals());

it('rejects wrong revisions and ignores superseded replies while abort and disposal terminate live requests', async () => {
  const ports: Port[] = [];
  const client = createKpiWorker(() => { const port = new Port(); ports.push(port); return port as unknown as Worker; });
  const start = (input = 1, signal = new AbortController().signal) => client.run(live(undefined, input), options, signal);
  const cancelled = expect(start()).rejects.toMatchObject({ name: 'AbortError' });
  const old = ports[0].postMessage.mock.calls[0][0].identity;
  expect(old).toMatchObject({ sourceWidgetId: 'source', inputRevision: 1, resultRevision: 1, outputRevision: 1 });
  const current = start(2);
  const second = ports[1].postMessage.mock.calls[0][0].identity;
  expect(second.requestId).toBeGreaterThan(old.requestId);
  expect(ports[0].terminate).toHaveBeenCalledOnce();
  ports[0].reply(old);
  ports[1].reply(second, { outputRevision: 99 });
  await cancelled;
  await expect(current).rejects.toThrow(/revision/i);
  expect(ports[1].terminate).toHaveBeenCalledOnce();
  const controller = new AbortController();
  const aborted = expect(start(3, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await aborted;
  expect(ports[2].terminate).toHaveBeenCalledOnce();
  const badMessage = expect(start()).rejects.toThrow(/unreadable/i);
  ports[3].dispatchEvent(new MessageEvent('messageerror'));
  await badMessage;
  const error = expect(start()).rejects.toThrow(/worker module unavailable/);
  ports[4].dispatchEvent(new ErrorEvent('error', { message: 'worker module unavailable' }));
  await error;
  const disposed = expect(start()).rejects.toMatchObject({ name: 'AbortError' });
  client.dispose();
  await disposed;
  expect(ports[5].terminate).toHaveBeenCalledOnce();
  await expect(start()).rejects.toThrow(/disposed/i);
});

it('refuses accessor and tampered options on the client before cloning or creating a port', async () => {
  const client = createKpiWorker(() => { throw Error('invalid options reached the port'); });
  const accessor = { ...options, get valueField(): string { throw Error('getter executed'); } };
  await expect(client.run(live(), accessor, new AbortController().signal)).resolves.toMatchObject({ ok: false, refused: true });
  client.dispose();
});

it('clones requests and typed snapshots through the worker entrypoint, fencing resolved vintages from routine input revisions', async () => {
  const scope = {
    onmessage: undefined as ((event: { data: KpiRequest }) => void) | undefined,
    postMessage: vi.fn<(reply: KpiReply) => void>(),
  };
  vi.stubGlobal('self', scope);
  await import('./kpi.worker');
  const send = (input: number, vintage?: string, choice = options) => {
    const identity = { requestId: input, sourceWidgetId: 'source', inputRevision: input, resultRevision: input, outputRevision: input };
    scope.onmessage!({ data: structuredClone({ identity, dataset: live(vintage, input), options: choice } satisfies KpiRequest) });
    const reply = structuredClone(scope.postMessage.mock.lastCall![0]);
    expect(reply).toMatchObject(identity);
    if ('error' in reply) throw Error(reply.error);
    return reply.result;
  };
  const initial = send(1);
  expect(initial).toMatchObject({ ok: true, snapshot: { value: .04, unit: { kind: 'fraction' } } });
  const stable = send(2);
  expect(stable.ok && stable.revision).toBe(initial.ok && initial.revision);
  const newVintage = send(3, '2026-11-20T04:16:46.000001Z');
  expect(newVintage.ok).toBe(true);
  expect(newVintage.ok && newVintage.revision).not.toBe(initial.ok && initial.revision);
  const forged = { ...options, source: liveMetricReceipt };
  expect(send(4, undefined, forged)).toMatchObject({ ok: false, refused: true });
});
