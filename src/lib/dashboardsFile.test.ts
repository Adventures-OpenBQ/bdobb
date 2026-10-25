// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __list, __read, __reset, __seed } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import {
  deleteDashboard,
  loadDashboards,
  makeDefaultDashboard,
  saveDashboard,
} from "./dashboardsFile";

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

describe("sync fields", () => {
  it("keeps revision and extensions through a save and load, and reads a non-number revision as absent", async () => {
    const extensions = { workspace: { content: { index: "x" }, tabKeys: { t1: "main" }, orphans: [] } };
    await saveDashboard({ id: "d1", name: "A", tabs: [{ id: "t1", name: "Main", cards: [] }], revision: 3, extensions });
    __seed("dashboards/d2.json", JSON.stringify({ id: "d2", name: "B", tabs: [], revision: "3" }));
    const [a, b] = await loadDashboards();
    expect(a).toMatchObject({ revision: 3, extensions });
    expect(b.revision).toBeUndefined();
  });
});
