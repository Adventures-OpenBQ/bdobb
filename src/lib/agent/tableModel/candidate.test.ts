// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildCandidate } from "./candidate";
import { pivotValueKey } from "../../pivotKeys";
import type { Arrangement } from "./contract";
import { intent } from "../../statementModel/testFixtures";
import type { StatementIntent } from "../../statementModel/types";
import type { TableModelV1 } from "../../tableModel/types";
import type { DatasetColumn } from "../../widgetData/types";

const columns = [{ id: "region", label: "Region", dtype: "text" }, { id: "revenue", label: "Revenue", dtype: "number" }, { id: "cost", label: "Cost", dtype: "number" }, { id: "date", label: "Date", dtype: "date" }] as DatasetColumn[];
const arrange = (operations: Arrangement["operations"]): Arrangement => ({ contract: "table-model/1", operations });
let n = 0; const allocate = () => `id-${++n}`;
const modelOf = (r: ReturnType<typeof buildCandidate>) => r.definition!.analytical as TableModelV1;

describe("buildCandidate", () => {
  it("adds categories and two independent measures on the same field, placing them by alias", () => {
    n = 0;
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
      { op: "measure.add", alias: "rs", source_field_id: "revenue", aggregation: "sum" },
      { op: "measure.add", alias: "rm", source_field_id: "revenue", aggregation: "mean", label: "Average revenue (unweighted)" },
      { op: "layout.set", rows: [{ alias: "reg" }], values: [{ alias: "rs" }, { alias: "rm" }] },
      { op: "totals.set", grand_total: true },
    ]), allocate);
    expect(r.errors).toEqual([]);
    expect(r.ids).toEqual({ reg: "id-1", rs: "id-2", rm: "id-3" });
    const m = modelOf(r);
    expect(m.layout).toMatchObject({ rows: ["id-1"], values: ["id-2", "id-3"] });
    expect(m.measures.map(x => [x.sourceFieldId, x.aggregation])).toEqual([["revenue", "sum"], ["revenue", "mean"]]);
    expect(m.subtotals.grandTotal).toBe(true);
  });
  it("derives Y and Q categories from one date field independently", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "category.add", alias: "y", name: "Year", source_field_id: "date", transform: "Y" },
      { op: "category.add", alias: "q", name: "Quarter", source_field_id: "date", transform: "Q" },
    ]), allocate);
    expect(modelOf(r).categories.map(c => [c.sourceFieldId, c.transform])).toEqual([["date", "Y"], ["date", "Q"]]);
  });
  it("refuses unknown stable IDs and leaves no candidate", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "measure.remove", target: { id: "nope" } }]), allocate);
    expect(r.definition).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ code: "unknown-reference", operation_index: 0, target_id: "nope" });
  });
  it("refuses an allocated ID that collides with an existing one", () => {
    const current = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "measure.add", source_field_id: "cost" }]), () => "dup").definition!;
    const r = buildCandidate(current, columns, arrange([{ op: "measure.add", source_field_id: "revenue" }]), () => "dup");
    expect(r.errors[0]).toMatchObject({ code: "id-collision" });
  });
  it("sets presentation without touching the model", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "presentation.set", sorting: [{ id: "revenue", desc: true }], hidden: ["cost"] }]), allocate);
    expect(r.definition!.table).toMatchObject({ sorting: [{ id: "revenue", desc: true }], hidden: ["cost"] });
    expect(r.definition!.analytical).toBeUndefined();
  });
  it("never mutates the input", () => {
    const current = { table: { sorting: [{ id: "cost", desc: false }] }, search: "" };
    const before = JSON.stringify(current);
    buildCandidate(current, columns, arrange([{ op: "measure.add", source_field_id: "cost" }, { op: "presentation.set", hidden: ["cost"] }]), allocate);
    expect(JSON.stringify(current)).toBe(before);
  });
  it("duplicates, updates and removes measures; removal strips the layout", () => {
    n = 0;
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "measure.add", alias: "a", source_field_id: "revenue", aggregation: "sum" },
      { op: "measure.duplicate", alias: "b", target: { alias: "a" } },
      { op: "measure.update", target: { alias: "b" }, aggregation: "max", label: "Peak" },
      { op: "layout.set", values: [{ alias: "a" }, { alias: "b" }] },
      { op: "measure.remove", target: { alias: "a" } },
    ]), allocate);
    expect(r.errors).toEqual([]);
    const m = modelOf(r);
    expect(m.measures).toEqual([{ id: "id-2", sourceFieldId: "revenue", aggregation: "max", customLabel: "Peak" }]);
    expect(m.layout.values).toEqual(["id-2"]);
  });
  it("updates and removes categories, stripping placements and controls; promotes and demotes", () => {
    n = 0;
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
      { op: "category.update", target: { alias: "reg" }, name: "Area" },
      { op: "layout.set", rows: [{ alias: "reg" }] },
      { op: "control.promote", category: { alias: "reg" }, label: "Area", multi_select: true },
      { op: "control.promote_page", enabled: true },
      { op: "control.demote", category: { alias: "reg" } },
      { op: "control.promote", category: { alias: "reg" }, label: "Area", multi_select: false },
      { op: "category.remove", target: { alias: "reg" } },
    ]), allocate);
    expect(r.errors).toEqual([]);
    const m = modelOf(r);
    expect(m.categories).toEqual([]);
    expect(m.layout.rows).toEqual([]);
    expect(m.params).toEqual({ promotePage: true, filters: [] });
  });
  it("maps fiscal_binding keys and rejects unknown ones", () => {
    const ok = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "category.add", name: "FY", source_field_id: "date", transform: "FY", fiscal_binding: { company_field_id: "region", period_kind: "FY" } }]), allocate);
    expect(modelOf(ok).categories[0].fiscalBinding).toEqual({ companyFieldId: "region", periodKind: "FY" });
    const bad = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "category.add", name: "FY", source_field_id: "date", transform: "FY", fiscal_binding: { nope: "x" } }]), allocate);
    expect(bad.errors[0]).toMatchObject({ code: "invalid-field", operation_index: 0 });
  });
  it("refuses viewer ops and presentation ids that are not columns", () => {
    expect(buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "viewer.reset" }]), allocate).errors[0]).toMatchObject({ code: "viewer-scope" });
    expect(buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "presentation.set", hidden: ["ghost"] }]), allocate).errors[0]).toMatchObject({ code: "invalid-field" });
  });
  it("enables the model", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "model.enable", enabled: false }]), allocate);
    expect(modelOf(r).enabled).toBe(false);
  });
  it("carries a legacy pivot over when the table has no model yet", () => {
    const current = { table: { pivot: { enabled: true, grouping: ["region"], split: [] } }, search: "" } as Parameters<typeof buildCandidate>[0];
    const r = buildCandidate(current, columns, arrange([{ op: "totals.set", groups: true }]), allocate);
    expect(modelOf(r).layout.rows).toHaveLength(1);
    expect(modelOf(r).categories[0]).toMatchObject({ sourceFieldId: "region" });
  });
  it("seeds no measures for a no-pivot table and a stored empty pivot alike", () => {
    const ops = arrange([{ op: "totals.set", groups: true }]);
    const none = buildCandidate({ table: {}, search: "" }, columns, ops, allocate);
    const off = buildCandidate({ table: { pivot: { enabled: false, grouping: [], split: [] } }, search: "" } as Parameters<typeof buildCandidate>[0], columns, ops, allocate);
    expect(modelOf(none).measures).toEqual([]);
    expect(modelOf(none).layout.values).toEqual([]);
    expect(modelOf(off)).toEqual({ ...modelOf(none), legacyPivot: { enabled: true, grouping: [], split: [] } });
  });
  it("keeps the stored measures of a legacy pivot", () => {
    const current = { table: { pivot: { enabled: true, grouping: ["region"], split: [], measures: [{ id: "m1", sourceFieldId: "revenue", aggregation: "sum" }] } }, search: "" } as Parameters<typeof buildCandidate>[0];
    const m = modelOf(buildCandidate(current, columns, arrange([{ op: "totals.set", groups: true }]), allocate));
    expect(m.measures).toEqual([{ id: "m1", sourceFieldId: "revenue", aggregation: "sum" }]);
    expect(m.layout.values).toEqual(["m1"]);
  });
  it("delegates statement operations to the Statement applier, keeping per-operation error indices", () => {
    const fixture = intent("income");
    const apply = { op: "statement.apply", template_id: "income", template_version: "1.0.0", bindings: fixture.bindings, period_kind: "FY" } as const;
    const ok = buildCandidate({ table: {}, search: "" }, columns, arrange([apply, { op: "presentation.set", hidden: ["cost"] }, { op: "statement.override", labels: { [fixture.template.lines[0].id]: "Sales" } }]), allocate);
    expect(ok.errors).toEqual([]);
    expect(ok.definition!.table.hidden).toEqual(["cost"]);
    expect((ok.definition!.analytical as StatementIntent).overrides.labels[fixture.template.lines[0].id]).toBe("Sales");
    const bad = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "presentation.set", hidden: ["cost"] }, apply, { op: "statement.update_template", template_version: "2.0.0" }]), allocate);
    expect(bad.definition).toBeUndefined();
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toMatchObject({ code: "validation", operation_index: 2, alternatives: ["income@1.0.0"] });
    const first = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "statement.reset" }]), allocate);
    expect(first.errors[0]).toMatchObject({ code: "validation", operation_index: 0, message: "apply a Statement template first" });
  });
  it("passes statement.update_template conflicts through, with no definition", () => {
    // Stale intent: its section order was authored when the section held fewer lines than the installed 1.0.0 template.
    const stale = intent("income");
    stale.template = structuredClone(stale.template);
    const section = stale.template.sections[0];
    const dropped = section.lineIds[section.lineIds.length - 1];
    section.lineIds = section.lineIds.slice(0, -1);
    stale.template.lines = stale.template.lines.filter(l => l.id !== dropped);
    stale.overrides.lineOrder[section.id] = [...section.lineIds].reverse();
    const r = buildCandidate({ table: {}, search: "", analytical: stale } as never, columns, arrange([{ op: "statement.update_template", template_version: "1.0.0" }]), allocate);
    expect(r.definition).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ code: "validation", message: "template update has conflicts", operation_index: 0 });
    expect(r.conflicts).toEqual([{ id: section.id, reason: expect.stringContaining("Section membership changed") }]);
  });
  it("replaces an existing table model with an applied Statement", () => {
    const fixture = intent("income");
    const withModel = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "model.enable", enabled: true }]), allocate).definition!;
    expect(withModel.analytical).toBeDefined();
    const r = buildCandidate(withModel, columns, arrange([{ op: "statement.apply", template_id: "income", template_version: "1.0.0", bindings: fixture.bindings, period_kind: "FY" }]), allocate);
    expect(r.errors).toEqual([]);
    expect(r.definition!.analytical).toMatchObject({ kind: "statement", template: { id: "income", version: "1.0.0" }, bindings: fixture.bindings });
  });
  it("refuses a statement operation mixed with a table-model operation, atomically", () => {
    const fixture = intent("income");
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "statement.apply", template_id: "income", template_version: "1.0.0", bindings: fixture.bindings, period_kind: "FY" }, { op: "totals.set", grand_total: true }]), allocate);
    expect(r.definition).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ code: "validation", operation_index: 1 });
  });
  it("does not alias the arrangement's presentation arrays", () => {
    const hidden = ["cost"];
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "presentation.set", hidden }]), allocate);
    expect(r.definition!.table.hidden).not.toBe(hidden);
  });
  it("names a source field used where a category or measure belongs, and the operation that creates one (live Rita placed field ids)", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "layout.set", rows: [{ id: "region" }] },
    ]), allocate);
    expect(r.errors[0]).toMatchObject({ code: "unknown-reference", target_id: "region" });
    expect(r.errors[0].message).toMatch(/region is a source field, not a category.*category\.add.*alias/);
    const v = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "layout.set", values: [{ id: "revenue" }] }]), allocate);
    expect(v.errors[0].message).toMatch(/revenue is a source field, not a measure or formula.*measure\.add.*alias/);
    const u = buildCandidate({ table: {}, search: "" }, columns, arrange([{ op: "layout.set", rows: [{ id: "nope" }] }]), allocate);
    expect(u.errors[0].message).toBe("no category nope");
  });
});

describe("formulas, filters and Page", () => {
  const KEY_A = pivotValueKey("A"), KEY_B = pivotValueKey("B");
  const base = () => buildCandidate({ table: {}, search: "" }, columns, arrange([
    { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
    { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
    { op: "measure.add", alias: "cost", source_field_id: "cost", aggregation: "sum" },
  ]), allocate);
  it("binds an aggregate ratio formula through the drawer binder using an alias defined earlier in the same request", () => {
    const r = buildCandidate({ table: {}, search: "" }, columns, arrange([
      { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
      { op: "measure.add", alias: "cost", source_field_id: "cost", aggregation: "sum" },
      { op: "formula.set", target: { alias: "margin" }, name: "Margin", scope: "aggregate", expression: "(R - C) / R", bindings: { R: { target: "measure", ref: { alias: "rev" } }, C: { target: "measure", ref: { alias: "cost" } } }, format: "percent" },
    ]), allocate);
    expect(r.errors).toEqual([]);
    const f = (r.definition!.analytical as TableModelV1).formulas[0];
    expect(f).toMatchObject({ id: r.ids.margin, name: "Margin", scope: "aggregate", expression: "(R - C) / R" });
    expect(JSON.stringify(f.ast)).toContain(r.ids.rev);
  });
  it("refuses a forward alias reference before the target formula exists", () => {
    const r = buildCandidate(base().definition!, columns, arrange([
      { op: "formula.set", target: { alias: "a" }, name: "A", scope: "aggregate", expression: "B + 1", bindings: { B: { target: "formula", ref: { alias: "b" } } } },
    ]), allocate);
    expect(r.definition).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ code: "unknown-reference", target_id: "b" });
  });
  it("refuses a circular pair in one request, whole arrangement, naming both ids", () => {
    const a = buildCandidate(base().definition!, columns, arrange([{ op: "formula.set", target: { alias: "a" }, name: "A", scope: "aggregate", expression: "1", bindings: {} }]), allocate);
    const r = buildCandidate(a.definition!, columns, arrange([
      { op: "formula.set", target: { alias: "b" }, name: "B", scope: "aggregate", expression: "A + 1", bindings: { A: { target: "formula", ref: { id: a.ids.a } } } },
      { op: "formula.set", target: { id: a.ids.a }, name: "A", scope: "aggregate", expression: "B + 1", bindings: { B: { target: "formula", ref: { alias: "b" } } } },
    ]), allocate);
    expect(r.definition).toBeUndefined();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "validation", operation_index: 1 });
    expect(r.errors[0].affected_ids).toEqual(expect.arrayContaining([a.ids.a, r.ids.b]));
    expect(r.ids.b).toBeTruthy();
  });
  it("keeps the source-stage checklist and the result-stage filter distinct", () => {
    const b = base();
    const r = buildCandidate(b.definition!, columns, arrange([
      { op: "checklist.set", category: { id: b.ids.reg }, member_keys: [KEY_A] },
      { op: "result_filter.add", category: { id: b.ids.reg }, target: { id: b.ids.rev }, target_kind: "measure", predicate: "gt", value: 5 },
    ]), allocate);
    const m = r.definition!.analytical as TableModelV1;
    expect(m.checklists).toEqual([{ categoryId: b.ids.reg, memberKeys: [KEY_A] }]);
    expect(m.resultFilters[0]).toMatchObject({ categoryId: b.ids.reg, target: { kind: "measure", id: b.ids.rev }, predicate: "gt", value: 5 });
  });
  it("sets one Page with its complete member set, and clears it", () => {
    const b = base();
    const set = buildCandidate(b.definition!, columns, arrange([{ op: "page.set", category: { id: b.ids.reg }, member_keys: [KEY_A, KEY_B] }]), allocate);
    expect((set.definition!.analytical as TableModelV1).layout.page).toEqual({ categoryId: b.ids.reg, memberKeys: [KEY_A, KEY_B] });
    const cleared = buildCandidate(set.definition!, columns, arrange([{ op: "page.clear" }]), allocate);
    expect((cleared.definition!.analytical as TableModelV1).layout.page).toBeUndefined();
  });

  it("refuses a real cycle across requests (existing a<-b, then a->b) naming both ids", () => {
    const b0 = base().definition!;
    const one = buildCandidate(b0, columns, arrange([
      { op: "formula.set", target: { alias: "a" }, name: "A", scope: "aggregate", expression: "1" , bindings: {} },
      { op: "formula.set", target: { alias: "b" }, name: "B", scope: "aggregate", expression: "A + 1", bindings: { A: { target: "formula", ref: { alias: "a" } } } },
    ]), allocate);
    expect(one.errors).toEqual([]);
    const two = buildCandidate(one.definition!, columns, arrange([
      { op: "formula.set", target: { id: one.ids.a }, name: "A", scope: "aggregate", expression: "B + 1", bindings: { B: { target: "formula", ref: { id: one.ids.b } } } },
    ]), allocate);
    expect(two.definition).toBeUndefined();
    expect(two.errors[0]).toMatchObject({ code: "validation", target_id: one.ids.a });
    expect(two.errors[0].affected_ids).toEqual(expect.arrayContaining([one.ids.a, one.ids.b]));
  });
  it("refuses removing a formula another formula or result filter uses", () => {
    const one = buildCandidate(base().definition!, columns, arrange([
      { op: "formula.set", target: { alias: "a" }, name: "A", scope: "aggregate", expression: "1", bindings: {} },
      { op: "formula.set", target: { alias: "b" }, name: "B", scope: "aggregate", expression: "A + 1", bindings: { A: { target: "formula", ref: { alias: "a" } } } },
    ]), allocate);
    const r = buildCandidate(one.definition!, columns, arrange([{ op: "formula.remove", target: { id: one.ids.a } }]), allocate);
    expect(r.errors[0]).toMatchObject({ code: "validation", target_id: one.ids.a });
  });
  it("removes a result filter by id and by alias, refusing an unknown one", () => {
    const b = base();
    const add = (alias?: string) => ({ op: "result_filter.add", ...(alias ? { alias } : {}), category: { id: b.ids.reg }, target: { id: b.ids.rev }, target_kind: "measure", predicate: "gt", value: 1 }) as Arrangement["operations"][number];
    const viaAlias = buildCandidate(b.definition!, columns, arrange([add("f"), { op: "result_filter.remove", target: { alias: "f" } }]), allocate);
    expect(viaAlias.errors).toEqual([]);
    expect((viaAlias.definition!.analytical as TableModelV1).resultFilters).toEqual([]);
    const added = buildCandidate(b.definition!, columns, arrange([add("f")]), allocate);
    const byId = buildCandidate(added.definition!, columns, arrange([{ op: "result_filter.remove", target: { id: added.ids.f } }]), allocate);
    expect((byId.definition!.analytical as TableModelV1).resultFilters).toEqual([]);
    const bad = buildCandidate(added.definition!, columns, arrange([{ op: "result_filter.remove", target: { id: "nope" } }]), allocate);
    expect(bad.errors[0]).toMatchObject({ code: "unknown-reference" });
  });
});


it("records a marked anonymous measure's exact operator only in transient candidate metadata", () => {
  const result = buildCandidate({ table: {}, search: "" }, columns, arrange([
    { op: "measure.add", source_field_id: "cost", aggregation: "sum", aggregation_intent: "user_override" },
  ]), () => "anonymous-override");
  expect(result.aggregationOverrides?.get("anonymous-override")).toBe("sum");
  expect(JSON.stringify(result.definition)).not.toContain("aggregation_intent");
});
