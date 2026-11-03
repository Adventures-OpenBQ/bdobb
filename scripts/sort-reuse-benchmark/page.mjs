// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/* global Worker */
import { createWorkerExecutor } from "../../src/lib/tableExecution/workerClient.ts";
import { decodeWire } from "../../src/lib/tableExecution/rust/wireCodec.ts";
async function run(mode, wire, options = {}) {
  const c = decodeWire(JSON.parse(wire)), controller = new AbortController(), signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), 6e4), workers = [];
  const budget = options.budget ?? 536870912;
  const executor = createWorkerExecutor("source", () => {
    const worker = new Worker("/worker.js", { type: "module", name: mode === "indexed" ? `bdobb-experimental-sort-reuse:${budget}` : "" });
    workers.push(worker);
    return worker;
  });
  let rev = { widgetId: "source", input: c.dataset.resultRevision, model: 1, output: 1 };
  let definition = structuredClone(c.definition), runtime = c.runtimeParams ?? {};
  if (options.scenario === "runtime") {
    const category = definition.analytical.categories[0].id;
    definition.analytical.params.filters = [{ id: "audit-runtime", categoryId: category, label: "Audit runtime", multiSelect: true }];
    runtime = { [`pivot:filter:${category}`]: { source: "viewer", memberKeys: null } };
  }
  if (options.scenario === "freshness") c.dataset.freshness.diagnostics = ["audit freshness"];
  async function publication(ready) {
    const blocks = [];
    const visit = async (path) => {
      for (let offset = 0; ; ) {
        const b = await executor.rows(rev, { groupPath: path, offset, limit: 100 }, signal);
        blocks.push(b);
        for (const g of b.groups) await visit(g.path);
        offset += b.rows.length;
        if (offset >= b.siblingCount || !b.rows.length) break;
      }
    };
    await visit([]);
    const totals = await executor.totals(rev, signal), chart = await executor.chartData(rev, ready.columns.map((c2) => c2.id), signal), facets = [];
    for (const category of ready.inspection.definition.analytical.categories) facets.push(await executor.facets(rev, category.id, signal));
    const inspection = [];
    for (const collection of ["definitions", "warnings", "periodBounds"]) inspection.push(await executor.inspect(rev, { collection, offset: 0, limit: 100 }, signal));
    const exports = [];
    for (const ignore of [false, true]) {
      const batches = [];
      for await (const b of executor.presented(rev, signal, ignore)) batches.push(b);
      exports.push(batches);
    }
    return { ready, blocks, totals, chart, facets, inspection, exports };
  }
  const apply = async (d, selection = { kind: "none" }) => {
    const start = performance.now(), ready = await executor.applyModel(d, selection, rev, signal, options.scenario === "unsupported" ? false : true, void 0, void 0, runtime);
    const ms = performance.now() - start;
    return { ready, ms };
  };
  try {
    await executor.registerInput(c.dataset, rev.input, signal);
    const sourceSort = c.dataset.columns.find((c2) => c2.dtype === "number")?.id;
    if (sourceSort) definition.table.sorting = [{ id: sourceSort, desc: true }];
    const initial = await apply(definition, options.scenario === "selection" ? { kind: "explicit", ids: ["absent-audit-id"] } : { kind: "none" });
    const initialSnapshot = options.validate ? await publication(initial.ready) : void 0;
    const target = initial.ready.columns.find((c2) => c2.id !== "group")?.id;
    const sorted = structuredClone(definition);
    sorted.table.sorting = [{ id: target, desc: options.desc ?? true }];
    rev = { ...rev, model: 2, output: 2 };
    if (options.scenario === "runtime") {
      const key = Object.keys(runtime)[0];
      runtime = { [key]: { source: "viewer", memberKeys: [] } };
    }
    if (options.scenario === "model") sorted.analytical.formulas[0].name += " edited";
    if (options.scenario === "source") {
      const input = structuredClone(c.dataset), field = sourceSort;
      if (field) input.rows[0].values[field] = 12345;
      await executor.registerInput(input, rev.input, signal);
    }
    const warm = await apply(sorted);
    const snapshot = options.validate ? await publication(warm.ready) : void 0;
    let follow;
    if (["runtime", "model", "source"].includes(options.scenario)) {
      rev = { ...rev, model: 3, output: 3 };
      const next = structuredClone(sorted);
      next.table.sorting[0].desc = !next.table.sorting[0].desc;
      const result = await apply(next);
      follow = options.validate ? await publication(result.ready) : void 0;
    }
    return { initialMs: initial.ms, applyMs: warm.ms, initialSnapshot, snapshot, follow };
  } finally {
    clearTimeout(timeout);
    executor.dispose();
    workers.forEach((w) => w.terminate());
  }
}
globalThis.indexedBrowser = { run };
