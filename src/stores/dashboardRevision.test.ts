// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// bdobb#41: every edit to a dashboard's content must move its `revision`, or
// the Workspace sync never uploads it and the next sync reverts it. Two
// guards, so a new action cannot forget:
//   1. the store writes a dashboard file only through saveEdit (which bumps)
//      or saveAsIs (creates, imports and the sync's own writes);
//   2. every function the store exposes is classified, and each one that
//      edits content is driven here and must bump, in memory and on disk.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "../lib/types";
import type { TableModelV1 } from "../lib/tableModel/types";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { collectPivotGroupProof } from "../lib/tableExecution/pivotGroupProof";
import { planGroupChange } from "../lib/pivotGroupChange";
import { __read, __reset } from "../test/memfs";
import { card, widget } from "../test/fixtures";
import { Boundary } from "../test/tableWorkerBoundary";
import { useDashboardStore } from "./dashboardStore";
import { tableCommitCoordinators } from "./tableCommitCoordinator";
import { tableExecutionStore as runtime } from "./tableExecutionStore";

// The Pivot group actions need a real worker proof over a local file.
vi.mock("../lib/localFiles", async () => ({
  ...(await vi.importActual<typeof import("../lib/localFiles")>("../lib/localFiles")),
  readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue\n" + Array.from({ length: 12 }, (_, i) => `R${i},${i}`).join("\n") + "\n")),
}));

const SOURCE = readFileSync(resolve(__dirname, "dashboardStore.ts"), "utf8");

/** Store functions that change a dashboard's content: each must bump. */
const MUTATING = [
  "renameDashboard",
  "replaceDashboardContents",
  "setGroupsDisabled",
  "createGroup",
  "joinGroup",
  "leaveGroup",
  "renameGroup",
  "deleteGroup",
  "addTab",
  "renameTab",
  "removeTab",
  "reorderTabs",
  "addCard",
  "addCardTo",
  "removeCard",
  "updateLayouts",
  "applyCardParams",
  "setCardMinimized",
  "patchCardField",
  "clearManagedSource",
  "setDashboardExchange",
  "dropUngroupable",
  "savePreset",
  "deletePreset",
  "addLinkedCard",
  "commitLinkedChartSettings",
  "replaceLinkedSource",
  "applyPivotGroupChange",
  "undoPivotGroupChange",
  "commitTableDefinition",
  "undoCardRemoval",
  "duplicateCard",
  "copyCardTo",
] as const;

/**
 * Store functions that do not edit an existing dashboard's content: navigation
 * and view state, new dashboards (they upload as new, whatever their
 * revision), the sync's own writes, and deletes (which leave a tombstone).
 */
const NOT_CONTENT = [
  "load",
  "setActive",
  "activeDashboard",
  "setActiveTab",
  "refreshAll",
  "setMaximized",
  "addDashboard",
  "duplicateDashboard",
  "importDashboards",
  "applySynced",
  "removeDashboard",
  "reorderDashboards",
  "syncDashboard",
  "dismissCardRemoval",
];

const seed = (): Dashboard => ({
  id: "d1",
  name: "Main",
  revision: 5,
  tabs: [
    { id: "t1", name: "One", cards: [card({ id: "c1", params: { symbol: "AAPL" } }), card({ id: "c2", params: { symbol: "MSFT" }, layout: { x: 0, y: 4, w: 4, h: 4 } })] },
    { id: "t2", name: "Two", cards: [] },
  ],
});

const store = () => useDashboardStore.getState();
const memRevision = () => store().dashboards.find((d) => d.id === "d1")?.revision ?? 0;
const diskRevision = () => (JSON.parse(__read("dashboards/d1.json") ?? "{}") as Dashboard).revision ?? 0;

const addLocalTable = (file = "data.csv") => store().addCardTo("d1", "t1", widget({ id: "local_table", backendId: "builtin" }), { file });
const addLinked = async (presentation: "table" | "chart") =>
  store().addLinkedCard({ dashboardId: "d1", tabId: "t1", sourceWidgetId: (await addLocalTable())!, presentation });

const key = (v: string) => JSON.stringify(["string", v]);
let releasePivot: (() => void) | undefined;
/** A Pivot owner on d1 whose page is in group g, unlinked through the coordinator (which calls the store). */
async function pivotUnlink() {
  vi.stubGlobal("Worker", Boundary);
  const model: TableModelV1 = { schemaVersion: 1, enabled: true, params: { promotePage: true, filters: [] }, categories: [{ id: "cat", name: "Region", sourceFieldId: "region", transform: "native" }], measures: [], formulas: [], layout: { rows: [], columns: [], values: [], page: { categoryId: "cat", memberKeys: [key("R0")] } }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } };
  const d: Dashboard = { id: "d1", name: "Main", revision: 5, groups: [{ id: "g", name: "Shared", paramName: "region", groupType: "region", value: Array.from({ length: 12 }, (_, i) => "R" + i).join(",") }], tabs: [{ id: "t1", name: "One", cards: [{ id: "w", widgetId: "local_table", backendId: "builtin", params: { file: "a.csv" }, bindings: [{ paramName: "pivot:page", groupId: "g" }], layout: { x: 0, y: 0, w: 40, h: 16 }, table: {}, tableDefinition: { table: {}, search: "", analytical: model }, tableSelection: { kind: "none" } }] }] };
  useDashboardStore.setState({ dashboards: [d], activeId: "d1", activeTabId: "t1" });
  runtime.syncDashboard(d);
  runtime.ensureTable("d1", "w");
  await runtime.settled("d1");
  const coordinator = tableCommitCoordinators.get("d1", "w");
  releasePivot = coordinator.retain();
  const base = coordinator.authoringBase();
  const context = coordinator.groupProofContext(base, "pivot:page")!;
  const proof = await collectPivotGroupProof(context, new AbortController().signal);
  if (!proof.ok) throw new Error(proof.reason);
  const planned = planGroupChange("unlink", { proof: proof.proof, proofContext: context });
  if (!planned.ok) throw new Error(planned.reason);
  return { coordinator, base, context, plan: planned.plan };
}

type Step = { setup?: () => Promise<unknown>; run: (from: unknown) => Promise<unknown> };
const STEPS: Record<(typeof MUTATING)[number], Step> = {
  renameDashboard: { run: () => store().renameDashboard("d1", "Renamed") },
  replaceDashboardContents: { run: () => store().replaceDashboardContents("d1", { id: "x", name: "X", tabs: [{ id: "t9", name: "T", cards: [] }] }) },
  setGroupsDisabled: { run: () => store().setGroupsDisabled("d1", true) },
  createGroup: { run: () => store().createGroup("c1", "symbol", "ticker", "AAPL") },
  joinGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().joinGroup(id as string, "c2", "symbol") },
  leaveGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: () => store().leaveGroup("c1", "symbol") },
  renameGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().renameGroup(store().activeId!, id as string, "Tickers") },
  deleteGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().deleteGroup(store().activeId!, id as string) },
  addTab: { run: () => store().addTab(store().activeId!, "Three") },
  renameTab: { run: () => store().renameTab("t1", "First") },
  removeTab: { run: () => store().removeTab("t2") },
  reorderTabs: { run: () => store().reorderTabs(["t2", "t1"]) },
  addCard: { run: () => store().addCard(widget({ id: "w2" })) },
  addCardTo: { run: () => store().addCardTo("d1", "t2", widget({ id: "w2" })) },
  removeCard: { run: () => store().removeCard("c2") },
  updateLayouts: { run: () => store().updateLayouts([{ i: "c1", x: 2, y: 0, w: 4, h: 4 }]) },
  applyCardParams: { run: () => store().applyCardParams("c1", { cardParams: { symbol: "NVDA" }, groupEdits: [] }) },
  setCardMinimized: { run: () => store().setCardMinimized("c1", true) },
  clearManagedSource: { setup: () => store().patchCardField('c1', 'managedSource', {sourceId:'source',kind:'upload',version:1}), run: () => store().clearManagedSource('c1',store().dashboards.find(d=>d.id==='d1')!.tabs[0].cards[0].backendId,'source') },
  patchCardField: { run: () => store().patchCardField("c1", "title", "Prices") },
  setDashboardExchange: { run: () => store().setDashboardExchange("d1", "XLON") },
  dropUngroupable: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: () => store().dropUngroupable("c1", ["symbol"]) },
  savePreset: { run: () => store().savePreset(store().activeId!, "Two weeks", "T-2w") },
  deletePreset: { setup: () => store().savePreset(store().activeId!, "Two weeks", "T-2w"), run: () => store().deletePreset(store().activeId!, "Two weeks") },
  addLinkedCard: { setup: () => addLocalTable(), run: (source) => store().addLinkedCard({ dashboardId: "d1", tabId: "t1", sourceWidgetId: source as string, presentation: "table" }) },
  commitLinkedChartSettings: {
    setup: () => addLinked("chart"),
    run: (id) => store().commitLinkedChartSettings("d1", id as string, { type: "line", category: "region", measures: ["revenue"], display: "grouped" }),
  },
  replaceLinkedSource: {
    setup: async () => ({ id: await addLinked("table"), second: await addLocalTable("second.csv") }),
    run: (from) => store().replaceLinkedSource((from as { id: string }).id, (from as { second: string }).second),
  },
  applyPivotGroupChange: {
    setup: pivotUnlink,
    run: (from) => {
      const s = from as Awaited<ReturnType<typeof pivotUnlink>>;
      return s.coordinator.commitPivotGroupChange(s.base, s.plan, s.context);
    },
  },
  undoPivotGroupChange: {
    setup: async () => {
      const s = await pivotUnlink();
      const saved = await s.coordinator.commitPivotGroupChange(s.base, s.plan, s.context);
      if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
      await runtime.settled("d1");
      return { coordinator: s.coordinator, undo: saved.undo };
    },
    run: (from) => {
      const s = from as { coordinator: ReturnType<typeof tableCommitCoordinators.get>; undo: Parameters<ReturnType<typeof tableCommitCoordinators.get>["undoPivotGroupChange"]>[1] };
      return s.coordinator.undoPivotGroupChange(s.coordinator.authoringBase(), s.undo);
    },
  },
  commitTableDefinition: { setup: () => addLocalTable(), run: (id) => store().commitTableDefinition("d1", id as string, { table: {}, search: "x" }, { kind: "none" }) },
  undoCardRemoval: { setup: () => store().removeCard("c2"), run: () => store().undoCardRemoval() },
  duplicateCard: { run: () => store().duplicateCard("c1") },
  copyCardTo: { run: () => store().copyCardTo("c1", "d1", "t2") },
};

/**
 * v5: these act on the dashboard they name, or that owns the tab, card or
 * group, not only the active one. Driven with another dashboard active.
 */
const SCOPED: Record<string, Step> = {
  addTab: { run: () => store().addTab("d1", "Three") },
  renameGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().renameGroup("d1", id as string, "Tickers") },
  deleteGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().deleteGroup("d1", id as string) },
  savePreset: { run: () => store().savePreset("d1", "Two weeks", "T-2w") },
  deletePreset: { setup: () => store().savePreset("d1", "Two weeks", "T-2w"), run: () => store().deletePreset("d1", "Two weeks") },
  createGroup: { run: () => store().createGroup("c1", "symbol", "ticker", "AAPL") },
  joinGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: (id) => store().joinGroup(id as string, "c2", "symbol") },
  leaveGroup: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: () => store().leaveGroup("c1", "symbol") },
  dropUngroupable: { setup: () => store().createGroup("c1", "symbol", "ticker", "AAPL"), run: () => store().dropUngroupable("c1", ["symbol"]) },
  renameTab: { run: () => store().renameTab("t1", "First") },
  removeTab: { run: () => store().removeTab("t2") },
  reorderTabs: { run: () => store().reorderTabs(["t2", "t1"]) },
  removeCard: { run: () => store().removeCard("c2") },
  updateLayouts: { run: () => store().updateLayouts([{ i: "c1", x: 2, y: 0, w: 4, h: 4 }]) },
  applyCardParams: { run: () => store().applyCardParams("c1", { cardParams: { symbol: "NVDA" }, groupEdits: [] }) },
  setCardMinimized: { run: () => store().setCardMinimized("c1", true) },
  clearManagedSource: { setup: () => store().patchCardField('c1', 'managedSource', {sourceId:'source',kind:'upload',version:1}), run: () => store().clearManagedSource('c1',store().dashboards.find(d=>d.id==='d1')!.tabs[0].cards[0].backendId,'source') },
  patchCardField: { run: () => store().patchCardField("c1", "title", "Prices") },
};

beforeEach(async () => {
  __reset();
  __resetJsonStoreForTests();
  useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, previousId: null, maximizedCardId: null, viewer: false, pendingCardRemoval: null });
});
afterEach(async () => {
  releasePivot?.();
  releasePivot = undefined;
  await Promise.resolve();
  runtime.disposeDashboard("d1");
  vi.unstubAllGlobals();
});

describe("dashboard revision (bdobb#41)", () => {
  it("writes dashboard files only through saveEdit and saveAsIs", () => {
    expect(SOURCE).toMatch(/async function saveEdit\(/);
    expect(SOURCE).toMatch(/async function saveAsIs\(/);
    expect(SOURCE.match(/\bsaveDashboard\(/g)?.length).toBe(2);
  });

  it("classifies every function the store exposes", () => {
    const fns = Object.entries(store()).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(fns).toEqual([...MUTATING, ...NOT_CONTENT].sort());
  });

  it.each(MUTATING)("%s bumps the revision, in memory and on disk", async (name) => {
    useDashboardStore.setState({ dashboards: [seed()], activeId: "d1", activeTabId: "t1" });
    const step = STEPS[name];
    const from = step.setup ? await step.setup() : undefined;
    const before = memRevision();
    await step.run(from);
    expect(memRevision(), "memory").toBeGreaterThan(before);
    expect(diskRevision(), "disk").toBe(memRevision());
  });

  it.each(Object.keys(SCOPED))("%s bumps the revision of a dashboard that is not active", async (name) => {
    const other: Dashboard = { id: "d0", name: "Other", revision: 1, tabs: [{ id: "t0", name: "Zero", cards: [] }] };
    useDashboardStore.setState({ dashboards: [other, seed()], activeId: "d0", activeTabId: "t0", activeTabIds: { d0: "t0", d1: "t1" } });
    const step = SCOPED[name];
    const from = step.setup ? await step.setup() : undefined;
    const before = memRevision();
    await step.run(from);
    expect(memRevision(), "memory").toBeGreaterThan(before);
    expect(diskRevision(), "disk").toBe(memRevision());
    expect(store().dashboards.find((d) => d.id === "d0")?.revision, "the active dashboard is untouched").toBe(1);
  });
});
