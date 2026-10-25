// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { exportCompatibleApp, importApps, planAppsImport } from "./appsJson";
// The dev line's own v5.7.0 example, verbatim (bdobb-dev v5.7.2,
// docs/examples/v5.7.0-parameters-and-pivot.apps.json): three statement cards
// written with dev's `state.pivotView`.
import { card } from "../test/fixtures";
import devApps from "../test/fixtures/dev-v5.7/parameters-and-pivot.apps.json";

type Item = { i: string; state?: Record<string, unknown> };
const fresh = () => structuredClone(devApps) as unknown as Array<{ tabs: Record<string, { layout: Item[] }> }>;
const statementsTab = (dashboards: ReturnType<typeof importApps>["dashboards"]) =>
  dashboards[0].tabs.find((t) => t.name === "Statements")!;

describe("importing dev's state.pivotView", () => {
  it("imports the dev v5.7.0 example, each pivot card as a Statement view, with nothing to report", () => {
    const text = JSON.stringify(devApps);
    const plan = planAppsImport(text, text.length, [], []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.issues).toBeUndefined();
    const tab = statementsTab(plan.dashboards);
    expect(tab.cards.map((c) => [c.widgetId, c.view, c.statement])).toEqual([
      ["equity_fundamental_income_yfinance_obb", "statement", undefined],
      ["equity_fundamental_balance_yfinance_obb", "statement", undefined],
      ["equity_fundamental_cash_yfinance_obb", "statement", undefined],
    ]);
    expect(tab.cards[0].params).toMatchObject({ symbol: "AAPL", provider: "yfinance", period: "annual" });
    // The pivot-table tab's cards carried no pivotView and stay plain tables.
    expect(plan.dashboards[0].tabs.find((t) => t.name === "Pivot Table")!.cards.every((c) => c.view === undefined)).toBe(true);
  });

  it("carries dev's collapsed sections as the Statement view's folds", () => {
    const apps = fresh();
    apps[0].tabs.statements.layout[0].state!.pivotView = { enabled: true, collapsed: ["Operating Expenses", "Other"] };
    const result = importApps(apps, []);
    expect(result.issues).toBeUndefined();
    expect(statementsTab(result.dashboards).cards[0].statement).toEqual({ collapsed: ["Operating Expenses", "Other"] });
  });

  it("drops what OpenBQ cannot map and reports each piece", () => {
    const apps = fresh();
    const [income, balance, cash] = apps[0].tabs.statements.layout;
    income.state!.pivotView = { enabled: true, collapsed: ["Revenue", 7, "", "Revenue"], grouping: ["symbol"] };
    // Workspace's own chart flag wins, as it did on dev: the pivot is lost.
    balance.state!.chartView = { enabled: true, chartType: "line" };
    cash.state!.transpose = true;
    const result = importApps(apps, []);
    expect(statementsTab(result.dashboards).cards.map((c) => [c.view, c.statement])).toEqual([
      ["statement", { collapsed: ["Revenue"] }],
      ["chart", undefined],
      ["transposed", undefined],
    ]);
    expect(result.issues).toEqual([
      { code: "UNSUPPORTED_EXTENSION", path: "$[0].tabs.statements.layout[0].state.pivotView.collapsed", message: "Statement folds that are not distinct section names." },
      { code: "UNSUPPORTED_EXTENSION", path: "$[0].tabs.statements.layout[0].state.pivotView.grouping", message: "Pivot state with no Statement equivalent." },
      { code: "UNSUPPORTED_EXTENSION", path: "$[0].tabs.statements.layout[1].state.pivotView", message: "Pivot view; the card's chart view wins." },
      { code: "UNSUPPORTED_EXTENSION", path: "$[0].tabs.statements.layout[2].state.pivotView", message: "Pivot view; the card's transposed view wins." },
    ]);
  });

  it("re-exports the mapped cards in OpenBQ's own v5 Statement envelope", () => {
    const apps = fresh();
    apps[0].tabs.statements.layout[0].state!.pivotView = { enabled: true, collapsed: ["Other"] };
    const dashboard = importApps(apps, []).dashboards[0];
    const out = exportCompatibleApp(dashboard);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(JSON.stringify(out.value)).not.toContain("pivotView");
    const back = statementsTab(importApps([out.value], []).dashboards);
    expect(back.cards.map((c) => [c.view, c.statement])).toEqual([
      ["statement", { collapsed: ["Other"] }],
      ["statement", undefined],
      ["statement", undefined],
    ]);
  });

  it("still ignores a pivotView that is switched off", () => {
    const apps = fresh();
    apps[0].tabs.statements.layout[0].state!.pivotView = { enabled: false, collapsed: ["Other"] };
    const result = importApps(apps, []);
    expect(statementsTab(result.dashboards).cards[0].view).toBeUndefined();
    expect(result.issues).toBeUndefined();
  });

  // SSRM walk, v5: a managed table's card takes the same mapping, and keeps
  // its saved source reference, so it reopens on Statement over that source.
  it("opens a managed table card with dev's pivotView on the Statement view, source kept", () => {
    const managed = card({ id: "m", widgetId: "managed_table", managedSource: { sourceId: "durable-source", kind: "upload", version: 1 } });
    const exported = exportCompatibleApp({ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [managed] }] });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const tabs = (exported.value as unknown as { tabs: Record<string, { layout: Item[] }> }).tabs;
    const item = Object.values(tabs)[0].layout[0];
    item.state = { ...item.state, pivotView: { enabled: true, collapsed: ["Revenue"] } };
    const result = importApps([exported.value], []);
    expect(result.issues).toBeUndefined();
    const [c] = result.dashboards[0].tabs[0].cards;
    expect([c.view, c.statement, c.managedSource]).toEqual(["statement", { collapsed: ["Revenue"] }, managed.managedSource]);
  });
});

// User ruling 2026-10-15: a local table's year-end backend persists with the card and in apps.json.
describe("a local table's year-end backend", () => {
  it("round-trips through apps.json", async () => {
    const { BUILTIN_WIDGETS } = await import("./builtins");
    const local = card({ id: "l", widgetId: "local_table", backendId: "builtin", params: { file: "f.csv", fiscalYearEndBackend: "openbq" } });
    const { exportApp } = await import("./appsJson");
    const exported = exportApp({ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [local] }] });
    const [c] = importApps([JSON.parse(JSON.stringify(exported))], BUILTIN_WIDGETS).dashboards[0].tabs[0].cards;
    expect(c.params).toEqual({ file: "f.csv", fiscalYearEndBackend: "openbq" });
  });
});
