// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { decodeWire } from '../../src/lib/tableExecution/rust/wireCodec';
import { createRustExecutor, type ResourceLimits } from '../../src/lib/tableExecution/rust/runtime';
import { input, revision } from '../../src/lib/tableExecution/fixtures';
import type { LocalWorkerExecutor } from '../../src/lib/tableExecution/types';
const signal = new AbortController().signal, raw = { table: {}, search: '' };
async function refused(work: () => Promise<unknown>) { try {
    await work();
    return 'accepted';
}
catch (error) {
    return (error as {
        descriptor?: {
            code: string;
        };
    }).descriptor?.code ?? (error as Error).message;
} }
async function withExecutor<T>(limits: ResourceLimits, work: (executor: LocalWorkerExecutor) => Promise<T>): Promise<T> { const executor = createRustExecutor('source', undefined, limits); try {
    return await work(executor);
}
finally {
    executor.dispose();
} }
export async function resourceProbe() {
    const admission = await withExecutor({ maxInputBytes: 1 }, executor => refused(() => executor.registerInput(input, 1, signal)));
    const state = await withExecutor({ maxStateBytes: 1 }, executor => refused(() => executor.registerInput(input, 1, signal)));
    const width = await withExecutor({ maxPivotColumns: 4 }, async (executor) => { await executor.registerInput(input, 1, signal); await executor.applyModel(raw, { kind: 'none' }, revision, signal); const error = await refused(() => executor.applyModel({ table: { pivot: { enabled: true, grouping: ['region'], split: ['team'] } }, search: '' }, { kind: 'none' }, { ...revision, model: 2, output: 2 }, signal)); return { error, rows: (await executor.rows(revision, { groupPath: [], offset: 0, limit: 3 }, signal)).rows.map(r => r.id), totalRevision: (await executor.totals(revision, signal)).revision.model }; });
    const reacquisition = await withExecutor({ maxRows: 3 }, async (executor) => { await executor.registerInput(input, 1, signal); await executor.applyModel(raw, { kind: 'none' }, revision, signal); const error = await refused(() => executor.registerInput({ ...input, rows: [...input.rows, { id: 'extra', values: { revenue: 999 } }] }, 2, signal)); return { error, totalRevision: (await executor.totals(revision, signal)).revision.model }; });
    const cache = await withExecutor({ maxCachedBlockBytes: 1 }, async (executor) => { await executor.registerInput(input, 1, signal); await executor.applyModel(raw, { kind: 'none' }, revision, signal); return { error: await refused(() => executor.rows(revision, { groupPath: [], offset: 0, limit: 1 }, signal)), totalRevision: (await executor.totals(revision, signal)).revision.model }; });
    const batch = await withExecutor({ maxBatchBytes: 2000 }, async (executor) => { await executor.registerInput({ ...input, completeness: { ...input.completeness, warnings: ['metadata'.repeat(1000)] } }, 1, signal); await executor.applyModel(raw, { kind: 'none' }, revision, signal); return { error: await refused(async () => { for await (const _batch of executor.presented(revision, signal, true)) {
            void _batch;
        } }), totalRevision: (await executor.totals(revision, signal)).revision.model }; });
    const backpressure = await withExecutor({ maxConcurrentTransfers: 1 }, async (executor) => { await executor.registerInput({ ...input, rows: Array.from({ length: 1001 }, (_, i) => ({ id: `r${i}`, values: { revenue: i } })) }, 1, signal); await executor.applyModel(raw, { kind: 'none' }, revision, signal); const stream = executor.presented(revision, signal, true)[Symbol.asyncIterator](); const first = await stream.next(); const rejected = await refused(() => executor.presented(revision, signal, true)[Symbol.asyncIterator]().next()); await stream.return?.(); const replacement = executor.presented(revision, signal, true)[Symbol.asyncIterator](); const released = await replacement.next(); await replacement.return?.(); return { rows: first.value?.rows.length, final: first.value?.final, rejected, released: released.value?.rows.length }; });
    return { admission, state, width, reacquisition, cache, batch, backpressure };
}
export async function replacementProbe() {
    let workers = 0, terminated = 0;
    let posted!: () => void;
    const postedPromise = new Promise<void>(resolve => { posted = resolve; });
    const executor = createRustExecutor('source', () => { workers++; const worker = new Worker(new URL('../../src/lib/tableExecution/rust/rust.worker.ts', import.meta.url), { type: 'module' }); const post = worker.postMessage.bind(worker); worker.postMessage = ((data: import('../../src/lib/tableExecution/types').ExecutionRequest) => { post(data); if (data.kind === 'applyModel' && data.revision.model === 2)
        posted(); }) as typeof worker.postMessage; const terminate = worker.terminate.bind(worker); worker.terminate = () => { terminated++; terminate(); }; return worker; });
    try {
        await executor.registerInput(input, 1, signal);
        await executor.applyModel(raw, { kind: 'none' }, revision, signal);
        const abort = new AbortController();
        const candidate = executor.applyModel({ table: {}, search: 'B' }, { kind: 'allMatching', excludedIds: [] }, { ...revision, model: 2, output: 2 }, abort.signal);
        await postedPromise;
        abort.abort();
        const rejected = await refused(() => candidate);
        const restored = await executor.rows(revision, { groupPath: [], offset: 0, limit: 3 }, signal);
        return { rejected, workers, terminated, ids: restored.rows.map(r => r.id), totalRevision: (await executor.totals(revision, signal)).revision.model, selection: restored.selection?.selection };
    }
    finally {
        executor.dispose();
    }
}
/** Native WebWorker termination is silent. Recovery is explicitly driven by the
 * supported cancellation/reset path; this does not simulate an error event. */
export async function terminatedWorkerProbe() {
    const workers: Worker[] = [];
    let posted!: () => void;
    const postedPromise = new Promise<void>(resolve => { posted = resolve; });
    const executor = createRustExecutor('source', () => {
        const worker = new Worker(new URL('../../src/lib/tableExecution/rust/rust.worker.ts', import.meta.url), { type: 'module' });
        workers.push(worker);
        const post = worker.postMessage.bind(worker);
        worker.postMessage = ((request: import('../../src/lib/tableExecution/types').ExecutionRequest) => {
            post(request);
            if (request.kind === 'applyModel' && request.revision.model === 2) posted();
        }) as typeof worker.postMessage;
        return worker;
    });
    try {
        await executor.registerInput(input, 1, signal);
        await executor.applyModel(raw, { kind: 'explicit', ids: ['r2'] }, revision, signal);
        const before = await executor.chartData(revision, ['region', 'revenue'], signal);
        workers[0].terminate(); // Actual browser API; it emits no error notification.
        const abort = new AbortController();
        const candidate = executor.applyModel({ table: {}, search: 'A' }, { kind: 'none' }, { ...revision, model: 2, output: 2 }, abort.signal);
        await postedPromise;
        abort.abort();
        const rejected = await refused(() => candidate);
        const restored = await executor.chartData(revision, ['region', 'revenue'], signal);
        return { route: 'WebWorker.terminate -> pending apply abort -> reset and rehydrate', rejected, workers: workers.length,
            before: before.rows.map(row => row.values.revenue), after: restored.rows.map(row => row.values.revenue), revision: restored.revision,
            selection: (await executor.rows(revision, { groupPath: [], offset: 0, limit: 3 }, signal)).selection?.selection };
    } finally { executor.dispose(); }
}
export async function malformedFileProbe() {
    const executor = createRustExecutor('source');
    const malformed = () => executor.importFile('broken.json', new TextEncoder().encode('{'), 2, signal);
    try {
        const first = await refused(malformed);
        await executor.registerInput(input, 1, signal);
        await executor.applyModel(raw, { kind: 'none' }, revision, signal);
        const replacement = await refused(malformed);
        // Failed replacement acquisition preserves the last committed source/model;
        // the next read rehydrates it in a fresh actual worker.
        const retained = await executor.chartData(revision, ['region', 'revenue'], signal);
        await executor.importFile('repaired.csv', new TextEncoder().encode('region,revenue\nRecovered,7\n'), 3, signal);
        const next = { ...revision, input: 3, model: 3, output: 3 };
        await executor.applyModel(raw, { kind: 'none' }, next, signal);
        const repaired = await executor.chartData(next, ['region', 'revenue'], signal);
        return { first, replacement, retained: retained.rows.map(row => row.values.revenue), retainedRevision: retained.revision,
            repaired: repaired.rows.map(row => row.values.revenue), repairedRevision: repaired.revision };
    } finally { executor.dispose(); }
}
Object.assign(window, { pivotResourceHarness: { resourceProbe, replacementProbe, terminatedWorkerProbe, malformedFileProbe } });
export async function browserBenchmark(c: {
    dataset: import('../../src/lib/widgetData/types').WidgetDataset;
    definition: import('../../src/lib/tableExecution/types').TableDefinition;
    runtimeParams: import('../../src/lib/tableExecution/runtimeParams').RuntimeParams;
}) {
    const executor = createRustExecutor('source');
    let model = 1;
    const timings: Record<string, number> = {};
    const now = () => performance.now();
    let started = now();
    try {
        await executor.registerInput(c.dataset, c.dataset.resultRevision, signal);
        timings.registrationIncludingWorkerInitMs = now() - started;
        let r = { ...revision, input: c.dataset.resultRevision };
        started = now();
        const ready = await executor.applyModel(c.definition, { kind: 'none' }, r, signal, false, undefined, [], c.runtimeParams);
        timings.applyWorkerRoundTripMs = now() - started;
        const edits = [];
        for (let i = 0; i < 5; i++) {
            r = { ...r, model: ++model, output: model };
            started = now();
            await executor.applyModel({ ...c.definition, table: { ...c.definition.table, sorting: [{ id: ready.columns.at(-1)!.id, desc: i % 2 === 0 }] } }, { kind: 'none' }, r, signal, false, undefined, [], c.runtimeParams);
            edits.push(now() - started);
        }
        started = now();
        let rows = 0, batches = 0;
        for await (const batch of executor.presented(r, signal, true)) {
            rows += batch.rows.length;
            batches++;
        }
        timings.exportWorkerRoundTripMs = now() - started;
        return { timings, repeatedEditWorkerRoundTripMs: edits, outputColumns: ready.columns.length, exportRows: rows, exportBatches: batches, memory: { workerLinearMemoryBytes: null, processPeakBytes: null, method: 'Worker memory is not exposed; no exact browser/Safari process peak is available.' } };
    }
    finally {
        executor.dispose();
    }
}
Object.assign(window, { pivotBenchmarkHarness: { browserBenchmark, decode: decodeWire } });
