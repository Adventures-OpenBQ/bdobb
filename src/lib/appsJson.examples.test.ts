// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID, LINKED_TABLE_ID, LINKED_CHART_ID } from "./builtins";
import { importApps, isAppsJson, type App } from "./appsJson";
import type { WidgetDef } from "./types";

/**
 * Every file under docs/examples is served to users: `pnpm apps:sync` writes
 * them all into openbq-docker's one combined examples/bdobb/apps.json (SERVED
 * in scripts/apps-sync.mjs), served at the API's /apps.json and opened from
 * the rail's Apps catalogue. So each one is parsed and imported
 * here exactly as opening it would, against a registry that serves every
 * widget id the file names. A shipped example that fails to import is a
 * broken promise, and nothing else in the suite reads those files.
 */
const dir = resolve(process.cwd(), "docs/examples");
// REVIEW (user ruling 2026-10-14): was the top-level *.apps.json only. Every
// example under docs/examples is served (scripts/apps-sync.mjs scans them all),
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
    "v9.0.0-calendars.apps.json",
    "v9.0.0-openbb-workspace-analysis.apps.json",
    "v5-financial-demo/apps.json",
  ];
  it("ships every known example file, and no file the list does not name", () => {
    expect(files).toEqual(expect.arrayContaining(KNOWN));
    expect([...files].sort()).toEqual([...KNOWN].sort());
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
    // BUILTIN_WIDGETS' own ids are already served by the app without a
    // registry entry, but the fixture registry here has to stand in for
    // every id a file names, built-in or not, since importApps takes one
    // flat registry.
    const registry = [...new Set(ids)].map(widget);
    const { dashboards, cards, unresolved } = importApps(apps, registry);
    expect(unresolved).toBe(0);
    expect(cards).toBe(ids.length);
    expect(dashboards).toHaveLength(apps.length);
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
      if ([LOCAL_TABLE_ID, LINKED_TABLE_ID, LINKED_CHART_ID].includes(w.id)) continue;
      expect(present.has(w.id), `${w.id} has no card in v4.0.0-builtins.apps.json`).toBe(true);
    }
    expect(present.has("param_echo")).toBe(true);
  });
});
