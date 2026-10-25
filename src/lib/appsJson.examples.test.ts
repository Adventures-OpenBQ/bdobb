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
const files = readdirSync(dir).filter((f) => f.endsWith(".apps.json"));

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

  // The card id is the openbb-videos extension's own widget id (path
  // /api/v1/videos/video, provider "custom"); a rename on either side would
  // import as unresolved on a real stack while this suite's fixture registry
  // still served it.
  it("v3.2.0-video-library: one Video Library card, and demo-providers carries it too", () => {
    expect(load("v3.2.0-video-library.apps.json").ids).toEqual(["videos_video_custom_obb"]);
    expect(load("v3.1.0-demo-providers.apps.json").ids).toContain("videos_video_custom_obb");
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
  // built-in fails the gate until it has a card in the example.
  it("v4.0.0-builtins: every BUILTIN_WIDGETS id, and param_echo, appears at least once", () => {
    const { ids } = load("v4.0.0-builtins.apps.json");
    const present = new Set(ids);
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
