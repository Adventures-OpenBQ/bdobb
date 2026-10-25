// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Real-worker verification: Rita and the drawer agree, a failed durable write publishes nothing, a source change discards the candidate.
import { cleanup } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { __failPath, __read, __reset } from "../../../test/memfs";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { pivotValueKey } from "../../pivotKeys";
import { executeLocalTool } from "../localTools";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

// Rita reaches a user's card only with Context sharing on (review A8).
beforeEach(() => { __reset(); useWidgetRegistryStore.getState().seedBuiltins(); useAgentEditsStore.getState().clear(); useSettingsStore.setState((s) => ({ settings: { ...s.settings, contextSharing: true } })); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); for (const d of ["rita", "drawer"]) tableExecutionStore.disposeDashboard(d); vi.unstubAllGlobals(); });

type Out = Record<string, unknown>;
const ritaModel = () => structuredClone(useDashboardStore.getState().dashboards.find(d => d.id === "rita")!.tabs[0].cards[0].tableDefinition!.analytical);
const view = (d: string) => tableExecutionStore.readView(d, "w");
const rows = async (d: string) => (await tableExecutionStore.readExecutor(d, "w")!.rows(view(d).active!, { groupPath: [], offset: 0, limit: 50 }, new AbortController().signal)).rows.map(x => x.values);
/** executor.rows returns the presented group rows only; the grand total is a separate executor call. */
const totals = async (d: string) => (await tableExecutionStore.readExecutor(d, "w")!.totals(view(d).active!, new AbortController().signal)).values;
const GROUP = "\u001egroup"; // the row-label column
/** The same arrangement through the real dispatcher (as Rita's execute_agent_tool reaches it) and, as the resulting model, through the drawer's commit path. */
async function bothWays(operations: unknown[]) {
  await mountCsv("rita"); await mountCsv("drawer");
  useDashboardStore.setState({ activeId: "rita" }); // the tools act on the active dashboard
  const { revision } = await executeLocalTool("describe_table", { card_id: "w" }) as { revision: string };
  const r = await executeLocalTool("arrange_table", { card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations } }) as Out & { ids: Record<string, string> };
  expect(r.status).toBe("applied");
  await commitDrawerModel("drawer", "w", ritaModel() as never);
  await waitFor(async () => expect(await rows("rita")).toEqual(await rows("drawer")));
  expect(await totals("rita")).toEqual(await totals("drawer"));
  expect(view("rita").ready!.columns).toEqual(view("drawer").ready!.columns);
  return { ids: r.ids, rows: await rows("rita"), totals: await totals("rita") };
}

// Fixture CSV: A,10,4 / A,20,5 / B,90,30. Region A = revenue 30, cost 9; B = 90, 30; grand total 120, 39; margin (R-C)/R.
it("Rita and the drawer produce the same presented values, order and totals for equivalent models", async () => {
  const { ids, rows: out, totals: grand } = await bothWays([
    { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
    { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
    { op: "measure.add", alias: "cost", source_field_id: "cost", aggregation: "sum" },
    { op: "formula.set", target: { alias: "m" }, name: "Margin", scope: "aggregate", expression: "(R - C) / R", bindings: { R: { target: "measure", ref: { alias: "rev" } }, C: { target: "measure", ref: { alias: "cost" } } } },
    { op: "layout.set", rows: [{ alias: "reg" }], values: [{ alias: "rev" }, { alias: "cost" }, { alias: "m" }] },
    { op: "totals.set", grand_total: true }, { op: "model.enable", enabled: true },
  ]);
  expect(out).toEqual([
    { [GROUP]: "A", [ids.rev]: 30, [ids.cost]: 9, [ids.m]: (30 - 9) / 30 },
    { [GROUP]: "B", [ids.rev]: 90, [ids.cost]: 30, [ids.m]: (90 - 30) / 90 },
  ]);
  expect(grand).toMatchObject({ [ids.rev]: 120, [ids.cost]: 39 }); // the grand total is not a row of executor.rows
  expect(grand[ids.m]).toBeCloseTo((120 - 39) / 120);
});

it("page.set and checklist.set give the drawer's presented rows for a narrowing selection and an empty one", async () => {
  const base = [
    { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
    { op: "category.add", alias: "dt", name: "Date", source_field_id: "date", transform: "native" },
    { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
    { op: "layout.set", rows: [{ alias: "dt" }], values: [{ alias: "rev" }] },
    { op: "model.enable", enabled: true },
  ];
  // Page = A (drops B's 01-03 row) and a checklist of one date: exactly one row survives, so a page or checklist that ignored its selection would show more.
  const one = await bothWays([...base,
    { op: "page.set", category: { alias: "reg" }, member_keys: [pivotValueKey("A")] },
    { op: "checklist.set", category: { alias: "dt" }, member_keys: [pivotValueKey("2026-01-02")] },
  ]);
  expect(one.rows).toEqual([{ [GROUP]: "2026-01-02", [one.ids.rev]: 20 }]);

  // Empty selection: apply it through Rita, then the same model through the drawer, and pin the values both produce.
  const { revision } = await describeTable({ card_id: "w" }) as { revision: string };
  expect(await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [{ op: "checklist.set", category: { id: one.ids.dt }, member_keys: [] }] } })).toMatchObject({ status: "applied" });
  expect((ritaModel() as { checklists: unknown[] }).checklists).toEqual([{ categoryId: one.ids.dt, memberKeys: [] }]);
  await waitFor(async () => expect((await rows("rita")).length).not.toBe(1));
  await commitDrawerModel("drawer", "w", ritaModel() as never);
  await waitFor(async () => expect(await rows("rita")).toEqual(await rows("drawer")));
  expect(await rows("rita")).toEqual([]); // an empty checklist selects none, on both sides
  expect(await rows("drawer")).toEqual([]);
});

it("a failed durable write publishes nothing and registers no Undo", async () => {
  await mountCsv();
  const { revision } = await describeTable({ card_id: "w" }) as { revision: string };
  const before = tableExecutionStore.readView("rita", "w").definition;
  const cardBefore = structuredClone(useDashboardStore.getState().dashboards.find(d => d.id === "rita")!.tabs[0].cards[0]);
  const fileBefore = __read("dashboards/rita.json");
  __failPath("dashboards/rita.json"); // the real write path: the coordinator's jsonStore write, not a mocked commit
  const out = await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [{ op: "presentation.set", hidden: ["cost"] }] } });
  expect(out).toMatchObject({ status: "failed", code: "commit-failed" });
  expect(tableExecutionStore.readView("rita", "w").definition).toEqual(before);
  expect(useDashboardStore.getState().dashboards.find(d => d.id === "rita")!.tabs[0].cards[0]).toEqual(cardBefore); // nothing published to the store
  expect(__read("dashboards/rita.json")).toEqual(fileBefore); // nothing persisted (no file existed before: a leaked write would create one)
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("a source change during the preview discards the candidate", async () => {
  await mountCsv();
  const { revision } = await describeTable({ card_id: "w" }) as { revision: string };
  const executor = tableExecutionStore.readExecutor("rita", "w")!;
  const original = executor.previewDefinition!.bind(executor);
  executor.previewDefinition = async (...a) => {
    const p = await original(...a);
    // An external source change: the coordinator's source identity covers card.params.
    useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => d.id !== "rita" ? d : { ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => c.id === "w" ? { ...c, params: { file: "other.csv" } } : c) })) }) }));
    return p;
  };
  const replace = vi.spyOn(tableCommitCoordinators.peek("rita", "w")!, "replaceDefinition");
  const out = await arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations: [{ op: "presentation.set", hidden: ["cost"] }] } });
  expect(out).toMatchObject({ status: "refused", code: "stale-revision", message: expect.stringMatching(/source changed/) }); // the write-boundary sourceMatches guard
  expect(replace).not.toHaveBeenCalled();
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});
