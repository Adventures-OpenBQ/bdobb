// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { StatementCompilationError } from '../statementModel/compile';
import { UnpivotError } from '../tableModel/unpivot';
import {bindObservedFormula,observedMemberPage} from './formulaAuthoring';
import { datasetFromBytes } from '../localTableData';
import type { WidgetDataset } from '../widgetData/types';
import { identityWitness } from './identityWitness';
import { calculateView } from './engine';
import { createResultStore, type ResultStore } from './resultStore';
import { ExecutionProtocolError, validateExecutionRequest } from './validation';
import type { ExecutionRequest, ExecutionResponse, ResultContext, SubsetBatch } from './types';

/** Worker-owned raw input, calculated store, and pull-based bounded transfers. */
export function createWorkerHandler(send: (response: ExecutionResponse) => void) {
  let input: WidgetDataset | undefined;
  let inputRevision = -1;
  let store: ResultStore | undefined;
  let context: ResultContext = { completeness: { kind: 'unknown', warnings: ['Input has not been acquired'] }, diagnostics: [] };
  let acquisition = 0;
  const transfers = new Map<string, { request: ExecutionRequest; iterator: Iterator<SubsetBatch>; sequence: number }>();
  const emitNext = (id: string, sequence: number) => {
    const transfer = transfers.get(id);
    if (!transfer || transfer.sequence !== sequence) throw new ExecutionProtocolError('INVALID_REQUEST', 'Unknown transfer or sequence');
    const next = transfer.iterator.next();
    if (next.done) { transfers.delete(id); return; }
    transfer.sequence++;
    if (next.value.final) transfers.delete(id);
    send(next.value);
  };
  return async (raw: unknown): Promise<void> => {
    let request: ExecutionRequest;
    try { request = validateExecutionRequest(raw); } catch (error) {
      // Reply only when the correlation envelope itself is valid.
      try {
        const descriptors=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptors(raw):{};
        const envelope = validateExecutionRequest({ kind: 'totals', requestId: descriptors.requestId?.value, revision: descriptors.revision?.value });
        send({ requestId: envelope.requestId, revision: envelope.revision, ...context, kind: 'error', error: error instanceof ExecutionProtocolError ? error.descriptor : { code: 'INVALID_REQUEST', message: 'Invalid table request' } });
      } catch { /* An invalid envelope cannot be safely correlated. */ }
      return;
    }
    const envelope = () => ({ requestId: request.requestId, revision: request.revision, ...context });
    try {
      switch (request.kind) {
        case 'registerInput': case 'importFile': {
          const token = ++acquisition;
          store = undefined; transfers.clear(); input = undefined; inputRevision = -1;
          context = { completeness: { kind: 'unknown', warnings: ['Input has not been acquired'] }, diagnostics: [] };
          const acquired = request.kind === 'registerInput' ? request.input : await datasetFromBytes(request.name, request.bytes, request.revision.widgetId, request.inputRevision);
          if (token !== acquisition) return;
          input = acquired; inputRevision = request.inputRevision;
          context = { completeness: input.completeness, diagnostics: [...(input.diagnostics ?? []), ...(input.freshness.diagnostics ?? []).map(message => ({ code: 'INPUT', message, severity: 'warning' as const }))] };
          send({ ...envelope(), kind: 'registered' }); break;
        }
        case 'bindFormula': case 'memberDomain': {
          if (!input || inputRevision !== request.revision.input) throw new ExecutionProtocolError('REVISION_MISMATCH', 'Input is not registered for revision');
          const base={requestId:request.requestId,revision:request.revision,completeness:input.completeness,diagnostics:[]};
          if(request.kind==='bindFormula')send({...base,kind:'bindFormula',...bindObservedFormula(input,request)});
          else send({...base,kind:'memberDomain',...observedMemberPage(input,request)});
          break;
        }
        case 'previewDefinition': {
          if (!input || inputRevision !== request.revision.input) throw new ExecutionProtocolError('REVISION_MISMATCH', 'Input is not registered for revision');
          // A local candidate calculation never replaces the active result store or transfers.
          const preview = calculateView(input, request.definition, {kind:'none'});
          send({...envelope(), completeness:preview.completeness, diagnostics:preview.diagnostics, kind:'previewDefinition', columns:preview.columns, rows:preview.presentedRows.slice(0,100), total:preview.presentedRows.length});
          break;
        }
        case 'inputSchema': {
          if (!input || inputRevision !== request.revision.input) throw new ExecutionProtocolError('REVISION_MISMATCH', 'Input is not registered for revision');
          // Schema-only inspection never calculates or creates a publishable view.
          send({ ...envelope(), kind: 'inputSchema', columns: structuredClone(input.columns) }); break;
        }
        case 'applyModel': {
          if (!input || inputRevision !== request.revision.input) throw new ExecutionProtocolError('REVISION_MISMATCH', 'Input is not registered for revision');
          transfers.clear();
          const view = calculateView(input, request.definition, request.selection, request.reconcileMissing, request.previousSelectionNamespace, request.provenAbsentIds, request.runtimeParams);
          view.diagnostics = [...(input.freshness.diagnostics ?? []).map(message => ({ code: 'INPUT', message, severity: 'warning' as const })), ...view.diagnostics];
          context = { completeness: view.completeness, diagnostics: view.diagnostics };
          store = createResultStore(view, request.revision);
          send(store.ready(request.requestId, request.revision)); break;
        }
        case 'cancel': acquisition++; for (const [id, transfer] of transfers) if (transfer.request.requestId === request.targetRequestId) transfers.delete(id); break;
        case 'dispose': acquisition++; input = undefined; store = undefined; transfers.clear(); break;
        case 'nextSubset': {
          const transfer = transfers.get(request.transferId);
          if (!transfer || transfer.request.requestId !== request.requestId || JSON.stringify(transfer.request.revision) !== JSON.stringify(request.revision)) throw new ExecutionProtocolError('REVISION_MISMATCH', 'Transfer revision mismatch');
          emitNext(request.transferId, request.sequence); break;
        }
        default: {
          if (!store) throw new ExecutionProtocolError('INVALID_REQUEST', 'No calculated view');
          switch (request.kind) {
            case 'identityWitness': {
              const ready = store.ready(request.requestId, request.revision);
              send({ ...envelope(), kind: 'identityWitness', identities: identityWitness(input!, request.path, request.ids, ready.inspection.definition, ready.columns) });
              break;
            }
            case 'selection': send(store.selection(request.requestId, request.revision, request.action, request.visibleIds)); break;
            case 'rows': send(store.rows(request.requestId, request.revision, request.request)); break;
            case 'facets': send(store.facets(request.requestId, request.revision, request.categoryId)); break;
            case 'inspect': send(store.inspect(request.requestId, request.revision, request)); break;
            case 'totals': send(store.totals(request.requestId, request.revision)); break;
            case 'chartData': send(store.chartData(request.requestId, request.revision, request.fields)); break;
            case 'presented':
              if (transfers.size >= 32) throw new ExecutionProtocolError('INVALID_REQUEST', 'Too many transfers');
              transfers.set(request.transferId, { request, iterator: store.presented(request.requestId, request.revision, request.transferId, undefined, request.ignoreSelection)[Symbol.iterator](), sequence: 0 });
              emitNext(request.transferId, 0); break;
          }
        }
      }
    } catch (error) {
      send({ ...envelope(), kind: 'error', error: error instanceof ExecutionProtocolError ? error.descriptor : error instanceof StatementCompilationError || error instanceof UnpivotError ? { code: 'INVALID_REQUEST', message: error.message.slice(0,4096) } : { code: 'INVALID_REQUEST', message: request.kind === 'importFile' ? 'Could not parse local table' : 'Table execution failed' } });
    }
  };
}
// Importing the handler in tests never installs a Window message listener.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const handler = createWorkerHandler(response => self.postMessage(response));
  self.onmessage = event => { void handler(event.data); };
}
