// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// V9 review C1/C2: arrange_table fills the provider's operator only where it neither combines instruments nor gets refused.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

const csv = vi.hoisted(() => ({ text: "" }));
vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode(csv.text)) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => useWidgetRegistryStore.getState().seedBuiltins());
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

function withHints(hints: Record<string, unknown>) {
  const real = tableExecutionStore.readView.bind(tableExecutionStore);
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
type Out = { status: string; code?: string; warnings?: { code?: string; message?: string }[]; preview?: { rows: unknown[] } };
const arrange = async (operations: unknown[]) => {
  const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
  return await arrangeTable({ card_id: "w", expected_revision: revision, mode: "preview", arrangement: { contract: "table-model/1", operations } }) as Out;
};
const bar = (time: string | null, status = "conditional") => ({ time, frequencies: ["1d", "1W", "1M"], entity: "require_selection", status, ruleset: "2026-09-20.1" });

it("C1: a multi-instrument table grouped by month without symbol gets no provider operator", async () => {
  csv.text = "symbol,close,volume,date\nAAPL,200,10,2026-01-05\nAAPL,210,10,2026-01-30\nMSFT,400,99,2026-01-06\nMSFT,420,99,2026-01-29\n";
  await mountCsv();
  withHints({ close: bar("last"), volume: bar("sum"), date: bar(null, "dimension") });
  const fields = (await describeTable({ card_id: "w" }) as { fields: { id: string; suggestion_note?: string | null }[] }).fields;
  expect(fields.find(f => f.id === "close")?.suggestion_note).toMatch(/reviewed at 1d, 1W, 1M/); // nothing grouped yet: the bucket comes first
  const measures = [{ op: "measure.add", alias: "c", source_field_id: "close" }, { op: "measure.add", alias: "v", source_field_id: "volume" }];
  const month = { op: "category.add", alias: "m", name: "Month", source_field_id: "date", transform: "M" };
  const byMonth = await arrange([month, ...measures, { op: "layout.set", rows: [{ alias: "m" }], values: [{ alias: "c" }, { alias: "v" }] }]);
  expect(byMonth.warnings?.some(w => w.code === "provider-aggregation-applied")).toBe(false);
  // Grouped by symbol as well, each cell is one instrument and the operators apply.
  const bySymbol = await arrange([month, { op: "category.add", alias: "s", name: "Symbol", source_field_id: "symbol", transform: "native" }, ...measures,
    { op: "layout.set", rows: [{ alias: "s" }, { alias: "m" }], values: [{ alias: "c" }, { alias: "v" }] }]);
  expect(bySymbol.status).toBe("previewed");
  expect(bySymbol.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-applied", message: "close: last applied, the provider's operator for this column" }));
  expect(bySymbol.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-applied", message: "volume: sum applied, the provider's operator for this column" }));
});

it("C1: the describe note says to group by the ungrouped instrument column", async () => {
  csv.text = "symbol,close,date\nAAPL,200,2026-01-05\nMSFT,400,2026-01-06\n";
  await mountCsv();
  withHints({ close: bar("last") });
  const out = await arrangeTable({ card_id: "w", expected_revision: (await describeTable({ card_id: "w" }) as { revision: string }).revision, arrangement: { contract: "table-model/1", operations: [
    { op: "category.add", alias: "m", name: "Month", source_field_id: "date", transform: "M" }, { op: "layout.set", rows: [{ alias: "m" }] },
  ] } }) as Out;
  expect(out.status).toBe("applied");
  const fields = (await describeTable({ card_id: "w" }) as { fields: { id: string; suggested?: string | null; suggestion_note?: string | null }[] }).fields;
  expect(fields.find(f => f.id === "close")).toMatchObject({ suggested: null, suggestion_note: expect.stringMatching(/^Leaving symbol ungrouped combines entities/) });
  // The how-to ("group by a date category … it applies last") is for the frequency case only; here it would contradict the note.
  expect(fields.find(f => f.id === "close")?.suggestion_note).not.toMatch(/To follow the provider/);
});

it("C2: an operator the arrangement cannot take is neither suggested nor filled, so the call is not refused", async () => {
  csv.text = "cost,date,filed\n4,2026-01-01,2026-02-01\n5,2026-04-02,2026-05-01\n";
  await mountCsv();
  withHints({ cost: { time: "last", frequencies: ["annual", "quarter"], entity: "require_selection", status: "conditional", ruleset: "x" } });
  const out = await arrange([
    { op: "category.add", alias: "q", name: "Q", source_field_id: "date", transform: "Q" },
    { op: "category.add", alias: "y", name: "Y", source_field_id: "filed", transform: "Y" },
    { op: "measure.add", alias: "c", source_field_id: "cost" },
    { op: "layout.set", rows: [{ alias: "q" }], columns: [{ alias: "y" }], values: [{ alias: "c" }] },
  ]);
  expect(out.status).toBe("previewed");
  expect(out.warnings?.some(w => w.code === "provider-aggregation-applied")).toBe(false);
});


it("names the Account grouping needed alongside a date category before promising a provider operator", async () => {
  csv.text = "Quarter end,Account,Units\n2024-03-31,Main,100\n2024-06-30,Main,120\n2024-09-30,Main,90\n2024-12-31,Main,130\n2025-03-31,Main,150\n2025-06-30,Main,160\n2025-09-30,Main,170\n2025-12-31,Main,180\n";
  await mountCsv();
  withHints({
    Units: { time: "last", frequencies: ["quarter", "annual"], entity: "require_selection", status: "conditional", ruleset: "live-gate" },
    Account: { time: null, frequencies: [], entity: "require_selection", status: "dimension", ruleset: "live-gate" },
  });
  const fields = (await describeTable({ card_id: "w" }) as { fields: { id: string; suggestion_note?: string | null }[] }).fields;
  const note = fields.find(f => f.id === "Units")?.suggestion_note;
  expect(note, "the date-only recipe must not promise last while Account remains ungrouped").toMatch(/group by Account/);
  const year = { op: "category.add", alias: "y", name: "Year", source_field_id: "Quarter end", transform: "Y" };
  const units = { op: "measure.add", alias: "u", source_field_id: "Units" };
  const unsafe = await arrange([year, units, { op: "layout.set", rows: [{ alias: "y" }], values: [{ alias: "u" }] }]);
  expect(unsafe.warnings?.some(w => w.code === "provider-aggregation-applied")).toBe(false);
  const safe = await arrange([year, { op: "category.add", alias: "a", name: "Account", source_field_id: "Account", transform: "native" }, units,
    { op: "layout.set", rows: [{ alias: "a" }, { alias: "y" }], values: [{ alias: "u" }] }]);
  expect(safe.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-applied", message: "Units: last applied, the provider's operator for this column" }));
  const values = safe.preview?.rows.flatMap(row => Object.values((row as { values: Record<string, unknown> }).values)) ?? [];
  expect(values).toContain(130);
  expect(values).toContain(180);
});


it("refuses a hinted measure's incomplete apply without saving blanks, then accepts corrected grouping", async () => {
  csv.text = "Quarter end,Account,Units\n2024-03-31,Main,100\n2024-12-31,Main,130\n2025-03-31,Main,150\n2025-12-31,Main,180\n";
  await mountCsv();
  withHints({ Units: { time: "last", frequencies: ["quarter", "annual"], entity: "require_selection", status: "conditional", ruleset: "live-gate" }, Account: { time: null, frequencies: [], entity: "require_selection", status: "dimension", ruleset: "live-gate" } });
  const year = { op: "category.add", alias: "y", name: "Year", source_field_id: "Quarter end", transform: "Y" };
  const units = { op: "measure.add", alias: "u", source_field_id: "Units" };
  const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
  const before = JSON.stringify(useDashboardStore.getState().dashboards);
  const edits = useAgentEditsStore.getState().entries.length;
  const request = (operations: unknown[]) => arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations } });
  const refused = await request([year, units, { op: "layout.set", rows: [{ alias: "y" }], values: [{ alias: "u" }] }]) as { status: string; code?: string; errors?: { message: string }[] };
  expect(refused.status).toBe("refused");
  expect(refused.code).toBe("validation-failed");
  const recovery = refused.errors?.map(e => e.message).join(" ") ?? "";
  expect(recovery).toMatch(/Account/);
  expect(recovery).toMatch(/leave aggregation out of measure\.add/);
  expect(recovery).toMatch(/last/);
  expect(recovery).toMatch(/unless the user explicitly named an operator/i);
  expect(recovery).not.toMatch(/name an available operator|Choose an available aggregation/i);
  expect(recovery).toMatch(/only if the user explicitly excludes/i);
  expect(JSON.stringify(useDashboardStore.getState().dashboards)).toBe(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(edits);
  const applied = await request([year, { op: "category.add", alias: "a", name: "Account", source_field_id: "Account", transform: "native" }, units, { op: "layout.set", rows: [{ alias: "a" }, { alias: "y" }], values: [{ alias: "u" }] }]) as { status: string; after?: { measures: { aggregation?: string }[] } };
  expect(applied.status).toBe("applied");
  expect(applied.after?.measures[0].aggregation).toBe("last");
});


it("allows editing an existing unset hinted measure without inventing an operator", async () => {
  csv.text = "date,Account,Units\n2024-01-01,Main,100\n2024-12-31,Main,130\n";
  await mountCsv();
  withHints({ Units: { time: "last", frequencies: ["annual"], entity: "require_selection", status: "conditional", ruleset: "live-gate" }, Account: { time: null, frequencies: [], entity: "require_selection", status: "dimension", ruleset: "live-gate" } });
  await commitDrawerModel("rita", "w", { categories: [{ id: "y", name: "Year", sourceFieldId: "date", transform: "Y" }], measures: [{ id: "u", sourceFieldId: "Units" }], layout: { rows: ["y"], columns: [], values: ["u"] } });
  const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
  const out = await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [{ op: "measure.update", target: { id: "u" }, label: "Existing units" }] } }) as { status: string; after: { measures: { aggregation?: string; label?: string }[] } };
  expect(out.status).toBe("applied");
  expect(out.after.measures[0]).toMatchObject({ label: "Existing units" });
  expect(out.after.measures[0].aggregation).toBeUndefined();
});


type IntentResult = { status: string; code?: string; errors?: { code: string; message: string }[]; warnings?: { code?: string; message?: string }[]; after?: { measures: { aggregation?: string }[] } };
async function unitsFixture() {
  csv.text = "date,Account,Units\n2024-01-01,Main,100\n2024-12-31,Main,130\n2025-01-01,Main,150\n2025-12-31,Main,180\n";
  await mountCsv();
  withHints({ Units: { time: "last", frequencies: ["annual"], entity: "require_selection", status: "conditional", ruleset: "intent" }, Account: { time: null, frequencies: [], entity: "require_selection", status: "dimension", ruleset: "intent" } });
}
const intentOps = (intent = false, account = true): Record<string, unknown>[] => [
  { op: "category.add", alias: "y", name: "Year", source_field_id: "date", transform: "Y" },
  ...(account ? [{ op: "category.add", alias: "a", name: "Account", source_field_id: "Account", transform: "native" }] : []),
  { op: "measure.add", alias: "u", source_field_id: "Units", aggregation: "sum", ...(intent ? { aggregation_intent: "user_override" } : {}) },
  { op: "layout.set", rows: [{ alias: "y" }, ...(account ? [{ alias: "a" }] : [])], values: [{ alias: "u" }] },
];
async function intentRequest(operations: unknown[], mode = "apply"): Promise<IntentResult> {
  const revision = (await describeTable({ card_id: "w" }) as { revision: string }).revision;
  return await arrangeTable({ card_id: "w", expected_revision: revision, mode, arrangement: { contract: "table-model/1", operations } }) as IntentResult;
}

it.each(["apply", "preview"])("refuses an unmarked sum overriding provider last in %s without changing dashboard or Undo", async mode => {
  await unitsFixture();
  const before = JSON.stringify(useDashboardStore.getState().dashboards);
  const edits = useAgentEditsStore.getState().entries.length;
  const out = await intentRequest(intentOps(), mode);
  expect(out.status).toBe("refused");
  expect(out.errors).toContainEqual(expect.objectContaining({ code: "provider-override-required" }));
  expect(JSON.stringify(useDashboardStore.getState().dashboards)).toBe(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(edits);
});

it("applies a marked user override with a warning and never persists its request intent", async () => {
  await unitsFixture();
  const out = await intentRequest(intentOps(true));
  expect(out.status).toBe("applied");
  expect(out.after?.measures[0].aggregation).toBe("sum");
  expect(out.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint" }));
  expect(JSON.stringify(useDashboardStore.getState().dashboards)).not.toContain("aggregation_intent");
});

it("requires intent even when the same named provider operator lacks its entity prerequisites", async () => {
  await unitsFixture();
  const ops = intentOps(false, false);
  ops.find(op => op.op === "measure.add")!.aggregation = "last";
  const refused = await intentRequest(ops);
  expect(refused.status).toBe("refused");
  expect(refused.errors).toContainEqual(expect.objectContaining({ code: "provider-override-required" }));
  ops.find(op => op.op === "measure.add")!.aggregation_intent = "user_override";
  const applied = await intentRequest(ops);
  expect(applied.status).toBe("applied");
  expect(applied.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint", message: expect.stringMatching(/unavailable/) }));
});

it("does not let one measure's override intent authorize another measure", async () => {
  await unitsFixture();
  const ops = intentOps(true);
  ops.splice(ops.length - 1, 0, { op: "measure.add", alias: "other", source_field_id: "Units", aggregation: "sum" });
  const out = await intentRequest(ops);
  expect(out.status).toBe("refused");
  expect(out.errors?.filter(error => error.code === "provider-override-required")).toHaveLength(1);
});

it("does not retain intent when a later alias update chooses a different unmarked operator", async () => {
  await unitsFixture();
  const ops = intentOps(true);
  ops.splice(ops.length - 1, 0, { op: "measure.update", target: { alias: "u" }, aggregation: "mean" });
  const out = await intentRequest(ops);
  expect(out.status).toBe("refused");
  expect(out.errors).toContainEqual(expect.objectContaining({ code: "provider-override-required" }));
});

it("requires fresh intent for existing operator changes but preserves unchanged user overrides", async () => {
  await unitsFixture();
  await commitDrawerModel("rita", "w", { categories: [{ id: "y", name: "Year", sourceFieldId: "date", transform: "Y" }, { id: "a", name: "Account", sourceFieldId: "Account", transform: "native" }], measures: [{ id: "u", sourceFieldId: "Units", aggregation: "last" }], layout: { rows: ["y", "a"], columns: [], values: ["u"] } });
  const change = { op: "measure.update", target: { id: "u" }, aggregation: "sum" };
  expect((await intentRequest([change])).status).toBe("refused");
  expect((await intentRequest([{ ...change, aggregation_intent: "user_override" }])).status).toBe("applied");
  const label = await intentRequest([{ op: "measure.update", target: { id: "u" }, label: "Requested sum" }]);
  expect(label.status).toBe("applied");
  expect(label.after?.measures[0].aggregation).toBe("sum");
  expect((await intentRequest([{ ...change, aggregation: "mean" }])).status).toBe("refused");
});


it("requires new scoped intent when copying a measure that overrides its provider", async () => {
  await unitsFixture();
  const original = await intentRequest(intentOps(true));
  const id = (original.after?.measures[0] as { id?: string }).id;
  expect(id).toEqual(expect.any(String));
  const copy = { op: "measure.duplicate", target: { id }, alias: "copy" };
  const refused = await intentRequest([copy]);
  expect(refused.errors).toContainEqual(expect.objectContaining({ code: "provider-override-required" }));
  const applied = await intentRequest([{ ...copy, aggregation_intent: "user_override" }]);
  expect(applied.status).toBe("applied");
  expect(applied.after?.measures).toHaveLength(2);
  expect(applied.after?.measures.every(measure => measure.aggregation === "sum")).toBe(true);
});

it("warns for a marked unchanged operator when required grouping is removed", async () => {
  await unitsFixture();
  await commitDrawerModel("rita", "w", { categories: [{ id: "y", name: "Year", sourceFieldId: "date", transform: "Y" }, { id: "a", name: "Account", sourceFieldId: "Account", transform: "native" }], measures: [{ id: "u", sourceFieldId: "Units", aggregation: "last" }], layout: { rows: ["y", "a"], columns: [], values: ["u"] } });
  const applied = await intentRequest([{ op: "category.remove", target: { id: "a" } }, { op: "measure.update", target: { id: "u" }, aggregation: "last", aggregation_intent: "user_override" }]);
  expect(applied.status).toBe("applied");
  expect(applied.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint", message: expect.stringMatching(/unavailable/) }));
});
