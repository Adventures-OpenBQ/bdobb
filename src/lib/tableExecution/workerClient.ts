// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {authoringPlainData} from './formulaAuthoringProtocol';
import { validateRuntimeParams, runtimePlainData, type RuntimeParams } from './runtimeParams';
import type { WidgetDataset } from '../widgetData/types';
import type { DefinitionPreview, FormulaBindResult, MemberDomainResult, ColumnProfileResult, InputSchema, ExecutionRequest, ExecutionResponse, LocalWorkerExecutor, Revision, SelectionSpec, TableDefinition, ViewReady, RowBlock, FacetResult, TotalResult, ChartResult, SubsetBatch, SelectionResult, IdentityWitnessResult, InspectionResult } from './types';
import { ExecutionProtocolError, validateExecutionRequest, validateExecutionResponse } from './validation';

type Pending = { revision: Revision; kind: ExecutionResponse['kind']; resolve: (value: ExecutionResponse) => void; reject: (error: unknown) => void; cleanup: () => void };
type Source = { kind: 'registerInput'; input: WidgetDataset; inputRevision: number } | { kind: 'importFile'; name: string; bytes: Uint8Array; inputRevision: number; yearEnds?: Record<string, number | null> };
const aborted = () => new DOMException('Table request cancelled', 'AbortError');
// A read of the view a newer apply replaces; consumers may ignore it like an obsolete response.
const superseded = () => new ExecutionProtocolError('REVISION_MISMATCH', 'Table view superseded');
// Shared hydration/restoration is never cancelled by one caller: only reset/dispose end it (by rejecting its sends).
const shared = new AbortController().signal;
// Each caller still stops waiting when its own signal aborts.
export const until = <T>(work: Promise<T>, signal: AbortSignal, cancelled = aborted) => new Promise<T>((resolve, reject) => {
  const abort = () => reject(cancelled());
  signal.addEventListener('abort', abort, { once: true });
  work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});

export type WorkerInitialization = { readyKind: string; failureKind: string; protocolVersion: number };

export function createWorkerExecutor(widgetId: string, factory: () => Worker = () => new Worker(new URL('./table.worker.ts', import.meta.url), { type: 'module' }), initialization?: WorkerInitialization): LocalWorkerExecutor {
  let worker: Worker | undefined;
  let ready: Promise<void> | undefined;
  let rejectReady: ((error: unknown) => void) | undefined;
  let generation = 0;
  let resetReason: unknown;
  let counter = 0;
  let disposed = false;
  let source: Source | undefined;
  /** The last registered importFile's statement reporters (undefined: none, or not a file). */
  let fiscalSymbols: string[] | undefined;
  let model: { definition: TableDefinition; selection: SelectionSpec; revision: Revision; reconcileMissing?: boolean; previousSelectionNamespace?: string; provenAbsentIds?: string[]; runtimeParams?:RuntimeParams } | undefined;
  let hydratedModel: typeof model;
  let restoring: Promise<void> | undefined;
  let applying = false;
  // Acquisition owns its generation even before readiness posts a request.
  let acquiring: number | undefined;
  let operation = 0;
  let hydration: Promise<void> | undefined;
  const pending = new Map<string, Pending>();
  const streamCleanups = new Set<() => void>();
  const inputRevision = () => ({ widgetId, input: source?.inputRevision ?? 0, model: 0, output: 0 });
  const reset = (error: unknown) => {
    resetReason = error;
    acquiring = undefined;
    rejectReady?.(error); rejectReady = undefined; ready = undefined;
    generation++;
    worker?.terminate(); worker = undefined; hydration = undefined; hydratedModel = undefined; restoring = undefined;
    for (const item of pending.values()) { item.cleanup(); item.reject(error); }
    pending.clear();
    for (const cleanup of streamCleanups) cleanup();
    streamCleanups.clear();
  };
  const create = () => {
    if (disposed) throw new Error('Table executor disposed');
    if (worker) return;
    const current = ++generation;
    const created = factory(); worker = created;
    let resolveReady: (() => void) | undefined;
    if (initialization) {
      ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      void ready.catch(() => {});
    }
    created.onmessage = event => {
      if (current !== generation || disposed) return;
      const message = event.data;
      if (initialization && message?.kind === initialization.failureKind) { reset(new Error(typeof message.message === 'string' ? message.message : 'Rust worker failed')); return; }
      if (initialization && message?.kind === initialization.readyKind) {
        if (message.protocolVersion !== initialization.protocolVersion) { reset(new Error('Unsupported Rust worker protocol')); return; }
        resolveReady?.(); resolveReady = undefined; rejectReady = undefined; return;
      }
      const raw = message as Partial<ExecutionResponse> | null;
      if (!raw || typeof raw.requestId !== 'string') { if (initialization) reset(new ExecutionProtocolError('INVALID_RESPONSE', 'Malformed worker response')); return; }
      const item = pending.get(raw.requestId);
      if (!item) return;
      let requestFailure = false;
      try {
        let response: ExecutionResponse;
        try {
          response = validateExecutionResponse(raw, item.revision, raw.requestId);
        } catch (error) {
          // Only a validated obsolete envelope is ignored; worker error descriptors settle.
          if (error instanceof ExecutionProtocolError && error.descriptor.code === 'REVISION_MISMATCH') return;
          throw error;
        }
        if (response.kind === 'error') { requestFailure = true; throw new ExecutionProtocolError(response.error.code, response.error.message); }
        if (response.kind !== item.kind) throw new ExecutionProtocolError('INVALID_RESPONSE', 'Unexpected response kind');
        pending.delete(raw.requestId); item.cleanup(); item.resolve(response);
      } catch (error) {
        if (initialization && !requestFailure) { reset(error); }
        else { pending.delete(raw.requestId); item.cleanup(); item.reject(error); }
      }
    };
    created.onerror = created.onmessageerror = () => { if (current === generation) reset(new Error('Worker failed')); };
  };
  const send = (request: ExecutionRequest, kind: ExecutionResponse['kind'], signal: AbortSignal): Promise<ExecutionResponse> => {
    try {
      if (disposed) throw new Error('Table executor disposed');
      if (signal.aborted) throw aborted();
      const validated = validateExecutionRequest(request);
      if (pending.size >= 32) throw new Error('Too many pending table requests');
      create();
      return new Promise((resolve, reject) => {
        const cancel = () => {
          const item = pending.get(request.requestId);
          if (!item) return;
          pending.delete(request.requestId); item.cleanup(); reject(aborted());
          if (request.kind === 'applyModel' || request.kind === 'registerInput' || request.kind === 'importFile') reset(aborted());
          else worker?.postMessage({ kind: 'cancel', requestId: `cancel-${++counter}`, revision: request.revision, targetRequestId: request.requestId });
        };
        const cleanup = () => signal.removeEventListener('abort', cancel);
        pending.set(request.requestId, { revision: structuredClone(request.revision), kind, resolve, reject, cleanup });
        signal.addEventListener('abort', cancel, { once: true });
        try { worker!.postMessage(validated); } catch (error) { reset(error); }
      });
    } catch (error) { return Promise.reject(error); }
  };
  const requestId = () => `table-${++counter}`;
  const ensure = async (signal: AbortSignal, restoreModel: boolean, candidateSource?: Source) => {
    if (disposed) throw new Error('Table executor disposed');
    if (signal.aborted) throw aborted();
    if (!worker) {
      create();
      const current = generation;
      hydration = (async () => {
        await ready;
        if (current !== generation) throw resetReason;
        const acquired = candidateSource ?? source;
        if (acquired) { const registered = await send({ ...acquired, requestId: requestId(), revision: { widgetId, input: acquired.inputRevision, model: 0, output: 0 } }, 'registered', shared) as Extract<ExecutionResponse, { kind: 'registered' }>; fiscalSymbols = registered.fiscalSymbols; }
        if (current !== generation) throw resetReason;
      })();
    }
    const expectedGeneration = generation;
    await until(hydration!, signal);
    if (expectedGeneration !== generation) throw resetReason;
    if (signal.aborted) throw aborted();
    if (restoreModel && model && hydratedModel !== model) {
      const snapshot=model;
      if (!restoring) restoring=(async()=>{await send({...snapshot,kind:'applyModel',requestId:requestId()},'viewReady',shared);if(expectedGeneration===generation)hydratedModel=snapshot;})();
      const restoration=restoring;void restoration.catch(()=>{});
      try {await until(restoration,signal);} finally {if(restoring===restoration)restoring=undefined;}
      if(expectedGeneration!==generation)throw resetReason;
      if(signal.aborted)throw aborted();
    }
  };
  const acquire = async (next: Source, signal: AbortSignal) => {
    if (signal.aborted) throw aborted();
    if (disposed) throw new Error('Table executor disposed');
    const snapshot = structuredClone(next);
    const token = ++operation; applying = false; reset(aborted());
    acquiring = token;
    try {
      await ensure(signal, false, snapshot);
      if (token !== operation) throw aborted();
      source = snapshot; model = undefined; hydratedModel = undefined;
    } catch (error) {
      if (token === operation && acquiring === token) reset(error);
      throw error;
    } finally {
      if (acquiring === token) acquiring = undefined;
    }
  };
  const read = async (revision: Revision, command: object, kind: ExecutionResponse['kind'], signal: AbortSignal) => {
    await ensure(signal, true);
    return send({ ...command, revision, requestId: requestId() } as ExecutionRequest, kind, signal);
  };
  return {
    async previewDefinition(revision,definition,signal) {
      authoringPlainData(definition); authoringPlainData(revision);
      const command=validateExecutionRequest({kind:'previewDefinition',revision,definition,requestId:requestId()});
      await ensure(signal,false);
      return send(command,'previewDefinition',signal) as Promise<DefinitionPreview>;
    },
    async bindFormula(revision,request,signal) {
      authoringPlainData(request);authoringPlainData(revision);const command={...request,kind:'bindFormula' as const,revision,requestId:requestId()};authoringPlainData(command);const snapshot=validateExecutionRequest(command);await ensure(signal,false);
      return send(snapshot,'bindFormula',signal) as Promise<FormulaBindResult>;
    },
    async memberDomain(revision,request,signal) {
      authoringPlainData(request);authoringPlainData(revision);const command={...request,kind:'memberDomain' as const,revision,requestId:requestId()};authoringPlainData(command);const snapshot=validateExecutionRequest(command);await ensure(signal,false);
      return send(snapshot,'memberDomain',signal) as Promise<MemberDomainResult>;
    },
    async columnProfile(revision,request,signal) {
      authoringPlainData(request);authoringPlainData(revision);const command={...request,kind:'columnProfile' as const,revision,requestId:requestId()};authoringPlainData(command);const snapshot=validateExecutionRequest(command);await ensure(signal,false);
      return send(snapshot,'columnProfile',signal) as Promise<ColumnProfileResult>;
    },
    async inputSchema(signal) {
      await ensure(signal, false);
      return send({ kind: 'inputSchema', revision: inputRevision(), requestId: requestId() }, 'inputSchema', signal) as Promise<InputSchema>;
    },
    registerInput: (input, inputRevision, signal) => acquire({ kind: 'registerInput', input, inputRevision }, signal),
    importFile: async (name, bytes, inputRevision, signal, yearEnds) => { await acquire({ kind: 'importFile', name, bytes, inputRevision, ...(yearEnds ? { yearEnds } : {}) }, signal); return fiscalSymbols; },
    async applyModel(definition, selection, revision, signal, reconcileMissing = true, previousSelectionNamespace, provenAbsentIds, runtimeParams) {
      if (signal.aborted) throw aborted();
      const bounded=validateRuntimeParams(runtimeParams,definition);
      const snapshot = structuredClone({ definition, selection, revision, reconcileMissing, previousSelectionNamespace, provenAbsentIds, runtimeParams:bounded });
      if (applying || acquiring !== undefined) reset(aborted());
      else if (pending.size) reset(superseded());
      const token = ++operation; applying = true;
      try {
        await ensure(signal, false);
        if (token !== operation) throw aborted();
        const result = await send({ kind: 'applyModel', ...snapshot, requestId: requestId() }, 'viewReady', signal) as ViewReady;
        model = snapshot; hydratedModel=snapshot;
        return result;
      } finally { if (token === operation) applying = false; }
    },
    identityWitness: (revision, path, ids, signal) => read(revision, { kind: 'identityWitness', path, ids }, 'identityWitness', signal) as Promise<IdentityWitnessResult>,
    selection: (revision, action, visibleIds, signal) => read(revision, { kind: 'selection', action, visibleIds }, 'selection', signal) as Promise<SelectionResult>,
    rows: (revision, request, signal) => read(revision, { kind: 'rows', request }, 'rows', signal) as Promise<RowBlock>,
    facets: (revision, categoryId, signal) => read(revision, { kind: 'facets', categoryId }, 'facets', signal) as Promise<FacetResult>,
    inspect: (revision, request, signal) => {runtimePlainData(request);return read(revision, { kind: 'inspect', ...request }, 'inspect', signal) as Promise<InspectionResult>;},
    totals: (revision, signal) => read(revision, { kind: 'totals' }, 'totals', signal) as Promise<TotalResult>,
    chartData: (revision, fields, signal) => read(revision, { kind: 'chartData', fields }, 'chartData', signal) as Promise<ChartResult>,
    async *presented(revision, signal, ignoreSelection) {
      await ensure(signal, true);
      const id = requestId(); const transferId = `transfer-${id}`; const current = generation;
      let sequence = 0;
      const cancel = () => {
        if (worker && current === generation) worker.postMessage({ kind: 'cancel', requestId: requestId(), revision, targetRequestId: id });
        cleanup();
      };
      const cleanup = () => { signal.removeEventListener('abort', cancel); streamCleanups.delete(cleanup); };
      signal.addEventListener('abort', cancel, { once: true });
      streamCleanups.add(cleanup);
      try {
        for (;;) {
          if (current !== generation) throw aborted();
          const command: ExecutionRequest = sequence === 0 ? { kind: 'presented', transferId, requestId: id, revision, ...(ignoreSelection ? { ignoreSelection } : {}) } : { kind: 'nextSubset', transferId, sequence, requestId: id, revision };
          const batch = await send(command, 'subset', signal) as SubsetBatch;
          if (batch.sequence !== sequence || batch.transferId !== transferId) throw new ExecutionProtocolError('INVALID_RESPONSE', 'Unexpected subset sequence');
          sequence++;
          if (batch.final) cleanup();
          yield batch;
          if (batch.final) return;
        }
      } finally { cancel(); }
    },
    dispose() { disposed = true; ++operation; reset(new Error('Table executor disposed')); source = undefined; model = undefined; },
  };
}
