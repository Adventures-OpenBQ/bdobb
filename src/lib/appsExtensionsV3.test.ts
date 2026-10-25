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
import { __resetJsonStoreForTests } from "./jsonStore";

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

it("refuses later card state rather than dropping it from a v3 export", () => {
  const input = dashboard(); Object.assign(input.tabs[0].cards[0], { pinned: "top" });
  expect(appsJson.exportCompatibleApp(input).ok).toBe(false);
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

// Archived exports from the earlier bdobb line mark a Pivot card with
// state.pivotView (bdobb#8): this line's Pivot does not read that format, so
// it must refuse, not drop it.
it("refuses archived Pivot state (state.pivotView enabled) before planning any writes", () => {
  const input = wire();
  const item = input[0].tabs.t.layout[0] as unknown as { state: Record<string, unknown> };
  item.state = { ...item.state, pivotView: { enabled: true } };
  const original = JSON.stringify(input);
  const result = planAppsImport(original, original.length, [], []);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.refusal).toContain("UNSUPPORTED_EXTENSION");
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
