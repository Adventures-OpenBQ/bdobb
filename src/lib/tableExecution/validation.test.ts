// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { validateExecutionRequest, validateExecutionResponse, ExecutionProtocolError } from "./validation";
const revision = { widgetId: "a", input: 1, model: 2, output: 3 };
const context = { completeness: { kind: "bounded", acquiredRowCount: 1, totalRowCount: 100, totalRowCountKind: "estimated", warnings: ["bounded input"] }, diagnostics: [{ code: "BOUND", message: "Partial acquisition", severity: "warning" }] };
const rows = { kind: "rows", requestId: "r", revision, request: { groupPath: ["stable-id"], offset: 0, limit: 10 } };
describe("execution protocol", () => {
  it("rejectsNegativeOrFractionalRanges", () => {
    for (const field of ["offset", "limit"]) for (const value of [-1, 0.5, NaN, Infinity])
      expect(() => validateExecutionRequest({ ...rows, request: { ...rows.request, [field]: value } })).toThrow(ExecutionProtocolError);
  });
  it("rejectsUnboundAnalyticalPayload", () => {
    const raw = { kind: "applyModel", requestId: "r", revision, definition: { table: {}, search: "", analytical: "globalThis.executed = true" }, selection: { kind: "none" } };
    expect(() => validateExecutionRequest(raw)).toThrow(ExecutionProtocolError);
    expect((globalThis as Record<string, unknown>).executed).toBeUndefined();
  });
  it("roundTripsDatesMissingValuesAndErrors", () => {
    const response = { ...context, kind: "rows", requestId: "r", revision, groupPath: ["stable-id"], offset: 0, siblingCount: 1, groups: [], rows: [{ id: "x", values: { date: new Date(0), missing: undefined, nan: NaN, error: new Error("cell") } }] };
    const copy = validateExecutionResponse(response, revision, "r");
    expect(copy).toEqual(response);
    expect(copy).not.toBe(response);
    expect(copy.revision).toEqual(revision);
    expect(validateExecutionRequest(rows).revision).toEqual(revision);
  });
  it("rejectsResponsesFromAnotherWidget", () => {
    const response = { ...context, ...rows, kind: "rows", groupPath: [], offset: 0, siblingCount: 0, groups: [], rows: [] };
    expect(() => validateExecutionResponse(response, { ...revision, widgetId: "b" }, "r")).toThrow(ExecutionProtocolError);
    for (const field of ["input", "model", "output"] as const)
      expect(() => validateExecutionResponse(response, { ...revision, [field]: 99 }, "r")).toThrow(ExecutionProtocolError);
    expect(() => validateExecutionResponse(response, revision, "other")).toThrow(ExecutionProtocolError);
  });
});

describe("structural boundary validation", () => {
  const model = { kind: "applyModel", requestId: "r", revision, definition: { table: {}, search: "" }, selection: { kind: "none" } };
  const ready = { ...context, kind: "viewReady", requestId: "r", revision, columns: [], topLevelCount: 0, inspection: { inputColumns: [], inputPeriodicity: {}, definition: model.definition, aggregations: {} } };
  it("rejects malformed table fields and nested pivot shapes", () => {
    for (const table of [{ sorting: 123 }, { columnOrder: false }, { sorting: [{ id: "x", desc: "yes" }] }, { columnFilters: [{}] }, { widths: { x: "wide" } }, { pinned: { x: true } }, { pivot: { enabled: true, grouping: [], split: [], buckets: { x: "day" } } }, { hidden: new Date() }])
      expect(() => validateExecutionRequest({ ...model, definition: { table, search: "" } })).toThrow(ExecutionProtocolError);
  });
  it("rejects malformed required inspection and diagnostic structures", () => {
    for (const change of [{ diagnostics: [null] }, { diagnostics: [{ code: "X", message: "x", severity: "fatal" }] }, { inspection: {} }, { inspection: { inputColumns: [], inputPeriodicity: {}, definition: model.definition, aggregations: new Date() } }, { completeness: { kind: "sample", warnings: [1] } }])
      expect(() => validateExecutionResponse({ ...ready, ...change }, revision, "r")).toThrow(ExecutionProtocolError);
  });
  it("preserves bounded and sample context on every result kind", () => {
    for (const kind of ["bounded", "sample"]) {
      const common = { requestId: "r", revision, ...context, completeness: { ...context.completeness, kind } };
      const results = [
        { ...ready, ...common },
        { ...common, kind: "rows", groupPath: [], offset: 0, siblingCount: 0, groups: [], rows: [] },
        { ...common, kind: "facets", categoryId: "c", scope: "filtered", values: {} },
        { ...common, kind: "totals", scope: "selected", values: {} },
        { ...common, kind: "subset", transferId: "t", sequence: 0, columns: [], rows: [], final: true },
        { ...common, kind: "chartData", columns: [{ id: "instance-1", label: "Value", sourceFieldId: "source" }], rows: [], resultRevision: 2, outputRevision: 3, provenance: { sourceWidgetId: "a" }, freshness: { availability: "available", stale: false } },
        { ...common, kind: "registered" },
        { ...common, kind: "error", error: { code: "INVALID_REQUEST", message: "bad" } },
      ];
      for (const result of results) {
        expect(validateExecutionResponse(result, revision, "r")).toEqual(result);
        const { completeness: _unused, ...missingContext } = result;
        expect(() => validateExecutionResponse(missingContext, revision, "r")).toThrow(ExecutionProtocolError);
      }
    }
  });
  it("accepts honest unknown context before acquisition", () => {
    const result = { kind: "registered", requestId: "r", revision, diagnostics: [], completeness: { kind: "unknown", warnings: ["Input not yet acquired"] } };
    expect(validateExecutionResponse(result, revision, "r")).toEqual(result);
  });
  it("rejects malformed declarative column metadata and preserves typed group members", () => {
    for (const column of [{ id: "i", label: "L", metadata: new Date() }, { id: "i", label: "L", dtype: "callback" }, { id: "i", label: "L", sourceFieldId: 1 }, { id: "i", label: "L", splitPath: [{ field: "f" }] }])
      expect(() => validateExecutionResponse({ ...ready, columns: [column] }, revision, "r")).toThrow(ExecutionProtocolError);
    const column = { id: "i", label: "L", sourceFieldId: "f", splitPath: [{ field: "f", value: 2026, memberKey: "typed-id", label: "2026", bucket: "year" }] };
    expect(validateExecutionResponse({ ...ready, columns: [column] }, revision, "r")).toEqual({ ...ready, columns: [column] });
  });
  it("rejects malformed or executable retained chart-field catalogs at the worker boundary", () => {
    for (const chartColumns of [[{ id: 'x', label: 'X', metadata: { callback: () => 1 } }], [{ id: 'x', label: 'X', splitPath: [{ field: 'Symbol' }] }], 'not columns'])
      expect(() => validateExecutionResponse({ ...ready, chartColumns }, revision, 'r')).toThrow(ExecutionProtocolError);
  });
  it("rejects callbacks in column metadata and preserves instance and source IDs", () => {
    const column = { id: "instance-1", sourceFieldId: "source", label: "Value", metadata: { precision: 2 } };
    expect(validateExecutionResponse({ ...ready, columns: [column] }, revision, "r")).toEqual({ ...ready, columns: [column] });
    expect(() => validateExecutionResponse({ ...ready, columns: [{ ...column, metadata: { callback: () => 1 } }] }, revision, "r")).toThrow(ExecutionProtocolError);
  });
});

it('validates declarative group delivery paths and clones inspection input schema', () => {
  const common = { ...context, requestId: 'r', revision };
  const block = { ...common, kind: 'rows', groupPath: ['parent'], offset: 0, siblingCount: 1, rows: [{ id: 'child', values: {} }], groups: [{ rowId: 'child', path: ['parent', 'child'], childCount: 2 }] };
  for (const group of [{ rowId: 'absent', path: ['parent', 'absent'], childCount: 2 }, { rowId: 'child', path: ['other', 'child'], childCount: 2 }, { rowId: 'child', path: ['parent', 'child'], childCount: -1 }, { rowId: 'child', path: ['parent', 'child'], childCount: () => 2 }]) {
    expect(() => validateExecutionResponse({ ...block, groups: [group] }, revision, 'r')).toThrow(ExecutionProtocolError);
  }
  const copied = validateExecutionResponse(block, revision, 'r');
  if (copied.kind !== 'rows') throw new Error('Expected rows');
  copied.groups[0].path.push('changed');
  expect(block.groups[0].path).toEqual(['parent', 'child']);
  const ready = { ...common, kind: 'viewReady', columns: [], topLevelCount: 1, inspection: { inputColumns: [{ id: 'source', label: 'Source', dtype: 'number' }], inputPeriodicity: {}, definition: { table: {}, search: '' }, aggregations: {} } };
  expect(() => validateExecutionResponse({ ...ready, inspection: { ...ready.inspection, inputColumns: [{ id: 'source', label: 'Source', metadata: { callback: () => 1 } }] } }, revision, 'r')).toThrow(ExecutionProtocolError);
  expect(() => validateExecutionResponse({ ...ready, inspection: { ...ready.inspection, inputPeriodicity: { source: 'callback' } } }, revision, 'r')).toThrow(ExecutionProtocolError);
  const result = validateExecutionResponse(ready, revision, 'r');
  if (result.kind !== 'viewReady') throw new Error('Expected ready');
  result.inspection.inputColumns[0].label = 'Changed';
  expect(ready.inspection.inputColumns[0].label).toBe('Source');
});
it('validates selection action bounds, summaries, and checkbox shapes', () => {
  const request = { kind: 'selection', requestId: 'r', revision, action: { kind: 'toggle', rowId: 'x' }, visibleIds: ['x'] };
  expect(validateExecutionRequest(request)).toEqual(request);
  expect(() => validateExecutionRequest({ ...request, action: { kind: 'toggle' } })).toThrow(ExecutionProtocolError);
  expect(() => validateExecutionRequest({ ...request, visibleIds: Array(1201).fill('x') })).toThrow('bounded');
  const response = { ...context, kind: 'selection', requestId: 'r', revision, selection: { kind: 'explicit', ids: ['x'] }, selectedCount: 1, eligibleCount: 2, checked: false, indeterminate: true, rows: [{ rowId: 'x', checked: true, selectable: true, indeterminate: false }] };
  expect(validateExecutionResponse(response, revision, 'r')).toEqual(response);
  for (const malformed of [{ ...response, selectedCount: -1 }, { ...response, checked: 1 }, { ...response, rows: [{ rowId: 'x' }] }, { ...response, selection: { kind: 'unknown' } }])
    expect(() => validateExecutionResponse(malformed, revision, 'r')).toThrow(ExecutionProtocolError);
});
it('validates optional prior local selection namespace as declarative context', () => {
  const model = { kind: 'applyModel', requestId: 'r', revision, definition: { table: {}, search: '' }, selection: { kind: 'none' }, reconcileMissing: false, previousSelectionNamespace: '[["region","native"]]' };
  expect(validateExecutionRequest(model)).toEqual(model);
  expect(() => validateExecutionRequest({ ...model, previousSelectionNamespace: {} })).toThrow(ExecutionProtocolError);
});

it('bounds identity witness candidates and path definitions and rejects malformed proof states', () => {
  const plain = { table: {}, search: '' };
  const request = { kind: 'identityWitness', requestId: 'r', revision, path: [plain, plain], ids: ['r0'] };
  expect(validateExecutionRequest(request)).toEqual(request);
  for (const invalid of [{ ...request, ids: Array(1201).fill('x') }, { ...request, path: [plain] }, { ...request, path: Array(65).fill(plain) }, { ...request, path: [plain, { ...plain, analytical: {} }] }]) {
    expect(() => validateExecutionRequest(invalid)).toThrow(ExecutionProtocolError);
  }
  const response = { ...context, kind: 'identityWitness', requestId: 'r', revision, identities: [{ id: 'r0', state: 'unknown' }] };
  expect(validateExecutionResponse(response, revision, 'r')).toEqual(response);
  expect(() => validateExecutionResponse({ ...response, identities: [{ id: 'r0', state: 'deleted-maybe' }] }, revision, 'r')).toThrow(ExecutionProtocolError);
});

it('validates persistent independent measures without dropping unavailable source intent', () => {
  const model = (measures: unknown) => ({ kind: 'applyModel', requestId: 'r', revision, definition: { table: { pivot: { enabled: true, grouping: [], split: [], measures } }, search: '' }, selection: { kind: 'none' } });
  const measures = [{ id: 'a', sourceFieldId: 'missing', aggregation: 'mean', customLabel: '' }, { id: 'b', sourceFieldId: 'missing' }];
  expect(validateExecutionRequest(model(measures))).toEqual(model(measures));
  for (const invalid of [null, {}, [{ id: '', sourceFieldId: 'v' }], [{ id: 'a', sourceFieldId: '' }], [{ id: 'a', sourceFieldId: 'v', aggregation: 'average' }], [{ id: 'a', sourceFieldId: 'v', customLabel: 1 }], [{ id: 'a', sourceFieldId: 'v' }, { id: 'a', sourceFieldId: 'v' }]])
    expect(() => validateExecutionRequest(model(invalid))).toThrow(ExecutionProtocolError);
});

it('rejects malformed measure output identity metadata', () => {
  for (const column of [{ id: 'x', label: 'X', measureId: 5 }, { id: 'x', label: 'X', sourceBindingId: '' }]) {
    expect(() => validateExecutionResponse({ ...context, kind: 'chartData', requestId: 'r', revision, columns: [column], rows: [], resultRevision: 2, outputRevision: 3, provenance: { sourceWidgetId: 'a' }, freshness: { availability: 'available', stale: false } }, revision, 'r')).toThrow(ExecutionProtocolError);
  }
});

it('validates exact bounded per-cell formats without coercing raw values',()=>{
 const response={...context,kind:'rows',requestId:'r',revision,groupPath:[],offset:0,siblingCount:1,groups:[],rows:[{id:'x',values:{value:0.4},cellFormats:{value:{formatterFn:'normalizedPercent',decimalPlaces:2}}}]};
 expect(validateExecutionResponse(response,revision,'r')).toEqual(response);
 for(const format of [{formatterFn:'script'},{decimalPlaces:101},{decimalPlaces:-1},{decimalPlaces:0.5},{formatterFn:'int',extra:true}]){
  expect(()=>validateExecutionResponse({...response,rows:[{...response.rows[0],cellFormats:{value:format}}]},revision,'r')).toThrow();
 }
 expect(()=>validateExecutionResponse({...response,rows:[{...response.rows[0],cellFormats:{ghost:{formatterFn:'int'}}}]},revision,'r')).toThrow();
});
