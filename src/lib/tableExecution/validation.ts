// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { validateStatementIntent } from '../statementModel/validation';
import {authoringPlainData,validateBindRequest,validateMemberRequest,validateBindResult,validateMemberResult} from './formulaAuthoringProtocol';
import { validateRuntimeParams, validateParamMatches, runtimePlainData } from './runtimeParams';
import { validateTableModel as validateAnalyticalModel } from '../tableModel/validation';
import { AGG_NAMES, BUCKETS } from "../types";
import type { ExecutionRequest, ExecutionResponse, ProtocolErrorDescriptor, Revision } from "./types";
export class ExecutionProtocolError extends Error {
  readonly descriptor: ProtocolErrorDescriptor;
  constructor(code: ProtocolErrorDescriptor["code"], message: string) {
    super(message); this.name = "ExecutionProtocolError"; this.descriptor = { code, message };
  }
}
type Obj = Record<string, unknown>;
function fail(message: string, code: ProtocolErrorDescriptor["code"] = "INVALID_REQUEST"): never { throw new ExecutionProtocolError(code, message); }
function obj(v: unknown): Obj { if (!v || typeof v !== "object" || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) fail("Expected an object"); return v as Obj; }
function str(v: unknown): asserts v is string { if (typeof v !== "string" || !v.length) fail("Expected nonempty ID"); }
function count(v: unknown): asserts v is number { if (!Number.isSafeInteger(v) || (v as number) < 0) fail("Expected nonnegative safe integer"); }
function strings(v: unknown): void { if (!Array.isArray(v)) fail("Expected ID array"); v.forEach(str); }
function envelope(v: Obj): void { str(v.requestId); const r = obj(v.revision); str(r.widgetId); count(r.input); count(r.model); count(r.output); }
function dataset(v: unknown): void {
  const d = obj(v); columns(d.columns); dataRows(d.rows); count(d.resultRevision); count(d.outputRevision);
  str(obj(d.provenance).sourceWidgetId);
  completeness(d.completeness); modelWarnings(d);
  provenance(d.provenance); optional(d, "diagnostics", diagnostics);
  const f = obj(d.freshness); if (!["available", "unavailable", "loading", "updating", "blocked", "error"].includes(String(f.availability)) || typeof f.stale !== "boolean") fail("Invalid freshness");
  optional(f, "lastSuccessAt", finite); optional(f, "error", text); optional(f, "diagnostics", x => array(x, text));
}
function scoped(v: Obj): void { if (!["input", "filtered", "selected", "presented"].includes(String(v.scope))) fail("Invalid scope"); cloneRecord(v.values); optional(v, "empty", bool); optional(v, "cellErrors", cellErrors); optional(v, "members", x => array(x, x => {const m = obj(x); str(m.key); text(m.label); cloneValue(m.value); count(m.count);})); }
function columns(v: unknown): void { if (!Array.isArray(v)) fail("Expected columns"); v.forEach(x => { const c = obj(x); str(c.id); text(c.label); optional(c, "sourceFieldId", str); optional(c, "sourceBindingId", str); optional(c, "measureId", str); optional(c, "dtype", x => choice(x, ["text", "number", "boolean", "date", "dateString", "object"])); optional(c, "aggregation", x => choice(x, AGG_NAMES)); optional(c, "analytical", analyticalColumn); optional(c, "metadata", cloneRecord); optional(c, "splitPath", groupMembers); optional(c, "format", x => { const f = obj(x); optional(f, "formatterFn", x => choice(x, ["int", "none", "percent", "normalized", "normalizedPercent", "dateToYear"])); optional(f, "decimalPlaces", finite); }); }); }
function dataRows(v: unknown): void { if (!Array.isArray(v)) fail("Expected rows"); v.forEach(x => { const r = obj(x); str(r.id); obj(r.values); optional(r, "groupPath", groupMembers); optional(r, "cellErrors", cellErrors); optional(r, "cellFormats", value => cellFormats(value, obj(r.values))); }); }

function text(v: unknown): void { if (typeof v !== "string") fail("Expected string"); }
function bool(v: unknown): void { if (typeof v !== "boolean") fail("Expected boolean"); }
function finite(v: unknown): void { if (typeof v !== "number" || !Number.isFinite(v)) fail("Expected finite number"); }
function choice(v: unknown, choices: readonly unknown[]): void { if (!choices.includes(v)) fail("Invalid enumerated value"); }
function optional(v: Obj, key: string, check: (value: unknown) => void): void { if (v[key] !== undefined) check(v[key]); }
function array(v: unknown, check: (value: unknown) => void): void { if (!Array.isArray(v)) fail("Expected array"); v.forEach(check); }
function record(v: unknown, check: (value: unknown) => void): void { Object.values(obj(v)).forEach(check); }
/** Metadata permits declarative values only; Dates and Errors belong in cells. */
function cloneValue(v: unknown, seen = new Set<object>()): void {
  if (v === null || v === undefined || ["string", "number", "boolean", "bigint"].includes(typeof v)) return;
  if (typeof v !== "object") fail("Invalid declarative value");
  if (seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) v.forEach(x => cloneValue(x, seen));
  else Object.values(obj(v)).forEach(x => cloneValue(x, seen));
}
function cloneRecord(v: unknown): void { obj(v); cloneValue(v); }
function groupMembers(v: unknown): void {
  array(v, x => {
    const g = obj(x); str(g.field);
    if (!Object.hasOwn(g, "value")) fail("Missing group value");
    cloneValue(g.value);
    for (const key of ["categoryId", "memberKey", "sourceBindingId"]) optional(g, key, str);
    optional(g, 'transform', x => choice(x, ['native','Y','Q','M','FY','FQ']));
    optional(g, "label", text); optional(g, "bucket", x => choice(x, BUCKETS));
  });
}
function boundedText(v: unknown): void { text(v); if (new TextEncoder().encode(v as string).length > 16384) fail('Metadata string exceeds limit'); }
function revisionValue(v: unknown): void { const r = obj(v); str(r.widgetId); count(r.input); count(r.model); count(r.output); if (Object.keys(r).some(k => !['widgetId','input','model','output'].includes(k))) fail('Unexpected revision field'); }
function analyticalColumn(v: unknown): void {
  const c = obj(v); choice(c.kind, ['formula','category']); str(c.definitionId); boundedText(c.definitionId); boundedText(c.name);
  optional(c, 'scope', x => choice(x, ['source','aggregate'])); optional(c, 'transform', x => choice(x, ['native','Y','Q','M','FY','FQ'])); optional(c, 'valueKind', x => choice(x, ['number']));
  if (Object.keys(c).some(k => !['kind','definitionId','name','scope','transform','valueKind'].includes(k))) fail('Unexpected analytical column field');
}
function modelWarnings(v: Obj): void {
  if (v.modelWarnings === undefined && v.modelWarningCount === undefined) return;
  count(v.modelWarningCount);
  array(v.modelWarnings, value => {
    const w = obj(value); choice(w.code, ['fiscal-alignment','approximate-period','incomplete-period','legacy-bucket']); text(w.message);
    if ((w.message as string).length > 1000) fail('Warning message exceeds limit');
    optional(w, 'categoryId', boundedText); count(w.periodCount); revisionValue(w.origin);
    if (Object.keys(w).some(k => !['code','message','categoryId','periodCount','origin'].includes(k))) fail('Unexpected warning projection field');
  });
  const length = (v.modelWarnings as unknown[]).length;
  if (length > 100 || length > (v.modelWarningCount as number)) fail('Invalid warning projection budget');
}
function completeness(v: unknown): void {
  const c = obj(v);
  choice(c.kind, ["complete", "partial", "sample", "bounded", "paged", "unknown"]);
  array(c.warnings, text);
  optional(c, "acquiredRowCount", count); optional(c, "totalRowCount", count);
  optional(c, "totalRowCountKind", x => choice(x, ["exact", "estimated"]));
}
function diagnostics(v: unknown): void {
  array(v, x => { const d = obj(x); str(d.code); text(d.message); choice(d.severity, ["info", "warning", "error"]);
    if(d.code.startsWith('PIVOT_PARAM_')) { str(d.key); if(d.key.length>512)fail('Parameter diagnostic key too long');if(!Array.isArray(d.memberKeys)||d.memberKeys.length>8)fail('Parameter diagnostic values exceed limit');array(d.memberKeys,key=>{str(key);if(key.length>256)fail('Parameter diagnostic value too long');});count(d.unmatchedCount);bool(d.truncated);if((d.message as string).length>1024)fail('Parameter diagnostic message too long'); } });
}
function provenance(v: unknown): void {
  const p = obj(v); str(p.sourceWidgetId);
  optional(p, 'presentation', value => { const q = obj(value); choice(q.scope, ['presented']); count(q.rowCount); revisionValue(q.revision); if(Object.keys(q).some(k => !['scope','rowCount','revision'].includes(k))) fail('Unexpected presentation field'); });
  optional(p, "sourceKind", text); optional(p, "sample", text); optional(p, "inputMayContainAggregates", bool);
  for (const key of ["receipt", "parameters", "metadata"]) optional(p, key, cloneRecord);
  optional(p, "lineage", x => array(x, x => { const l = obj(x); str(l.widgetId); count(l.resultRevision); count(l.outputRevision); }));
}
function table(v: unknown): void {
  const t = obj(v);
  for (const key of ["columnOrder", "hidden"]) optional(t, key, strings);
  optional(t, "sorting", x => array(x, x => { const s = obj(x); str(s.id); bool(s.desc); }));
  optional(t, "columnFilters", x => array(x, x => { const f = obj(x); str(f.id); if (!Object.hasOwn(f, "value")) fail("Missing filter value"); }));
  optional(t, "widths", x => record(x, finite));
  optional(t, "pinned", x => record(x, x => choice(x, [null, "left", "right"])));
  optional(t, "pivot", x => {
    const p = obj(x); bool(p.enabled); strings(p.grouping); strings(p.split);
    optional(p, "expanded", x => { if (x !== true) record(x, bool); });
    optional(p, "legacyExpanded", x => record(x, bool));
    optional(p, "keyEncoding", x => choice(x, ["typed-v1"]));
    optional(p, "aggregationFns", x => record(x, x => choice(x, AGG_NAMES)));
    optional(p, "measures", x => {
      const ids = new Set<string>();
      array(x, value => {
        const m = obj(value); str(m.id); str(m.sourceFieldId);
        if (ids.has(m.id)) fail("Duplicate measure ID");
        ids.add(m.id);
        optional(m, "aggregation", value => choice(value, AGG_NAMES));
        optional(m, "customLabel", text);
      });
    });
    optional(p, "buckets", x => record(x, x => choice(x, BUCKETS)));
  });
}
function definition(v: unknown): void {
  const d = obj(v); table(d.table); text(d.search);
  if (Object.keys(d).some(key => !["table", "search", "analytical"].includes(key))) fail("Unknown table definition field");
  if (Object.hasOwn(d, 'analytical')) {
    const statement = d.analytical && typeof d.analytical === 'object' && Object.getOwnPropertyDescriptor(d.analytical, 'schemaVersion')?.value === 2;
    const validation = statement ? validateStatementIntent(d.analytical) : validateAnalyticalModel(d.analytical);
    const invalid = validation.diagnostics.find(diagnostic => diagnostic.severity === 'error' && (statement || diagnostic.path === '' || diagnostic.code === 'unsupported-schema' || (diagnostic.code === 'invalid-structure' && !/^(categories|measures|formulas)\.\d+/.test(diagnostic.path))));
    if (invalid) fail(`Invalid analytical model: ${invalid.message}`);
  }
}

/** Same model gate for durable intent and worker requests; no execution or repair. */
export function validateTableModel(rawDefinition: unknown, rawSelection: unknown): void {
  definition(clone(rawDefinition));
  const s = obj(clone(rawSelection));
  if (s.kind === "explicit") strings(s.ids);
  else if (s.kind === "allMatching") strings(s.excludedIds);
  else if (s.kind !== "none") fail("Invalid selection");
  const keys = s.kind === "explicit" ? ["kind", "ids"] : s.kind === "allMatching" ? ["kind", "excludedIds"] : ["kind"];
  if (Object.keys(s).some(key => !keys.includes(key))) fail("Unknown selection field");
}

function selection(v: unknown): void { validateTableModel({ table: {}, search: '' }, v); }
function selectionSummary(v: unknown): void {
  const s = obj(v); selection(s.selection); count(s.selectedCount); count(s.eligibleCount); bool(s.checked); bool(s.indeterminate);
  array(s.rows, value => { const row = obj(value); str(row.rowId); bool(row.selectable); bool(row.checked); bool(row.indeterminate); });
  if ((s.rows as unknown[]).length > 1200) fail('Selection visible IDs must be bounded');
}
function clone<T>(v: T): T { try { return structuredClone(v); } catch { return fail("Payload is not structured-cloneable"); } }
function inspectionRequest(v: Obj): void {
  choice(v.collection, ['definitions','warnings','periodBounds','groupDomain']); count(v.offset);count(v.limit);
  optional(v,'definitionId',x=>{str(x);if(v.collection!=='definitions'||new TextEncoder().encode(x as string).length>16384)fail('Invalid definition selector');});
  if(v.collection==='groupDomain'){for(const k of ['paramKey','categoryId','categoryRecipe']){str(v[k]);boundedText(v[k]);}if(new TextEncoder().encode(v.paramKey as string).length>512||new TextEncoder().encode(v.categoryRecipe as string).length>16384)fail('Invalid domain identity');if(v.definitionId!==undefined)fail('Unexpected domain definition selector');optional(v,'groupEvidence',raw=>{const evidence=obj(raw);if(Object.keys(evidence).some(k=>!['groupId','transportValue'].includes(k)))fail('Invalid group evidence');validateRuntimeParams({[v.paramKey as string]:{source:'group',...evidence}});});}else if(['paramKey','categoryId','categoryRecipe','groupEvidence'].some(k=>k in v))fail('Unexpected group evidence');
  if ((v.limit as number)<1 || (v.limit as number)>100) fail('Inspection limit must be 1–100');
}
function inspectionPage(v: Obj): void {
  if(Object.keys(v).some(k=>!['kind','requestId','revision','completeness','diagnostics','modelWarnings','modelWarningCount','collection','offset','limit','definitionId','rows','total','nextOffset','truncated','paramKey','categoryId','categoryRecipe','groupEvidence','domain'].includes(k))) fail('Unexpected inspection response field');
  inspectionRequest(v);count(v.total);bool(v.truncated);optional(v,'nextOffset',count);
  const rows=v.rows as unknown[];
  array(rows, value => {
    const r=obj(value);
    if(v.collection==='groupDomain'){choice(r.kind,['groupMember']);for(const k of ['key','label','transport']){text(r[k]);if(new TextEncoder().encode(r[k] as string).length>(k==='label'?256:16384))fail('Domain member exceeds budget');}bool(r.labelTruncated);bool(r.matched);count(r.observedCount);count(r.eligibleCount);if((r.eligibleCount as number)>(r.observedCount as number)||Object.keys(r).some(k=>!['kind','key','label','transport','labelTruncated','matched','observedCount','eligibleCount'].includes(k)))fail('Invalid domain member');}else if(v.collection==='definitions') {
      choice(r.kind,['formula','measure','category']);str(r.id);text(r.name);strings(r.referenceIds);count(r.referenceCount);bool(r.truncatedReferences);array(r.resolvedOperators,x=>choice(x,AGG_NAMES));
      if((r.referenceIds as unknown[]).length>100 || (r.resolvedOperators as unknown[]).length>9 || new Set(r.resolvedOperators as unknown[]).size!==(r.resolvedOperators as unknown[]).length || r.referenceCount as number < (r.referenceIds as unknown[]).length || r.truncatedReferences!==((r.referenceCount as number)>(r.referenceIds as unknown[]).length)) fail('Invalid definition inspection budget');
      optional(r,'scope',x=>{if(r.kind!=='formula')fail('Scope belongs to formulas');choice(x,['source','aggregate']);});
      optional(r,'sourceFilterKind',x=>{if(r.kind!=='formula'||r.scope!=='source')fail('Filter kind belongs to source formulas');choice(x,['none','text','number','date','boolean']);});
      if(v.definitionId!==undefined&&r.id!==v.definitionId)fail('Definition selector mismatch');
      if(Object.keys(r).some(k=>!['kind','id','name','referenceIds','referenceCount','truncatedReferences','resolvedOperators','scope','sourceFilterKind'].includes(k))) fail('Unexpected definition inspection field');
    } else if(v.collection==='warnings') {
      choice(r.kind,['warning']);str(r.id);str(r.code);text(r.message);optional(r,'categoryId',str);count(r.periodCount);
      if(Object.keys(r).some(k=>!['kind','id','code','message','categoryId','periodCount'].includes(k))) fail('Unexpected warning field');
    } else {
      choice(r.kind,['periodBounds']);str(r.warningId);optional(r,'categoryId',str);for(const k of ['companyKey','start','end','source','period','context']) text(r[k]);
      if(Object.keys(r).some(k=>!['kind','warningId','categoryId','companyKey','start','end','source','period','context'].includes(k))) fail('Unexpected period field');
    }
  });
  if(v.definitionId!==undefined&&(v.total as number)>1)fail('Definition selector must be unique');
  if(rows.length>(v.limit as number) || (v.offset as number)+rows.length>(v.total as number) && rows.length>0) fail('Invalid inspection page size');
  if(v.collection==='groupDomain'){const d=obj(v.domain);if(Object.keys(d).some(k=>!['classificationComplete','categoryErrorCount','omittedCount','scanned','status','reason','inputCount','matchedKeyCount','unmatched','unmatchedCount'].includes(k)))fail('Unexpected domain metadata');bool(d.classificationComplete);for(const k of ['categoryErrorCount','omittedCount','scanned','inputCount','matchedKeyCount','unmatchedCount'])count(d[k]);choice(d.status,['resolved','refused']);optional(d,'reason',x=>choice(x,['ambiguous','partial','budget']));strings(d.unmatched);if((d.unmatched as string[]).length>8||(d.unmatched as string[]).some(s=>new TextEncoder().encode(s).length>256)||d.unmatchedCount as number<(d.unmatched as unknown[]).length||(d.omittedCount as number)>(v.total as number)||d.scanned as number<rows.length||(d.scanned as number)>(v.limit as number)||new TextEncoder().encode(JSON.stringify(v)).length>262144||new TextEncoder().encode(JSON.stringify(rows)).length>131072)fail('Invalid domain budget');if((d.scanned as number)>Math.max(0,(v.total as number)-(v.offset as number))||(d.matchedKeyCount as number)>(v.total as number)||(d.unmatchedCount as number)>(d.inputCount as number)||(d.classificationComplete&&(d.categoryErrorCount as number)>0)||rows.filter(row=>obj(row).matched).length>(d.matchedKeyCount as number)||(d.status==='refused')!==(d.reason!==undefined))fail('Inconsistent domain counts');const next=Math.min(v.offset as number,v.total as number)+(d.scanned as number);if(v.truncated!==(next<(v.total as number))||(v.truncated?v.nextOffset!==next||next<=(v.offset as number):v.nextOffset!==undefined))fail('Invalid domain continuation');return;}
  if(v.domain!==undefined)fail('Unexpected domain metadata');
  const next=(v.offset as number)+rows.length;
  if(v.truncated!==(next<(v.total as number)) || (v.truncated ? v.nextOffset!==next || rows.length===0 : v.nextOffset!==undefined)) fail('Invalid inspection continuation');
}
/** Throws a typed error with a serializable descriptor; never evaluates analytical input. */
export function validateExecutionRequest(raw: unknown): ExecutionRequest {
  let source=raw;
  if(raw&&typeof raw==='object'&&Object.values(Object.getOwnPropertyDescriptors(raw)).some(d=>!('value' in d)))fail('Request envelope accessors are unsupported');
  if(raw&&typeof raw==='object'&&['bindFormula','memberDomain','previewDefinition'].includes(Object.getOwnPropertyDescriptor(raw,'kind')?.value)){authoringPlainData(raw);}
  if(raw&&typeof raw==='object'&&(Object.getOwnPropertyDescriptor(raw,'collection')?.value==='groupDomain'||Object.getOwnPropertyDescriptor(raw,'kind')?.value==='inspect'))runtimePlainData(raw);
  if (raw && typeof raw === 'object') { const descriptor=Object.getOwnPropertyDescriptor(raw,'runtimeParams'); if(descriptor){obj(raw);if(!('value' in descriptor))fail('Runtime accessors are unsupported');const runtime=validateRuntimeParams(descriptor.value);const prepared:Obj=Object.create(null);for(const [key,value]of Object.entries(Object.getOwnPropertyDescriptors(raw))){if(!('value' in value))fail('Runtime-bearing envelope accessors are unsupported');prepared[key]=key==='runtimeParams'?runtime:value.value;}source=prepared;} }
  const v = obj(clone(source)); envelope(v);
  switch (v.kind) {
    case "bindFormula": case "memberDomain": {
      const allowed=['kind','requestId','revision','definition',...(v.kind==='bindFormula'?['draft','bindings']:['categoryId','categoryRecipe','offset','limit','search'])];if(Object.keys(v).some(k=>!allowed.includes(k)))fail('Unexpected authoring request field');revisionValue(v.revision);definition(v.definition);if(v.kind==='bindFormula')validateBindRequest(v);else validateMemberRequest(v);break;
    }
    case "previewDefinition": {
      if(Object.keys(v).some(k=>!['kind','requestId','revision','definition'].includes(k)))fail('Unexpected preview field');
      definition(v.definition); break;
    }
    case "registerInput": dataset(v.input); count(v.inputRevision); if (v.inputRevision !== obj(v.revision).input) fail("Input revision mismatch"); break;
    case "importFile": str(v.name); if (!(ArrayBuffer.isView(v.bytes) && Object.prototype.toString.call(v.bytes) === "[object Uint8Array]")) fail("Expected file bytes"); count(v.inputRevision); if (v.inputRevision !== obj(v.revision).input) fail("Input revision mismatch"); break;
    case "nextSubset": str(v.transferId); count(v.sequence); break;
    case "applyModel": {
      validateTableModel(v.definition, v.selection); validateRuntimeParams(v.runtimeParams, v.definition as import('./types').TableDefinition); optional(v, "reconcileMissing", bool); optional(v, "previousSelectionNamespace", str); optional(v, "provenAbsentIds", strings); break;
    }
    case "identityWitness": {
      strings(v.ids); array(v.path, definition);
      if ((v.ids as string[]).length > 1200 || (v.path as unknown[]).length < 2 || (v.path as unknown[]).length > 64) fail('Identity witness budget exceeded');
      break;
    }
    case "selection": {
      strings(v.visibleIds); if ((v.visibleIds as string[]).length > 1200) fail('Selection visible IDs must be bounded');
      const a = obj(v.action); choice(a.kind, ['summary', 'all', 'clear', 'toggle']); if (a.kind === 'toggle') str(a.rowId); break;
    }
    case "rows": { const r = obj(v.request); strings(r.groupPath); count(r.offset); count(r.limit); break; }
    case "facets": str(v.categoryId); break;
    case "chartData": strings(v.fields); break;
    case "presented": str(v.transferId); optional(v, "ignoreSelection", bool); break;
    case "cancel": str(v.targetRequestId); break;
    case "inspect": inspectionRequest(v); break;
    case "inputSchema": case "totals": case "dispose": break;
    default: fail("Unknown request kind");
  }
  return v as ExecutionRequest;
}
/** Correlates every revision component and request ID before accepting a result. */
export function validateExecutionResponse(raw: unknown, expected: Revision, requestId: string): ExecutionResponse {
  try {
    if(raw&&typeof raw==='object'&&Object.values(Object.getOwnPropertyDescriptors(raw)).some(d=>!('value' in d)))fail('Response envelope accessors are unsupported');
    if(raw&&typeof raw==='object'){const inspection=Object.getOwnPropertyDescriptor(raw,'inspection');if(inspection){if(!('value' in inspection))fail('Inspection accessors are unsupported');if(inspection.value&&typeof inspection.value==='object'){const matches=Object.getOwnPropertyDescriptor(inspection.value,'paramMatches');if(matches){if(!('value' in matches))fail('Runtime match accessors are unsupported');validateParamMatches(matches.value);}}}}
    if(raw&&typeof raw==='object'&&(Object.getOwnPropertyDescriptor(raw,'collection')?.value==='groupDomain'||Object.getOwnPropertyDescriptor(raw,'kind')?.value==='inspect'))runtimePlainData(raw);
    if(raw&&typeof raw==='object'&&['bindFormula','memberDomain','previewDefinition'].includes(Object.getOwnPropertyDescriptor(raw,'kind')?.value))authoringPlainData(raw,262144);
    const v = obj(clone(raw)); envelope(v); const r = obj(v.revision);
    if (v.requestId !== requestId || r.widgetId !== expected.widgetId || r.input !== expected.input || r.model !== expected.model || r.output !== expected.output)
      fail("Response belongs to another request or revision", "REVISION_MISMATCH");
    completeness(v.completeness); diagnostics(v.diagnostics); modelWarnings(v);
    switch (v.kind) {
      case "previewDefinition": columns(v.columns); dataRows(v.rows); count(v.total); if((v.rows as unknown[]).length>100 || (v.rows as unknown[]).length>(v.total as number))fail('Preview budget exceeded'); break;
      case "bindFormula": validateBindResult(v); break;
      case "memberDomain": validateMemberResult(v); break;
      case "identityWitness": {
        array(v.identities, value => { const witness = obj(value); str(witness.id); choice(witness.state, ['present', 'absent', 'unknown']); });
        if ((v.identities as unknown[]).length > 1200) fail('Identity witness budget exceeded');
        break;
      }
      case "selection": selectionSummary(v); break;
      case "rows": {
        optional(v, "selection", selectionSummary);
        strings(v.groupPath); count(v.offset); count(v.siblingCount); dataRows(v.rows);
        const parent = v.groupPath as string[], seen = new Set<string>();
        array(v.groups, x => {
          const g = obj(x); str(g.rowId); strings(g.path); count(g.childCount);
          const path = g.path as string[];
          if (seen.has(g.rowId) || !(v.rows as Obj[]).some(row => row.id === g.rowId) || path.length !== parent.length + 1 || path.at(-1) !== g.rowId || parent.some((id, i) => path[i] !== id)) fail("Invalid group delivery path");
          seen.add(g.rowId);
        });
        break;
      }
      case "viewReady": optional(v, "selection", selection); optional(v, "selectionNamespace", str); columns(v.columns); optional(v, "chartColumns", columns); count(v.topLevelCount); { const inspection = obj(v.inspection); columns(inspection.inputColumns); record(inspection.inputPeriodicity, x => choice(x, ["daily", "weekly", "monthly", "quarterly", "annual", "irregular"])); definition(inspection.definition); cloneRecord(inspection.aggregations); optional(inspection,"paramMatches",validateParamMatches); optional(inspection, "counts", x => { const c=obj(x); for(const k of ["definitions","warnings","periodBounds"]) count(c[k]); }); } break;
      case "facets": str(v.categoryId); scoped(v); break;
      case "inspect": inspectionPage(v); break;
      case "totals": scoped(v); break;
      case "subset": str(v.transferId); count(v.sequence); if (v.sequence === 0 || v.columns !== undefined) columns(v.columns); if (v.provenance !== undefined) provenance(v.provenance); if (v.freshness !== undefined) { const f = obj(v.freshness); choice(f.availability, ["available", "unavailable", "loading", "updating", "blocked", "error"]); bool(f.stale); optional(f, "lastSuccessAt", finite); optional(f, "error", text); optional(f, "diagnostics", x => array(x, text)); } dataRows(v.rows); if (typeof v.final !== "boolean") fail("Invalid final flag"); break;
      case "chartData": dataset(v); break;
      case "error": { const e = obj(v.error); if (!["INVALID_REQUEST", "INVALID_RESPONSE", "UNBOUND_ANALYTICAL", "REVISION_MISMATCH", "MISSING_FIELD", "RESOURCE_LIMIT"].includes(String(e.code)) || typeof e.message !== "string") fail("Invalid error descriptor"); break; }
      case "inputSchema": columns(v.columns); if (Object.keys(v).some(k => !["kind", "requestId", "revision", "completeness", "diagnostics", "columns"].includes(k))) fail("Unexpected input schema field"); break;
      case "registered": break;
      default: fail("Unknown response kind");
    }
    return v as ExecutionResponse;
  } catch (error) {
    if (error instanceof ExecutionProtocolError && error.descriptor.code === "INVALID_REQUEST") throw new ExecutionProtocolError("INVALID_RESPONSE", error.message);
    throw error;
  }
}

function cellErrors(v: unknown): void { record(v, x => { const e = obj(x); str(e.code); text(e.message); optional(e, 'definitionId', str); optional(e, 'dependencyIds', strings); optional(e, 'affectedRecordCount', count); optional(e, 'recordPreview', x => {strings(x); if ((x as string[]).length > 5) fail('Cell error preview must be bounded');}); if (Object.hasOwn(e, 'recordIds')) fail('Unbounded error identities cannot be delivered'); }); }

/** Row formats describe only delivered cells; no executable or unbounded payload. */
function cellFormats(value: unknown, values: Obj): void {
  const formats = obj(value);
  if (Object.keys(formats).length > 10000) fail('Cell formats exceed limit');
  for (const [id, raw] of Object.entries(formats)) {
    boundedText(id); if (!Object.hasOwn(values, id)) fail('Cell format has no delivered value');
    const format = obj(raw);
    if (Object.keys(format).some(key => !['formatterFn', 'decimalPlaces'].includes(key))) fail('Unexpected cell format field');
    optional(format, 'formatterFn', fn => choice(fn, ['int', 'none', 'percent', 'normalized', 'normalizedPercent', 'dateToYear']));
    optional(format, 'decimalPlaces', n => { count(n); if (n > 100) fail('Cell format precision exceeds limit'); });
  }
}
