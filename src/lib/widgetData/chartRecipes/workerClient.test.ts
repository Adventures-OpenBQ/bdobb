// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from 'vitest';
import { createRecipeWorker, type RecipeRequest } from './workerClient';
import { drawdownOptions, priceDataset } from './fixtures';

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
