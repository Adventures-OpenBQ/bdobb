// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Revision } from '../../tableExecution/types';
import type { WidgetDataset } from '../types';
import { decodeLinkedKpiOptions } from './settings';
import type { LinkedKpiOptions, KpiResult } from './types';

type KpiIdentity = { requestId: number; sourceWidgetId: string; inputRevision?: number; resultRevision: number; outputRevision: number };
export type KpiRequest = { identity: KpiIdentity; dataset: WidgetDataset; options: LinkedKpiOptions };
export type KpiReply = KpiIdentity & ({ result: KpiResult } | { error: string });

/** A client serves one card. Terminating an obsolete synchronous transform releases the worker immediately. */
export function createKpiWorker(create = () => new Worker(new URL('./kpi.worker.ts', import.meta.url), { type: 'module' })) {
  let port: Worker | undefined;
  let cancel: (() => void) | undefined;
  let disposed = false;
  let sequence = 0;
  function terminate() {
    port?.terminate();
    port = undefined;
  }
  return {
    async run(dataset: WidgetDataset & { revision?: Revision }, options: LinkedKpiOptions, signal: AbortSignal): Promise<KpiResult> {
      if (disposed) throw new Error('The KPI worker was disposed.');
      signal.throwIfAborted();
      cancel?.();
      const decoded = decodeLinkedKpiOptions(options);
      if (!decoded.ok) return { ok: false, refused: true, message: decoded.message };
      const worker = port ??= create();
      const identity: KpiIdentity = {
        requestId: ++sequence, sourceWidgetId: dataset.revision?.widgetId ?? dataset.provenance.sourceWidgetId,
        inputRevision: dataset.revision?.input, resultRevision: dataset.resultRevision, outputRevision: dataset.outputRevision,
      };
      return new Promise((resolve, reject) => {
        function cleanup() {
          worker.removeEventListener('message', message);
          worker.removeEventListener('error', error);
          worker.removeEventListener('messageerror', unreadable);
          signal.removeEventListener('abort', abort);
          cancel = undefined;
        }
        function fail(reason: unknown) {
          cleanup();
          terminate();
          reject(reason);
        }
        function abort() { fail(new DOMException('KPI calculation cancelled.', 'AbortError')); }
        function error(event: ErrorEvent) { fail(new Error(event.message || 'The KPI worker failed. Reload the KPI.')); }
        function unreadable() { fail(new Error('The KPI worker returned an unreadable response. Reload the KPI.')); }
        function message(event: MessageEvent<KpiReply>) {
          const reply = event.data;
          if (reply?.requestId !== identity.requestId) return;
          if (reply.sourceWidgetId !== identity.sourceWidgetId || reply.inputRevision !== identity.inputRevision ||
              reply.resultRevision !== identity.resultRevision || reply.outputRevision !== identity.outputRevision) {
            fail(new Error('The KPI worker returned a different source revision. Refresh the KPI.'));
            return;
          }
          cleanup();
          if ('error' in reply) reject(new Error(reply.error));
          else resolve(reply.result);
        }
        cancel = abort;
        worker.addEventListener('message', message);
        worker.addEventListener('error', error);
        worker.addEventListener('messageerror', unreadable);
        signal.addEventListener('abort', abort, { once: true });
        try { worker.postMessage({ identity, dataset, options: decoded.options } satisfies KpiRequest); }
        catch (cause) { fail(cause); }
      });
    },
    dispose() {
      disposed = true;
      cancel?.();
      terminate();
    },
  };
}
