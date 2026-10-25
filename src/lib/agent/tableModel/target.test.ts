// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Boundary } from "../../../test/tableWorkerBoundary";
import { WORKER_MAX_CELLS } from "../../tableExecution/eligibility";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { resolveTableTarget, openRuntime, revisionWitness } from "./target";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { arrangeTable, describeTable } from "./tools";
import type { DashboardCard } from "../../types";

const card = (over: Partial<DashboardCard>): DashboardCard =>
  ({ id: "c", widgetId: "local_table", backendId: "builtin", params: { file: "a.csv" }, layout: { x: 0, y: 0, w: 4, h: 4 }, ...over }) as DashboardCard;
function board(cards: DashboardCard[]) {
  useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards }] }], activeId: "d", activeTabId: "t", viewer: false, pendingCardRemoval: null });
}
beforeEach(() => {
  useWidgetRegistryStore.getState().seedBuiltins();
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, { id: "prices", backendId: "be", name: "Prices", description: "", type: "table", category: "x", subCategory: "", endpoint: "/p", source: [], params: [], gridData: { w: 4, h: 4 } }] }));
});

describe("table tool targets (adaptation 1a)", () => {
  it("classifies a CSV/XLS table as a worker table", () => {
    board([card({})]);
    expect(resolveTableTarget("c").kind).toBe("worker");
  });
  it("classifies a linked table as a worker table", () => {
    board([card({ id: "s" }), card({ id: "c", widgetId: "linked_table", params: {}, linkedSource: { kind: "widget", sourceWidgetId: "s" } })]);
    expect(resolveTableTarget("c").kind).toBe("worker");
  });
  it("takes a backend table as a worker table: it runs on the same client worker as CSV/XLS", async () => {
    board([card({ widgetId: "prices", backendId: "be", params: {} })]);
    expect(resolveTableTarget("c")).toMatchObject({ kind: "worker" });
    // Its tab is not mounted here, so the tools answer not-ready, never server-execution-pending.
    expect(await describeTable({ card_id: "c" })).toMatchObject({ status: "unavailable", reason: "runtime-not-ready" });
    const arranged = await arrangeTable({ card_id: "c", expected_revision: "x", arrangement: { contract: "table-model/1", operations: [] } });
    expect(JSON.stringify(arranged)).not.toContain("server-execution-pending");
  });
  it("says why an oversized backend table has no table model: the worker's ceiling", async () => {
    vi.stubGlobal("Worker", Boundary);
    const c = card({ widgetId: "prices", backendId: "be", params: {} });
    board([c]);
    try {
      tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]);
      tableExecutionStore.ensureTable("d", "c");
      tableExecutionStore.setBackendRows("d", "c", Array.from({ length: WORKER_MAX_CELLS + 1 }, () => ({ x: 1 })));
      await tableExecutionStore.settled("d");
      expect(await describeTable({ card_id: "c" })).toMatchObject({ status: "unavailable", reason: "runtime-not-ready", message: expect.stringContaining("too large for the table engine") });
    } finally {
      tableExecutionStore.disposeDashboard("d");
      vi.unstubAllGlobals();
    }
  });
  it("answers unknown for a linked table (or one of a linked table) built on key-maint's provider_api_keys table", async () => {
    useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, { id: "provider_api_keys", backendId: "km", name: "Provider API Keys", description: "", type: "table", category: "x", subCategory: "", endpoint: "/keys", source: [], params: [], gridData: { w: 4, h: 4 } }] }));
    board([
      card({ id: "k", widgetId: "provider_api_keys", backendId: "km", params: {} }),
      card({ id: "c", widgetId: "linked_table", params: {}, linkedSource: { kind: "widget", sourceWidgetId: "k" } }),
      card({ id: "g", widgetId: "linked_table", params: {}, linkedSource: { kind: "widget", sourceWidgetId: "c" } }),
    ]);
    expect(resolveTableTarget("c")).toMatchObject({ kind: "refusal", status: "unknown", message: "unknown card c" });
    expect(resolveTableTarget("g")).toMatchObject({ kind: "refusal", status: "unknown", message: "unknown card g" });
    expect(await describeTable({ card_id: "c" })).not.toHaveProperty("fields");
  });
  it("answers an unknown card exactly like get_widget_data", () => {
    board([]);
    expect(resolveTableTarget("nope")).toMatchObject({ kind: "refusal", status: "unknown", message: "unknown card nope" });
  });
  it("refuses a worker table shown as a chart with view-not-tabular", () => {
    board([card({ view: "chart" })]);
    expect(resolveTableTarget("c")).toMatchObject({ kind: "refusal", status: "view-not-tabular" });
  });
});

describe("runtime access", () => {
  it("is runtime-not-ready when the card's table is not mounted", () => {
    board([card({})]);
    const target = resolveTableTarget("c");
    if (target.kind !== "worker") throw new Error("expected worker");
    expect(tableCommitCoordinators.peek("d", "c")).toBeUndefined();
    expect(openRuntime(target)).toMatchObject({ status: "runtime-not-ready", alternatives: [expect.stringContaining("navigate")] });
    expect(tableCommitCoordinators.peek("d", "c")).toBeUndefined();   // peek never creates
  });
  it("changes the witness when the saved definition or source changes, not when nothing changed", () => {
    board([card({})]);
    const c = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    const view = tableExecutionStore.readView("d", "c");
    const w = revisionWitness(c, view);
    expect(revisionWitness(structuredClone(c), view)).toBe(w);
    expect(revisionWitness({ ...c, tableDefinition: { table: {}, search: "x" } } as DashboardCard, view)).not.toBe(w);
    expect(revisionWitness({ ...c, params: { file: "b.csv" } }, view)).not.toBe(w);
  });
});
it('supports managed table tools but explicitly refuses standard LIVE analytical scope',()=>{
 const def={id:'managed',backendId:'be',name:'Managed',description:'',type:'table_ssrm',provider:'managed-native' as const,protocolVersion:1,category:'x',subCategory:'',endpoint:'/sessions',source:[],params:[],gridData:{w:4,h:4}};
 useWidgetRegistryStore.setState(s=>({widgets:[...s.widgets,def,{...def,id:'live',provider:undefined}]}));
 const managed=card({widgetId:'managed',backendId:'be',managedSource:{sourceId:'a',kind:'upload',version:1}});
 board([managed]);expect(resolveTableTarget('c').kind).toBe('worker');
 const view=tableExecutionStore.readView('d','c');
 expect(revisionWitness({...managed,managedSource:{...managed.managedSource!,sourceId:'b'}},view)).not.toBe(revisionWitness(managed,view));
 board([card({widgetId:'live',backendId:'be'})]);expect(resolveTableTarget('c')).toMatchObject({kind:'refusal',status:'server-execution-pending',message:expect.stringMatching(/LIVE.*whole|whole.*LIVE/)});
});
