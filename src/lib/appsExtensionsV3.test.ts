// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";
import * as appsJson from "./appsJson";
import { card } from "../test/fixtures";
import type { Dashboard, TableCardState } from "./types";
import { importApps, planAppsImport } from "./appsJson";
import { encodeV3CardExtension } from "./appsExtensionsV3";
import { saveDashboard, loadDashboards } from "./dashboardsFile";
import { __reset, __list } from "../test/memfs";
import { __resetJsonStoreForTests, saveJson } from "./jsonStore";
import { BUILTIN_WIDGETS } from "./builtins";
import type { RecipeOptions } from "./widgetData/chartRecipes/types";

const table: TableCardState = {
  sorting: [{ id: "close", desc: true }],
  columnFilters: [{ id: "close", value: { min: 1, max: 5 } }],
  columnOrder: ["symbol", "close"], hidden: [],
  widths: { symbol: 160 }, pinned: { symbol: "left", close: null },
};
function wire(native: unknown = { schemaVersion: 1, profile: "v3", table, title: "Watch", minimized: false, view: "raw" }) {
  return [{ name: "Research", tabs: { t: { name: "Data", layout: [
    { i: "prices", x: 0, y: 0, w: 20, h: 9, state: { params: {}, chartView: { enabled: false }, extensions: { bdobb: native } } },
    { i: "prices", x: 20, y: 0, w: 20, h: 9, state: { params: {}, chartView: { enabled: false }, extensions: { bdobb: { schemaVersion: 1, profile: "v3", table: { pinned: {} } } } } },
  ] } }, extensions: { bdobb: { schemaVersion: 1, profile: "v3", tabOrder: ["t"], groupsDisabled: true } } }];
}
beforeEach(() => { __reset(); __resetJsonStoreForTests(); });
describe("v3 compatible app imports", () => {
  it("restores independent native state for repeated widgets", () => {
    const d = importApps(wire(), []).dashboards[0];
    const [a, b] = d.tabs[0].cards;
    expect(a.table).toEqual(table);
    expect(a).toMatchObject({ title: "Watch", minimized: false, view: "raw" });
    expect(b.table).toEqual({ pinned: {} });
    expect(d.groupsDisabled).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
  it("allocates fresh external identities and preserves them internally", async () => {
    const first = importApps(wire(), []).dashboards[0];
    const second = importApps(wire(), []).dashboards[0];
    expect(first.tabs[0].cards[0].id).not.toBe(second.tabs[0].cards[0].id);
    await saveDashboard(first);
    expect((await loadDashboards())[0]).toEqual(first);
  });
  it.each([
    { schemaVersion: 2, profile: "v3" },
    { schemaVersion: 1, profile: "v4" },
    { schemaVersion: 1, profile: "v3", table: { widths: { close: -1 } } },
    { schemaVersion: 1, profile: "v3", table: { pinned: { close: "top" } } },
    { schemaVersion: 1, profile: "v3", table: { pivot: {} } },
    { schemaVersion: 1, profile: "v3", view: "chart" },
    { schemaVersion: 1, profile: "v3", cardId: "local-id" },
    JSON.parse('{"schemaVersion":1,"profile":"v3","table":{"widths":{"__proto__":1}}}'),
  ])("refuses invalid or unsupported extensions before planning an import", (native) => {
    const text = JSON.stringify(wire(native));
    expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
  });
  it("does not take a hand-authored external card id as local identity", () => {
    const input = wire();
    Object.assign(input[0].tabs.t.layout[0], { id: "source-card-id" });
    expect(importApps(input, []).dashboards[0].tabs[0].cards[0].id).not.toBe("source-card-id");
  });
});

function dashboard(): Dashboard {
  return { id: "internal-dashboard", name: "Research", groupsDisabled: false, tabs: [
    { id: "10", name: "First", cards: [card({ id: "internal-card-first", title: "Watch", view: "raw", minimized: false, table })] },
    { id: "2", name: "Second", cards: [card({ id: "internal-card-second", table: { pinned: {} } })] },
  ] };
}
describe("compatible v3 exports", () => {
  it("round trips authored state and numeric tab order without exporting card ids", () => {
    const input = dashboard();
    const result = appsJson.exportCompatibleApp(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issue.message);
    const text = JSON.stringify(result.value);
    expect(text).not.toContain("internal-card");
    expect(text).not.toContain("sourceCardId");
    const restored = importApps(JSON.parse(`[${text}]`), []).dashboards[0];
    expect(restored.tabs.map((t) => t.name)).toEqual(["First", "Second"]);
    expect(restored.tabs[0].cards[0]).toMatchObject({ table, title: "Watch", view: "raw", minimized: false });
    expect(input.tabs[0].cards[0].id).toBe("internal-card-first");
  });
  it("normalizes legacy group ids and restores duplicate group display names offline", () => {
    const input = dashboard();
    input.groups = [
      { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
      { id: "g2", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
    ];
    Object.assign(input.tabs[0].cards[0], { groupIds: ["g1"] });
    input.tabs[1].cards[0].bindings = [{ groupId: "g2", paramName: "symbol" }];
    const result = appsJson.exportCompatibleApp(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issue.message);
    const restored = importApps([result.value], []).dashboards[0];
    expect(restored.groups?.map((g) => g.name)).toEqual(["Ticker", "Ticker"]);
    expect(restored.tabs[0].cards[0].bindings?.[0].groupId).toBe(restored.groups?.[0].id);
    expect(restored.tabs[1].cards[0].bindings?.[0].groupId).toBe(restored.groups?.[1].id);
  });
  it.each([NaN, Infinity, 0, -2])("refuses invalid widths before JSON serialization", (width) => {
    const input = dashboard(); input.tabs[0].cards[0].table = { widths: { close: width } };
    expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
  });
  it("refuses local asset definitions without their bytes", () => {
    const input = dashboard(); input.tabs[0].cards[0].widgetId = "local_table"; input.tabs[0].cards[0].params.file = "stored.csv";
    const result = appsJson.exportCompatibleApp(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("MISSING_LOCAL_ASSET");
  });
  it("refuses non-JSON and cyclic filter values", () => {
    for (const value of [undefined, new Date(), () => 1]) {
      const input = dashboard(); input.tabs[0].cards[0].table = { columnFilters: [{ id: "c", value }] };
      expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
    }
    const value: Record<string, unknown> = {}; value.self = value;
    const input = dashboard(); input.tabs[0].cards[0].table = { columnFilters: [{ id: "c", value }] };
    expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
  });
  it("does not mutate plain projection or retain internal backend identities", () => {
    const input = dashboard();
    const before = JSON.stringify(input);
    appsJson.exportCompatibleApp(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(appsJson.exportApp(input)).not.toHaveProperty("extensions");
  });
});

it("round trips risk recipe cards and remaps their source through a compatible app export", async () => {
  const recipes: RecipeOptions[] = [
    { version: 1, kind: "return-distribution", fields: { date: "date", price: "adjusted_close" }, symbol: "AMD", bins: 30 },
    { version: 1, kind: "small-multiples", fields: { date: "date", price: "adjusted_close", symbol: "ticker" }, symbols: ["NVDA", "AMD"] },
    { version: 1, kind: "etf-pareto", fields: { holding: "ticker", weight: "weight" } },
    { version: 1, kind: "etf-exposure", fields: { category: "region", weight: "weight" }, mode: "region" },
  ];
  const input = dashboard();
  const [tab] = input.tabs;
  for (const recipe of recipes) {
    tab.cards.push(card({
      id: recipe.kind, widgetId: "linked_chart", linkedSource: { kind: "widget", sourceWidgetId: tab.cards[0].id },
      linkedChart: { type: recipe.kind, display: "grouped", measures: [], recipe },
    }));
  }

  const exported = appsJson.exportCompatibleApp(input);
  expect(exported).toMatchObject({ ok: true, value: { extensions: { bdobb: { profile: "v4" } } } });
  if (!exported.ok) throw new Error(exported.issue.message);
  const restored = importApps(JSON.parse(JSON.stringify([exported.value])), []).dashboards[0];
  await saveDashboard(restored);
  const [producer, ...charts] = (await loadDashboards())[0].tabs[0].cards;
  for (const [index, chart] of charts.entries()) {
    const recipe = recipes[index];
    expect(chart.linkedSource).toEqual({ kind: "widget", sourceWidgetId: producer.id });
    expect(chart.linkedChart).toEqual({ type: recipe.kind, display: "grouped", measures: [], recipe });
  }
  expect(charts).toHaveLength(4);
});

it("refuses later card state rather than dropping it from a v3 export", () => {
  // User ruling 2026-10-12 (v8 R1): `pinned` is v8 state now. The v3 profile
  // itself still refuses it; the compatible export carries it in the v8
  // envelope instead; and state no profile knows is still refused, not dropped.
  const input = dashboard(); Object.assign(input.tabs[0].cards[0], { pinned: "top" });
  const v3 = encodeV3CardExtension(input.tabs[0].cards[0], "$.card");
  expect(v3.ok).toBe(false);
  if (!v3.ok) expect(v3.issue.code).toBe("UNSUPPORTED_V3_STATE");
  const v8 = appsJson.exportCompatibleApp(input);
  expect(v8.ok).toBe(true);
  if (v8.ok) expect(v8.value.extensions?.bdobb.profile).toBe("v8");
  const unknown = dashboard(); Object.assign(unknown.tabs[0].cards[0], { futureCardState: true });
  expect(appsJson.exportCompatibleApp(unknown).ok).toBe(false);
});
it("retains explicit empty grouped parameters and unused group definitions", () => {
  const input = dashboard();
  input.groups = [
    { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
    { id: "g2", name: "Unused", paramName: "symbol", groupType: "symbol", value: "MSFT" },
  ];
  input.tabs[0].cards[0].params.symbol = "";
  input.tabs[0].cards[0].bindings = [{ groupId: "g1", paramName: "symbol" }];
  const result = appsJson.exportCompatibleApp(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issue.message);
  const restored = importApps([result.value], []).dashboards[0];
  expect(restored.groups).toHaveLength(2);
  expect(restored.tabs[0].cards[0].params.symbol).toBe("");
});
it("refuses malformed enhanced geometry instead of normalizing away the error", () => {
  const input = wire(); input[0].tabs.t.layout[0].w = 0;
  const text = JSON.stringify(input);
  expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
});

it("refuses bad tab references and leaves the store untouched", () => {
  const input = wire(); input[0].extensions.bdobb.tabOrder = ["missing"];
  const text = JSON.stringify(input);
  const before = __list();
  expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
  expect(__list()).toEqual(before);
});
it("refuses unsafe internal tab identities before producing a portable file", () => {
  const input = dashboard(); input.tabs[0].id = "__proto__";
  expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
});
it("refuses duplicate group identities before losing membership", () => {
  const input = dashboard();
  input.groups = [
    { id: "g", name: "A", paramName: "symbol", groupType: "symbol", value: "AAPL" },
    { id: "g", name: "B", paramName: "symbol", groupType: "symbol", value: "MSFT" },
  ];
  expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
});

it("refuses multiple parameters bound to one group when the projection cannot preserve them", () => {
  const input = dashboard();
  input.groups = [{ id: "g", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" }];
  input.tabs[0].cards[0].bindings = [{ groupId: "g", paramName: "symbol" }, { groupId: "g", paramName: "ticker" }];
  expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
});

it.each(["invalid-definition", "missing-member", "duplicate-binding"])("refuses malformed enhanced group state: %s", (kind) => {
  const input = wire();
  Object.assign(input[0], { groups: [{ type: "param", name: "G", paramName: kind === "invalid-definition" ? "" : "symbol", defaultValue: "AAPL" }] });
  Object.assign(input[0].tabs.t.layout[0], { groups: [kind === "missing-member" ? "missing" : "G"] });
  if (kind === "duplicate-binding") Object.assign(input[0].tabs.t.layout[0], { groupBindings: [{ group: "G", paramName: "symbol" }, { group: "G", paramName: "ticker" }] });
  const text = JSON.stringify(input);
  expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
});

it("preserves an ordinary remote parameter named file", () => {
  const input = dashboard(); input.tabs[0].cards[0].params.file = "remote-filing";
  const result = appsJson.exportCompatibleApp(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issue.message);
  expect(importApps([result.value], []).dashboards[0].tabs[0].cards[0].params.file).toBe("remote-filing");
});
it("refuses two claimed groups that compete for the same card parameter", () => {
  const input = wire();
  Object.assign(input[0], { groups: [
    { type: "param", name: "G", paramName: "symbol", defaultValue: "AAPL" },
    { type: "param", name: "H", paramName: "symbol", defaultValue: "MSFT" },
  ] });
  Object.assign(input[0].tabs.t.layout[0], { groups: ["G", "H"] });
  const text = JSON.stringify(input);
  expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
});

// Archived exports from the earlier bdobb line mark a statement Pivot card
// with state.pivotView (bdobb#8). Since 2026-10-15 (user ruling) that maps
// onto this line's Statement view instead of refusing the file.
it("imports archived Pivot state (state.pivotView enabled) as the Statement view; a native view wins, reported", () => {
  const input = wire();
  for (const item of input[0].tabs.t.layout as unknown as { state: Record<string, unknown> }[]) item.state = { ...item.state, pivotView: { enabled: true } };
  const original = JSON.stringify(input);
  const result = planAppsImport(original, original.length, [], []);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.dashboards[0].tabs[0].cards.map((c) => c.view)).toEqual(["raw", "statement"]);
  expect(result.issues).toEqual([{ code: "UNSUPPORTED_EXTENSION", path: "$[0].tabs.t.layout[0].state.pivotView", message: "Pivot view; the card's raw view wins." }]);
  expect(JSON.stringify(input)).toBe(original);
  expect(__list()).toEqual([]);
});

it("still imports a card whose archived Pivot state is switched off", () => {
  const input = wire();
  const item = input[0].tabs.t.layout[0] as unknown as { state: Record<string, unknown> };
  item.state = { ...item.state, pivotView: { enabled: false } };
  const text = JSON.stringify(input);
  expect(planAppsImport(text, text.length, [], []).ok).toBe(true);
});

describe("a synced card", () => {
  it("encodes its BDOBB state although it carries server state in extensions", () => {
    const synced = card({ title: "Mine", extensions: { workspace: { widget: { id: "w1" }, layout: {}, params: {} } } });
    expect(encodeV3CardExtension(synced, "$")).toEqual({ ok: true, value: { schemaVersion: 1, profile: "v3", title: "Mine" } });
  });
});

it("round trips screening and income recipes through the v4 envelope and refuses fabricated acquisition facts", () => {
  const recipes = [
    { version: 1, kind: "bubble-regression", priceDate: "latest", regression: true,
      fields: { symbol: "symbol", date: "last_day_data_date", dividendYield: "dividend_yield", priceChange: "price_change_5d", marketCap: "market_cap", exchange: "exchange", currency: "currency_symbol" } },
    { version: 1, kind: "dividend-steps", instrument: "SHEL.LSE", fields: { date: "ex_dividend_date", amount: "amount", currency: "currency" } },
    { version: 1, kind: "income-sankey", periodColumn: "period-column" },
  ] satisfies RecipeOptions[];
  const input = dashboard(), [tab] = input.tabs;
  for (const recipe of recipes) tab.cards.push(card({ id: recipe.kind, widgetId: "linked_chart",
    linkedSource: { kind: "widget", sourceWidgetId: tab.cards[0].id },
    linkedChart: { type: recipe.kind, display: "grouped", measures: [], recipe },
  }));
  const exported = appsJson.exportCompatibleApp(input);
  expect(exported).toMatchObject({ ok: true, value: { extensions: { bdobb: { profile: "v4" } } } });
  if (!exported.ok) throw new Error(exported.issue.message);
  const payload = JSON.parse(JSON.stringify([exported.value]));
  const [producer, ...charts] = importApps(payload, []).dashboards[0].tabs[0].cards;
  expect(charts.map(chart => chart.linkedChart?.recipe)).toEqual(recipes);
  expect(charts.every(chart => chart.linkedSource?.sourceWidgetId === producer.id)).toBe(true);
  const [income] = payload[0].extensions.bdobb.cards.filter((entry: { extras: { linkedChart?: { type: string } } }) =>
    entry.extras.linkedChart?.type === "income-sankey");
  income.extras.linkedChart.recipe.reportingCurrency = "USD";
  const text = JSON.stringify(payload);
  expect(planAppsImport(text, text.length, [], []).ok).toBe(false);

  delete income.extras.linkedChart.recipe.reportingCurrency;
  income.extras.linkedChart.financialEvidence = { scale: 1000 };
  const forgedChart = JSON.stringify(payload);
  expect(planAppsImport(forgedChart, forgedChart.length, [], []).ok).toBe(false);
});

it("preserves a pinned news calendar and strictly rejects unknown settings and versions on import", () => {
  const input = dashboard();
  const tab = input.tabs[0];
  const recipe = {
    version: 1, kind: "news-sentiment-calendar", instrument: "CANOPY.US",
    fields: { timestamp: "date", articleId: "url", instrument: "symbols", polarity: "polarity" },
    window: { mode: "pinned", start: "2024-02-29", end: "2024-03-01" },
  } satisfies RecipeOptions;
  tab.cards.push(card({ id: "news", widgetId: "linked_chart", linkedSource: { kind: "widget", sourceWidgetId: tab.cards[0].id },
    linkedChart: { type: recipe.kind, measures: [], display: "grouped", recipe },
  }));
  const exported = appsJson.exportCompatibleApp(input);
  if (!exported.ok) throw new Error(exported.issue.message);
  const serialized = JSON.stringify([exported.value]);
  const [producer, news] = importApps(JSON.parse(serialized), []).dashboards[0].tabs[0].cards;
  expect(news.linkedChart?.recipe).toEqual(recipe);
  expect(news.linkedSource?.sourceWidgetId).toBe(producer.id);
  for (const change of [
    { chart_sources: { version: 1, receipts: [] } },
    { daySummaries: [] },
    { recipe: { ...recipe, version: 2 } },
    { recipe: { ...recipe, fields: { ...recipe.fields, title: "title" } } },
    { recipe: { ...recipe, window: { ...recipe.window, resolved: "2024-03-01" } } },
  ]) {
    const payload = JSON.parse(serialized);
    Object.assign(payload[0].extensions.bdobb.cards[1].extras.linkedChart, change);
    const text = JSON.stringify(payload);
    expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
  }
});


it("preserves a return summary’s explicit order and bounds and rejects runtime data on import", () => {
  const input = dashboard();
  const tab = input.tabs[0];
  const recipe = {
    version: 1, kind: "return-summary", symbols: ["ZZZ.US", "AAA.US"], view: "violin",
    fields: { date: "date", price: "adjusted_close", symbol: "symbol" },
    window: { mode: "common", start: "2026-01-03", end: "2026-01-28" },
  } satisfies RecipeOptions;
  tab.cards.push(card({ id: "returns", widgetId: "linked_chart", linkedSource: { kind: "widget", sourceWidgetId: tab.cards[0].id },
    linkedChart: { type: recipe.kind, measures: [], display: "grouped", recipe },
  }));
  const exported = appsJson.exportCompatibleApp(input);
  if (!exported.ok) throw new Error(exported.issue.message);
  const serialized = JSON.stringify([exported.value]);
  const [producer, summary] = importApps(JSON.parse(serialized), []).dashboards[0].tabs[0].cards;
  expect(summary.linkedChart?.recipe).toEqual(recipe);
  expect(summary.linkedSource?.sourceWidgetId).toBe(producer.id);
  for (const change of [
    { returnSummary: { series: [] } },
    { receipt: { interval: "1d" } },
    { recipe: { ...recipe, version: 2 } },
    { recipe: { ...recipe, viewportHeight: 340 } },
    { recipe: { ...recipe, window: { ...recipe.window, resolved: "2026-01-28" } } },
  ]) {
    const payload = JSON.parse(serialized);
    Object.assign(payload[0].extensions.bdobb.cards[1].extras.linkedChart, change);
    const text = JSON.stringify(payload);
    expect(planAppsImport(text, text.length, [], []).ok).toBe(false);
  }
});

it("roundtrips ownership choices and refuses runtime data, unknown keys and versions", () => {
  const input = dashboard();
  const tab = input.tabs[0];
  const recipe = { kind: "ownership-snapshot", version: 1, issuer: "EXAMPLE.US", view: "waffle",
    fields: { bucket: "bucket_id", share: "reported_share" } } satisfies RecipeOptions;
  tab.cards.push(card({ id: "ownership", widgetId: "linked_chart", linkedSource: { kind: "widget", sourceWidgetId: tab.cards[0].id },
    linkedChart: { type: recipe.kind, measures: [], display: "grouped", recipe },
  }));
  const exported = appsJson.exportCompatibleApp(input);
  if (!exported.ok) throw new Error(exported.issue.message);
  const serialized = JSON.stringify([exported.value]);
  const [producer, ownership] = importApps(JSON.parse(serialized), []).dashboards[0].tabs[0].cards;
  expect(ownership.linkedChart?.recipe).toEqual(recipe);
  expect(ownership.linkedSource?.sourceWidgetId).toBe(producer.id);
  const hostile = [
    { ownershipSnapshot: { buckets: [] } },
    { chart_sources: { version: 1, receipts: [] } },
    { unexpected: "unknown key" },
    { recipe: { ...recipe, version: 2 } },
    { recipe: { ...recipe, partition: { status: "verified" } } },
    { recipe: { ...recipe, fields: { ...recipe.fields, asOf: "as_of" } } },
  ];
  expect(hostile.map(change => {
    const payload = JSON.parse(serialized);
    Object.assign(payload[0].extensions.bdobb.cards[1].extras.linkedChart, change);
    const text = JSON.stringify(payload);
    return planAppsImport(text, text.length, [], []).ok;
  })).toEqual(hostile.map(() => false));
});

const kpiOptions = {
  version: 1, metric: 'eps_ttm', valueField: 'eps_ttm', observation: { mode: 'pinned', id: 'revised-report' },
  view: 'gauge', range: { min: 0, max: 100, label: 'Planning range' },
  reference: { kind: 'observation', id: 'first-report' },
} as const;

function kpiDashboard(linkedMetric = kpiOptions): Dashboard {
  const source = card({ id: 'kpi-source', widgetId: 'local_table', backendId: 'builtin' });
  const metric = card({ id: 'kpi', widgetId: 'linked_metric', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: source.id } });
  return { id: 'kpi-dash', name: 'KPI', tabs: [{ id: 'kpi-tab', name: 'KPI', cards: [source, { ...metric, linkedMetric }] }] };
}

it('round trips only the authored KPI question and repairs its source identity', async () => {
  const original = kpiDashboard();
  const result = appsJson.exportCompatibleApp(original);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issue.message);
  const restored = importApps([JSON.parse(JSON.stringify(result.value))], BUILTIN_WIDGETS).dashboards[0];
  const [table, metric] = restored.tabs[0].cards;
  expect(metric.widgetId).toBe('linked_metric');
  expect(metric.linkedMetric).toEqual(kpiOptions);
  expect(metric.linkedSource).toEqual({ kind: 'widget', sourceWidgetId: table.id });
  await saveDashboard(restored);
  expect((await loadDashboards())[0].tabs[0].cards[1].linkedMetric).toEqual(kpiOptions);
});

it.each([
  { version: 2 }, { snapshot: { unit: 'USD', value: 1 } }, { gauge: { data: [] } }, { chartSources: {} },
  { observation: { mode: 'latest', id: 'first-report' } }, { range: { ...kpiOptions.range, unit: 'USD' } },
  { reference: { ...kpiOptions.reference, currency: 'USD' } }, { range: undefined },
])('rejects malformed linkedMetric options during v4 app import and export (%j)', change => {
  const base = kpiDashboard();
  delete base.tabs[0].cards[1].linkedMetric;
  const exported = appsJson.exportCompatibleApp(base);
  if (!exported.ok) throw new Error(exported.issue.message);
  const input = exported.value;
  const portableCards = (input.extensions!.bdobb as { cards: { extras: Record<string, unknown> }[] }).cards;
  portableCards[1].extras.linkedMetric = { ...kpiOptions, ...change };
  expect(() => importApps([input], [])).toThrow(/linkedMetric/);
  Object.assign(base.tabs[0].cards[1], { linkedMetric: { ...kpiOptions, ...change } });
  expect(appsJson.exportCompatibleApp(base).ok).toBe(false);
});


it('reopens native dashboard cards with tampered linkedMetric settings cleared', async () => {
  const dashboard = kpiDashboard();
  const metric = dashboard.tabs[0].cards[1];
  Object.assign(metric, { linkedMetric: { ...kpiOptions, observation: { ...kpiOptions.observation, unit: 'USD' } } });
  await saveJson(`dashboards/${dashboard.id}.json`, dashboard);
  const reopened = (await loadDashboards())[0].tabs[0].cards[1];
  expect(reopened.widgetId).toBe('linked_metric');
  expect(reopened.linkedSource).toEqual(metric.linkedSource);
  expect(reopened).not.toHaveProperty('linkedMetric');
});

it('rejects portable KPI settings hosted by a backend metric with the same widget id', () => {
  const result = appsJson.exportCompatibleApp(kpiDashboard());
  if (!result.ok) throw new Error(result.issue.message);
  const builtIn = BUILTIN_WIDGETS.find(widget => widget.id === 'linked_metric')!;
  const impostor = { ...builtIn, backendId: 'external' };
  expect(() => importApps([result.value], [impostor])).toThrow(/built-in linked metric widget/);
});
