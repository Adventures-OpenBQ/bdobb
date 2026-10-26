// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { capabilitiesFor } from "./capabilities";
import { OPERATIONS } from "./contract";
import { measureEligibility } from "../../../components/renderers/table-model/measureEligibility";
import { statementTemplate } from "../../statementModel/catalog";
import type { DatasetColumn } from "../../widgetData/types";

const columns = [{ id: "region", label: "Region", dtype: "text" }, { id: "revenue", label: "Revenue", dtype: "number" }, { id: "date", label: "Date", dtype: "date" }] as DatasetColumn[];

it("derives per-field aggregations from the drawer's measureEligibility, not a private list", () => {
  const caps = capabilitiesFor(undefined, columns, "authoring");
  const empty = { schemaVersion: 1, enabled: true, params: { promotePage: false, filters: [] }, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } } as const;
  for (const c of columns) expect(caps.aggregations_by_field[c.id]).toEqual(measureEligibility({ model: empty as never, columns, sourceFieldId: c.id }).operators);
  expect(caps.aggregations_by_field.region).not.toContain("sum");
});
it("marks FY/FQ as requiring fiscal metadata and lists only installed Statement templates", () => {
  const caps = capabilitiesFor(undefined, columns, "authoring");
  expect(caps.category_transforms.filter(t => t.requires_fiscal_binding).map(t => t.transform)).toEqual(["FY", "FQ"]);
  for (const t of caps.statement.templates) expect(statementTemplate(t.id as "income", t.version)).toBeDefined();
});
it("in viewer mode offers only viewer operations", () => {
  expect(capabilitiesFor(undefined, columns, "viewer").operations).toEqual(["viewer.set", "viewer.reset"]);
});
it("names each offered operation's required and optional fields, so the model need not guess them (live Rita sent name/totals/groups)", () => {
  const caps = capabilitiesFor(undefined, columns, "authoring");
  expect(Object.keys(caps.operation_fields)).toEqual(caps.operations);
  expect(caps.operation_fields["category.add"]).toEqual({ required: ["name", "source_field_id", "transform"], optional: ["alias", "fiscal_binding"] });
  expect(caps.operation_fields["layout.set"]).toEqual({ required: [], optional: ["rows", "columns", "values"] });
  expect(Object.keys(capabilitiesFor(undefined, columns, "viewer").operation_fields)).toEqual(["viewer.set", "viewer.reset"]);
});
it("carries a short how_to_arrange for authoring, naming only real operations and their required fields (live Rita treated fields as categories)", () => {
  const rules = capabilitiesFor(undefined, columns, "authoring").how_to_arrange!;
  expect(rules.length).toBeGreaterThan(0);
  const text = rules.join("\n");
  for (const op of (text.match(/\b[a-z_]+\.[a-z_]+\b/g) ?? []).filter(t => t !== "preview.rows")) expect(Object.keys(OPERATIONS), op).toContain(op);
  for (const op of ["category.add", "measure.add"] as const) for (const f of Object.keys(OPERATIONS[op].required)) expect(text).toContain(f);
  expect(text).toMatch(/rows and columns take categories/);
  expect(text).toMatch(/never a field id/);
  expect(text).toMatch(/preview\.rows/);
  expect(text).toMatch(/grand total.*row count|row count.*grand total/);
  expect(capabilitiesFor(undefined, columns, "viewer").how_to_arrange).toBeUndefined();
});
it("lists M (month) as a category transform (D-014)", () => {
  expect(capabilitiesFor(undefined, columns, "authoring").category_transforms.map(t => t.transform)).toContain("M");
});
it("tells the model how first/last become available: date categories on one field, added in the same call (D-014)", () => {
  const text = capabilitiesFor(undefined, columns, "authoring").how_to_arrange!.join("\n");
  expect(text).toMatch(/first\/last/);
  expect(text).toMatch(/\(Y\/Q\/M\/FY\/FQ\) all sit on exactly one field/);
  expect(text).toMatch(/same call/);
});


it("advertises the exact override intent on every measure operation that can choose an operator", () => {
  const caps = capabilitiesFor(undefined, columns, "authoring");
  for (const op of ["measure.add", "measure.update", "measure.duplicate"]) expect(caps.operation_fields[op].optional).toContain("aggregation_intent");
  expect(caps.how_to_arrange?.join(" ")).toContain("aggregation_intent");
  expect(caps.how_to_arrange?.join(" ")).toContain("user_override");
});

it("maps calendar units explicitly so a quarter-named field does not change a requested year grouping", () => {
  const rules = capabilitiesFor(undefined, columns, "authoring").how_to_arrange!.join(" ");
  expect(rules).toContain('calendar year: "Y"');
  expect(rules).toContain('calendar quarter: "Q"');
  expect(rules).toContain('calendar month: "M"');
  expect(rules).toContain("requested grouping");
});

it("makes inspection-only status and the required execution step explicit in the returned guidance", () => {
  const rules = capabilitiesFor(undefined, columns, "authoring").how_to_arrange!.join(" ");
  expect(rules).toContain("describe_table has not changed the table");
  expect(rules).toContain("contains no grouped totals");
  expect(rules).toContain("call arrange_table");
});

it("requires direct apply for changes because apply already validates and previews atomically", () => {
  const rules = capabilitiesFor(undefined, columns, "authoring").how_to_arrange!.join(" ");
  expect(rules).toContain("do not precede it with a separate preview call");
  expect(rules).toContain("apply transaction already validates");
});
