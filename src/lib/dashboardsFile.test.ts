// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { __list, __read, __reset, __seed } from "../test/memfs";
import { onDashboardChanged } from "./dashboardSync";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import {
  deleteDashboard,
  loadDashboards,
  makeDefaultDashboard,
  saveDashboard,
} from "./dashboardsFile";
import { fromWorkspace, toWorkspace } from "./workspaceDashboards";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("loadDashboards", () => {
  it("seeds one dashboard with one default tab named Main when the directory is empty", async () => {
    const loaded = await loadDashboards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Main");
    expect(loaded[0].tabs).toEqual([{ id: expect.any(String), name: "Main", cards: [] }]);
    expect(__read(`dashboards/${loaded[0].id}.json`)).toBeDefined();
  });

  /**
   * App.tsx bootstraps in a `useEffect`, and React.StrictMode double-mounts in
   * dev, so `load()` runs twice concurrently. Seeding is check-then-act with an
   * await between the check and the write, so both callers saw an empty
   * directory and both seeded — each under its own `crypto.randomUUID()` path,
   * leaving two dashboards named "Main". `loadBackends` escaped only because
   * both of its writes land on the same `backends.json` path.
   */
  it("seeds only once when two bootstraps load concurrently", async () => {
    const [first, second] = await Promise.all([loadDashboards(), loadDashboards()]);

    expect(__list().filter((p) => p.startsWith("dashboards/"))).toHaveLength(1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
  });

  it("sorts by name using localeCompare", async () => {
    __seed("dashboards/1.json", JSON.stringify({ id: "1", name: "Zulu", cards: [] }));
    __seed("dashboards/2.json", JSON.stringify({ id: "2", name: "alpha", cards: [] }));
    expect((await loadDashboards()).map((d) => d.name)).toEqual(["alpha", "Zulu"]);
  });

  it.each([
    ["a missing name", { id: "1", cards: [] }],
    ["a non-string name", { id: "1", name: 7, cards: [] }],
    ["a missing cards array", { id: "1", name: "Main" }],
    ["a non-array cards field", { id: "1", name: "Main", cards: {} }],
    ["a non-array tabs field", { id: "1", name: "Main", tabs: {} }],
    ["a null tab", { id: "1", name: "Main", tabs: [null] }],
    ["a tab without a cards array", { id: "1", name: "Main", tabs: [{ id: "t", name: "Main" }] }],
  ])("quarantines a dashboard file with %s", async (_label, content) => {
    __seed("dashboards/1.json", JSON.stringify(content));
    await loadDashboards();
    expect(__read("dashboards/1.json.corrupt")).toBe(JSON.stringify(content));
  });

  describe("a legacy flat-cards file (written before tabs existed)", () => {
    const legacyCard = {
      id: "c1",
      widgetId: "w1",
      backendId: "b1",
      params: {},
      layout: { x: 0, y: 0, w: 20, h: 9 },
    };

    it("normalizes into one tab named Main holding all its cards", async () => {
      __seed("dashboards/1.json", JSON.stringify({ id: "1", name: "Old", cards: [legacyCard] }));

      const [loaded] = await loadDashboards();

      expect(loaded.tabs).toHaveLength(1);
      expect(loaded.tabs[0].name).toBe("Main");
      expect(loaded.tabs[0].cards).toEqual([legacyCard]);
    });

    it("does not rewrite the file merely by loading it", async () => {
      __seed("dashboards/1.json", JSON.stringify({ id: "1", name: "Old", cards: [legacyCard] }));

      await loadDashboards();

      const onDisk = JSON.parse(__read("dashboards/1.json") ?? "{}");
      expect(onDisk).not.toHaveProperty("tabs");
      expect(onDisk.cards).toEqual([legacyCard]);
    });

    it("converges to the tabs shape the next time it's saved", async () => {
      __seed("dashboards/1.json", JSON.stringify({ id: "1", name: "Old", cards: [legacyCard] }));
      const [loaded] = await loadDashboards();

      await saveDashboard(loaded);

      const onDisk = JSON.parse(__read("dashboards/1.json") ?? "{}");
      expect(onDisk.tabs).toEqual([{ id: loaded.tabs[0].id, name: "Main", cards: [legacyCard] }]);
      expect(onDisk).not.toHaveProperty("cards");
    });
  });

  describe("a dashboard written before bindings existed", () => {
    it("turns groupIds into bindings on the group's own paramName, and defaults groupType", async () => {
      __seed(
        "dashboards/d1.json",
        JSON.stringify({
          id: "d1",
          name: "Legacy",
          groups: [{ id: "g1", name: "Ticker", paramName: "symbol", value: "MSFT" }],
          tabs: [
            {
              id: "t1",
              name: "Main",
              cards: [
                {
                  id: "c1",
                  widgetId: "quote",
                  backendId: "b1",
                  params: { symbol: "AAPL" },
                  layout: { x: 0, y: 0, w: 1, h: 1 },
                  groupIds: ["g1", "g-ghost"],
                },
              ],
            },
          ],
        }),
      );
      const [d] = await loadDashboards();
      expect(d.groups).toEqual([
        { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
      ]);
      const card = d.tabs[0].cards[0] as Record<string, unknown>;
      expect(card.bindings).toEqual([{ groupId: "g1", paramName: "symbol" }]);
      expect(card).not.toHaveProperty("groupIds");
    });

    it("does not rewrite the file merely by loading it", async () => {
      const raw = JSON.stringify({
        id: "d1",
        name: "Legacy",
        groups: [{ id: "g1", name: "Ticker", paramName: "symbol", value: "MSFT" }],
        tabs: [{ id: "t1", name: "Main", cards: [] }],
      });
      __seed("dashboards/d1.json", raw);
      await loadDashboards();
      expect(__read("dashboards/d1.json")).toBe(raw);
    });
  });

  describe("presets", () => {
    it("reads presets leniently, and a file without them has none", async () => {
      __seed("dashboards/p.json", JSON.stringify({ id: "p", name: "P", tabs: [], presets: [{ name: "Two weeks", expr: "T-2w" }, { name: "", expr: "T" }, { expr: "T" }, 7] }));
      __seed("dashboards/q.json", JSON.stringify({ id: "q", name: "Q", tabs: [] }));
      const [p, q] = await loadDashboards();
      expect(p.presets).toEqual([{ name: "Two weeks", expr: "T-2w" }]);
      expect(q.presets).toBeUndefined();
    });

    it("writes presets with the dashboard", async () => {
      const d = { ...makeDefaultDashboard(), presets: [{ name: "YTD", expr: "Y0/T" }] };
      await saveDashboard(d);
      expect(JSON.parse(__read(`dashboards/${d.id}.json`)!).presets).toEqual([{ name: "YTD", expr: "Y0/T" }]);
    });
  });

  describe("exchange and the FY ends override (v5.4.0)", () => {
    it("loads a stored six-MIC exchange unchanged, any catalogue calendar, and keeps another name for repair", async () => {
      const six = ["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG"];
      six.forEach((mic, i) => __seed(`dashboards/s${i}.json`, JSON.stringify({ id: `s${i}`, name: mic, tabs: [], exchange: mic })));
      __seed("dashboards/x.json", JSON.stringify({ id: "x", name: "X", tabs: [], exchange: "XPAR" }));
      __seed("dashboards/y.json", JSON.stringify({ id: "y", name: "Y", tabs: [], exchange: "US" }));
      __seed("dashboards/z.json", JSON.stringify({ id: "z", name: "Z", tabs: [], exchange: 7 }));
      const byId = Object.fromEntries((await loadDashboards()).map((d) => [d.id, d.exchange]));
      six.forEach((mic, i) => expect(byId[`s${i}`]).toBe(mic));
      expect(byId.x).toBe("XPAR");
      expect(byId.y).toBe("US");
      expect(byId.z).toBeUndefined();
    });

    it("carries a card's FY ends override through a read", async () => {
      const card = { id: "c", widgetId: "w", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, fiscalYearEnd: 6 };
      __seed("dashboards/z.json", JSON.stringify({ id: "z", name: "Z", tabs: [{ id: "t", name: "T", cards: [card] }] }));
      const [z] = await loadDashboards();
      expect(z.tabs[0].cards[0].fiscalYearEnd).toBe(6);
    });
  });
});

describe("saveDashboard / deleteDashboard", () => {
  it("writes one file per dashboard", async () => {
    const d = makeDefaultDashboard();
    await saveDashboard(d);
    expect(JSON.parse(__read(`dashboards/${d.id}.json`) ?? "")).toEqual(d);
  });

  it("deletes the file", async () => {
    const d = makeDefaultDashboard();
    await saveDashboard(d);
    await deleteDashboard(d.id);
    expect(__read(`dashboards/${d.id}.json`)).toBeUndefined();
  });
});

describe("announcing a write", () => {
  it("emits the dashboard id after a save and after a delete", async () => {
    // In the file layer, not the store: every persisting path -- a param
    // Apply, a rename, an import, a duplicate -- funnels through these two,
    // so no future writer can forget to announce itself.
    const seen: string[] = [];
    const off = await onDashboardChanged((id) => seen.push(id));
    const d = makeDefaultDashboard();
    await saveDashboard(d);
    expect(seen).toEqual([d.id]);
    await deleteDashboard(d.id);
    expect(seen).toEqual([d.id, d.id]);
    off();
  });
});

describe("sync fields", () => {
  it("keeps revision and extensions through a save and load, and reads a non-number revision as absent", async () => {
    const extensions = { workspace: { content: { index: "x" }, tabKeys: { t1: "main" }, orphans: [] } };
    await saveDashboard({ id: "d1", name: "A", tabs: [{ id: "t1", name: "Main", cards: [] }], revision: 3, extensions });
    __seed("dashboards/d2.json", JSON.stringify({ id: "d2", name: "B", tabs: [], revision: "3" }));
    const [a, b] = await loadDashboards();
    expect(a).toMatchObject({ revision: 3, extensions });
    expect(b.revision).toBeUndefined();
  });

  /**
   * A card that came down from a Workspace server carries the server's widget
   * record in extensions.workspace: its id, its storage, every field BDOBB
   * does not model. Saving it must keep that record whole, or after a restart
   * the next sync uploads a stripped widget under a fresh id.
   */
  it("keeps a synced card's extensions byte-for-byte through a save and load, so the next upload is the server's own record", async () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src/test/workspace-fama-french.json"), "utf8"));
    const content = () => structuredClone(fixture.owned["aaaaaaaa-0000-4000-8000-000000000002"].content);
    const downloaded = fromWorkspace(content(), "dashboard", []);
    const synced = downloaded.tabs[0].cards[0];
    // A sibling key BDOBB does not know (a later version's, say) rides along untouched.
    Object.assign(synced.extensions as object, { later: { note: "kept", list: [1, null, { deep: true }] } });
    const before = JSON.stringify(downloaded.tabs.map((t) => t.cards.map((c) => c.extensions)));
    const serverIds = (content().data.widgets as { id: string; widgetId: string }[]).filter((w) => w.widgetId !== "navigation_bar").map((w) => w.id).sort();

    await saveDashboard(downloaded);
    const [reloaded] = await loadDashboards();

    expect(JSON.stringify(reloaded.tabs.map((t) => t.cards.map((c) => c.extensions)))).toBe(before);
    const card = reloaded.tabs[0].cards[0];
    expect((card.extensions as Record<string, unknown>).later).toEqual({ note: "kept", list: [1, null, { deep: true }] });
    expect(card.extensions?.workspace?.widget.storage).toEqual(content().data.widgets[0].storage);
    const uploaded = toWorkspace(reloaded, "dashboard") as { data: { widgets: { id: string; widgetId: string }[] } };
    expect(uploaded.data.widgets.filter((w) => w.widgetId !== "navigation_bar").map((w) => w.id).sort()).toEqual(serverIds);
    const byId = (body: { data: { widgets: { id: string }[] } }) => [...body.data.widgets].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(uploaded)).toEqual(byId(content()));
  });

  it("never writes a function or an accessor that sits in a card's extensions", async () => {
    const extensions = { workspace: { widget: { id: "w1", storage: { params: {} } }, layout: { i: "w1" }, params: {} }, kept: [1, "a"] };
    const runtime: Record<string, unknown> = { ...structuredClone(extensions), refresh: () => "secret" };
    Object.defineProperty(runtime, "computed", { enumerable: true, get: () => "secret" });
    Object.assign(runtime.workspace as object, { hook: () => "secret" });
    const card = { id: "c1", widgetId: "w", backendId: "b", params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, extensions: runtime };
    await saveDashboard({ id: "d1", name: "A", tabs: [{ id: "t1", name: "Main", cards: [card as never] }] });
    const raw = __read("dashboards/d1.json") ?? "";
    expect(raw).not.toContain("secret");
    expect(JSON.parse(raw).tabs[0].cards[0].extensions).toEqual(extensions);
  });
});
