// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Actual emitted Wasm, independently checked against the frozen-compatible TS engine.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, platform, release, arch, cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { workloads } from './matched-executors-workloads.mjs';
import { waitForOwnedServer } from './matched-executors-driver-utils.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), script = fileURLToPath(import.meta.url), args = process.argv.slice(2);
const argument = (key, fallback) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at + 1]; };
const samples = Number(argument('--samples', '3'));
const artifactDirectory = resolve(argument('--artifact-directory', join(root, 'src/lib/tableExecution/rust/generated')));
const artifactRevision = argument('--artifact-revision', null);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20)
    throw new Error('--samples must be 1–20');
const rounded = value => Math.round(value * 1000) / 1000;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const names = argument('--workloads', 'small,large,largeRaw,wide,mixed,fiscal,formula').split(',');
async function bundle(dir) {
    const source = `export {encodeRequest,decodeResponse} from ${JSON.stringify(join(root, 'src/lib/tableExecution/rust/protocol.ts'))};export {decodeWire,encodeWire} from ${JSON.stringify(join(root, 'src/lib/tableExecution/rust/wireCodec.ts'))};export {LocaleOrderBridge} from ${JSON.stringify(join(root, 'src/lib/tableExecution/rust/orderingBridge.ts'))};export {calculateView} from ${JSON.stringify(join(root, 'src/lib/tableExecution/engine.ts'))};`;
    const path = join(dir, 'benchmark-tools.mjs');
    await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'benchmark-tools.ts' }, bundle: true, format: 'esm', platform: 'node', outfile: path, logLevel: 'silent' });
    return path;
}
function equivalent(actual, expected, path = '') {
    if (typeof actual === 'number' && typeof expected === 'number' && /(ratio|margin|mean|avg)/i.test(path) && Number.isFinite(actual) && Number.isFinite(expected)) {
        assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, 1e-12 * Math.max(Math.abs(actual), Math.abs(expected))), path);
        return;
    }
    if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
        assert.equal(Array.isArray(actual), Array.isArray(expected), path);
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
        for (const key of Object.keys(expected))
            equivalent(actual[key], expected[key], `${path}.${key}`);
        return;
    }
    assert.deepEqual(actual, expected, path);
}
async function runCase(name, tools) {
    const c = (await workloads(tools))[name];
    if (!c)
        throw new Error('Unknown benchmark case');
    const workloadSha256 = createHash('sha256').update(JSON.stringify(tools.encodeWire(c))).digest('hex');
    const module = await import(pathToFileURL(join(artifactDirectory, 'pivot_wasm.js')).href);
    const bytes = await readFile(join(artifactDirectory, 'pivot_wasm_bg.wasm'));
    const initStart = performance.now();
    const exports = await module.default({ module_or_path: bytes });
    const initializationMs = performance.now() - initStart;
    const crossings = { scalar: 0, raw: 0, recipe: 0, sort: 0 }, bridge = new tools.LocaleOrderBridge('en-US');
    const host = { wire: JSON.stringify({ protocolVersion: 1, locale: 'en-US' }), order(json) { const q = JSON.parse(json); crossings[q.kind]++; let result; switch (q.kind) {
            case 'scalar':
                result = bridge.compare(q.a, q.b);
                break;
            case 'raw': {
                const raw = bridge.compareRaw(q.a, q.b);
                result = Number.isNaN(raw) ? 'unordered' : Math.sign(raw) || 0;
                break;
            }
            case 'recipe':
                result = bridge.compareRecipe(q.a, q.b);
                break;
            case 'sort':
                result = bridge.sortPermutation(q.values, q.descending);
                break;
            default: throw new Error('Unknown host order operation');
        } return JSON.stringify({ ok: result }); } };
    const phase = { openSession: [], inputConversion: [], inputRustDispatch: [], applyConversion: [], applyRustDispatch: [], responseConversion: [], baselineCalculation: [], exportConversion: [], exportRustDispatch: [], exportResponseConversion: [], repeatedEdits: [] };
    let peakStageRss = process.memoryUsage().rss, peakStageHeap = process.memoryUsage().heapUsed, peakLinear = exports.memory.buffer.byteLength, inputEncodedBytes = 0, exportEncodedBytes = 0, usage, outputRows, outputColumns;
    const observe = () => { const memory = process.memoryUsage(); peakStageRss = Math.max(peakStageRss, memory.rss); peakStageHeap = Math.max(peakStageHeap, memory.heapUsed); peakLinear = Math.max(peakLinear, exports.memory.buffer.byteLength); };
    for (let sample = 0; sample < samples; sample++) {
        let r = { widgetId: 'source', input: c.dataset.resultRevision, model: 1, output: 1 }, requestId = 0;
        let start = performance.now();
        const handle = module.open_session(host);
        phase.openSession.push(performance.now() - start);
        const call = (command, encodePhase, dispatchPhase, decodePhase) => { const request = { requestId: `bench-${++requestId}`, revision: r, ...command }; let tick = performance.now(); const encoded = tools.encodeRequest(request, 'en-US', handle); if (encodePhase)
            phase[encodePhase].push(performance.now() - tick); if (command.kind === 'registerInput')
            inputEncodedBytes = Buffer.byteLength(encoded); observe(); tick = performance.now(); const result = module.dispatch(handle, encoded); if (dispatchPhase)
            phase[dispatchPhase].push(performance.now() - tick); observe(); tick = performance.now(); const response = tools.decodeResponse(result, request, handle, command.kind === 'applyModel' ? 'raw' : c.definition.analytical ? 'analytical' : c.definition.table.pivot?.enabled ? 'legacy' : 'raw'); if (decodePhase)
            phase[decodePhase].push(performance.now() - tick); observe(); if (response?.kind === 'error')
            throw new Error(JSON.stringify(response.error)); return { response, bytes: Buffer.byteLength(result) }; };
        try {
            call({ kind: 'registerInput', input: c.dataset, inputRevision: r.input }, 'inputConversion', 'inputRustDispatch', 'responseConversion');
            const { response: ready } = call({ kind: 'applyModel', definition: c.definition, selection: { kind: 'none' }, reconcileMissing: false, runtimeParams: c.runtimeParams }, 'applyConversion', 'applyRustDispatch', 'responseConversion');
            outputColumns = ready.columns.length;
            start = performance.now();
            const baseline = tools.calculateView(c.dataset, c.definition, { kind: 'none' }, false, undefined, [], c.runtimeParams);
            phase.baselineCalculation.push(performance.now() - start);
            observe();
            const chart = call({ kind: 'chartData', fields: ready.columns.map(col => col.id) }).response;
            const baselineRows = baseline.presentedRows.map(row => ({ ...row, values: Object.fromEntries(Object.entries(row.values).filter(([key]) => ready.columns.some(col => col.id === key))), ...(row.cellErrors ? { cellErrors: Object.fromEntries(Object.entries(row.cellErrors).filter(([key]) => ready.columns.some(col => col.id === key))) } : {}), ...(row.cellFormats ? { cellFormats: Object.fromEntries(Object.entries(row.cellFormats).filter(([key]) => ready.columns.some(col => col.id === key))) } : {}) }));
            equivalent(chart.rows, baselineRows, `${name}.rows`);
            equivalent(call({ kind: 'totals' }).response.values, baseline.totals.values, `${name}.totals`);
            outputRows = chart.rows.length;
            const transferId = 'bench-stream', streamRequestId = `bench-${requestId + 1}`;
            let sequence = 0, rows = 0;
            for (;;) {
                const request = { requestId: streamRequestId, revision: r, ...(sequence === 0 ? { kind: 'presented', transferId, ignoreSelection: true } : { kind: 'nextSubset', transferId, sequence }) };
                start = performance.now();
                const encoded = tools.encodeRequest(request, 'en-US', handle);
                phase.exportConversion.push(performance.now() - start);
                start = performance.now();
                const text = module.dispatch(handle, encoded);
                phase.exportRustDispatch.push(performance.now() - start);
                exportEncodedBytes += Buffer.byteLength(text);
                observe();
                start = performance.now();
                const batch = tools.decodeResponse(text, request, handle, c.definition.analytical ? 'analytical' : c.definition.table.pivot?.enabled ? 'legacy' : 'raw');
                phase.exportResponseConversion.push(performance.now() - start);
                if (batch.kind !== 'subset')
                    throw new Error(JSON.stringify(batch));
                equivalent(batch.rows, baselineRows.slice(rows, rows + batch.rows.length), `${name}.export`);
                rows += batch.rows.length;
                if (batch.final)
                    break;
                sequence++;
            }
            assert.equal(rows, outputRows);
            for (let edit = 0; edit < 5; edit++) {
                r = { ...r, model: r.model + 1, output: r.output + 1 };
                start = performance.now();
                call({ kind: 'applyModel', definition: { ...c.definition, table: { ...c.definition.table, sorting: [{ id: ready.columns.at(-1).id, desc: edit % 2 === 0 }] } }, selection: { kind: 'none' }, reconcileMissing: false, runtimeParams: c.runtimeParams });
                phase.repeatedEdits.push(performance.now() - start);
            }
            usage = JSON.parse(module.resource_usage(handle));
            observe();
        }
        finally {
            module.close_session(handle);
            observe();
        }
    }
    return { name, workloadSha256, inputRows: c.dataset.rows.length, inputColumns: c.dataset.columns.length, inputEncodedBytes, outputRows, outputColumns, samples, initializationMs: rounded(initializationMs), timingsMs: Object.fromEntries(Object.entries(phase).map(([name, values]) => [name, { median: rounded(median(values)), observations: values.map(rounded) }])), collationCrossings: crossings, hostCacheEstimatedBytes: bridge.cacheBytes, exportEncodedBytesAllSamples: exportEncodedBytes, resourceUsage: usage, memory: { wasmLinearMemoryHighWaterBytes: peakLinear, nodeStageBoundaryRssMaxBytes: peakStageRss, nodeStageBoundaryHeapMaxBytes: peakStageHeap, processPeakBytes: null }, parity: 'Projected chart rows and totals match TS; exact except documented 1e-12 relative/absolute mean/ratio tolerance.' };
}
if (args.includes('--case')) {
    const tools = await import(pathToFileURL(argument('--bundle')).href);
    process.stdout.write(JSON.stringify(await runCase(argument('--case'), tools)));
}
else {
    const dir = await mkdtemp(join(tmpdir(), 'pivot-benchmark-'));
    let server;
    try {
        const toolPath = await bundle(dir), tools = await import(pathToFileURL(toolPath).href);
        const node = [];
        for (const name of names) {
            process.stderr.write(`Measuring ${name} (${samples} samples)...\n`);
            const child = spawnSync(process.execPath, [script, '--case', name, '--bundle', toolPath, '--samples', String(samples), '--artifact-directory', artifactDirectory], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
            if (child.status !== 0)
                throw new Error(child.stderr || child.stdout);
            node.push(JSON.parse(child.stdout));
            process.stderr.write(`Measured ${name}: ${node.at(-1).inputRows} rows\n`);
        }
        const browsers = {};
        if (args.includes('--browser')) {
            if (args.includes('--artifact-directory')) throw new Error('Alternate artifacts support isolated Node measurements only');
            const { chromium, webkit } = await import('@playwright/test');
            server = spawn(process.execPath, ['scripts/pivot-browser-server.mjs'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
            server.errorOutput = '';
            server.stderr.on('data', chunk => { server.errorOutput += chunk; });
            // No owner token: any healthy server on 4175 is accepted, as before.
            await waitForOwnedServer(server, async () => ({ ok: (await fetch('http://127.0.0.1:4175/health')).ok, owner: null }), null);
            for (const [name, engine] of Object.entries({ chromium, webkit })) {
                const browser = await engine.launch({ headless: true });
                try {
                    const page = await browser.newPage();
                    await page.goto('http://127.0.0.1:4175/built/');
                    await page.waitForFunction(() => !!globalThis.pivotBenchmarkHarness);
                    browsers[name] = { browserVersion: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), cases: [] };
                    for (const [caseName, c] of Object.entries(await workloads(tools)).filter(([name])=>names.includes(name))) {
                        const wire = tools.encodeWire(c);
                        const result = await page.evaluate(async (wire) => { return globalThis.pivotBenchmarkHarness.browserBenchmark(globalThis.pivotBenchmarkHarness.decode(wire)); }, wire);
                        browsers[name].cases.push({ name: caseName, ...result });
                    }
                }
                finally {
                    await browser.close();
                }
            }
        }
        const result = { schemaVersion: 1, benchmarkScriptSha256: createHash('sha256').update(await readFile(script)).digest('hex'), measuredAt: new Date().toISOString(), activation: { default: 'typescript', regularIpadPhysicalEvidence: null, blocked: true }, platform: { os: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, physicalMemoryBytes: totalmem(), node: process.version }, toolchain: JSON.parse(await readFile(join(root, 'scripts/pivot-toolchain.json'), 'utf8')), artifact: { wasmSha256: createHash('sha256').update(await readFile(join(artifactDirectory, 'pivot_wasm_bg.wasm'))).digest('hex'), baseRevision: artifactRevision ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), sourceWorkingTreeMayIncludeUncommittedTaskChanges: true }, methods: { node: 'Fresh child process and Wasm instance per workload. Timed encodeRequest (validation+clone+wire/JSON), actual Wasm dispatch (parse+calculation+publication+serialization), decodeResponse, registration, five successive edits per sample, and pulled export batches. TS calculation excludes transport; no comparable speedup claim.', memory: 'Wasm linear-memory pages are a monotonic instance high-water including free capacity, sampled after every call. Node RSS/heap are stage-boundary samples including TS oracle and conversion; not exact process peak. Safari/worker process peak unavailable.', state: 'resource_usage reports conservative recursive owned-field estimates, not actual allocator bytes or process memory.', browser: 'Actual Web Workers: wall-clock registration (includes module initialization and source conversion), apply/edit round trips, and pulled export across structured-clone transport. Browser memory unavailable.' }, node, browsers };
        const output = resolve(argument('--output', join(root, 'docs/releases/validation/rust-pivot/measurements.json')));
        await mkdir(resolve(output, '..'), { recursive: true });
        await writeFile(output, JSON.stringify(result, null, 2) + '\n');
        process.stdout.write(`Saved ${output}\n`);
    }
    finally {
        server?.kill('SIGTERM');
        await rm(dir, { recursive: true, force: true });
    }
}
