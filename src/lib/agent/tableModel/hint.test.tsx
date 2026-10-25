// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// V9-P2: describe_table reports a column's provider aggregation hint and arrange_table names a contradicting operator.
// A CSV carries no hint, so the input columns are given the metadata backendTableSource puts on a backend column.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => useWidgetRegistryStore.getState().seedBuiltins());
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

const revenueHint = { time: "sum", frequencies: ["quarter", "annual"], entity: "require_selection", status: "conditional", ruleset: "eodhd-1" };
const regionHint = { time: null, frequencies: [], entity: "require_selection", status: "dimension", ruleset: "eodhd-1" };

function withHints(extra: Record<string, unknown> = {}) {
  const real = tableExecutionStore.readView.bind(tableExecutionStore);
  const hints: Record<string, unknown> = { revenue: revenueHint, region: regionHint, ...extra };
  // One wrapped object per real view: React's store subscription needs a stable snapshot.
  const seen = new WeakMap<object, ReturnType<typeof real>>();
  vi.spyOn(tableExecutionStore, "readView").mockImplementation((d, id) => {
    const v = real(d, id);
    if (!v.ready) return v;
    if (!seen.has(v)) {
      const inputColumns = v.ready.inspection.inputColumns.map(c => (hints[c.id] ? { ...c, metadata: { aggregationHint: hints[c.id] } } : c)) as never;
      seen.set(v, { ...v, ready: { ...v.ready, inspection: { ...v.ready.inspection, inputColumns } } });
    }
    return seen.get(v)!;
  });
}
type Field = { id: string; hint?: unknown; suggested?: string | null; suggestion_note?: string | null };
const fields = async () => (await describeTable({ card_id: "w" }) as { fields: Field[] }).fields;
const byQuarter = { categories: [{ id: "q", name: "Quarter", sourceFieldId: "date", transform: "Q" }, { id: "r", name: "Region", sourceFieldId: "region", transform: "native" }], layout: { rows: ["r"], columns: ["q"], values: [] } } as never;

it("describe_table reports each hinted field's hint and the suggestion under the current arrangement", async () => {
  await mountCsv();
  withHints();
  let f = await fields();
  // Nothing grouped: the rule was reviewed at quarter/annual, so no operator is offered yet.
  expect(f.find(x => x.id === "revenue")).toMatchObject({ hint: revenueHint, suggested: null, suggestion_note: expect.stringMatching(/reviewed at quarter, annual/) });
  // ...but the note names the operator and the date transforms that unlock it, so Rita can act on it in one call.
  expect(f.find(x => x.id === "revenue")?.suggestion_note).toMatch(/Q, FQ, Y or FY date category.*group by region.*leave aggregation out of measure\.add.*applies sum/);
  expect(f.find(x => x.id === "cost")).toEqual({ id: "cost", label: "cost", type: "number" }); // no hint, no extra keys
  await commitDrawerModel("rita", "w", byQuarter);
  f = await fields();
  expect(f.find(x => x.id === "revenue")).toMatchObject({ suggested: "sum", suggestion_note: null });
});

it("arrange_table warns when a measure's aggregation contradicts the provider's suggestion, and only then", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", byQuarter);
  withHints();
  const run = async (aggregation: string) => {
    const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
    return await arrangeTable({ card_id: "w", expected_revision: revision, mode: "preview", arrangement: { contract: "table-model/1", operations: [
      { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation, aggregation_intent: "user_override" },
      { op: "layout.set", rows: [{ id: "r" }], columns: [{ id: "q" }], values: [{ alias: "rev" }] },
    ] } }) as { status: string; warnings: { code?: string; message?: string }[] };
  };
  const mean = await run("mean");
  expect(mean.status).toBe("previewed");
  expect(mean.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint", message: "revenue: mean chosen, but the provider suggests sum for this column" }));
  const sum = await run("sum");
  expect(sum.warnings.some(w => w.code === "provider-aggregation-hint")).toBe(false);
});

// Live gate 2026-10-15: told the rule, a 35B model still chose the provider's operator about half the time, so
// arrange_table fills it in when measure.add leaves aggregation out, judged on the arrangement in that same call.
const costHint = { time: "last", frequencies: ["quarter", "annual"], entity: "require_selection", status: "conditional", ruleset: "eodhd-1" };
type Applied = { status: string; code?: string; errors?: { message: string }[]; after: { measures: { source_field_id: string; aggregation?: string }[] }; warnings: { severity?: string; code?: string; message?: string }[] };
const quarter = { name: "Quarter", source_field_id: "date", transform: "Q" };
const region = { name: "Region", source_field_id: "region", transform: "native" };
const addCost = async (categories: Record<string, unknown>[], aggregation?: string) => {
  const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
  return await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [
    ...categories.map((c, i) => ({ op: "category.add", alias: `g${i}`, ...c })),
    { op: "measure.add", alias: "c", source_field_id: "cost", ...(aggregation ? { aggregation, aggregation_intent: "user_override" } : {}) },
    { op: "layout.set", rows: categories.map((_, i) => ({ alias: `g${i}` })), values: [{ alias: "c" }] },
  ] } }) as Applied;
};

it("arrange_table fills in the provider's operator when measure.add leaves aggregation out and the call's arrangement meets the rule", async () => {
  await mountCsv();
  withHints({ cost: costHint });
  const out = await addCost([region, quarter]);
  expect(out.status).toBe("applied");
  expect(out.after.measures.find(m => m.source_field_id === "cost")?.aggregation).toBe("last");
  expect(out.warnings).toContainEqual(expect.objectContaining({ severity: "info", code: "provider-aggregation-applied", message: "cost: last applied, the provider's operator for this column" }));
});

it("arrange_table refuses an apply with an omitted provider operator when the arrangement does not meet the rule", async () => {
  await mountCsv();
  withHints({ cost: costHint });
  for (const categories of [[region], [quarter]]) { // no date grouping: no reviewed frequency; region left ungrouped: regions A and B in one cell
    const out = await addCost(categories);
    expect(out.status).toBe("refused");
    expect(out.code).toBe("validation-failed");
    expect(out.errors?.some(error => /provider's last/.test(error.message))).toBe(true);
  }
});

it("arrange_table keeps an explicitly marked user operator and warns when it contradicts the provider", async () => {
  await mountCsv();
  withHints({ cost: costHint });
  const out = await addCost([region, quarter], "sum");
  expect(out.after.measures.find(m => m.source_field_id === "cost")?.aggregation).toBe("sum");
  expect(out.warnings.some(w => w.code === "provider-aggregation-applied")).toBe(false);
  expect(out.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint" }));
});
