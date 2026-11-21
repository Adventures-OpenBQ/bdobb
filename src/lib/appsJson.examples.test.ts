// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID, LINKED_TABLE_ID, LINKED_CHART_ID, LINKED_METRIC_ID } from "./builtins";
import { importApps, isAppsJson, type App } from "./appsJson";
import type { WidgetDef } from "./types";
import { datasetFromBytes } from "./localTableData";
import { buildKpiSnapshot } from "./widgetData/kpi/build";
import { buildEtfHierarchy } from "./widgetData/chartRecipes/etfSunburst";
import { runRecipe } from "./widgetData/chartRecipes/run";
import { normalizeWidgets } from "./widgetsJson";
import { captureChartSources, chartRequestContext } from "./widgetData/chartRecipes/chartSourceContracts";
import { backendFinancialResponse } from "./widgetData/chartRecipes/financialEvidence";

/**
 * For stack-backed examples, `pnpm apps:sync` writes
 * the manifests into openbq-docker's one combined examples/bdobb/apps.json (SERVED
 * in scripts/apps-sync.mjs), served at the API's /apps.json and opened from
 * the rail's Apps catalogue. So each one is parsed and imported
 * here exactly as opening it would, against a registry that serves every
 * widget id the file names. A shipped example that fails to import is a
 * broken promise, and nothing else in the suite reads those files.
 */
const dir = resolve(process.cwd(), "docs/examples");
// REVIEW (user ruling 2026-10-14): was the top-level *.apps.json only. Every
// example under docs/examples is distributed (scripts/apps-sync.mjs scans them all),
// so a <dir>/apps.json example -- v5-financial-demo -- is read here too, and
// every it.each below covers it.
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith(".apps.json")),
  ...readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(dir, d.name)).filter((f) => f.endsWith("apps.json")).map((f) => `${d.name}/${f}`)),
];

function widget(id: string): WidgetDef {
  return {
    id,
    backendId: "b1",
    name: id,
    description: "",
    type: "table",
    category: "",
    subCategory: "",
    endpoint: `/${id}`,
    gridData: { w: 20, h: 9 },
    params: [],
    source: [],
  };
}

function load(file: string): { apps: App[]; ids: string[] } {
  const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
  expect(isAppsJson(raw), `${file} is an apps.json array`).toBe(true);
  const apps = raw as App[];
  const ids = apps.flatMap((a) => Object.values(a.tabs).flatMap((t) => t.layout.map((l) => l.i)));
  return { apps, ids };
}

describe("docs/examples", () => {
  // REVIEW (user ruling 2026-10-14, openbq-docker pairing): was "ships at
  // least the three known examples". Renamed; the arrayContaining check is
  // unchanged, and the list must now name every example file, so a new one is
  // added here too.
  const KNOWN = [
    "v3.1.0-builtins.apps.json",
    "v3.1.0-demo-providers.apps.json",
    "v3.1.0-openbb-workspace.apps.json",
    "v3.2.0-video-library.apps.json",
    "v4.0.0-builtins.apps.json",
    "v4.0.0-parameters.apps.json",
    "v5.0.0-treasury-calendar.apps.json",
    "v6.0.0-rita.apps.json",
    "v7.0.0-touch.apps.json",
    "v8.0.0-news.apps.json",
    "v8.0.0-pinned.apps.json",
    "v9-chart-expansion.apps.json",
    "v9-risk-exposure.apps.json",
    "v9-screening-income.apps.json",
    "v9-next-news-sentiment-calendar.apps.json",
    "v9-next-return-box-violin.apps.json",
    "v9-next-ownership-snapshot.apps.json",
    "v9-next-kpi-gauges.apps.json",
    "v9-next-etf-sunburst.apps.json",
    "v9-next-dual-axis-overlays.apps.json",
    "v9-next-estimate-revisions.apps.json",
    "v9-next-market-map.apps.json",
    "v9.0.0-calendars.apps.json",
    "v9.0.0-openbb-workspace-analysis.apps.json",
    "v5-financial-demo/apps.json",
  ];
  it("ships every known example file, and no file the list does not name", () => {
    expect(files).toEqual(expect.arrayContaining(KNOWN));
    expect([...files].sort()).toEqual([...KNOWN].sort());
  });

  it("v9-screening-income: imports three versioned questions and matches their source requests to the snapshot receipts", () => {
    const name = "v9-screening-income";
    const { apps } = load(name + ".apps.json");
    const sources = JSON.parse(readFileSync(join(dir, name, "widgets.json"), "utf8")) as Record<string, { endpoint: string }>;
    const imported = importApps(apps, [...BUILTIN_WIDGETS, ...Object.keys(sources).map(widget)]);
    expect(imported.unresolved).toBe(0);
    const cards = imported.dashboards[0].tabs[0].cards;
    expect(cards).toHaveLength(6);
    const charts = cards.filter(card => card.widgetId === LINKED_CHART_ID);
    expect(charts.map(card => card.linkedChart?.recipe)).toEqual([
      { version: 1, kind: "bubble-regression", priceDate: "latest", regression: true, fields: {
        symbol: "symbol", date: "last_day_data_date", dividendYield: "dividend_yield", priceChange: "price_change_5d",
        marketCap: "market_cap", exchange: "exchange", currency: "currency_symbol", name: "name", sector: "sector",
      } },
      { version: 1, kind: "dividend-steps", instrument: "CANOPY.US", fields: {
        date: "ex_dividend_date", amount: "amount", currency: "currency", frequency: "frequency",
      } },
      { version: 1, kind: "income-sankey", periodColumn: '["string","FY2026"]\u001fstatement/income/1.0.0/measure/value' },
    ]);
    const kinds = ["screener", "dividends", "income"];
    for (const [index, chart] of charts.entries()) {
      const source = cards.find(card => card.id === chart.linkedSource?.sourceWidgetId)!;
      expect(source.widgetId).toBe("screening_demo_" + kinds[index]);
      const endpoint = sources[source.widgetId].endpoint;
      const url = new URL(endpoint, "http://127.0.0.1:17911");
      for (const [key, value] of Object.entries(source.params)) url.searchParams.set(key, value);
      expect(url.searchParams.get("chart_source")).toBe("true");
      const payload: unknown = JSON.parse(readFileSync(join(dir, name, url.pathname), "utf8"));
      expect(backendFinancialResponse(payload, url)?.evidence.kind).toBe(kinds[index]);
      if (index === 2) expect(source).toMatchObject({ view: "statement", tableDefinition: { analytical: { kind: "statement" } } });
    }
  });

  it("v9-next-news-sentiment-calendar imports with its explicit fixture connection and validates the request scope", () => {
    const name = "v9-next-news-sentiment-calendar";
    const { apps } = load(name + ".apps.json");
    const { widgets, issues } = normalizeWidgets(JSON.parse(readFileSync(join(dir, name, "widgets.json"), "utf8")), "news-fixtures");
    expect(issues).toEqual([]);
    const imported = importApps(apps, [...BUILTIN_WIDGETS, ...widgets]);
    expect(imported.unresolved).toBe(0);
    const [chart, source] = imported.dashboards[0].tabs[0].cards;
    expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
    expect(chart.linkedChart?.recipe).toMatchObject({
      version: 1, kind: "news-sentiment-calendar", instrument: "CANOPY.US", window: { mode: "latest-12-months" },
    });
    expect(source.widgetId).toBe(widgets[0].id);
    const url = new URL(widgets[0].endpoint, "http://127.0.0.1:17912");
    for (const [key, value] of Object.entries(source.params)) url.searchParams.set(key, value);
    const payload = JSON.parse(readFileSync(join(dir, name, url.pathname), "utf8"));
    const acquisition = chartRequestContext(url, "results", Date.parse("2026-11-19T16:00:00Z"));
    expect(captureChartSources(acquisition!, payload, payload.results)?.news).toMatchObject({
      kind: "news", instrument: "CANOPY.US", delivered_count: 5, scope: { kind: "sample", limit: 10, offset: 0 },
    });
    expect(importApps(apps, BUILTIN_WIDGETS).unresolved).toBe(1);
  });

  it("v9-next-return-box-violin imports its chart question and reacquires the separate local fixture", async () => {
    const name = "v9-next-return-box-violin";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(1); // The separate live tab resolves after its EODHD widget connects.
    const [chart, source] = imported.dashboards[0].tabs[0].cards;
    expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
    expect(source.params).toEqual({});
    const recipe = chart.linkedChart?.recipe;
    if (!recipe) throw new Error("Missing imported return summary recipe.");
    expect(recipe).toMatchObject({ kind: "return-summary", symbols: ["CANOPY.US", "ALDER.US"], view: "box", window: { mode: "own" } });
    const filename = "fixture-adjusted-prices.json";
    const dataset = await datasetFromBytes(filename, readFileSync(join(dir, name, filename)), source.id, 1);
    const result = runRecipe(dataset, recipe, { theme: "light", maxDecimals: 2, today: "2026-11-20" });
    expect(result).toMatchObject({ ok: true, returnSummary: { series: [
      { symbol: "CANOPY.US", start: "2026-01-06", end: "2026-02-02" },
      { symbol: "ALDER.US", start: "2026-01-06", end: "2026-02-02" },
    ] } });
    if (result.ok) expect(result.returnSummary?.series.map(item => item.samples.length)).toEqual([20, 20]);
  });

  it("v9-next-ownership-snapshot imports source-free questions and independently verifies its two local snapshots", async () => {
    const name = "v9-next-ownership-snapshot";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const [barsTab, waffleTab] = imported.dashboards[0].tabs;
    for (const [tab, view, file] of [[barsTab, "bars", "fictional-measures.json"], [waffleTab, "waffle", "fictional-register.json"]] as const) {
      const [chart, source] = tab.cards;
      expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
      expect(source.params).toEqual({});
      const recipe = chart.linkedChart?.recipe;
      if (!recipe) throw new Error("Missing imported ownership recipe.");
      expect(recipe).toMatchObject({ kind: "ownership-snapshot", issuer: "EXAMPLE.US", version: 1, view });
      const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
      const result = runRecipe(dataset, recipe, { theme: "light", maxDecimals: 2, today: "2026-11-20" });
      expect(result).toMatchObject({ ok: true, ownershipSnapshot: { view } });
      if (!result.ok) continue;
      if (result.ownershipSnapshot?.view === "waffle") {
        expect(result.ownershipSnapshot.buckets.reduce((sum, bucket) => sum + bucket.cells, 0)).toBe(100);
        expect(result.ownershipSnapshot.buckets).toContainEqual({ id: "treasury", percent: .01, cells: 0 });
      } else {
        expect(result.ownershipSnapshot?.measures.map(measure => measure.reported)).toEqual([33.3, .421875, 22.125]);
      }
    }
  });

  it("v9-next-kpi-gauges imports six source-free metric questions and admits their acquired units", async () => {
    const name = "v9-next-kpi-gauges", file = "fictional-observations.json";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const [tab] = imported.dashboards[0].tabs;
    const source = tab.cards.find(card => card.widgetId === LOCAL_TABLE_ID)!;
    expect(source.params).toEqual({});
    const metrics = tab.cards.filter(card => card.widgetId === LINKED_METRIC_ID);
    expect(metrics).toHaveLength(6);
    const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
    const expected = [
      ["price", 82.415, { kind: "money-per-share", currency: "USD" }],
      ["market_cap", 8241500000, { kind: "money", currency: "USD" }],
      ["dividend_yield", .00428, { kind: "fraction" }],
      ["pe_ratio", 18.125, { kind: "multiple" }],
      ["eps_ttm", 4.546, { kind: "money-per-share", currency: "USD" }],
      ["revenue_ttm", 2901200000, { kind: "money", currency: "USD" }],
    ];
    for (const [index, card] of metrics.entries()) {
      expect(card.linkedSource).toEqual({ kind: "widget", sourceWidgetId: source.id });
      const [metric, value, unit] = expected[index];
      const options = card.linkedMetric;
      if (!options) throw new Error("Missing linked KPI options.");
      expect(options.metric).toBe(metric);
      const result = buildKpiSnapshot(dataset, options);
      expect(result).toMatchObject({ ok: true, snapshot: { value, unit } });
      if (metric === "eps_ttm") expect(result).toMatchObject({
        ok: true, gauge: { data: [expect.objectContaining({ type: "indicator" })] },
        snapshot: { reference: { kind: "observation", value: 4.2 }, observation: { reporting_basis: "US-GAAP", period_start: "2025-10-01" } },
      });
    }
  });

  it("v9-next-etf-sunburst imports a source-free question and admits the supplied local holdings", async () => {
    const name = "v9-next-etf-sunburst", file = "fictional-holdings.json";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const [chart, source] = imported.dashboards[0].tabs[0].cards;
    expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
    expect(source.params).toEqual({});
    const recipe = chart.linkedChart?.recipe;
    if (recipe?.kind !== "etf-sunburst") throw new Error("Missing imported ETF recipe.");
    expect(recipe).toMatchObject({ fund: "CANOPY.US", depth: 2, snapshot: "latest" });
    const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
    const admitted = buildEtfHierarchy(dataset, recipe);
    expect(admitted).toMatchObject({ ok: true, value: { scope: "delivered", acquiredCount: 4, deliveredWeight: .35,
      holdings: expect.arrayContaining([
        expect.objectContaining({ symbol: "CEDAR.US", value: .000001 }),
        expect.objectContaining({ symbol: "WILLOW.US", value: 0 }),
      ]) } });
  });

  it("v9-next-dual-axis-overlays acquires both prepared local recipe examples", async () => {
    const name = "v9-next-dual-axis-overlays";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const tabs = imported.dashboards[0].tabs;
    expect(tabs.map(tab => tab.name)).toEqual(["Price and EPS", "CPI and Treasury yield"]);
    for (const [i, tab] of tabs.entries()) {
      const [chart, source] = tab.cards;
      const file = i === 0 ? "fictional-price-eps.json" : "fictional-cpi-ten-year.json";
      expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
      expect(source.params).toEqual({});
      const options = chart.linkedChart?.recipe;
      if (options?.kind !== "dual-axis-overlay") throw new Error("Missing imported overlay recipe.");
      const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
      const result = runRecipe(dataset, options, { theme: "light", maxDecimals: 2, today: "2026-11-20" });
      expect(result).toMatchObject({ ok: true, overlay: { recipe: i === 0 ? "price-eps" : "cpi-ten-year",
        left: { unitLabel: i === 0 ? "USD/share" : "1982–84 = 100" },
        right: { unitLabel: i === 0 ? "USD/share" : "%" },
      } });
    }
  });

  it("v9-next-estimate-revisions imports only pinned questions and compares the acquired examples", async () => {
    const name = "v9-next-estimate-revisions";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const tabs = imported.dashboards[0].tabs;
    expect(tabs.map(tab => tab.name)).toEqual(["Slope", "Time path", "Bump"]);
    for (const [index, tab] of tabs.entries()) {
      const [chart, source] = tab.cards;
      expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
      expect(source.params).toEqual({});
      const options = chart.linkedChart?.recipe;
      if (options?.kind !== "estimate-revisions") throw new Error("Missing imported estimate revision recipe.");
      const file = index === 2 ? "fictional-universe.json" : "fictional-single-issuer.json";
      const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
      expect(runRecipe(dataset, options, { theme: "light", maxDecimals: 2, today: "2026-11-20" })).toMatchObject({
        ok: true, estimateRevisions: { view: ["slope", "path", "bump"][index], target: { start: "2027-01-01", end: "2027-03-31", kind: "FQ" } },
      });
    }
  });

  it("v9-next-market-map reacquires each authored mode through its matching local example", async () => {
    const name = "v9-next-market-map";
    const { apps } = load(name + ".apps.json");
    const imported = importApps(apps, BUILTIN_WIDGETS);
    expect(imported.unresolved).toBe(0);
    const tabs = imported.dashboards[0].tabs;
    expect(tabs.map(tab => tab.name)).toEqual(["Delivered capitalization", "Named index"]);
    const expected = [
      { file: "fictional-capitalization.json", mode: "delivered-cap", session: "latest", value: 103365.4321, denomination: "USD" },
      { file: "fictional-index.json", mode: "index-weight", session: "2026-11-13", value: 1, denomination: null },
    ];
    for (const [index, tab] of tabs.entries()) {
      const [chart, source] = tab.cards;
      expect(chart.linkedSource?.sourceWidgetId).toBe(source.id);
      expect(source.params).toEqual({});
      const recipe = chart.linkedChart?.recipe;
      if (recipe?.kind !== "market-map") throw new Error("Missing imported market-map recipe.");
      const { file, mode, session, value, denomination } = expected[index];
      expect(recipe).toMatchObject({ mode, session });
      const dataset = await datasetFromBytes(file, readFileSync(join(dir, name, file)), source.id, 1);
      expect(runRecipe(dataset, recipe, { theme: "light", maxDecimals: 2, today: "2026-11-20" })).toMatchObject({
        ok: true, marketMap: { mode, denomination, session: "2026-11-13", root: { value } },
      });
    }
    const template = readFileSync(join(dir, name + ".apps.json"), "utf8");
    expect(template).not.toMatch(/chart_sources|viewport|ALFA\.US|example\/acquisition/);
  });

  it("v9-risk-exposure: remaps each saved financial question to its single source table", () => {
    const { apps } = load("v9-risk-exposure.apps.json");
    const sources = ["prices", "holdings", "sectors", "regions"].map(name => widget("risk_demo_" + name));
    const imported = importApps(apps, [...BUILTIN_WIDGETS, ...sources]);
    expect(imported.unresolved).toBe(0);
    const cards = imported.dashboards[0].tabs[0].cards;
    expect(cards).toHaveLength(8);
    const prices = { date: "date", price: "adjusted_close", symbol: "symbol" };
    const questions = [
      { kind: "return-distribution", fields: prices, symbol: "ALDER", bins: 5 },
      { kind: "small-multiples", fields: prices, symbols: ["CEDAR", "ALDER", "BIRCH"] },
      { kind: "etf-pareto", fields: { holding: "symbol", label: "name", weight: "weight" } },
      { kind: "etf-exposure", fields: { category: "sector", weight: "weight" }, mode: "sector" },
    ];
    const charts = cards.filter(card => card.widgetId === LINKED_CHART_ID);
    expect(charts.map(card => card.linkedChart?.recipe)).toEqual(questions.map(q => ({ version: 1, ...q })));
    expect(charts.map(card => cards.find(source => source.id === card.linkedSource?.sourceWidgetId)?.widgetId))
      .toEqual(["risk_demo_prices", "risk_demo_prices", "risk_demo_holdings", "risk_demo_sectors"]);
    expect(cards.filter(card => !card.linkedSource).map(card => card.widgetId)).toEqual(sources.map(source => source.id));
  });

  // The Demo providers cards are openbq-docker's widget ids (its /widgets.json
  // as BDOBB's v6 regression run captured it): EIA and BLS search under their
  // openbq-docker names, and Nasdaq's keyless historical EPS where Alpha
  // Vantage's demo-key card was; EconDB and Videos are the extensions
  // openbq-docker v3 adds.
  // REVIEW (2026-10-15, EconDB card): the pinned EconDB id was
  // "economy_indicators_econdb_obb", the ODP 4 shared economy router's id,
  // which openbq-docker v3+ does not serve. Its vendored openbb-econdb
  // (v3/econdb, econdb_router.py) mounts under openbb-core 2's provider
  // namespace, so the widget is econdb_economy_indicators_econdb_obb, and a
  // country-level symbol without a country answers 422. The id list keeps its
  // exact-order toEqual; the EconDB params are newly pinned below, so this is a
  // correction plus a new assertion, not a weaker one.
  it("v3.1.0-demo-providers: openbq-docker's widget ids, Nasdaq EPS in place of Alpha Vantage", () => {
    const { apps, ids } = load("v3.1.0-demo-providers.apps.json");
    expect(apps.map((a) => a.name)).toEqual(["Demo providers"]);
    expect(ids).toEqual([
      "eia_short_term_energy_outlook_eia_obb",
      "uscongress_bills_congress_gov_obb",
      "bls_search_bls_obb",
      "cftc_cot_cftc_obb",
      "econdb_economy_indicators_econdb_obb",
      "nasdaq_equity_fundamental_historical_eps_nasdaq_obb",
      "videos_video_custom_obb",
    ]);
    const layout = Object.values(apps[0].tabs).flatMap((t) => t.layout);
    expect(layout.find((l) => l.i === "nasdaq_equity_fundamental_historical_eps_nasdaq_obb")?.state?.params).toEqual({ symbol: "IBM" });
    expect(layout.find((l) => l.i === "bls_search_bls_obb")?.state?.params).toEqual({ category: "cpi", query: "CUUR0000SA0" });
    expect(layout.find((l) => l.i === "econdb_economy_indicators_econdb_obb")?.state?.params).toEqual({ symbol: "RGDP", country: "US" });
    // The COT card needs a market code to load at all; 067651 is WTI crude oil (NYMEX). An unset date
    // param opens on today, and a one-day COT window is empty (204), so the card pins its start date.
    expect(layout.find((l) => l.i === "cftc_cot_cftc_obb")?.state?.params).toEqual({ code: "067651", start_date: "2025-01-01" });
    expect(apps[0].description).toContain("openbq-docker v3");
    expect(apps[0].description).toContain("credentials.demo.env");
    expect(apps[0].description).not.toContain("openbb-docker");
  });

  // The V5 Statement example sits in a directory of its own beside its fixture
  // backend (widgets.json, cash-flow.json, served locally by its README).
  // openbq-docker v5+ serves the same synthetic_cash_flow widget id, so the
  // card must name exactly the fixture's widget, and come back in the
  // Statement view.
  it("v5-financial-demo: the V5 Statement card names its fixture's widget and imports in the Statement view", () => {
    const { apps, ids } = load("v5-financial-demo/apps.json");
    expect(apps.map((a) => a.name)).toEqual(["V5 Statement Example"]);
    const fixture = JSON.parse(readFileSync(join(dir, "v5-financial-demo/widgets.json"), "utf8")) as Record<string, { endpoint: string }>;
    expect(ids).toEqual(["synthetic_cash_flow"]);
    expect(Object.keys(fixture)).toEqual(ids);
    expect(readdirSync(join(dir, "v5-financial-demo"))).toContain(fixture.synthetic_cash_flow.endpoint);
    const { dashboards, cards, unresolved } = importApps(apps, ids.map(widget));
    expect(unresolved).toBe(0);
    expect(cards).toBe(1);
    expect(dashboards[0].tabs[0].cards[0]).toMatchObject({ widgetId: "synthetic_cash_flow", view: "statement", statement: { collapsed: [] } });
  });

  // OpenBB Workspace's CFTC, BLS and IMF dashboards (bdobb-v2 docs/examples/openbb-workspace),
  // re-keyed to openbq-docker's openbb-core 2 provider-namespaced ids: an ODP 4 shared-router id
  // ("economy_...") is not served and would import unresolved. Workspace's navigation_bar strip and
  // the OpenBB-hosted imf_utils_* custom widgets are dropped. The chokepoint-volume card is an
  // ssrm_table; v3 could not draw it, so it joins at v4, where SsrmTableRenderer arrives.
  it("v3.1.0-openbb-workspace: CFTC, BLS and IMF on openbq-docker's widget ids", () => {
    const { apps, ids } = load("v3.1.0-openbb-workspace.apps.json");
    expect(apps.map((a) => a.name)).toEqual([
      "OpenBB Workspace - CFTC Commitment of Traders",
      "OpenBB Workspace - BLS",
      "OpenBB Workspace - IMF Explorer",
    ]);
    expect(ids).toEqual([
      "cftc_cot_cftc_obb",
      "cftc_cot_search_cftc_obb",
      "bls_search_bls_obb",
      "bls_series_bls_obb",
      "imf_available_indicators_imf_obb",
      "imf_indicators_imf_obb",
      "imf_direction_of_trade_imf_obb",
      "imf_chokepoint_volume_imf_obb",
      "imf_port_info_imf_obb",
      "imf_port_volume_imf_obb",
    ]);
    for (const app of apps) expect(app.description).not.toContain("openbb-docker");
  });

  // OpenBB Workspace's Analysis Dashboard (bdobb-v2 docs/examples/openbb-workspace),
  // re-keyed to the openbq-eodhd extension's mirror ids; navigation_bar dropped.
  it("v9.0.0-openbb-workspace-analysis: eleven tabs of EODHD prices and AAPL fundamentals", () => {
    const { apps, ids } = load("v9.0.0-openbb-workspace-analysis.apps.json");
    expect(apps.map((a) => a.name)).toEqual(["OpenBB Workspace - Analysis Dashboard"]);
    expect(Object.keys(apps[0].tabs)).toHaveLength(11);
    expect([...new Set(ids)].sort()).toEqual([
      "eodhd_equity_fundamental_balance_eodhd_obb",
      "eodhd_equity_fundamental_cash_eodhd_obb",
      "eodhd_equity_price_historical_eodhd_obb",
    ]);
    expect(ids).not.toContain("navigation_bar");
  });

  // The card id is the openbb-videos extension's own widget id (path
  // /api/v1/videos/video, provider "custom"); a rename on either side would
  // import as unresolved on a real stack while this suite's fixture registry
  // still served it.
  it("v3.2.0-video-library: one Video Library card, and demo-providers carries it too", () => {
    expect(load("v3.2.0-video-library.apps.json").ids).toEqual(["videos_video_custom_obb"]);
    expect(load("v3.1.0-demo-providers.apps.json").ids).toContain("videos_video_custom_obb");
  });

  // Episode 5 is where readers first meet the Calendar view: both cards are
  // openbb-api's own keyless U.S. Treasury widgets (openbb-government-us),
  // and each must come back from the import as a calendar on these columns.
  it("v5.0.0-treasury-calendar: two Treasury auction cards, each in the Calendar view", () => {
    const { apps, ids } = load("v5.0.0-treasury-calendar.apps.json");
    expect(ids).toEqual(["ustreasury_upcoming_auctions_us_treasury_obb", "ustreasury_auction_results_us_treasury_obb"]);
    const { dashboards } = importApps(apps, ids.map(widget));
    const cards = dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards));
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.view).toBe("calendar");
      expect(card.calendar).toMatchObject({ dateField: "auction_date", titleField: "security_term", seriesField: "security_type" });
    }
    expect(cards[1].params.start_date).toMatch(/^T-/);
    // Paged and the endless modes move a date-range widget's start/end to
    // follow the page and save them as fixed dates; only Static draws the
    // widget's own range. The results card's window is relative (T-6w to T)
    // and must stay so, so it is Static. Upcoming auctions has no range.
    expect(cards[0].calendar?.mode).toBe("paged");
    expect(cards[1].calendar?.mode).toBe("static");
  });

  // The Rita sample is for trying the assistant on a bare install, so it may
  // lean on nothing a backend has to serve.
  it("v6.0.0-rita: uses only clock, markdown and note cards", () => {
    expect(new Set(load("v6.0.0-rita.apps.json").ids)).toEqual(new Set(["clock", "markdown", "note"]));
  });

  // v8: the News sample. Its feeds travel only in the v8 envelope (R1), so
  // this is the import of a file a v7 install refuses; the card must come
  // back with every feed, the highlight and the dragged tab order.
  it("v8.0.0-news: one News card whose feeds come back from the v8 envelope", () => {
    const { apps, ids } = load("v8.0.0-news.apps.json");
    expect(ids).toEqual(["news"]);
    expect(apps[0].extensions?.bdobb.profile).toBe("v8");
    expect(JSON.stringify(apps[0].tabs)).not.toContain("feeds");
    const [card] = importApps(apps, BUILTIN_WIDGETS).dashboards[0].tabs[0].cards;
    expect(card.params).toEqual({ url: "", layout: "vertical", autoScroll: "off" });
    expect(card.news?.feeds).toHaveLength(14);
    expect(card.news?.highlights).toEqual(["Fed"]);
    expect(card.news?.tabOrder).toEqual(["Wires", "Substack", "Seeking Alpha"]);
  });

  // v8: the pinned sample. The donor shipped no example with a pinned card;
  // this one exercises the v8 envelope's per-card `pinned` (R1). The pins
  // live only in the envelope, never in the plain layout a v7 install reads.
  it("v8.0.0-pinned: a Note pinned to the top and a Clock to the bottom, from the v8 envelope", () => {
    const { apps, ids } = load("v8.0.0-pinned.apps.json");
    expect(ids).toEqual(["note", "markdown", "clock"]);
    expect(apps[0].extensions?.bdobb.profile).toBe("v8");
    expect(Object.values(apps[0].tabs).flatMap((t) => t.layout).some((l) => "pinned" in l)).toBe(false);
    const cards = importApps(apps, BUILTIN_WIDGETS).dashboards[0].tabs[0].cards;
    expect(cards.map((c) => [c.widgetId, c.pinned])).toEqual([["note", "top"], ["markdown", undefined], ["clock", "bottom"]]);
  });

  // v9: Episode 9's example, carried from the donor's v9.6.2-calendars
  // (4121eb9e, a145640a) into clean's envelope. The EODHD cards are the
  // openbq-eodhd mirror ids an OpenBB Platform 5 openbb-api serves
  // (`eodhd_<route>_eodhd_obb`); the Treasury card is clean's own keyless
  // auction-results widget, as Episode 5's. Each calendar comes back in its
  // mode, the statement in the Statement view, and the markets share groups.
  it("v9.0.0-calendars: three calendars in their modes, a statement, and two grouped price cards", () => {
    const { apps, ids } = load("v9.0.0-calendars.apps.json");
    expect(ids).toEqual([
      "eodhd_equity_price_historical_eodhd_obb",
      "eodhd_equity_price_historical_eodhd_obb",
      "eodhd_equity_fundamental_income_eodhd_obb",
      "eodhd_economy_calendar_eodhd_obb",
      "ustreasury_auction_results_us_treasury_obb",
      "eodhd_equity_calendar_earnings_eodhd_obb",
    ]);
    expect(apps[0].extensions?.bdobb.profile).toBe("v5");
    expect(JSON.stringify(apps[0].tabs)).not.toContain("calendarView");
    expect(JSON.stringify(apps[0].tabs)).not.toContain("pivotView");
    const { dashboards } = importApps(apps, [...new Set(ids)].map(widget));
    const [markets, calendars] = dashboards[0].tabs;
    expect([markets.name, calendars.name]).toEqual(["Markets", "Calendars"]);
    expect(markets.cards.map((c) => c.view)).toEqual([undefined, "chart", "statement"]);
    const groups = dashboards[0].groups ?? [];
    expect(groups.map((g) => g.paramName)).toEqual(["symbol", "interval"]);
    for (const c of markets.cards.slice(0, 2)) expect(c.bindings?.map((b) => b.paramName)).toEqual(["symbol", "interval"]);
    expect(markets.cards[2].bindings?.map((b) => b.paramName)).toEqual(["symbol"]);
    expect(calendars.cards.every((c) => c.view === "calendar")).toBe(true);
    expect(calendars.cards[0].calendar).toEqual({ mode: "paged", unit: "month", evenRows: true });
    expect(calendars.cards[1].calendar).toMatchObject({ mode: "vertical", rowUnit: "week", dateField: "auction_date" });
    expect(calendars.cards[2].calendar).toMatchObject({ mode: "horizontal", cellMode: "list", seriesField: "symbol" });
    expect(calendars.cards[2].calendar?.series).toHaveLength(7);
    // The two EODHD calendars carry a relative range (user ruling,
    // 2026-10-18): the calendar view only mounts, and only pushes its own
    // window, once a first request has returned rows, and an unbounded first
    // request ran past the gateway's 55 s.
    expect(calendars.cards[0].params).toMatchObject({ start_date: "T-1mo", end_date: "T+2mo" });
    expect(calendars.cards[2].params).toMatchObject({ start_date: "T-MON", end_date: "T+1m" });
  });

  // Every example says which BDOBB it needs, in words a reader sees in the
  // Apps catalogue: "BDOBB X.Y.Z or later". The version is of the example's
  // own line (its file name's major) and never below what its BDOBB envelope
  // needs -- a v8 envelope opens only on 8.0.0 or later.
  it.each(files)("%s names the minimum BDOBB version in its description", (file) => {
    const { apps } = load(file);
    // REVIEW (user ruling 2026-10-14): was /^v(\d+)\./, which only a top-level
    // vX.Y.Z-*.apps.json name matches; v5-financial-demo/apps.json is now read
    // too, so the line's major may also end in "-". Same check, one more file.
    const line = Number(/^v(\d+)[.-]/.exec(file)![1]);
    for (const app of apps) {
      const m = /BDOBB (\d+)\.(\d+)\.(\d+) or later/.exec(app.description);
      expect(m, `${file}: ${app.name}`).not.toBeNull();
      const major = Number(m![1]);
      expect(major, file).toBe(line);
      const profile = app.extensions?.bdobb.profile;
      const floor = profile === undefined ? 3 : Number(String(profile).slice(1));
      expect(major, `${file}: ${String(profile)}`).toBeGreaterThanOrEqual(floor);
    }
  });

  // Locked widgets never ride a shared example: importing one replaces the
  // reader's own docks behind the guard (lib/docksImport.ts). The help says to
  // share a band as its own file instead.
  it.each(files)("%s carries no locked widgets", (file) => {
    for (const app of load(file).apps) {
      expect((app.extensions?.bdobb as { docks?: unknown } | undefined)?.docks, file).toBeUndefined();
    }
  });

  // The description is what the Apps card shows: a reader's summary, not
  // implementation notes (those live in the comments above).
  it.each(files)("%s describes itself in a few sentences", (file) => {
    for (const app of load(file).apps) expect(app.description.length).toBeLessThanOrEqual(400);
  });

  it.each(files)("%s imports every card against a registry that serves it", (file) => {
    const { apps, ids } = load(file);
    // Use actual built-in identities and stub the backend widgets separately.
    const registry = [...new Set(ids)].map(id => BUILTIN_WIDGETS.find(builtIn => builtIn.id === id) ?? widget(id));
    const { dashboards, cards, unresolved } = importApps(apps, registry);
    expect(unresolved).toBe(0);
    expect(cards).toBe(ids.length);
    expect(dashboards).toHaveLength(apps.length);
  });

  it.each(files.filter(file => file.startsWith("v9-next-")))("%s imports linked presentation Parameters closed", file => {
    const { apps, ids } = load(file);
    const registry = [...new Set(ids)].map(id => BUILTIN_WIDGETS.find(builtIn => builtIn.id === id) ?? widget(id));
    const { dashboards } = importApps(apps, registry);
    const linked = dashboards.flatMap(dashboard => dashboard.tabs.flatMap(tab => tab.cards))
      .filter(card => card.widgetId === LINKED_CHART_ID || card.widgetId === LINKED_METRIC_ID);
    expect(linked.length).toBeGreaterThan(0);
    for (const card of linked) expect(card).not.toHaveProperty("paramsOpen");
  });

  // N2: a sample dashboard exists for every embedded widget, pinned so a new
  // built-in fails the gate until it has a card in the example. v8: News is a
  // v8 built-in whose state needs the v8 envelope, so its sample is the v8
  // News example, not the v4 file a v4-v7 install must still open.
  it("v4.0.0-builtins: every BUILTIN_WIDGETS id, and param_echo, appears at least once", () => {
    const { ids } = load("v4.0.0-builtins.apps.json");
    const present = new Set([...ids, ...load("v8.0.0-news.apps.json").ids]);
    for (const w of BUILTIN_WIDGETS) {
      // Local file is hidden from the library (WidgetLibrary.tsx) and only
      // ever created by dropping a real file on the dashboard -- its `file`
      // param names a stored file nothing here can portably seed, so it gets
      // no sample card, the same reason it gets no library entry.
      // Linked cards also need dashboard-owned table IDs. External apps.json
      // intentionally has no native dependency-reference extension.
      // The Picture in Picture only does anything in the macOS app (it is a
      // placeholder elsewhere) and needs a Chrome player to park, so it gets
      // no sample card either.
      if ([LOCAL_TABLE_ID, LINKED_TABLE_ID, LINKED_CHART_ID, LINKED_METRIC_ID, "picture_in_picture"].includes(w.id)) continue;
      expect(present.has(w.id), `${w.id} has no card in v4.0.0-builtins.apps.json`).toBe(true);
    }
    expect(present.has("param_echo")).toBe(true);
  });
});
