// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// V9 review C1/C2: arrange_table fills the provider's operator only where it neither combines instruments nor gets refused.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { mountCsv } from "./testHarness";
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
