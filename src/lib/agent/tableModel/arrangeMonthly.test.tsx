// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// D-014: Rita builds monthly OHLCV bars with a first-class M category in one arrange_table call.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

// Rows deliberately out of date order: first/last must follow the date, not the file.
vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode(
  "date,open,high,low,close,volume\n" +
  "2026-02-03,20,25,18,22,300\n" +
  "2026-01-05,11,15,8,14,150\n" +
  "2026-01-02,10,12,9,11,100\n" +
  "2026-02-02,19,21,17,20,200\n" +
  "2026-01-03,10.5,13,9.5,12,120\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => { useWidgetRegistryStore.getState().seedBuiltins(); useAgentEditsStore.getState().clear(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

it("arrange_table builds monthly first open / max high / min low / last close / sum volume from an M category (D-014)", async () => {
  await mountCsv();
  const { revision } = await describeTable({ card_id: "w" }) as { revision: string };
  const out = await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [
    { op: "category.add", alias: "m", name: "Month", source_field_id: "date", transform: "M" },
    { op: "measure.add", alias: "o", source_field_id: "open", aggregation: "first" },
    { op: "measure.add", alias: "h", source_field_id: "high", aggregation: "max" },
    { op: "measure.add", alias: "l", source_field_id: "low", aggregation: "min" },
    { op: "measure.add", alias: "c", source_field_id: "close", aggregation: "last" },
    { op: "measure.add", alias: "v", source_field_id: "volume", aggregation: "sum" },
    { op: "layout.set", rows: [{ alias: "m" }], values: [{ alias: "o" }, { alias: "h" }, { alias: "l" }, { alias: "c" }, { alias: "v" }] },
    { op: "model.enable", enabled: true },
  ] } }) as { status: string; ids: Record<string, string>; preview: { total: number; rows: { values: Record<string, unknown>; groupPath: { value: unknown }[] }[] } };
  expect(out.status).toBe("applied");
  expect(out.preview.total).toBe(2);
  const bars = out.preview.rows.map(r => [r.groupPath[0].value, ...["o", "h", "l", "c", "v"].map(a => r.values[out.ids[a]])]);
  expect(bars).toEqual([["2026-01", 10, 15, 8, 14, 370], ["2026-02", 19, 25, 17, 22, 500]]);
});
