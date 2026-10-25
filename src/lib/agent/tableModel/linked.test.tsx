// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Real-worker verification: a linked table sees only its immediate source's presented subset, and Rita is told honestly that the cascade is still running.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalTableRenderer } from "../../../components/renderers/LocalTableRenderer";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { __reset } from "../../../test/memfs";
import { pivotValueKey } from "../../pivotKeys";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => { __reset(); useWidgetRegistryStore.getState().seedBuiltins(); useAgentEditsStore.getState().clear(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

const renderLinked = (dashboardId: string, widgetId: string) =>
  render(<LocalTableRenderer executionIdentity={{ dashboardId, widgetId }} file="" label="Linked" refreshKey={0} state={{}} onStateChange={() => undefined} filterRow />);

it("a linked table sees only its source's presented subset and reports cascade status", async () => {
  await mountCsv();
  const d = useDashboardStore.getState().dashboards[0];
  const linkedId = await useDashboardStore.getState().addLinkedCard({ dashboardId: d.id, tabId: d.tabs[0].id, sourceWidgetId: "w", presentation: "table" });
  expect(linkedId).toBeTruthy();
  tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0] as never);
  renderLinked(d.id, linkedId!);
  await waitFor(() => expect(tableExecutionStore.readView(d.id, linkedId!).status).toMatch(/ready|empty/));

  // Task 4 addendum: the linked card's own summary names its kind and immediate source.
  expect(await describeTable({ card_id: linkedId })).toMatchObject({ card: { id: linkedId, source_kind: "linked", source_card_id: "w", mode: "authoring", editable: true } });

  const src = await describeTable({ card_id: "w" }) as { revision: string };
  const out = await arrangeTable({ card_id: "w", expected_revision: src.revision, arrangement: { contract: "table-model/1", operations: [
    { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
    { op: "checklist.set", category: { alias: "reg" }, member_keys: [pivotValueKey("A")] },
  ] } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(out.status).toBe("applied");
  expect(out.linked).toEqual([expect.objectContaining({ card_id: linkedId })]);
  expect(out.linked[0]).toMatchObject({ status: "updating", stale: true }); // the runtime exposes the cascade as updating+stale, never ready
  await waitFor(() => expect(tableExecutionStore.readView(d.id, linkedId!).status).toMatch(/ready|empty/));
  await commitDrawerModel(d.id, linkedId!, { categories: [{ id: "lr", name: "Region", sourceFieldId: "region", transform: "native" }] });
  const members = await describeTable({ card_id: linkedId, section: "members:lr" }) as { rows: { label: string }[] };
  expect(members.rows.map(r => r.label)).toEqual(["A"]); // B was excluded upstream and never leaks
});

it("a linked table's profile never shows a record its source excludes (privacy)", async () => {
  await mountCsv();
  const d = useDashboardStore.getState().dashboards[0];
  const linkedId = (await useDashboardStore.getState().addLinkedCard({ dashboardId: d.id, tabId: d.tabs[0].id, sourceWidgetId: "w", presentation: "table" }))!;
  tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0] as never);
  renderLinked(d.id, linkedId);
  await waitFor(() => expect(tableExecutionStore.readView(d.id, linkedId).status).toMatch(/ready|empty/));
  const src = await describeTable({ card_id: "w" }) as { revision: string };
  expect(await arrangeTable({ card_id: "w", expected_revision: src.revision, arrangement: { contract: "table-model/1", operations: [
    { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
    { op: "checklist.set", category: { alias: "reg" }, member_keys: [pivotValueKey("A")] },
  ] } })).toMatchObject({ status: "applied" });
  await waitFor(() => expect(tableExecutionStore.readView(d.id, linkedId).status).toMatch(/ready|empty/));
  await waitFor(async () => expect((await describeTable({ card_id: linkedId, section: "profile" }) as { rows_profiled: number }).rows_profiled).toBe(2));
  const p = await describeTable({ card_id: linkedId, section: "profile" }) as { fields: { id: string; count: number; distinct: number; min?: unknown; max?: unknown; samples: unknown[] }[] };
  const pick = (id: string) => p.fields.find(f => f.id === id);
  expect(pick("region")).toMatchObject({ count: 2, distinct: 1, samples: ["A"] });
  expect(pick("revenue")).toMatchObject({ count: 2, min: 10, max: 20, samples: [10, 20] });
  expect(pick("cost")).toMatchObject({ max: 5 });
  expect(pick("date")).toMatchObject({ max: "2026-01-02" });
  for (const scope of ["input", "filtered"]) {
    const text = JSON.stringify(await describeTable({ card_id: linkedId, section: "profile", scope }));
    expect(text).not.toContain('"B"');
    expect(text).not.toContain("2026-01-03");
  }
});
