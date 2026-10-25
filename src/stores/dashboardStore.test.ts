// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../lib/dashboardsFile", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/dashboardsFile")>("../lib/dashboardsFile");
  return { ...actual, saveDashboard: vi.fn(actual.saveDashboard) };
});

import { __failPath, __list, __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { saveDashboard } from "../lib/dashboardsFile";
import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, LOCAL_TABLE_ID } from "../lib/builtins";
import { readLocalFile, saveLocalFile } from "../lib/localFiles";
import type { Dashboard, WidgetDef } from "../lib/types";
import { widget as baseWidget } from "../test/fixtures";
import { useDashboardStore } from "./dashboardStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

const saveSpy = saveDashboard as unknown as Mock;

const widget = (over: Partial<WidgetDef> = {}): WidgetDef =>
  baseWidget({
    id: "price_history",
    name: "Price History",
    endpoint: "equity/price",
    params: [
      { paramName: "symbol", value: "AAPL" },
      { paramName: "provider", value: "yfinance", show: false },
      { paramName: "interval" },
    ],
    ...over,
  });

/** Loads the seeded dashboard, adds a second tab, and returns both tab ids. */
async function loadWithSecondTab(): Promise<{ tabA: string; tabB: string }> {
  await useDashboardStore.getState().load();
  const tabA = useDashboardStore.getState().activeTabId!;
  const tabB = (await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Second"))!;
  return { tabA, tabB };
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  saveSpy.mockClear();
  // viewer is included because the store is module-level: without it, the
  // viewer suite's `viewer: true` would leak into every test declared after it.
  useDashboardStore.setState({
    dashboards: [],
    activeId: null,
    previousId: null,
    activeTabId: null,
    maximizedCardId: null,
    viewer: false,
    pendingCardRemoval: null,
  });
});

describe("load", () => {
  it("seeds one dashboard named Main with one tab, makes both active", async () => {
    await useDashboardStore.getState().load();
    const { dashboards, activeId, activeTabId } = useDashboardStore.getState();
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].name).toBe("Main");
    expect(activeId).toBe(dashboards[0].id);
    expect(activeTabId).toBe(dashboards[0].tabs[0].id);
  });

  it("selects the first dashboard by sorted name", async () => {
    __seed("dashboards/1.json", JSON.stringify({ id: "1", name: "Zulu", cards: [] }));
    __seed("dashboards/2.json", JSON.stringify({ id: "2", name: "alpha", cards: [] }));
    await useDashboardStore.getState().load();
    expect(useDashboardStore.getState().activeId).toBe("2");
  });
});

describe("setActive", () => {
  it("moves activeDashboard and writes no second selection field", async () => {
    await useDashboardStore.getState().load();
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;

    useDashboardStore.getState().setActive(second);

    const state = useDashboardStore.getState();
    expect(state.activeId).toBe(second);
    expect(state.activeDashboard()?.id).toBe(second);
    // Exactly one field names the active dashboard. Methods are not state, so
    // function-typed keys (setActive, activeDashboard) are filtered out — the
    // regression this guards against is a second stored id, not a method name.
    // activeTabId is excluded deliberately: it is the ONE field naming the
    // active TAB, a distinct concept from the active dashboard, covered by
    // its own test below rather than this one.
    const fields = Object.keys(state).filter(
      (k) => typeof state[k as keyof typeof state] !== "function" && k !== "activeTabId" && k !== "activeTabIds",
    );
    expect(fields.filter((k) => /current|selected|active/i.test(k))).toEqual(["activeId"]);
  });

  it("records the outgoing dashboard as previousId", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;

    useDashboardStore.getState().setActive(second);

    expect(useDashboardStore.getState().previousId).toBe(first);
  });

  it("does not record history when re-selecting the active dashboard", async () => {
    await useDashboardStore.getState().load();
    const only = useDashboardStore.getState().activeId!;
    useDashboardStore.getState().setActive(only);
    expect(useDashboardStore.getState().previousId).toBeNull();
  });

  it("resets activeTabId to the new dashboard's first tab", async () => {
    await useDashboardStore.getState().load();
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;
    const secondTab = useDashboardStore.getState().dashboards.find((d) => d.id === second)!.tabs[0].id;

    useDashboardStore.getState().setActive(second);

    expect(useDashboardStore.getState().activeTabId).toBe(secondTab);
  });
});

describe("tab CRUD (addTab / renameTab / removeTab / setActiveTab)", () => {
  it("adds a tab to the active dashboard and returns its id", async () => {
    await useDashboardStore.getState().load();
    const tabId = await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Second");
    expect(tabId).not.toBeNull();
    expect(useDashboardStore.getState().activeDashboard()!.tabs.map((t) => t.name)).toEqual([
      "Main",
      "Second",
    ]);
  });

  it("returns null and adds nothing when there is no active dashboard", async () => {
    expect(await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Orphan")).toBeNull();
  });

  it("does not switch to the new tab", async () => {
    await useDashboardStore.getState().load();
    const before = useDashboardStore.getState().activeTabId;
    await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Second");
    expect(useDashboardStore.getState().activeTabId).toBe(before);
  });

  it("activates the new tab when there was no active tab (the zero-tabs recovery path)", async () => {
    await useDashboardStore.getState().load();
    const onlyTab = useDashboardStore.getState().activeTabId!;
    await useDashboardStore.getState().removeTab(onlyTab);
    expect(useDashboardStore.getState().activeTabId).toBeNull();

    const newTabId = await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Recovered");

    expect(useDashboardStore.getState().activeTabId).toBe(newTabId);
  });

  it("renames a tab and persists it", async () => {
    await useDashboardStore.getState().load();
    const tabId = useDashboardStore.getState().activeTabId!;
    const dashboardId = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().renameTab(tabId, "Renamed");
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].name).toBe("Renamed");
    const persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted.tabs[0].name).toBe("Renamed");
  });

  it("switches the active tab", async () => {
    const { tabB } = await loadWithSecondTab();
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);
    expect(useDashboardStore.getState().activeTabId).toBe(tabB);
  });

  it("removes a tab and persists it", async () => {
    const { tabB } = await loadWithSecondTab();
    await useDashboardStore.getState().removeTab(tabB);
    expect(useDashboardStore.getState().activeDashboard()!.tabs.map((t) => t.id)).not.toContain(
      tabB,
    );
  });

  it("resets activeTabId to the first remaining tab only when the removed tab was active", async () => {
    const { tabA, tabB } = await loadWithSecondTab();
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);

    await useDashboardStore.getState().removeTab(tabB);

    expect(useDashboardStore.getState().activeTabId).toBe(tabA);
  });

  it("leaves activeTabId alone when the removed tab was not active", async () => {
    const { tabA, tabB } = await loadWithSecondTab();
    // tabA is active (the default after loadWithSecondTab).

    await useDashboardStore.getState().removeTab(tabB);

    expect(useDashboardStore.getState().activeTabId).toBe(tabA);
  });

  it("allows deleting the last tab, leaving activeTabId null", async () => {
    await useDashboardStore.getState().load();
    const onlyTab = useDashboardStore.getState().activeTabId!;
    await useDashboardStore.getState().removeTab(onlyTab);
    expect(useDashboardStore.getState().activeTabId).toBeNull();
    expect(useDashboardStore.getState().activeDashboard()!.tabs).toEqual([]);
  });
});

describe("addCard", () => {
  it("seeds params from the definition's default values, hidden ones included", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());

    const card = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];
    expect(card.params).toEqual({ symbol: "AAPL", provider: "yfinance" });
  });

  it("takes its size from gridData and stacks below existing cards on the same tab", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    await useDashboardStore.getState().addCard(widget({ id: "second" }));

    const [first, second] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    expect(first.layout).toEqual({ x: 0, y: 0, w: 20, h: 9 });
    expect(second.layout).toEqual({ x: 0, y: 9, w: 20, h: 9 });
  });

  it("stacks under only its own tab's cards, not another tab's", async () => {
    const { tabB } = await loadWithSecondTab();
    await useDashboardStore.getState().addCard(widget());
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);
    await useDashboardStore.getState().addCard(widget({ id: "second" }));

    const dashboard = useDashboardStore.getState().activeDashboard()!;
    const secondTabCard = dashboard.tabs.find((t) => t.id === tabB)!.cards[0];
    // Stacks at y=0, exactly as if it were the only card added anywhere —
    // not pushed below the first tab's card.
    expect(secondTabCard.layout).toEqual({ x: 0, y: 0, w: 20, h: 9 });
  });

  it("persists the card", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    const id = useDashboardStore.getState().activeId!;
    expect(JSON.parse(__read(`dashboards/${id}.json`) ?? "").tabs[0].cards).toHaveLength(1);
  });

  it("resolves to null and persists nothing when there is no active dashboard", async () => {
    await useDashboardStore.getState().load();
    const only = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().removeDashboard(only);
    saveSpy.mockClear();

    const before = useDashboardStore.getState().dashboards;
    const result = await useDashboardStore.getState().addCard(widget());

    expect(result).toBeNull();
    expect(useDashboardStore.getState().dashboards).toEqual(before);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("resolves to null when the active dashboard has no active tab", async () => {
    await useDashboardStore.getState().load();
    const onlyTab = useDashboardStore.getState().activeTabId!;
    await useDashboardStore.getState().removeTab(onlyTab);
    saveSpy.mockClear();

    expect(await useDashboardStore.getState().addCard(widget())).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("updateLayouts", () => {
  it("applies a multi-item move in exactly one write", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    await useDashboardStore.getState().addCard(widget({ id: "second" }));
    const cards = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    saveSpy.mockClear();

    await useDashboardStore.getState().updateLayouts([
      { i: cards[0].id, x: 5, y: 1, w: 10, h: 4 },
      { i: cards[1].id, x: 0, y: 6, w: 8, h: 3 },
    ]);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const updated = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    expect(updated[0].layout).toEqual({ x: 5, y: 1, w: 10, h: 4 });
    expect(updated[1].layout).toEqual({ x: 0, y: 6, w: 8, h: 3 });
  });

  it("ignores layout entries for cards that no longer exist", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    const cards = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;

    await useDashboardStore.getState().updateLayouts([
      { i: cards[0].id, x: 1, y: 1, w: 2, h: 2 },
      { i: "ghost", x: 9, y: 9, w: 1, h: 1 },
    ]);

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(1);
  });

  it("leaves a second tab's cards untouched", async () => {
    const { tabB } = await loadWithSecondTab();
    await useDashboardStore.getState().addCard(widget());
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);
    await useDashboardStore.getState().addCard(widget({ id: "second" }));
    const dashboard = useDashboardStore.getState().activeDashboard()!;
    const tabBCardBefore = { ...dashboard.tabs.find((t) => t.id === tabB)!.cards[0].layout };
    const tabACard = dashboard.tabs[0].cards[0];

    await useDashboardStore.getState().updateLayouts([{ i: tabACard.id, x: 9, y: 9, w: 1, h: 1 }]);

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs.find((t) => t.id === tabB)!.cards[0].layout).toEqual(tabBCardBefore);
  });
});

describe("removeCard", () => {
  it("removes the card and its position together, in one write", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    await useDashboardStore.getState().addCard(widget({ id: "second" }));
    const [first] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    saveSpy.mockClear();

    await useDashboardStore.getState().removeCard(first.id);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const remaining = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    expect(remaining).toHaveLength(1);
    expect(remaining.some((c) => c.id === first.id)).toBe(false);
  });

  it("leaves the remaining cards' positions untouched", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    await useDashboardStore.getState().addCard(widget({ id: "second" }));
    const [first, second] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    const before = { ...second.layout };

    await useDashboardStore.getState().removeCard(first.id);

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].layout).toEqual(
      before,
    );
  });

  it("survives a reload with the card still gone", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    await useDashboardStore.getState().removeCard(card.id);

    __resetJsonStoreForTests();
    useDashboardStore.setState({ dashboards: [], activeId: null });
    await useDashboardStore.getState().load();

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toEqual([]);
  });

  it("leaves a second tab untouched (object identity preserved) when the card is on a different tab", async () => {
    const { tabB } = await loadWithSecondTab();
    await useDashboardStore.getState().addCard(widget());
    const dashboardBefore = useDashboardStore.getState().activeDashboard()!;
    const tabBBefore = dashboardBefore.tabs.find((t) => t.id === tabB)!;
    const [card] = dashboardBefore.tabs[0].cards;

    await useDashboardStore.getState().removeCard(card.id);

    const tabBAfter = useDashboardStore.getState().activeDashboard()!.tabs.find((t) => t.id === tabB)!;
    expect(tabBAfter).toBe(tabBBefore);
  });

  it("retains the stored file until the pending removal is dismissed", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;

    await useDashboardStore.getState().removeCard(card.id);
    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);
    await useDashboardStore.getState().dismissCardRemoval();

    await expect(readLocalFile(stored)).rejects.toThrow(/ENOENT/);
  });

  it("deletes nothing for an ordinary card that happens to carry a file param", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore.getState().addCard(widget(), { file: stored });
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;

    await useDashboardStore.getState().removeCard(card.id);

    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("does not remove a card or its file from a viewer window", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    useDashboardStore.setState({ viewer: true });

    await useDashboardStore.getState().removeCard(card.id);

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(1);
    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("keeps a stored file another card still names, and deletes it with the last one", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });
    const originalId = useDashboardStore.getState().activeId!;
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    // duplicateDashboard copies params.file, so two cards name one file.
    const copyId = await useDashboardStore.getState().duplicateDashboard(originalId);
    const [copyCard] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;

    useDashboardStore.setState({ activeId: originalId });
    await useDashboardStore.getState().removeCard(card.id);

    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);

    useDashboardStore.setState({ activeId: copyId });
    await useDashboardStore.getState().removeCard(copyCard.id);
    await useDashboardStore.getState().dismissCardRemoval();

    await expect(readLocalFile(stored)).rejects.toThrow(/ENOENT/);
  });
});

describe("stored files a tab or a dashboard removal discards", () => {
  /** The seeded dashboard, with one local-table card reading `stored`. */
  async function withLocalCard(stored: string): Promise<void> {
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });
  }

  it("deletes the stored file of a local-table card whose tab is removed", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await withLocalCard(stored);
    const tabId = useDashboardStore.getState().activeTabId!;

    await useDashboardStore.getState().removeTab(tabId);

    await expect(readLocalFile(stored)).rejects.toThrow(/ENOENT/);
  });

  it("deletes the stored file of a local-table card whose dashboard is removed", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await withLocalCard(stored);
    const id = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().removeDashboard(id);

    await expect(readLocalFile(stored)).rejects.toThrow(/ENOENT/);
  });

  it("keeps a stored file a card on another dashboard still names", async () => {
    await useDashboardStore.getState().load();
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await withLocalCard(stored);
    const originalId = useDashboardStore.getState().activeId!;
    // duplicateDashboard copies params.file, so all three name the one file.
    const copyId = (await useDashboardStore.getState().duplicateDashboard(originalId))!;
    await useDashboardStore.getState().duplicateDashboard(originalId);

    useDashboardStore.setState({ activeId: originalId });
    const tabId = useDashboardStore.getState().activeDashboard()!.tabs[0].id;
    await useDashboardStore.getState().removeTab(tabId);

    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);

    await useDashboardStore.getState().removeDashboard(copyId);

    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("addCard placement", () => {
  it("stacks below everything already on the tab", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());

    await useDashboardStore.getState().addCard(widget({ id: "second" }));

    const [, second] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    expect(second.layout).toEqual({ x: 0, y: 9, w: 20, h: 9 });
  });
});

describe("dashboard CRUD", () => {
  it("seeds one default tab on creation", async () => {
    await useDashboardStore.getState().load();
    const id = await useDashboardStore.getState().addDashboard("Second");
    const created = useDashboardStore.getState().dashboards.find((d) => d.id === id)!;
    expect(created.tabs).toEqual([{ id: expect.any(String), name: "Main", cards: [] }]);
  });

  it("renames and persists", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().renameDashboard(id, "Renamed");
    expect(JSON.parse(__read(`dashboards/${id}.json`) ?? "").name).toBe("Renamed");
  });

  it("deletes the file and moves activeId to a survivor", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = await useDashboardStore.getState().addDashboard("Second");

    await useDashboardStore.getState().removeDashboard(first);

    expect(__read(`dashboards/${first}.json`)).toBeUndefined();
    expect(useDashboardStore.getState().activeId).toBe(second);
  });

  it("leaves activeId null when the last dashboard is deleted", async () => {
    await useDashboardStore.getState().load();
    const only = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().removeDashboard(only);
    expect(useDashboardStore.getState().activeId).toBeNull();
  });

  // Mirrors backendsStore.test.ts's __failPath regression tests: addDashboard,
  // renameDashboard, and removeDashboard must persist BEFORE mutating state,
  // so a failed write can never leave memory and disk diverged.

  it("rejects without adding the dashboard when the write fails", async () => {
    await useDashboardStore.getState().load();
    const before = useDashboardStore.getState().dashboards;
    __failPath("dashboards");

    await expect(useDashboardStore.getState().addDashboard("Second")).rejects.toThrow();

    expect(useDashboardStore.getState().dashboards).toEqual(before);
  });

  it("rejects without renaming the dashboard when the write fails", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const before = useDashboardStore.getState().dashboards;
    __failPath(`dashboards/${id}.json`);

    await expect(useDashboardStore.getState().renameDashboard(id, "Renamed")).rejects.toThrow();

    expect(useDashboardStore.getState().dashboards).toEqual(before);
  });

  it("rejects without removing the dashboard when the write fails", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const before = useDashboardStore.getState().dashboards;
    __failPath(`dashboards/${id}.json`);

    await expect(useDashboardStore.getState().removeDashboard(id)).rejects.toThrow();

    expect(useDashboardStore.getState().dashboards).toEqual(before);
    expect(useDashboardStore.getState().activeId).toBe(id);
  });

  it("resets activeTabId to the survivor's first tab when the active dashboard is deleted", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;
    const secondTab = useDashboardStore
      .getState()
      .dashboards.find((d) => d.id === second)!.tabs[0].id;
    useDashboardStore.getState().setActive(second);

    await useDashboardStore.getState().removeDashboard(second);

    expect(useDashboardStore.getState().activeId).toBe(first);
    expect(useDashboardStore.getState().activeTabId).not.toBe(secondTab);
    expect(useDashboardStore.getState().activeTabId).toBe(
      useDashboardStore.getState().dashboards.find((d) => d.id === first)!.tabs[0].id,
    );
  });

  it("leaves activeTabId alone when the deleted dashboard was not active", async () => {
    await useDashboardStore.getState().load();
    const only = useDashboardStore.getState().activeId!;
    const activeTabBefore = useDashboardStore.getState().activeTabId;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;

    await useDashboardStore.getState().removeDashboard(second);

    expect(useDashboardStore.getState().activeId).toBe(only);
    expect(useDashboardStore.getState().activeTabId).toBe(activeTabBefore);
  });
});

describe("addCardTo", () => {
  it("adds to the named dashboard's named tab, not the active one", async () => {
    await useDashboardStore.getState().load();
    const store = useDashboardStore.getState();
    const other = await store.addDashboard("Other");
    const otherTabId = useDashboardStore.getState().dashboards.find((d) => d.id === other)!.tabs[0]
      .id;
    const activeBefore = useDashboardStore.getState().activeId;

    const cardId = await useDashboardStore.getState().addCardTo(other, otherTabId, widget());

    expect(cardId).not.toBeNull();
    const target = useDashboardStore.getState().dashboards.find((d) => d.id === other);
    expect(target?.tabs[0].cards).toHaveLength(1);
    // It must not have touched the active dashboard, nor switched to the target.
    const active = useDashboardStore.getState().dashboards.find((d) => d.id === activeBefore);
    expect(active?.tabs[0].cards).toHaveLength(0);
    expect(useDashboardStore.getState().activeId).toBe(activeBefore);
  });

  it("returns null for a dashboard id that names no dashboard", async () => {
    expect(await useDashboardStore.getState().addCardTo("nope", "any", widget())).toBeNull();
  });

  it("returns null for a tab id that names no tab on that dashboard", async () => {
    await useDashboardStore.getState().load();
    const dashboardId = useDashboardStore.getState().activeId!;
    expect(await useDashboardStore.getState().addCardTo(dashboardId, "nope", widget())).toBeNull();
  });

  it("returns null rather than throwing when there is no active dashboard", async () => {
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    expect(await useDashboardStore.getState().addCard(widget())).toBeNull();
  });

  it("merges a params override on top of the widget's seeded defaults", async () => {
    await useDashboardStore.getState().load();
    const dashboardId = useDashboardStore.getState().activeId!;
    const tabId = useDashboardStore.getState().activeTabId!;
    const cardId = await useDashboardStore
      .getState()
      .addCardTo(dashboardId, tabId, widget(), { symbol: "MSFT" });
    const card = useDashboardStore
      .getState()
      .dashboards.find((d) => d.id === dashboardId)
      ?.tabs.find((t) => t.id === tabId)
      ?.cards.find((c) => c.id === cardId);
    expect(card?.params.symbol).toBe("MSFT");
    expect(card?.params.provider).toBe("yfinance");
  });
});

describe("load with a dashboard order", () => {
  async function seedThree() {
    await useDashboardStore.getState().addDashboard("Charlie");
    await useDashboardStore.getState().addDashboard("Alpha");
    await useDashboardStore.getState().addDashboard("Bravo");
  }

  it("sorts dashboards by the given order, ignoring today's alphabetical default", async () => {
    // No leading load() here: on an empty mock filesystem, load() itself
    // auto-seeds and persists a default "Main" dashboard (readOrSeed() in
    // dashboardsFile.ts, unrelated to this task) that would otherwise
    // contaminate the exact-array assertions below with a 4th, unlisted
    // dashboard. addDashboard() already persists each seeded dashboard to
    // disk on its own, so the directory is never empty when load(order)
    // reads it at the end of the test.
    await seedThree();
    const byName = (name: string) => useDashboardStore.getState().dashboards.find((d) => d.name === name)!.id;
    const order = [byName("Bravo"), byName("Charlie"), byName("Alpha")];

    await useDashboardStore.getState().load(order);

    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(order);
  });

  it("appends a dashboard missing from the order to the end, in alphabetical order among the unlisted ones", async () => {
    await seedThree();
    const byName = (name: string) => useDashboardStore.getState().dashboards.find((d) => d.name === name)!.id;
    const order = [byName("Bravo")];

    await useDashboardStore.getState().load(order);

    const names = useDashboardStore.getState().dashboards.map((d) => d.name);
    expect(names).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("activates the first dashboard in the given order, not the alphabetically-first one", async () => {
    await seedThree();
    const byName = (name: string) => useDashboardStore.getState().dashboards.find((d) => d.name === name)!.id;
    const order = [byName("Charlie"), byName("Alpha"), byName("Bravo")];

    await useDashboardStore.getState().load(order);

    expect(useDashboardStore.getState().activeId).toBe(byName("Charlie"));
  });

  it("falls back to alphabetical order entirely when no order is given", async () => {
    await seedThree();

    await useDashboardStore.getState().load();

    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });
});

describe("reorderDashboards", () => {
  // No leading load() in this describe block: on an empty mock filesystem,
  // load() auto-seeds and persists a default "Main" dashboard (readOrSeed()
  // in dashboardsFile.ts) that would otherwise contaminate these exact-array
  // assertions with an extra, unlisted dashboard — addDashboard() works fine
  // standalone and doesn't need a preceding load().
  it("reorders the in-memory dashboards array to match the given id order", async () => {
    const a = (await useDashboardStore.getState().addDashboard("A"))!;
    const b = (await useDashboardStore.getState().addDashboard("B"))!;
    const c = (await useDashboardStore.getState().addDashboard("C"))!;

    useDashboardStore.getState().reorderDashboards([c, a, b]);

    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual([c, a, b]);
  });

  it("drops any id in the given order that names no loaded dashboard", async () => {
    const a = (await useDashboardStore.getState().addDashboard("A"))!;

    useDashboardStore.getState().reorderDashboards(["not-a-real-id", a]);

    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual([a]);
  });

  it("appends a loaded dashboard whose id is missing from the given order, instead of dropping it", async () => {
    const a = (await useDashboardStore.getState().addDashboard("A"))!;
    const b = (await useDashboardStore.getState().addDashboard("B"))!;
    const c = (await useDashboardStore.getState().addDashboard("C"))!;

    useDashboardStore.getState().reorderDashboards([c, a]);

    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual([c, a, b]);
  });
});

describe("mutateActive (deliberate optimistic-write asymmetry)", () => {
  it("updates in-memory state even when the write rejects, unlike the dashboard CRUD above", async () => {
    // addCard/removeCard/updateLayouts go through mutateActive, which sets()
    // BEFORE persisting (see the comment on mutateDashboard) — the opposite
    // order from addDashboard/renameDashboard/removeDashboard. This is
    // intentional: updateLayouts fires on drag-release, and persisting first
    // would hold the grid in its pre-drop position until the write settled.
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    __failPath(`dashboards/${id}.json`);

    await expect(useDashboardStore.getState().addCard(widget())).rejects.toThrow();

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(1);
  });
});

describe("applyCardParams", () => {
  async function seedOneCard() {
    await useDashboardStore.getState().load();
    const id = await useDashboardStore.getState().addCard(widget());
    saveSpy.mockClear();
    return id as string;
  }

  /** A dashboard with a group ("g1") that the seeded card belongs to. */
  async function seedCardWithGroup() {
    const cardId = await seedOneCard();
    const active = useDashboardStore.getState().activeDashboard()!;
    useDashboardStore.setState({
      dashboards: useDashboardStore.getState().dashboards.map((d) =>
        d.id === active.id
          ? {
              ...d,
              groups: [
                { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
              ],
              tabs: d.tabs.map((t) => ({
                ...t,
                cards: t.cards.map((c) =>
                  c.id === cardId
                    ? { ...c, bindings: [{ groupId: "g1", paramName: "symbol" }] }
                    : c,
                ),
              })),
            }
          : d,
      ),
    });
    saveSpy.mockClear();
    return cardId;
  }

  it("writes the card params and the group value in a single save", async () => {
    const cardId = await seedCardWithGroup();

    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "AAPL", interval: "1h" },
      groupEdits: [{ groupId: "g1", value: "TSLA" }],
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.params.interval).toBe("1h");
    expect(after.groups!.find((g) => g.id === "g1")!.value).toBe("TSLA");
  });

  it("leaves a group untouched when groupEdits is empty", async () => {
    const cardId = await seedOneCard();
    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [],
    });
    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.params).toEqual({ symbol: "NVDA" });
  });

  it("makes no write at all for an unknown card id with no group edits to apply", async () => {
    await seedOneCard();
    await useDashboardStore.getState().applyCardParams("nope", {
      cardParams: { symbol: "X" },
      groupEdits: [],
    });
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("still writes group edits for an unknown card id when the named group exists", async () => {
    const cardId = await seedCardWithGroup();
    await useDashboardStore.getState().applyCardParams("nope", {
      cardParams: { symbol: "X" },
      groupEdits: [{ groupId: "g1", value: "TSLA" }],
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.groups!.find((g) => g.id === "g1")!.value).toBe("TSLA");
    // The seeded card is unrelated to "nope" and must be untouched.
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.params.symbol).toBe("AAPL");
  });

  it("does not add a groups key to persisted JSON when the dashboard never had one", async () => {
    const cardId = await seedOneCard();
    const dashboardId = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [],
    });

    const persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted).not.toHaveProperty("groups");
  });

  it("leaves the groups array identity unchanged when groupEdits is empty", async () => {
    const cardId = await seedCardWithGroup();
    const before = useDashboardStore.getState().activeDashboard()!.groups;

    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [],
    });

    const after = useDashboardStore.getState().activeDashboard()!.groups;
    expect(after).toBe(before);
  });

  it("leaves the groups array identity unchanged when groupEdits names a group not on this dashboard", async () => {
    const cardId = await seedCardWithGroup();
    const before = useDashboardStore.getState().activeDashboard()!.groups;

    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [{ groupId: "not-on-this-dashboard", value: "TSLA" }],
    });

    const after = useDashboardStore.getState().activeDashboard()!.groups;
    expect(after).toBe(before);
  });

  it("produces a new groups array when a group on this dashboard actually changes", async () => {
    const cardId = await seedCardWithGroup();
    const before = useDashboardStore.getState().activeDashboard()!.groups;

    await useDashboardStore.getState().applyCardParams(cardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [{ groupId: "g1", value: "TSLA" }],
    });

    const after = useDashboardStore.getState().activeDashboard()!.groups;
    expect(after).not.toBe(before);
    expect(after!.find((g) => g.id === "g1")!.value).toBe("TSLA");
  });

  it("leaves a second tab's own card untouched when applying params on the first tab", async () => {
    const { tabB } = await loadWithSecondTab();
    await useDashboardStore.getState().addCard(widget());
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);
    const secondTabCardId = (await useDashboardStore.getState().addCard(widget({ id: "second" })))!;
    const tabBCardBefore = useDashboardStore
      .getState()
      .activeDashboard()!
      .tabs.find((t) => t.id === tabB)!.cards[0];
    const firstTabCardId = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].id;

    await useDashboardStore.getState().applyCardParams(firstTabCardId, {
      cardParams: { symbol: "NVDA" },
      groupEdits: [],
    });

    const tabBCardAfter = useDashboardStore
      .getState()
      .activeDashboard()!
      .tabs.find((t) => t.id === tabB)!.cards[0];
    expect(tabBCardAfter).toBe(tabBCardBefore);
    expect(tabBCardAfter.id).toBe(secondTabCardId);
  });

  describe("group actions", () => {
    it("createGroup appends a numbered group of the control's type and binds the creating param", async () => {
      const cardId = await seedOneCard();
      const id = await useDashboardStore.getState().createGroup(cardId, "symbol", "symbol", "AAPL");
      const d = useDashboardStore.getState().activeDashboard()!;
      expect(d.groups).toEqual([
        { id, name: "Group 1", paramName: "symbol", groupType: "symbol", value: "AAPL" },
      ]);
      expect(d.tabs[0].cards.find((c) => c.id === cardId)!.bindings).toEqual([
        { groupId: id, paramName: "symbol" },
      ]);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it("joinGroup replaces an existing binding for the same param, leaving the card's value alone", async () => {
      const cardId = await seedCardWithGroup();
      const store = useDashboardStore.getState();
      const g2 = await store.createGroup(cardId, "interval", "interval", "1d");
      // A second symbol group, joined from a card that is already in g1.
      const other = await seedOneCard();
      const g3 = await useDashboardStore.getState().createGroup(other, "symbol", "symbol", "F");
      await useDashboardStore.getState().joinGroup(g3!, cardId, "symbol");
      const card = useDashboardStore
        .getState()
        .activeDashboard()!
        .tabs[0].cards.find((c) => c.id === cardId)!;
      expect(card.bindings).toEqual([
        { groupId: g2, paramName: "interval" },
        { groupId: g3, paramName: "symbol" },
      ]);
      expect(card.params.symbol).toBe("AAPL");
    });

    it("leaveGroup drops the binding and writes the group's value onto the card so the control does not snap", async () => {
      const cardId = await seedCardWithGroup();
      await useDashboardStore.getState().leaveGroup(cardId, "symbol");
      const card = useDashboardStore
        .getState()
        .activeDashboard()!
        .tabs[0].cards.find((c) => c.id === cardId)!;
      expect(card.bindings).toBeUndefined();
      expect(card.params.symbol).toBe("MSFT");
    });

    it("renameGroup changes the name and nothing else", async () => {
      await seedCardWithGroup();
      await useDashboardStore.getState().renameGroup(useDashboardStore.getState().activeId!, "g1", "Watchlist");
      const g = useDashboardStore.getState().activeDashboard()!.groups![0];
      expect(g).toEqual({ id: "g1", name: "Watchlist", paramName: "symbol", groupType: "symbol", value: "MSFT" });
    });

    it("deleteGroup removes the group and every binding to it, writing the value onto each member", async () => {
      const cardId = await seedCardWithGroup();
      await useDashboardStore.getState().deleteGroup(useDashboardStore.getState().activeId!, "g1");
      const d = useDashboardStore.getState().activeDashboard()!;
      expect(d.groups).toEqual([]);
      const card = d.tabs[0].cards.find((c) => c.id === cardId)!;
      expect(card.bindings).toBeUndefined();
      expect(card.params.symbol).toBe("MSFT");
    });

    it("deleteGroup hands the value back on EVERY param a card bound to it", async () => {
      // Two of one card's params in one group — what an imported file can
      // carry. Unbinding only the first would leave the second dangling at a
      // group that no longer exists.
      const cardId = await seedCardWithGroup();
      const active = useDashboardStore.getState().activeDashboard()!;
      useDashboardStore.setState({
        dashboards: useDashboardStore.getState().dashboards.map((d) =>
          d.id === active.id
            ? {
                ...d,
                tabs: d.tabs.map((t) => ({
                  ...t,
                  cards: t.cards.map((c) =>
                    c.id === cardId
                      ? {
                          ...c,
                          bindings: [
                            { groupId: "g1", paramName: "symbol" },
                            { groupId: "g1", paramName: "ticker" },
                          ],
                        }
                      : c,
                  ),
                })),
              }
            : d,
        ),
      });

      await useDashboardStore.getState().deleteGroup(useDashboardStore.getState().activeId!, "g1");

      const card = useDashboardStore
        .getState()
        .activeDashboard()!
        .tabs[0].cards.find((c) => c.id === cardId)!;
      expect(card.bindings).toBeUndefined();
      expect(card.params.symbol).toBe("MSFT");
      expect(card.params.ticker).toBe("MSFT");
    });

    it("refuses every group action in the viewer window", async () => {
      const cardId = await seedCardWithGroup();
      useDashboardStore.setState({ viewer: true });
      expect(await useDashboardStore.getState().createGroup(cardId, "interval", "interval", "1d")).toBeNull();
      await useDashboardStore.getState().deleteGroup(useDashboardStore.getState().activeId!, "g1");
      expect(useDashboardStore.getState().activeDashboard()!.groups).toHaveLength(1);
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});

describe("patchCardField: table", () => {
  it("a reset (null) also clears the worker definition's copy of the table state, keeping its model", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const pinned = { pinned: { sector: "right" as const } };
    useDashboardStore.setState((s) => ({ dashboards: s.dashboards.map((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, cards: t.cards.map((c) => c.id === cardId ? { ...c, table: pinned, tableDefinition: { table: pinned, search: "x" } } : c) })) })) }));

    await useDashboardStore.getState().patchCardField(cardId, "table", null);

    const card = useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(card).not.toHaveProperty("table");
    expect(card.tableDefinition).toEqual({ table: {}, search: "x" });
  });
});

describe("patchCardField: view", () => {
  it("persists the chosen view onto the card", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "view", "raw");

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.view).toBe("raw");
  });

  it("clears the view field, rather than asserting table, when toggled back with null", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const dashboardId = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().patchCardField(cardId, "view", "raw");
    await useDashboardStore.getState().patchCardField(cardId, "view", null);

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)).not.toHaveProperty("view");

    const persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    const persistedCard = persisted.tabs[0].cards.find((c: { id: string }) => c.id === cardId);
    expect(persistedCard).not.toHaveProperty("view");
  });
});

describe("setCardMinimized", () => {
  it("persists the minimized flag onto the card", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().setCardMinimized(cardId, true);

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.minimized).toBe(true);
  });

  it("persists false as well as true, not just presence/absence", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().setCardMinimized(cardId, true);
    await useDashboardStore.getState().setCardMinimized(cardId, false);

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards.find((c) => c.id === cardId)!.minimized).toBe(false);
  });
});

describe("clearManagedSource", () => {
  it("clears the source on the card's own dashboard, not the active one", async () => {
    await useDashboardStore.getState().load();
    const other = await useDashboardStore.getState().addDashboard("Other");
    const otherTabId = useDashboardStore.getState().dashboards.find((d) => d.id === other)!.tabs[0].id;
    const cardId = (await useDashboardStore.getState().addCardTo(other, otherTabId, widget())) as string;
    await useDashboardStore.getState().patchCardField(cardId, "managedSource", { sourceId: "s1", kind: "upload", version: 1 });
    const owned = () => useDashboardStore.getState().dashboards.find((d) => d.id === other)!.tabs[0].cards[0];
    expect(owned().managedSource?.sourceId).toBe("s1");
    expect(useDashboardStore.getState().activeId).not.toBe(other);

    await useDashboardStore.getState().clearManagedSource(cardId, owned().backendId, "s1");

    expect(owned()).not.toHaveProperty("managedSource");
  });
});

describe("refreshAll", () => {
  it("starts at epoch 0 and bumps by one per call", () => {
    expect(useDashboardStore.getState().refreshEpoch).toBe(0);

    useDashboardStore.getState().refreshAll();
    expect(useDashboardStore.getState().refreshEpoch).toBe(1);

    useDashboardStore.getState().refreshAll();
    expect(useDashboardStore.getState().refreshEpoch).toBe(2);
  });

  it("writes nothing to disk — the epoch is a signal, not persisted state", async () => {
    const before = __list();
    useDashboardStore.getState().refreshAll();
    // Give an accidental save a chance to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__list()).toEqual(before);
  });
});

describe("setGroupsDisabled", () => {
  it("persists the flag onto the dashboard and survives a reload", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().setGroupsDisabled(id, true);
    expect(useDashboardStore.getState().activeDashboard()!.groupsDisabled).toBe(true);

    // The real gate: dashboardsFile.withDefaults rebuilds the object field by
    // field, so a new field is dropped on read unless it is carried across.
    __resetJsonStoreForTests();
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await useDashboardStore.getState().load();
    expect(useDashboardStore.getState().activeDashboard()!.groupsDisabled).toBe(true);
  });

  it("toggles back off", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().setGroupsDisabled(id, true);
    await useDashboardStore.getState().setGroupsDisabled(id, false);

    expect(useDashboardStore.getState().activeDashboard()!.groupsDisabled).toBe(false);
  });
});

describe("duplicateDashboard", () => {
  it("copies the tabs and cards with fresh ids, names it '<name> copy', and activates it", async () => {
    await useDashboardStore.getState().load();
    const sourceId = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().renameDashboard(sourceId, "Macro");
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    const copyId = (await useDashboardStore.getState().duplicateDashboard(sourceId)) as string;

    const copy = useDashboardStore.getState().dashboards.find((d) => d.id === copyId)!;
    expect(copy.name).toBe("Macro copy");
    expect(copyId).not.toBe(sourceId);
    expect(copy.tabs).toHaveLength(1);
    expect(copy.tabs[0].id).not.toBe(useDashboardStore.getState().dashboards[0].tabs[0].id);
    expect(copy.tabs[0].cards).toHaveLength(1);
    expect(copy.tabs[0].cards[0].id).not.toBe(cardId);
    expect(copy.tabs[0].cards[0].widgetId).toBe("price_history");
    expect(useDashboardStore.getState().activeId).toBe(copyId);
    expect(useDashboardStore.getState().activeTabId).toBe(copy.tabs[0].id);
  });

  it("inserts the copy directly after the original", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const last = await useDashboardStore.getState().addDashboard("Zulu");

    const copyId = (await useDashboardStore.getState().duplicateDashboard(first)) as string;

    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual([first, copyId, last]);
  });

  it("remaps group ids so the copy's cards point at the COPY's groups", async () => {
    await useDashboardStore.getState().load();
    const sourceId = useDashboardStore.getState().activeId!;
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    // Groups have no creation UI yet, so write one straight onto the stored
    // dashboard the way an apps.json import will.
    useDashboardStore.setState({
      dashboards: useDashboardStore.getState().dashboards.map((d) =>
        d.id === sourceId
          ? {
              ...d,
              groups: [
                { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
              ],
              tabs: d.tabs.map((t) => ({
                ...t,
                cards: t.cards.map((c) =>
                  c.id === cardId
                    ? { ...c, bindings: [{ groupId: "g1", paramName: "symbol" }] }
                    : c,
                ),
              })),
            }
          : d,
      ),
    });
    const copyId = (await useDashboardStore.getState().duplicateDashboard(sourceId)) as string;

    const copy = useDashboardStore.getState().dashboards.find((d) => d.id === copyId)!;
    const newGroupId = copy.groups![0].id;
    expect(newGroupId).not.toBe("g1");
    expect(copy.groups![0]).toEqual({
      id: newGroupId,
      name: "Ticker",
      paramName: "symbol",
      groupType: "symbol",
      value: "MSFT",
    });
    expect(copy.tabs[0].cards[0].bindings).toEqual([{ groupId: newGroupId, paramName: "symbol" }]);
  });

  it("carries groupsDisabled across", async () => {
    await useDashboardStore.getState().load();
    const sourceId = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().setGroupsDisabled(sourceId, true);

    const copyId = (await useDashboardStore.getState().duplicateDashboard(sourceId)) as string;

    expect(
      useDashboardStore.getState().dashboards.find((d) => d.id === copyId)!.groupsDisabled,
    ).toBe(true);
  });

  it("keeps changes that land while its own save is still in flight", async () => {
    await useDashboardStore.getState().load();
    const sourceId = useDashboardStore.getState().activeId!;
    const otherId = (await useDashboardStore.getState().addDashboard("Other"))!;
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    // duplicateDashboard reads `dashboards` BEFORE awaiting its write. Hold
    // that write open and land two other changes while it is pending: if the
    // pre-await snapshot is spliced back afterwards, both are silently
    // reverted. applyCardParams is active-dashboard-scoped, so the card edit
    // goes to the source (still active); the rename covers another dashboard.
    let release!: () => void;
    saveSpy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    const duplicating = useDashboardStore.getState().duplicateDashboard(sourceId);
    await useDashboardStore
      .getState()
      .applyCardParams(cardId, { cardParams: { symbol: "MSFT" }, groupEdits: [] });
    await useDashboardStore.getState().renameDashboard(otherId, "Renamed");
    release();
    const copyId = (await duplicating) as string;

    const after = useDashboardStore.getState().dashboards;
    expect(after.map((d) => d.id)).toEqual([sourceId, copyId, otherId]);
    expect(after.find((d) => d.id === sourceId)!.tabs[0].cards[0].params.symbol).toBe("MSFT");
    expect(after.find((d) => d.id === otherId)!.name).toBe("Renamed");
  });

  it("keeps a card edit that lands while a rename's write is pending, in memory and on disk", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    let release!: () => void;
    saveSpy.mockImplementationOnce(() => new Promise<void>((resolve) => { release = () => resolve(); }));

    const renaming = useDashboardStore.getState().renameDashboard(id, "Renamed");
    // The edit publishes at once; its write queues behind the blocked one, so it is awaited after release.
    const editing = useDashboardStore.getState().applyCardParams(cardId, { cardParams: { symbol: "MSFT" }, groupEdits: [] });
    await Promise.resolve();
    release();
    await Promise.all([renaming, editing]);

    const now = useDashboardStore.getState().dashboards.find((d) => d.id === id)!;
    expect(now.name).toBe("Renamed");
    expect(now.tabs[0].cards[0].params.symbol).toBe("MSFT");
    const disk = JSON.parse(__read(`dashboards/${id}.json`)!) as Dashboard;
    expect(disk.name).toBe("Renamed");
    expect(disk.tabs[0].cards[0].params.symbol).toBe("MSFT");
  });

  it("does not revert a card edit that lands while a sync's write is pending", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const synced = { ...useDashboardStore.getState().dashboards.find((d) => d.id === id)!, name: "From server" };
    let release!: () => void;
    saveSpy.mockImplementationOnce(() => new Promise<void>((resolve) => { release = () => resolve(); }));

    const applying = useDashboardStore.getState().applySynced([synced], []);
    // The edit publishes at once; its write queues behind the blocked one, so it is awaited after release.
    const editing = useDashboardStore.getState().applyCardParams(cardId, { cardParams: { symbol: "MSFT" }, groupEdits: [] });
    await Promise.resolve();
    release();
    await Promise.all([applying, editing]);

    expect(useDashboardStore.getState().dashboards.find((d) => d.id === id)!.tabs[0].cards[0].params.symbol).toBe("MSFT");
  });

  it("writes the copy to its own file", async () => {
    await useDashboardStore.getState().load();
    const sourceId = useDashboardStore.getState().activeId!;

    const copyId = (await useDashboardStore.getState().duplicateDashboard(sourceId)) as string;

    expect(__list()).toContain(`dashboards/${copyId}.json`);
  });

  it("returns null for an unknown id and writes nothing", async () => {
    await useDashboardStore.getState().load();
    saveSpy.mockClear();

    expect(await useDashboardStore.getState().duplicateDashboard("gone")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("viewer mode", () => {
  it("refuses every dashboard-level write and logs which action was refused", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    expect(await useDashboardStore.getState().addDashboard("New")).toBeNull();
    await useDashboardStore.getState().renameDashboard(id, "Renamed");
    await useDashboardStore.getState().removeDashboard(id);
    expect(await useDashboardStore.getState().duplicateDashboard(id)).toBeNull();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Main"]);
    await vi.waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("viewer window refused addDashboard");
      expect(log).toContain("viewer window refused renameDashboard");
      expect(log).toContain("viewer window refused removeDashboard");
      expect(log).toContain("viewer window refused duplicateDashboard");
      // A refusal is expected behaviour in the viewer, not a fault: tagging it
      // ERROR would put routine noise in front of whoever triages the log.
      expect(log).not.toMatch(/ERROR viewer window/);
    });
  });

  it("applies a card-level change in memory but never writes it", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    // Params and the view toggle stay usable in the viewer window — that is
    // the design's explicit requirement — so the change must land in memory.
    await useDashboardStore
      .getState()
      .applyCardParams(cardId, { cardParams: { symbol: "MSFT" }, groupEdits: [] });
    await useDashboardStore.getState().patchCardField(cardId, "view", "raw");

    const after = useDashboardStore.getState().activeDashboard()!;
    expect(after.tabs[0].cards[0].params.symbol).toBe("MSFT");
    expect(after.tabs[0].cards[0].view).toBe("raw");
    expect(saveSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(__read("logs/bdobb.log") ?? "").toContain("viewer window did not persist");
    });
    expect(__read("logs/bdobb.log") ?? "").not.toMatch(/ERROR viewer window/);
  });

  it("leaves the file on disk exactly as it was", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const before = __read(`dashboards/${id}.json`);
    useDashboardStore.setState({ viewer: true });

    await useDashboardStore.getState().addCard(widget());
    await useDashboardStore.getState().renameDashboard(id, "Renamed");

    expect(__read(`dashboards/${id}.json`)).toBe(before);
  });
});

/**
 * Spec §5: an imported card that no backend served resolves itself through
 * the registry's `find`, and "the store rewrites the card's backendId on the
 * next save of that dashboard". Without the rewrite, "the first backend
 * serving the id" is recomputed every session and can flip between two
 * backends that both serve it.
 */
describe("pinning an unresolved card's backend on the next save", () => {
  /** One card whose widget no connected backend served at import time. */
  async function loadUnresolved(): Promise<string> {
    __seed(
      "dashboards/d1.json",
      JSON.stringify({
        id: "d1",
        name: "Imported",
        tabs: [
          {
            id: "t1",
            name: "Main",
            cards: [
              {
                id: "c1",
                widgetId: "price_history",
                backendId: UNRESOLVED_BACKEND_ID,
                params: {},
                layout: { x: 0, y: 0, w: 20, h: 9 },
              },
            ],
          },
        ],
      }),
    );
    await useDashboardStore.getState().load();
    return "c1";
  }

  afterEach(() => {
    useWidgetRegistryStore.setState({ widgets: [] });
  });

  it("writes the resolved backendId to disk and to memory", async () => {
    const cardId = await loadUnresolved();
    useWidgetRegistryStore.setState({ widgets: [widget({ backendId: "b7" })] });

    await useDashboardStore.getState().updateLayouts([{ i: cardId, x: 1, y: 1, w: 2, h: 2 }]);

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].backendId).toBe("b7");
    const written = JSON.parse(__read("dashboards/d1.json") ?? "{}");
    expect(written.tabs[0].cards[0].backendId).toBe("b7");
  });

  it("leaves the sentinel in place while nothing serves the id", async () => {
    const cardId = await loadUnresolved();
    useWidgetRegistryStore.setState({ widgets: [widget({ id: "something_else" })] });

    await useDashboardStore.getState().updateLayouts([{ i: cardId, x: 1, y: 1, w: 2, h: 2 }]);

    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].backendId).toBe(
      UNRESOLVED_BACKEND_ID,
    );
  });

  it("does not write the pin from the viewer window", async () => {
    const cardId = await loadUnresolved();
    useWidgetRegistryStore.setState({ widgets: [widget({ backendId: "b7" })] });
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    await useDashboardStore.getState().updateLayouts([{ i: cardId, x: 1, y: 1, w: 2, h: 2 }]);

    expect(saveSpy).not.toHaveBeenCalled();
    const written = JSON.parse(__read("dashboards/d1.json") ?? "{}");
    expect(written.tabs[0].cards[0].backendId).toBe(UNRESOLVED_BACKEND_ID);
  });
});

describe("importDashboards", () => {
  const imported = (id: string, name: string): Dashboard => ({
    id,
    name,
    tabs: [{ id: `${id}-t1`, name: "Main", cards: [] }],
  });

  it("writes each dashboard, appends them, and activates the first", async () => {
    await useDashboardStore.getState().load();
    const existing = useDashboardStore.getState().activeId!;
    saveSpy.mockClear();

    await useDashboardStore.getState().importDashboards([imported("i1", "One"), imported("i2", "Two")]);

    expect(saveSpy).toHaveBeenCalledTimes(2);
    const state = useDashboardStore.getState();
    expect(state.dashboards.map((d) => d.name)).toEqual(["Main", "One", "Two"]);
    expect(state.activeId).toBe("i1");
    expect(state.previousId).toBe(existing);
    expect(state.activeTabId).toBe("i1-t1");
    expect(__read("dashboards/i2.json")).toBeDefined();
  });

  // A write failing part-way used to leave the dashboards already written on
  // disk but absent from memory, so a retry imported them a second time.
  it("publishes the dashboards already written when a later write fails", async () => {
    await useDashboardStore.getState().load();
    __failPath("dashboards/i2.json");

    await expect(
      useDashboardStore
        .getState()
        .importDashboards([imported("i1", "One"), imported("i2", "Two"), imported("i3", "Three")]),
    ).rejects.toThrow();

    const state = useDashboardStore.getState();
    expect(__read("dashboards/i1.json")).toBeDefined();
    expect(state.dashboards.map((d) => d.name)).toEqual(["Main", "One"]);
    expect(state.activeId).toBe("i1");
  });

  it("does nothing at all when the file held no app", async () => {
    await useDashboardStore.getState().load();
    const before = useDashboardStore.getState().activeId;
    saveSpy.mockClear();

    await useDashboardStore.getState().importDashboards([]);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toHaveLength(1);
    expect(useDashboardStore.getState().activeId).toBe(before);
  });

  it("is refused in the viewer window", async () => {
    await useDashboardStore.getState().load();
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    await useDashboardStore.getState().importDashboards([imported("i1", "One")]);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toHaveLength(1);
  });

  it("refuses more dashboards than the cap, without writing any of them", async () => {
    await useDashboardStore.getState().load();
    saveSpy.mockClear();
    const tooMany = Array.from({ length: 501 }, (_, i) => imported(`i${i}`, `D${i}`));

    await useDashboardStore.getState().importDashboards(tooMany);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toHaveLength(1);
    // Logged, not shown: the rail already showed the user a notice, and this
    // guard exists for a caller that has no notice to show.
    expect(__read("logs/bdobb.log") ?? "").toContain("refused an import of 501 dashboards");
  });

  it("accepts exactly the cap", async () => {
    await useDashboardStore.getState().load();
    saveSpy.mockClear();
    const atCap = Array.from({ length: 500 }, (_, i) => imported(`i${i}`, `D${i}`));

    await useDashboardStore.getState().importDashboards(atCap);

    expect(saveSpy).toHaveBeenCalledTimes(500);
    expect(useDashboardStore.getState().dashboards).toHaveLength(501);
  });
});

// maximizedCardId names a card on the active dashboard; every path that
// leaves that dashboard has to clear it, as setActive does, or it dangles.
describe("maximizedCardId across a dashboard switch by removal, duplicate or import", () => {
  it("clears it when the active dashboard is removed", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    useDashboardStore.setState({ maximizedCardId: "c-gone" });
    await useDashboardStore.getState().removeDashboard(id);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("clears it when a duplicate becomes the active dashboard", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    useDashboardStore.setState({ maximizedCardId: "c1" });
    await useDashboardStore.getState().duplicateDashboard(id);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("clears it when an import activates its first dashboard", async () => {
    await useDashboardStore.getState().load();
    useDashboardStore.setState({ maximizedCardId: "c1" });
    await useDashboardStore
      .getState()
      .importDashboards([{ id: "i1", name: "One", tabs: [{ id: "i1-t1", name: "Main", cards: [] }] }]);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });
});

describe("removeDashboard racing a card write", () => {
  // The delete is awaited before the dashboard leaves memory, so a card
  // change landing in that window found it still there and queued a save
  // behind the delete: the file came back, and the dashboard with it on the
  // next launch.
  it("does not let a card change made during the delete write the file back", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    const removing = useDashboardStore.getState().removeDashboard(id);
    await useDashboardStore.getState().patchCardField(cardId, "title", "Late");
    await removing;

    expect(__read(`dashboards/${id}.json`)).toBeUndefined();
  });
});

describe("replaceDashboardContents", () => {
  const incoming: Dashboard = {
    id: "file-id",
    name: "From the file",
    tabs: [
      { id: "ft1", name: "Imported A", cards: [] },
      { id: "ft2", name: "Imported B", cards: [] },
    ],
    groups: [{ id: "g1", name: "Symbol", paramName: "symbol", groupType: "symbol", value: "MSFT" }],
  };

  /** Main (active, from load) plus Second, in that order. */
  async function twoDashboards(): Promise<{ main: string; second: string }> {
    await useDashboardStore.getState().load();
    const main = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;
    saveSpy.mockClear();
    return { main, second };
  }

  it("keeps the id, the name and the position, and takes the file's tabs and groups", async () => {
    const { main, second } = await twoDashboards();

    await useDashboardStore.getState().replaceDashboardContents(second, incoming);

    const { dashboards } = useDashboardStore.getState();
    expect(dashboards.map((d) => d.id)).toEqual([main, second]);
    const replaced = dashboards[1];
    expect(replaced.name).toBe("Second");
    expect(replaced.tabs.map((t) => t.name)).toEqual(["Imported A", "Imported B"]);
    expect(replaced.groups).toEqual(incoming.groups);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(__read(`dashboards/${second}.json`) ?? "{}");
    expect(written.id).toBe(second);
    expect(written.tabs[0].name).toBe("Imported A");
  });

  it("keeps the target's server shell, so the next upload still carries its template and type", async () => {
    const { second } = await twoDashboards();
    const workspace = { content: { index: "u", data: { templateId: "t", type: "template" } }, tabKeys: {}, orphans: [] };
    useDashboardStore.setState((s) => ({ dashboards: s.dashboards.map((d) => (d.id === second ? { ...d, extensions: { workspace } } : d)) }));

    await useDashboardStore.getState().replaceDashboardContents(second, incoming);

    expect(useDashboardStore.getState().dashboards.find((d) => d.id === second)?.extensions).toEqual({ workspace });
    expect(JSON.parse(__read(`dashboards/${second}.json`) ?? "{}").extensions).toEqual({ workspace });
  });

  it("reopens the active dashboard on its new first tab and clears a maximized card", async () => {
    const { main } = await twoDashboards();
    useDashboardStore.setState({ activeId: main, maximizedCardId: "old-card" });

    await useDashboardStore.getState().replaceDashboardContents(main, incoming);

    const state = useDashboardStore.getState();
    expect(state.activeId).toBe(main);
    expect(state.activeTabId).toBe("ft1");
    expect(state.maximizedCardId).toBeNull();
  });

  it("leaves the active tab alone when another dashboard is replaced", async () => {
    const { main, second } = await twoDashboards();
    useDashboardStore.setState({ activeId: main });
    const tab = useDashboardStore.getState().activeTabId;

    await useDashboardStore.getState().replaceDashboardContents(second, incoming);

    expect(useDashboardStore.getState().activeTabId).toBe(tab);
  });

  it("rejects and changes nothing when the write fails", async () => {
    const { second } = await twoDashboards();
    const before = useDashboardStore.getState().dashboards;
    __failPath(`dashboards/${second}.json`);

    await expect(
      useDashboardStore.getState().replaceDashboardContents(second, incoming),
    ).rejects.toThrow();

    expect(useDashboardStore.getState().dashboards).toEqual(before);
  });

  it("is refused in the viewer window", async () => {
    const { second } = await twoDashboards();
    const before = useDashboardStore.getState().dashboards;
    useDashboardStore.setState({ viewer: true });

    await useDashboardStore.getState().replaceDashboardContents(second, incoming);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toEqual(before);
    // refuse() logs without awaiting, so the line lands a tick later.
    await vi.waitFor(() =>
      expect(__read("logs/bdobb.log") ?? "").toContain(
        "viewer window refused replaceDashboardContents",
      ),
    );
  });

  it("deletes the stored file of a local-table card the replace discarded", async () => {
    await useDashboardStore.getState().load();
    const main = useDashboardStore.getState().activeId!;
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });

    await useDashboardStore.getState().replaceDashboardContents(main, incoming);

    await expect(readLocalFile(stored)).rejects.toThrow(/ENOENT/);
  });

  it("keeps the stored file when the incoming dashboard still names it", async () => {
    await useDashboardStore.getState().load();
    const main = useDashboardStore.getState().activeId!;
    const stored = await saveLocalFile(new File(["a\n"], "rows.csv"));
    await useDashboardStore
      .getState()
      .addCard(widget({ id: LOCAL_TABLE_ID, backendId: BUILTIN_BACKEND_ID }), { file: stored });
    const [card] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    const keeping: Dashboard = {
      ...incoming,
      tabs: [{ id: "ft1", name: "Imported A", cards: [{ ...card, id: "incoming-card" }] }],
    };

    await useDashboardStore.getState().replaceDashboardContents(main, keeping);

    await expect(readLocalFile(stored)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("drops the target's groupsDisabled, since the file has none", async () => {
    const { second } = await twoDashboards();
    await useDashboardStore.getState().setGroupsDisabled(second, true);

    await useDashboardStore.getState().replaceDashboardContents(second, incoming);

    const replaced = useDashboardStore.getState().dashboards.find((d) => d.id === second)!;
    expect(replaced.groupsDisabled).toBeUndefined();
  });
});

describe("patchCardField: table", () => {
  it("persists the table state onto the card and survives a reload", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "table", {
      sorting: [{ id: "close", desc: true }],
      hidden: ["volume"],
    });

    const table = () =>
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!
        .table;
    expect(table()).toEqual({ sorting: [{ id: "close", desc: true }], hidden: ["volume"] });

    // The real gate for note (g)(1): dashboardsFile.withDefaults names the
    // DASHBOARD's own fields explicitly, and passes `tabs` — and therefore
    // every card object inside them — through by reference. This proves a
    // new CARD field is not dropped on read, so withDefaults needs no edit.
    __resetJsonStoreForTests();
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await useDashboardStore.getState().load();
    expect(table()).toEqual({ sorting: [{ id: "close", desc: true }], hidden: ["volume"] });
  });

  it("merges a patch over what is already there rather than replacing it", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "table", { hidden: ["volume"] });
    await useDashboardStore.getState().patchCardField(cardId, "table", { columnOrder: ["close", "symbol"] });

    expect(
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].table,
    ).toEqual({ hidden: ["volume"], columnOrder: ["close", "symbol"] });
  });

  it("overwrites a field the patch names, including with an empty list", async () => {
    // Clear (filters) and un-hide-everything both arrive as empty arrays, and
    // must not be treated as "no change".
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore
      .getState()
      .patchCardField(cardId, "table", { columnFilters: [{ id: "symbol", value: "AA" }], hidden: ["volume"] });
    await useDashboardStore.getState().patchCardField(cardId, "table", { columnFilters: [], hidden: [] });

    expect(
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].table,
    ).toEqual({ columnFilters: [], hidden: [] });
  });

  it("removes the field entirely for null, on disk as well as in memory", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const dashboardId = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().patchCardField(cardId, "table", { hidden: ["volume"] });
    await useDashboardStore.getState().patchCardField(cardId, "table", null);

    expect(
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0],
    ).not.toHaveProperty("table");

    const persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted.tabs[0].cards[0]).not.toHaveProperty("table");
  });

  it("does nothing for a cardId no dashboard holds", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget());
    saveSpy.mockClear();

    await useDashboardStore.getState().patchCardField("nope", "table", { hidden: ["a"] });

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0]).not.toHaveProperty(
      "table",
    );
  });

  it("applies the change in memory but writes nothing in the viewer window", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    await useDashboardStore
      .getState()
      .patchCardField(cardId, "table", { sorting: [{ id: "close", desc: false }] });

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].table).toEqual({
      sorting: [{ id: "close", desc: false }],
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("leaves every other card on the tab referentially untouched", async () => {
    // WidgetCard memoises its effective params on the card's own identity, so
    // rebuilding a sibling card here would refetch it.
    await useDashboardStore.getState().load();
    const first = (await useDashboardStore.getState().addCard(widget())) as string;
    await useDashboardStore.getState().addCard(widget({ id: "other" }));
    const before = useDashboardStore.getState().activeDashboard()!.tabs[0].cards[1];

    await useDashboardStore.getState().patchCardField(first, "table", { hidden: ["volume"] });

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[1]).toBe(before);
  });
});

describe("patchCardField: title", () => {
  it("persists a title override onto the card and survives a reload", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "title", "AAPL daily");

    const title = () =>
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!
        .title;
    expect(title()).toBe("AAPL daily");

    // The real gate for "dashboardsFile needs no change": withDefaults names
    // the DASHBOARD's own fields explicitly and passes `tabs` -- and therefore
    // every card object inside them -- through by reference. Same gate the
    // table field has, for the same reason.
    __resetJsonStoreForTests();
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await useDashboardStore.getState().load();
    expect(title()).toBe("AAPL daily");
  });

  it("removes the field entirely for null, on disk as well as in memory", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const dashboardId = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().patchCardField(cardId, "title", "AAPL daily");
    await useDashboardStore.getState().patchCardField(cardId, "title", null);

    // not.toHaveProperty, not toBeUndefined: `title: undefined` would still be
    // a key in memory, and "the card has no override" is the whole state.
    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0]).not.toHaveProperty(
      "title",
    );

    const persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted.tabs[0].cards[0]).not.toHaveProperty("title");
  });

  it("applies the change in memory but writes nothing in the viewer window", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    await useDashboardStore.getState().patchCardField(cardId, "title", "AAPL daily");

    expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].title).toBe(
      "AAPL daily",
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("patchCardField: one field at a time", () => {
  // The three writers used to be three actions; folding them into one makes
  // "sets the named field and only the named field" a property worth pinning,
  // not an obvious consequence of three separate code paths.
  it("leaves the card's other fields as they were", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "view", "raw");
    await useDashboardStore.getState().patchCardField(cardId, "title", "AAPL daily");
    await useDashboardStore.getState().patchCardField(cardId, "table", { hidden: ["volume"] });

    const card = () =>
      useDashboardStore.getState().activeDashboard()!.tabs[0].cards.find((c) => c.id === cardId)!;
    expect(card()).toMatchObject({
      view: "raw",
      title: "AAPL daily",
      table: { hidden: ["volume"] },
    });

    // Clearing one field must not disturb the other two.
    await useDashboardStore.getState().patchCardField(cardId, "title", null);
    expect(card()).not.toHaveProperty("title");
    expect(card().view).toBe("raw");
    expect(card().table).toEqual({ hidden: ["volume"] });
  });
});

describe("setMaximized", () => {
  it("holds one card id at a time and writes no dashboard file", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    saveSpy.mockClear();

    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
    useDashboardStore.getState().setMaximized(cardId);
    expect(useDashboardStore.getState().maximizedCardId).toBe(cardId);
    useDashboardStore.getState().setMaximized(null);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();

    // Transient UI state, never persisted -- so no write at all, not even a
    // no-op one that would rewrite the dashboard on every maximize.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("is allowed in the viewer window, because there is nothing there to refuse", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    useDashboardStore.getState().setMaximized(cardId);

    expect(useDashboardStore.getState().maximizedCardId).toBe(cardId);
    expect(saveSpy).not.toHaveBeenCalled();
    // Not a refusal and not a suppressed write: this action never touches a
    // file in ANY window, so neither log line belongs to it.
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).not.toContain("viewer window refused");
    expect(log).not.toContain("viewer window did not persist");
  });

  it("is cleared by switching dashboard", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const second = (await useDashboardStore.getState().addDashboard("Second")) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().setActive(second);

    // The maximized card is not on screen any more; leaving the id set would
    // maximize nothing and freeze a layout item on a dashboard nobody is on.
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("is cleared by switching tab", async () => {
    const { tabB } = await loadWithSecondTab();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);

    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("survives re-selecting the tab that is already active", async () => {
    const { tabA } = await loadWithSecondTab();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabA);

    // Clicking the tab you are already on is not a switch, so there is no
    // card being left behind and nothing to clear.
    expect(useDashboardStore.getState().activeTabId).toBe(tabA);
    expect(useDashboardStore.getState().maximizedCardId).toBe(cardId);
  });
});

/**
 * Tab order IS the `tabs` array inside the dashboard file, so a reorder is a
 * dashboard mutation and goes through mutateActive -- which is what makes it
 * one write, and what makes the viewer window behave.
 */
describe("reorderTabs", () => {
  /** The seeded dashboard plus two more tabs, returned in file order. */
  async function loadWithThreeTabs(): Promise<{ a: string; b: string; c: string }> {
    await useDashboardStore.getState().load();
    const a = useDashboardStore.getState().activeTabId!;
    const b = (await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Second"))!;
    const c = (await useDashboardStore.getState().addTab(useDashboardStore.getState().activeId!, "Third"))!;
    return { a, b, c };
  }

  const tabIds = () => useDashboardStore.getState().activeDashboard()!.tabs.map((t) => t.id);

  const persistedTabIds = (dashboardId: string) =>
    (JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}") as { tabs?: { id: string }[] })
      .tabs?.map((t) => t.id);

  it("reorders the active dashboard's tabs and persists them in one write", async () => {
    const { a, b, c } = await loadWithThreeTabs();
    const dashboardId = useDashboardStore.getState().activeId!;
    saveSpy.mockClear();

    await useDashboardStore.getState().reorderTabs([c, a, b]);

    expect(tabIds()).toEqual([c, a, b]);
    // saveJson awaits the write, so the file is already on memfs here -- the
    // same reason renameTab's own test reads it on the next line.
    expect(persistedTabIds(dashboardId)).toEqual([c, a, b]);
    // A drop is ONE file write, exactly like renameTab.
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves activeTabId alone even when the tab that moved is the active one", async () => {
    const { a, b, c } = await loadWithThreeTabs();
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, c);

    await useDashboardStore.getState().reorderTabs([c, a, b]);

    // Reordering does not change which tab is showing; unlike removeTab there
    // is nothing to re-point.
    expect(useDashboardStore.getState().activeTabId).toBe(c);
  });

  it("drops any id in the given order that names no tab", async () => {
    const { a, b, c } = await loadWithThreeTabs();

    await useDashboardStore.getState().reorderTabs(["not-a-real-id", c, a, b]);

    expect(tabIds()).toEqual([c, a, b]);
  });

  it("applies the reorder in memory and writes nothing in the viewer window", async () => {
    const { a, b, c } = await loadWithThreeTabs();
    const dashboardId = useDashboardStore.getState().activeId!;
    const before = __read(`dashboards/${dashboardId}.json`);
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();

    await useDashboardStore.getState().reorderTabs([c, a, b]);

    expect(tabIds()).toEqual([c, a, b]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(__read(`dashboards/${dashboardId}.json`)).toBe(before);
  });
});
it.each(['leave','delete'] as const)('reserved %s removes binding without writing group text into ordinary params',async action=>{
 const key='pivot:filter:cat';const d:Dashboard={id:'reserved',name:'R',groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value:'A,B'}],tabs:[{id:'t',name:'T',cards:[{id:'c',widgetId:'unknown',backendId:'unknown',params:{ordinary:'kept'},layout:{x:0,y:0,w:1,h:1},bindings:[{groupId:'g',paramName:key}]}]}]};
 useDashboardStore.setState({dashboards:[d],activeId:d.id,activeTabId:'t'});
 if(action==='leave')await useDashboardStore.getState().leaveGroup('c',key);else await useDashboardStore.getState().deleteGroup(useDashboardStore.getState().activeId!, 'g');
 const card=useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];expect(card.params).toEqual({ordinary:'kept'});expect(card.bindings??[]).toEqual([]);
});
it('dashboard duplicate remaps reserved group ownership while retaining card-local category suffixes',async()=>{
 const d:Dashboard={id:'reserved',name:'R',groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value:'A'}],tabs:[{id:'t',name:'T',cards:[{id:'c',widgetId:'unknown',backendId:'unknown',params:{},layout:{x:0,y:0,w:1,h:1},bindings:[{groupId:'g',paramName:'pivot:filter:cat'}]}]}]};useDashboardStore.setState({dashboards:[d],activeId:d.id,activeTabId:'t'});
 const id=await useDashboardStore.getState().duplicateDashboard(d.id);const copy=useDashboardStore.getState().dashboards.find(d=>d.id===id)!;expect(copy.tabs[0].cards[0].id).not.toBe('c');expect(copy.groups![0].id).not.toBe('g');expect(copy.tabs[0].cards[0].bindings).toEqual([{groupId:copy.groups![0].id,paramName:'pivot:filter:cat'}]);
});

describe("revision", () => {
  const base = (revision?: number): Dashboard => ({ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [{ id: "c1", widgetId: "w", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 2, h: 2 } }] }], ...(revision === undefined ? {} : { revision }) });
  const stored = () => JSON.parse(__read("dashboards/d1.json") ?? "null") as Dashboard;

  it("counts every written edit, in memory and on disk", async () => {
    useDashboardStore.setState({ dashboards: [base()], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().renameDashboard("d1", "Renamed");
    await useDashboardStore.getState().setCardMinimized("c1", true);
    expect(useDashboardStore.getState().dashboards[0].revision).toBe(2);
    expect(stored().revision).toBe(2);
  });

  it("continues from the replaced dashboard's revision on an import's Replace", async () => {
    useDashboardStore.setState({ dashboards: [base(4)], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().replaceDashboardContents("d1", { id: "x", name: "X", tabs: [{ id: "t9", name: "T", cards: [] }] });
    expect(stored().revision).toBe(5);
  });
});


describe("applySynced", () => {
  it("replaces by id without a revision bump, appends new ones, reopens a replaced active dashboard, and removes", async () => {
    const d = (id: string, tab: string, revision?: number): Dashboard => ({ id, name: id, tabs: [{ id: tab, name: "Main", cards: [] }], ...(revision === undefined ? {} : { revision }) });
    useDashboardStore.setState({ dashboards: [d("d1", "t1", 4), d("d2", "t2")], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().applySynced([d("d1", "t9", 4), d("d3", "t3")], ["d2"]);
    expect(useDashboardStore.getState().dashboards.map((x) => [x.id, x.revision, x.tabs[0].id])).toEqual([["d1", 4, "t9"], ["d3", undefined, "t3"]]);
    expect(useDashboardStore.getState().activeTabId).toBe("t9");
    expect(JSON.parse(__read("dashboards/d1.json") ?? "null").revision).toBe(4);
    expect(__read("dashboards/d2.json")).toBeUndefined();
  });

  it("is refused in the viewer", async () => {
    useDashboardStore.setState({ dashboards: [], viewer: true });
    await useDashboardStore.getState().applySynced([{ id: "d1", name: "d1", tabs: [] }], []);
    expect(useDashboardStore.getState().dashboards).toEqual([]);
  });
});

describe("pinCard (v8)", () => {
  async function threeCards() {
    await useDashboardStore.getState().load();
    const a = (await useDashboardStore.getState().addCard(widget())) as string;
    const b = (await useDashboardStore.getState().addCard(widget())) as string;
    const c = (await useDashboardStore.getState().addCard(widget())) as string;
    return { a, b, c };
  }
  const cards = () => useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
  const find = (id: string) => cards().find((x) => x.id === id)!;

  it("sets an edge and leaves the layout untouched", async () => {
    const { a } = await threeCards();
    const before = find(a).layout;
    await useDashboardStore.getState().pinCard(a, "bottom");
    expect(find(a).pinned).toBe("bottom");
    expect(find(a).layout).toEqual(before);
  });

  it("swaps: pinning a second card to an occupied edge unpins the first, on that edge only", async () => {
    const { a, b, c } = await threeCards();
    await useDashboardStore.getState().pinCard(a, "bottom");
    await useDashboardStore.getState().pinCard(c, "top");
    await useDashboardStore.getState().pinCard(b, "bottom");
    expect(find(a)).not.toHaveProperty("pinned");
    expect(find(b).pinned).toBe("bottom");
    expect(find(c).pinned).toBe("top");
  });

  it("only swaps within the same tab", async () => {
    const { tabA, tabB } = await loadWithSecondTab();
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabA);
    const a = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabB);
    const b = (await useDashboardStore.getState().addCard(widget())) as string;
    await useDashboardStore.getState().pinCard(a, "top");
    await useDashboardStore.getState().pinCard(b, "top");
    const all = useDashboardStore.getState().activeDashboard()!.tabs.flatMap((t) => t.cards);
    expect(all.find((x) => x.id === a)!.pinned).toBe("top");
    expect(all.find((x) => x.id === b)!.pinned).toBe("top");
  });

  it("clears with null and persists both directions to the dashboard file, one revision on each", async () => {
    const { a } = await threeCards();
    const id = useDashboardStore.getState().activeId!;
    const revision = () => useDashboardStore.getState().activeDashboard()!.revision ?? 0;
    const before = revision();
    await useDashboardStore.getState().pinCard(a, "top");
    let persisted = JSON.parse(__read(`dashboards/${id}.json`) ?? "{}");
    expect(persisted.tabs[0].cards.find((x: { id: string }) => x.id === a).pinned).toBe("top");
    expect(persisted.revision).toBe(before + 1);

    await useDashboardStore.getState().pinCard(a, null);
    expect(find(a)).not.toHaveProperty("pinned");
    persisted = JSON.parse(__read(`dashboards/${id}.json`) ?? "{}");
    expect(persisted.tabs[0].cards.find((x: { id: string }) => x.id === a)).not.toHaveProperty("pinned");
    expect(persisted.revision).toBe(before + 2);
  });

  it("pins a card on a dashboard that is not the active one (a workspace tile)", async () => {
    const { a } = await threeCards();
    const owner = useDashboardStore.getState().activeId!;
    const other = (await useDashboardStore.getState().addDashboard("Other"))!;
    useDashboardStore.getState().setActive(other);
    expect(useDashboardStore.getState().activeId).toBe(other);
    await useDashboardStore.getState().pinCard(a, "bottom");
    const d = useDashboardStore.getState().dashboards.find((x) => x.id === owner)!;
    expect(d.tabs[0].cards.find((x) => x.id === a)!.pinned).toBe("bottom");
  });

  it("writes nothing in the viewer window", async () => {
    const { a } = await threeCards();
    useDashboardStore.setState({ viewer: true });
    saveSpy.mockClear();
    await useDashboardStore.getState().pinCard(a, "top");
    expect(find(a).pinned).toBe("top");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("a duplicate is never pinned, and the original keeps its edge", async () => {
    const { a } = await threeCards();
    await useDashboardStore.getState().pinCard(a, "bottom");
    const copy = (await useDashboardStore.getState().duplicateCard(a))!;
    expect(find(copy)).not.toHaveProperty("pinned");
    expect(find(a).pinned).toBe("bottom");
    expect(cards().filter((x) => x.pinned === "bottom")).toHaveLength(1);
  });

  it("Copy to another tab or dashboard is never pinned either", async () => {
    const { tabA, tabB } = await loadWithSecondTab();
    useDashboardStore.getState().setActiveTab(useDashboardStore.getState().activeId!, tabA);
    const a = (await useDashboardStore.getState().addCard(widget())) as string;
    await useDashboardStore.getState().pinCard(a, "top");
    const copy = (await useDashboardStore.getState().copyCardTo(a, useDashboardStore.getState().activeId!, tabB))!;
    const all = useDashboardStore.getState().activeDashboard()!.tabs.flatMap((t) => t.cards);
    expect(all.find((x) => x.id === copy)).not.toHaveProperty("pinned");
    expect(all.find((x) => x.id === a)!.pinned).toBe("top");
  });
});

describe("patchCardField: news", () => {
  const state = {
    feeds: [
      { url: "https://feeds.bloomberg.com/markets/news.rss", name: "Bloomberg", tab: "Wires" },
      { url: "https://example.substack.com/feed", name: "", tab: "" },
    ],
    highlights: ["fed", "rates"],
  };

  it("replaces the whole news state, rather than merging it", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;

    await useDashboardStore.getState().patchCardField(cardId, "news", state);
    await useDashboardStore.getState().patchCardField(cardId, "news", { feeds: [state.feeds[1]] });

    const after = useDashboardStore.getState().activeDashboard()!;
    const stored = after.tabs[0].cards.find((c) => c.id === cardId)!.news;
    expect(stored).toEqual({ feeds: [state.feeds[1]] });
    expect(stored).not.toHaveProperty("highlights");
  });

  it("persists the news state to the dashboard file and clears it with null", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    const dashboardId = useDashboardStore.getState().activeId!;

    await useDashboardStore.getState().patchCardField(cardId, "news", state);
    let persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted.tabs[0].cards.find((c: { id: string }) => c.id === cardId).news).toEqual(state);

    await useDashboardStore.getState().patchCardField(cardId, "news", null);
    persisted = JSON.parse(__read(`dashboards/${dashboardId}.json`) ?? "{}");
    expect(persisted.tabs[0].cards.find((c: { id: string }) => c.id === cardId)).not.toHaveProperty("news");
  });
});

it('saves and reopens only the managed source reference, excluding extraneous bytes and credentials',async()=>{
 await useDashboardStore.getState().load();
 const id=(await useDashboardStore.getState().addCard(widget()))!;
 await useDashboardStore.getState().patchCardField(id,'managedSource',{sourceId:'private-source',kind:'upload',version:1,bytes:[1,2],authorization:'secret'} as import('../lib/types').ManagedSourceReference);
 await useDashboardStore.getState().load();
 const saved=useDashboardStore.getState().dashboards.flatMap(d=>d.tabs.flatMap(t=>t.cards)).find(c=>c.id===id)!;
 expect(saved.managedSource).toEqual({sourceId:'private-source',kind:'upload',version:1});
 expect(JSON.stringify(saved)).not.toContain('secret');
});

describe("activeTabIds[activeId] stays the active tab", () => {
  const tabOf = () => {
    const s = useDashboardStore.getState();
    return { activeTabId: s.activeTabId, selected: s.activeId === null ? undefined : s.activeTabIds[s.activeId] };
  };

  it("duplicateDashboard records the copy's selected tab", async () => {
    __seed("dashboards/a.json", JSON.stringify({ id: "a", name: "A", tabs: [{ id: "a1", name: "Main", cards: [] }] }));
    await useDashboardStore.getState().load();
    const copy = (await useDashboardStore.getState().duplicateDashboard("a"))!;
    const tab = useDashboardStore.getState().dashboards.find((d) => d.id === copy)!.tabs[0].id;
    expect(tabOf()).toEqual({ activeTabId: tab, selected: tab });
  });

  it("removeDashboard of the active one lands on the next dashboard's selected tab", async () => {
    __seed("dashboards/a.json", JSON.stringify({ id: "a", name: "A", tabs: [{ id: "a1", name: "Main", cards: [] }] }));
    __seed("dashboards/b.json", JSON.stringify({ id: "b", name: "B", tabs: [{ id: "b1", name: "Main", cards: [] }, { id: "b2", name: "Two", cards: [] }] }));
    await useDashboardStore.getState().load(["b", "a"]);
    useDashboardStore.getState().setActiveTab("b", "b2");
    useDashboardStore.getState().setActive("a");
    await useDashboardStore.getState().removeDashboard("a");
    expect(tabOf()).toEqual({ activeTabId: "b2", selected: "b2" });
  });

  it("applySynced replacing the active dashboard re-points its selected tab", async () => {
    const d = (id: string, tab: string): Dashboard => ({ id, name: id, tabs: [{ id: tab, name: "Main", cards: [] }] });
    useDashboardStore.setState({ dashboards: [d("d1", "t1")], activeId: "d1", activeTabId: "t1", activeTabIds: { d1: "t1" } });
    await useDashboardStore.getState().applySynced([d("d1", "t9")], []);
    expect(tabOf()).toEqual({ activeTabId: "t9", selected: "t9" });
  });
});
