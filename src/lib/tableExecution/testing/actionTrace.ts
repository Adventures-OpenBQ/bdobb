// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { encodeWire, decodeWire, type WireValue } from '../rust/wireCodec';
import type { WidgetDataset } from '../../widgetData/types';
import type { Revision, TableDefinition, TableExecutor, SelectionSpec, SelectionAction, RowRequest } from '../types';
export interface TraceFixture { dataset: WidgetDataset; definition: TableDefinition; selection: SelectionSpec }
export type TraceAction =
  | { kind: 'apply'; definition: TableDefinition; selection?: SelectionSpec }
  | { kind: 'select'; action: SelectionAction; visibleIds: string[] }
  | { kind: 'replace'; dataset?: WidgetDataset; reverse?: boolean }
  | { kind: 'rows'; request: RowRequest }
  | { kind: 'presented' }
  | { kind: 'chartData'; fields?: string[] };
export interface TraceObservation { action: 'initial' | TraceAction['kind']; revision: Revision; value: unknown }
/** Only transport-generated identifiers are omitted; numeric values (including -0) remain intact. */
export function normalizeTrace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTrace);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const envelope = typeof record.requestId === 'string' && typeof record.kind === 'string' && record.revision !== undefined;
    if (envelope) return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'requestId' && !(key === 'transferId' && record.kind === 'subset')));
    if ('proposed' in record && 'applied' in record) return {proposed:normalizeTrace(record.proposed),applied:normalizeTrace(record.applied)};
  }
  return value;
}
export async function runTrace(create: () => Promise<TableExecutor>, fixture: TraceFixture, actions: TraceAction[]): Promise<TraceObservation[]> {
  let executor: TableExecutor;
  try { executor = await create(); } catch (error) { throw new TraceExecutionError(error, 'acquire', -1, {widgetId:'trace',input:0,model:0,output:0}); }
  const signal = new AbortController().signal;
  let dataset = structuredClone(fixture.dataset), definition = structuredClone(fixture.definition), selection = structuredClone(fixture.selection);
  const revision: Revision = { widgetId: 'trace', input: 1, model: 0, output: 0 }, observations: TraceObservation[] = [];
  let fields: string[] = [];
  const apply = async () => { revision.model++; revision.output++; const ready = await executor.applyModel(definition, selection, { ...revision }, signal); fields = ready.columns.map(c => c.id); return ready; };
  const record = (action: TraceObservation['action'], value: unknown) => observations.push({ action, revision: { ...revision }, value: normalizeTrace(value) });
  let actionKind: TraceObservation['action'] = 'initial', actionIndex = -1;
  try {
    await executor.registerInput(dataset, revision.input, signal);
    record('initial', await apply());
    for (const [index, action] of actions.entries()) {
      actionKind = action.kind; actionIndex = index;
      let value: unknown;
      switch (action.kind) {
        case 'apply': definition = structuredClone(action.definition); if (action.selection) selection = structuredClone(action.selection); value = await apply(); break;
        case 'replace': dataset = structuredClone(action.dataset ?? dataset); if (action.reverse) dataset.rows.reverse(); revision.input++; await executor.registerInput(dataset, revision.input, signal); value = await apply(); break;
        case 'select': { const proposed = await executor.selection({ ...revision }, action.action, action.visibleIds, signal); selection = proposed.selection; value = { proposed, applied: await apply() }; break; }
        case 'rows': value = await executor.rows({ ...revision }, action.request, signal); break;
        case 'chartData': value = await executor.chartData({ ...revision }, action.fields ?? fields, signal); break;
        case 'presented': { const batches = []; for await (const batch of executor.presented({ ...revision }, signal)) batches.push(batch); value = batches; break; }
      }
      record(action.kind, value);
    }
    return observations;
  } catch (error) { throw new TraceExecutionError(error, actionKind, actionIndex, { ...revision }); } finally { executor.dispose(); }
}
/** Mulberry32: stable bounded traces with no dependence on Math.random or wall time. */
export function generateTrace(seed: number, steps: number): TraceAction[] {
  let state = seed >>> 0;
  const next = () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  let rawEligible = true;
  return Array.from({ length: steps }, (_, index): TraceAction => {
    const pick = Math.floor(next() * 10);
    if (pick === 0) return { kind: 'replace', reverse: true };
    if (pick === 1) return { kind: 'select', action: { kind: index % 2 ? 'clear' : 'all' }, visibleIds: ['r0'] };
    if (pick === 2) return { kind: 'select', action: rawEligible ? { kind: 'toggle', rowId: `r${Math.floor(next() * 3)}` } : {kind:'clear'}, visibleIds: ['r0'] };
    if (pick === 3) return { kind: 'presented' };
    if (pick === 4) return { kind: 'chartData' };
    if (pick === 5) return { kind: 'rows', request: { groupPath: [], offset: index % 3, limit: 1 } };
    const table: TableDefinition['table'] = pick === 6 ? { columnFilters: [{ id: 'revenue', value: { min: 15 } }] } : pick === 7 ? { sorting: [{ id: 'revenue', desc: next() > .5 }] } : pick === 8 ? { pivot: { enabled: true, grouping: ['region'], split: index % 2 ? ['team'] : [], aggregationFns: { revenue: 'sum' } } } : {};
    rawEligible = pick !== 6 && pick !== 8;
    return { kind: 'apply', definition: { table, search: '' }, ...(pick === 9 ? { selection: { kind: 'none' as const } } : {}) };
  });
}
export interface ReplayTrace { version: 1; seed: number; fixture: TraceFixture; actions: TraceAction[]; failure?: {failureClass:string;ts?:TraceExecutionFailure;wasm?:TraceExecutionFailure} }
/** The existing wire codec escapes every user object and preserves missing values and numeric tags. */
export function serializeTrace(trace: ReplayTrace): string {
  const value = encodeWire(trace), holes: string[][] = [];
  const collect = (child: unknown, path: string[]) => {
    if (!child || typeof child !== 'object') return;
    if (Array.isArray(child)) for (let i = 0; i < child.length; i++) if (!Object.hasOwn(child,i)) holes.push([...path,String(i)]);
    for (const key of Object.keys(child)) collect((child as Record<string,unknown>)[key],[...path,key]);
  };
  collect(trace,[]);
  // The wire codec materializes array holes; this out-of-band shape restores their presence exactly.
  return JSON.stringify({format:'pivot-action-trace/wire-v1',value,holes},null,2);
}
export function parseTrace(json: string): ReplayTrace {
  const encoded = JSON.parse(json) as {format?:string;value:WireValue;holes:string[][]};
  if (encoded.format !== 'pivot-action-trace/wire-v1' || !Array.isArray(encoded.holes)) throw new Error('Unsupported trace encoding');
  const trace = decodeWire(encoded.value) as ReplayTrace;
  for (const path of encoded.holes) {
    if (!Array.isArray(path) || !path.length || path.some(key=>typeof key !== 'string')) throw new Error('Invalid trace array shape');
    let parent: unknown = trace;
    for (const key of path.slice(0,-1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent,key)) throw new Error('Invalid trace array path');
      parent = (parent as Record<string,unknown>)[key];
    }
    const index = path.at(-1)!;
    if (!Array.isArray(parent) || !/^(0|[1-9][0-9]*)$/.test(index) || Number(index) >= parent.length) throw new Error('Invalid trace array index');
    delete parent[Number(index)];
  }
  if (!trace || trace.version !== 1 || !Array.isArray(trace.actions)) throw new Error('Unsupported trace');
  return trace;
}
export interface TraceExecutionFailure { action: TraceObservation['action'] | 'acquire'; actionIndex: number; revision: Revision; name: string; message: string; code?: string }
class TraceExecutionError extends Error {
  readonly failure: TraceExecutionFailure;
  constructor(error: unknown, action: TraceExecutionFailure['action'], actionIndex: number, revision: Revision) {
    super(error instanceof Error ? error.message : String(error), {cause:error});
    const descriptor = (error as {descriptor?:{code?:unknown}} | null)?.descriptor;
    this.failure = {action,actionIndex,revision,name:error instanceof Error ? error.name : 'ThrownValue',message:this.message,...(typeof descriptor?.code === 'string' ? {code:descriptor.code} : {})};
  }
}
export type TraceOutcome = {kind:'success';observations:TraceObservation[]} | {kind:'failure';failure:TraceExecutionFailure};
export async function captureTrace(create:()=>Promise<TableExecutor>,fixture:TraceFixture,actions:TraceAction[]):Promise<TraceOutcome> {
  try { return {kind:'success',observations:await runTrace(create,fixture,actions)}; }
  catch(error) {
    if (!(error instanceof TraceExecutionError)) throw error;
    return {kind:'failure',failure:error.failure};
  }
}
export function traceOutcomeMismatchClass(ts:TraceOutcome,wasm:TraceOutcome):string|null {
  const signature = (engine:string,outcome:TraceOutcome) => outcome.kind === 'failure' ? `${engine}:${outcome.failure.action}:${outcome.failure.name}${outcome.failure.code ? `:${outcome.failure.code}` : ''}:${JSON.stringify(outcome.failure.message)}` : '';
  if (ts.kind === 'failure' || wasm.kind === 'failure') return `execution:${[signature('ts',ts),signature('wasm',wasm)].filter(Boolean).join('|')}`;
  return traceMismatchClass(ts.observations,wasm.observations);
}
export interface TraceParityFailure {failureClass:string;ts:TraceOutcome;wasm:TraceOutcome;minimized:TraceAction[]}
/** Persist the complete input before minimization; unexpected reduction errors cannot erase it. */
export async function qualifyTrace(tsCreate:()=>Promise<TableExecutor>,wasmCreate:()=>Promise<TableExecutor>,replay:ReplayTrace,save:(suffix:'full'|'minimized',trace:ReplayTrace,failureClass:string)=>void):Promise<TraceParityFailure|null> {
  const ts = await captureTrace(tsCreate,replay.fixture,replay.actions), wasm = await captureTrace(wasmCreate,replay.fixture,replay.actions);
  const failureClass = traceOutcomeMismatchClass(ts,wasm);
  if (!failureClass) return null;
  const failedReplay: ReplayTrace = {...replay,failure:{failureClass,...(ts.kind === 'failure' ? {ts:ts.failure} : {}),...(wasm.kind === 'failure' ? {wasm:wasm.failure} : {})}};
  save('full',failedReplay,failureClass);
  const minimized = await reduceTrace(replay.actions,async actions=>{
    const candidateClass = traceOutcomeMismatchClass(await captureTrace(tsCreate,replay.fixture,actions),await captureTrace(wasmCreate,replay.fixture,actions));
    return candidateClass === failureClass ? candidateClass : null;
  });
  save('minimized',{...failedReplay,actions:minimized},failureClass);
  return {failureClass,ts,wasm,minimized};
}
/** Deletion reducer retains the original semantic mismatch class, never any arbitrary failure. */
export async function reduceTrace(actions: TraceAction[], classify: (actions: TraceAction[]) => Promise<string | null>): Promise<TraceAction[]> {
  const failure = await classify(actions);
  if (!failure) throw new Error('Trace does not fail');
  let reduced = actions.slice();
  for (let i = 0; i < reduced.length;) {
    const candidate = reduced.filter((_, index) => index !== i);
    if (await classify(candidate) === failure) { reduced = candidate; i = 0; } else i++;
  }
  return reduced;
}
/** Stable public failure categories used by minimization and persisted replay diagnostics. */
export function traceMismatchClass(left: unknown, right: unknown, path: string[] = []): string | null {
  if (Object.is(left, right)) return null;
  const category = () => path.includes('cellErrors') ? 'cell-errors' : path.includes('values') ? 'cells' : path.includes('provenance') ? 'provenance' : path.includes('completeness') ? 'completeness' : path.some(p => /selection|proposed/i.test(p)) ? 'selection' : path.includes('rows') || path.includes('groups') ? 'identities-order' : path.includes('revision') ? 'revision' : 'public-shape';
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return category();
    for (let i = 0; i < left.length; i++) { const failure = traceMismatchClass(left[i], right[i], [...path, String(i)]); if (failure) return failure; }
    return null;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a) || !(key in b)) return traceMismatchClass(a[key], b[key], [...path, key]) ?? category();
      const failure = traceMismatchClass(a[key], b[key], [...path, key]); if (failure) return failure;
    }
    return null;
  }
  return category();
}
