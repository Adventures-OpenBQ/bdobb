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
  const tabB = (await useDashboardStore.getState().addTab("Second"))!;
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
      (k) => typeof state[k as keyof typeof state] !== "function" && k !== "activeTabId",
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

describe("goToPrevious", () => {
  it("swaps back and forth between the last two dashboards", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;
    useDashboardStore.getState().setActive(second);

    useDashboardStore.getState().goToPrevious();
    expect(useDashboardStore.getState().activeId).toBe(first);

    useDashboardStore.getState().goToPrevious();
    expect(useDashboardStore.getState().activeId).toBe(second);
  });

  it("does nothing when there is no history", async () => {
    await useDashboardStore.getState().load();
    const only = useDashboardStore.getState().activeId!;
    useDashboardStore.getState().goToPrevious();
    expect(useDashboardStore.getState().activeId).toBe(only);
  });

  it("does nothing when the previous dashboard has been deleted", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second"))!;
    useDashboardStore.getState().setActive(second);

    await useDashboardStore.getState().removeDashboard(first);
    useDashboardStore.getState().goToPrevious();

    expect(useDashboardStore.getState().activeId).toBe(second);
  });
});

describe("tab CRUD (addTab / renameTab / removeTab / setActiveTab)", () => {
  it("adds a tab to the active dashboard and returns its id", async () => {
    await useDashboardStore.getState().load();
    const tabId = await useDashboardStore.getState().addTab("Second");
    expect(tabId).not.toBeNull();
    expect(useDashboardStore.getState().activeDashboard()!.tabs.map((t) => t.name)).toEqual([
      "Main",
      "Second",
    ]);
  });

  it("returns null and adds nothing when there is no active dashboard", async () => {
    expect(await useDashboardStore.getState().addTab("Orphan")).toBeNull();
  });

  it("does not switch to the new tab", async () => {
    await useDashboardStore.getState().load();
    const before = useDashboardStore.getState().activeTabId;
    await useDashboardStore.getState().addTab("Second");
    expect(useDashboardStore.getState().activeTabId).toBe(before);
  });

  it("activates the new tab when there was no active tab (the zero-tabs recovery path)", async () => {
    await useDashboardStore.getState().load();
    const onlyTab = useDashboardStore.getState().activeTabId!;
    await useDashboardStore.getState().removeTab(onlyTab);
    expect(useDashboardStore.getState().activeTabId).toBeNull();

    const newTabId = await useDashboardStore.getState().addTab("Recovered");

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
    useDashboardStore.getState().setActiveTab(tabB);
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
    useDashboardStore.getState().setActiveTab(tabB);

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
    useDashboardStore.getState().setActiveTab(tabB);
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
    useDashboardStore.getState().setActiveTab(tabB);
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

  it("releases a removed local file after its Undo entry is dismissed", async () => {
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

  it("a viewer refuses removal and retains the card and its local file", async () => {
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
    useDashboardStore.getState().setActiveTab(tabB);
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
      await useDashboardStore.getState().renameGroup("g1", "Watchlist");
      const g = useDashboardStore.getState().activeDashboard()!.groups![0];
      expect(g).toEqual({ id: "g1", name: "Watchlist", paramName: "symbol", groupType: "symbol", value: "MSFT" });
    });

    it("deleteGroup removes the group and every binding to it, writing the value onto each member", async () => {
      const cardId = await seedCardWithGroup();
      await useDashboardStore.getState().deleteGroup("g1");
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

      await useDashboardStore.getState().deleteGroup("g1");

      const card = useDashboardStore
        .getState()
        .activeDashboard()!
        .tabs[0].cards.find((c) => c.id === cardId)!;
      expect(card.bindings).toBeUndefined();
      expect(card.params.symbol).toBe("MSFT");
      expect(card.params.ticker).toBe("MSFT");
    });

    /**
     * A September member of a quarter group holding the December label
     * `2026-Q3` (Jul–Sep): the member shows it as FY2026-Q4, stored `2026-Q4`.
     * Its year end comes from the sibling `fy_end` param.
     */
    async function seedSeptemberQuarterMember() {
      const periodWidget = widget({
        id: "period_w",
        params: [
          { paramName: "fy_end", value: "12" },
          { paramName: "quarter", type: "quarter", fiscalYearEndParam: "fy_end" },
        ],
      });
      useWidgetRegistryStore.setState({ widgets: [periodWidget] });
      await useDashboardStore.getState().load();
      const cardId = (await useDashboardStore.getState().addCard(periodWidget)) as string;
      const active = useDashboardStore.getState().activeDashboard()!;
      useDashboardStore.setState({
        dashboards: useDashboardStore.getState().dashboards.map((d) =>
          d.id === active.id
            ? {
                ...d,
                groups: [
                  { id: "g-q", name: "Quarter", paramName: "quarter", groupType: "quarter", value: "2026-Q3" },
                ],
                tabs: d.tabs.map((t) => ({
                  ...t,
                  cards: t.cards.map((c) =>
                    c.id === cardId
                      ? {
                          ...c,
                          params: { ...c.params, fy_end: "9" },
                          bindings: [{ groupId: "g-q", paramName: "quarter" }],
                        }
                      : c,
                  ),
                })),
              }
            : d,
        ),
      });
      return cardId;
    }

    const quarterOf = (cardId: string) =>
      useDashboardStore
        .getState()
        .activeDashboard()!
        .tabs[0].cards.find((c) => c.id === cardId)!.params.quarter;

    it("leaveGroup keeps the member's own label for a quarter group, not the December one", async () => {
      const cardId = await seedSeptemberQuarterMember();
      // GroupLink hands back the group's value relabelled under the member's
      // year end: 2026-Q3 (Dec) is FY2026-Q4 under September.
      await useDashboardStore.getState().leaveGroup(cardId, "quarter", "2026-Q4");
      expect(quarterOf(cardId)).toBe("2026-Q4");
    });

    it("deleteGroup relabels a quarter group's value under each member's sibling-param year end", async () => {
      const cardId = await seedSeptemberQuarterMember();
      await useDashboardStore.getState().deleteGroup("g-q");
      expect(quarterOf(cardId)).toBe("2026-Q4");
    });

    it("deleteGroup relabels under the member's FY ends override, ahead of its param's own fields (v5.4.0, spec §1.5)", async () => {
      const cardId = await seedSeptemberQuarterMember();
      // The sibling param now says December; the card's override says
      // September, and the override is the chain's first rung.
      useDashboardStore.setState({
        dashboards: useDashboardStore.getState().dashboards.map((d) => ({
          ...d,
          tabs: d.tabs.map((t) => ({
            ...t,
            cards: t.cards.map((c) =>
              c.id === cardId ? { ...c, params: { ...c.params, fy_end: "12" }, fiscalYearEnd: 9 } : c,
            ),
          })),
        })),
      });
      await useDashboardStore.getState().deleteGroup("g-q");
      expect(quarterOf(cardId)).toBe("2026-Q4");
    });

    it("refuses every group action in the viewer window", async () => {
      const cardId = await seedCardWithGroup();
      useDashboardStore.setState({ viewer: true });
      expect(await useDashboardStore.getState().createGroup(cardId, "interval", "interval", "1d")).toBeNull();
      await useDashboardStore.getState().deleteGroup("g1");
      expect(useDashboardStore.getState().activeDashboard()!.groups).toHaveLength(1);
      expect(saveSpy).not.toHaveBeenCalled();
    });
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

    useDashboardStore.getState().setActiveTab(tabB);

    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("survives re-selecting the tab that is already active", async () => {
    const { tabA } = await loadWithSecondTab();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().setActiveTab(tabA);

    // Clicking the tab you are already on is not a switch, so there is no
    // card being left behind and nothing to clear.
    expect(useDashboardStore.getState().activeTabId).toBe(tabA);
    expect(useDashboardStore.getState().maximizedCardId).toBe(cardId);
  });

  it("is cleared by goToPrevious", async () => {
    await useDashboardStore.getState().load();
    const first = useDashboardStore.getState().activeId!;
    const second = (await useDashboardStore.getState().addDashboard("Second")) as string;
    useDashboardStore.getState().setActive(second);
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().goToPrevious();

    // Option+0 is a dashboard switch like any other: the maximized card is on
    // the dashboard being left.
    expect(useDashboardStore.getState().activeId).toBe(first);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("survives a goToPrevious that has no history to go back to", async () => {
    await useDashboardStore.getState().load();
    const cardId = (await useDashboardStore.getState().addCard(widget())) as string;
    useDashboardStore.getState().setMaximized(cardId);

    useDashboardStore.getState().goToPrevious();

    // Nothing was switched, so nothing is stale.
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
    const b = (await useDashboardStore.getState().addTab("Second"))!;
    const c = (await useDashboardStore.getState().addTab("Third"))!;
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
    useDashboardStore.getState().setActiveTab(c);

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

describe("syncDashboard", () => {
  const stored = (id: string, name: string, tabs: unknown) =>
    __seed(`dashboards/${id}.json`, JSON.stringify({ id, name, tabs }));

  it("replaces one dashboard from disk without moving the selection", async () => {
    stored("1", "One", [{ id: "t1", name: "Main", cards: [] }]);
    stored("2", "Two", [{ id: "t2", name: "Main", cards: [] }]);
    await useDashboardStore.getState().load();
    useDashboardStore.getState().setActive("2");
    const before = useDashboardStore.getState();
    expect(before.activeId).toBe("2");

    // The other window renamed it and added a tab.
    stored("1", "One renamed", [
      { id: "t1", name: "Main", cards: [] },
      { id: "t9", name: "Added", cards: [] },
    ]);
    await useDashboardStore.getState().syncDashboard("1");

    const after = useDashboardStore.getState();
    expect(after.dashboards.find((d) => d.id === "1")?.name).toBe("One renamed");
    expect(after.dashboards.find((d) => d.id === "1")?.tabs).toHaveLength(2);
    // Untouched: this window is looking at a different dashboard.
    expect(after.activeId).toBe("2");
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.dashboards.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("keeps the active tab when it survives, and falls back when it does not", async () => {
    stored("1", "One", [
      { id: "t1", name: "Main", cards: [] },
      { id: "t2", name: "Second", cards: [] },
    ]);
    await useDashboardStore.getState().load();
    useDashboardStore.setState({ activeTabId: "t2" });

    stored("1", "One", [
      { id: "t1", name: "Main", cards: [] },
      { id: "t2", name: "Second renamed", cards: [] },
    ]);
    await useDashboardStore.getState().syncDashboard("1");
    expect(useDashboardStore.getState().activeTabId).toBe("t2");

    // Now the tab this window was on is gone from the incoming version.
    stored("1", "One", [{ id: "t1", name: "Main", cards: [] }]);
    await useDashboardStore.getState().syncDashboard("1");
    expect(useDashboardStore.getState().activeTabId).toBe("t1");
  });

  it("drops a dashboard deleted on the other side", async () => {
    stored("1", "One", [{ id: "t1", name: "Main", cards: [] }]);
    stored("2", "Two", [{ id: "t2", name: "Main", cards: [] }]);
    await useDashboardStore.getState().load();
    __reset();
    await useDashboardStore.getState().syncDashboard("1");
    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["2"]);
  });

  it("writes nothing when the deleted dashboard was the last one", async () => {
    stored("1", "One", [{ id: "t1", name: "Main", cards: [] }]);
    await useDashboardStore.getState().load();
    __reset();
    await useDashboardStore.getState().syncDashboard("1");
    // A viewer never writes: the directory read used to seed a fresh "Main"
    // here, from the viewer window.
    expect(__list().filter((p) => p.startsWith("dashboards/"))).toEqual([]);
    expect(useDashboardStore.getState().dashboards).toEqual([]);
  });

  it("a sync that starts while an earlier one is reading sees the later write", async () => {
    stored("1", "One", [{ id: "t1", name: "Main", cards: [] }]);
    // Enough other files that a whole-directory read is still running after
    // "1" has been read -- the window in which a second change used to be
    // handed the first read's (older) result.
    for (let i = 0; i < 200; i += 1) stored(`z${i}`, `Z${i}`, [{ id: `t${i}`, name: "Main", cards: [] }]);
    await useDashboardStore.getState().load();

    const first = useDashboardStore.getState().syncDashboard("1");
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    stored("1", "Two", [{ id: "t1", name: "Main", cards: [] }]);
    const second = useDashboardStore.getState().syncDashboard("1");
    await Promise.all([first, second]);

    expect(useDashboardStore.getState().dashboards.find((d) => d.id === "1")?.name).toBe("Two");
  });
});


describe("presets", () => {
  const seeded = (): Dashboard => ({ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] });

  beforeEach(() => {
    useDashboardStore.setState({ dashboards: [seeded()], activeId: "d1", activeTabId: "t1", viewer: false });
    saveSpy.mockClear();
  });

  it("savePreset appends, and the same name replaces in place", async () => {
    await useDashboardStore.getState().savePreset("Two weeks", "T-2w");
    await useDashboardStore.getState().savePreset("Hour", "now-1h");
    await useDashboardStore.getState().savePreset("Two weeks", "T-14d");
    expect(useDashboardStore.getState().activeDashboard()?.presets).toEqual([
      { name: "Two weeks", expr: "T-14d" },
      { name: "Hour", expr: "now-1h" },
    ]);
    expect(saveSpy).toHaveBeenCalledTimes(3);
    expect(JSON.parse(__read("dashboards/d1.json")!).presets).toHaveLength(2);
  });

  it("deletePreset removes by name and drops the field when none remain", async () => {
    await useDashboardStore.getState().savePreset("Two weeks", "T-2w");
    await useDashboardStore.getState().deletePreset("Two weeks");
    expect(useDashboardStore.getState().activeDashboard()).not.toHaveProperty("presets");
  });

  it("the viewer window refuses both", async () => {
    useDashboardStore.setState({ viewer: true });
    await useDashboardStore.getState().savePreset("Two weeks", "T-2w");
    expect(useDashboardStore.getState().activeDashboard()?.presets).toBeUndefined();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("duplicateDashboard copies the presets", async () => {
    await useDashboardStore.getState().savePreset("Two weeks", "T-2w");
    const id = await useDashboardStore.getState().duplicateDashboard("d1");
    expect(useDashboardStore.getState().dashboards.find((d) => d.id === id)?.presets).toEqual([{ name: "Two weeks", expr: "T-2w" }]);
  });
});

describe("setDashboardExchange (v5.4.0)", () => {
  it("persists the MIC, survives a reload, copies with a duplicate, and clears with null", async () => {
    await useDashboardStore.getState().load();
    const id = useDashboardStore.getState().activeId!;
    await useDashboardStore.getState().setDashboardExchange(id, "XLON");
    expect(useDashboardStore.getState().activeDashboard()!.exchange).toBe("XLON");

    __resetJsonStoreForTests();
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await useDashboardStore.getState().load();
    expect(useDashboardStore.getState().activeDashboard()!.exchange).toBe("XLON");

    const copyId = (await useDashboardStore.getState().duplicateDashboard(id)) as string;
    expect(useDashboardStore.getState().dashboards.find((d) => d.id === copyId)!.exchange).toBe("XLON");

    await useDashboardStore.getState().setDashboardExchange(id, null);
    expect(useDashboardStore.getState().dashboards.find((d) => d.id === id)).not.toHaveProperty("exchange");
  });
});

describe("dropUngroupable (v5.4.0)", () => {
  it("removes the named bindings, keeps the card's own values, and logs once per param", async () => {
    const groups = [
      { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
      { id: "g2", name: "Interval", paramName: "interval", groupType: "interval", value: "1d" },
    ];
    const card = {
      id: "c1",
      widgetId: "w1",
      backendId: "b1",
      params: { symbol: "AAPL" },
      layout: { x: 0, y: 0, w: 1, h: 1 },
      bindings: [
        { groupId: "g1", paramName: "symbol" },
        { groupId: "g2", paramName: "interval" },
      ],
    };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }], groups }],
      activeId: "d1",
      activeTabId: "t1",
    });
    await useDashboardStore.getState().dropUngroupable("c1", ["symbol"]);
    const after = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    expect(after.bindings).toEqual([{ groupId: "g2", paramName: "interval" }]);
    expect(after.params).toEqual({ symbol: "AAPL" });
    await vi.waitFor(() => {
      expect(__read("logs/bdobb.log") ?? "").toContain("card c1: symbol is not groupable; removed from its group");
    });
  });
});

describe("duplicateCard / copyCardTo", () => {
  /** d1/t1 holds c1 (bound, y:0 h:4) and c2 (y:4 h:3); d2/t2 is empty. */
  function seedTwoDashboards() {
    const c1 = {
      id: "c1",
      widgetId: "w1",
      backendId: "b1",
      params: { symbol: "AAPL" },
      title: "Mine",
      layout: { x: 0, y: 0, w: 10, h: 4 },
      bindings: [{ groupId: "g1", paramName: "symbol" }],
    };
    const c2 = {
      id: "c2",
      widgetId: "w2",
      backendId: "b1",
      params: {},
      layout: { x: 0, y: 4, w: 10, h: 3 },
    };
    useDashboardStore.setState({
      dashboards: [
        { id: "d1", name: "D1", tabs: [{ id: "t1", name: "Main", cards: [c1, c2] }] },
        { id: "d2", name: "D2", tabs: [{ id: "t2", name: "Main", cards: [] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
      viewer: false,
    });
    saveSpy.mockClear();
  }

  beforeEach(() => {
    seedTwoDashboards();
  });

  it("duplicates a card below the others on the same tab, without its bindings", async () => {
    const id = await useDashboardStore.getState().duplicateCard("c1");
    const tab = useDashboardStore.getState().dashboards.find((d) => d.id === "d1")!.tabs[0];
    const copy = tab.cards.find((c) => c.id === id)!;
    expect(id).not.toBe("c1");
    expect(copy).toMatchObject({
      widgetId: "w1",
      backendId: "b1",
      params: { symbol: "AAPL" },
      title: "Mine",
      layout: { x: 0, y: 7, w: 10, h: 4 },
    });
    expect(copy.bindings).toBeUndefined();
    expect(JSON.parse(__read("dashboards/d1.json") ?? "{}").tabs[0].cards).toHaveLength(3);
  });

  it("copies a card to another dashboard's tab and leaves the source alone", async () => {
    const id = await useDashboardStore.getState().copyCardTo("c1", "d2", "t2");
    const target = useDashboardStore
      .getState()
      .dashboards.find((d) => d.id === "d2")!
      .tabs.find((t) => t.id === "t2")!;
    expect(target.cards.map((c) => c.id)).toContain(id);
    expect(
      useDashboardStore.getState().dashboards.find((d) => d.id === "d1")!.tabs[0].cards.map((c) => c.id),
    ).toEqual(["c1", "c2"]);
  });

  it("returns null for an unknown card or target", async () => {
    expect(await useDashboardStore.getState().duplicateCard("nope")).toBeNull();
    expect(await useDashboardStore.getState().copyCardTo("c1", "d2", "nope")).toBeNull();
  });

  // Back-port of dev b7b7361 (v12.4.2 review): a copy that shares the source's
  // nested objects is one in-place edit from corrupting both cards.
  it.each(["duplicate", "copy to"] as const)("%s gives the copy its own nested objects", async (how) => {
    useDashboardStore.setState((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id !== "d1"
          ? d
          : {
              ...d,
              tabs: [
                {
                  ...d.tabs[0],
                  cards: d.tabs[0].cards.map((c) =>
                    c.id !== "c1"
                      ? c
                      : { ...c, table: { hidden: ["col1"] }, tableDefinition: { table: { hidden: ["col1"] }, search: "x" }, tableSelection: { kind: "none" as const } },
                  ),
                },
              ],
            },
      ),
    }));
    const source = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    const id = how === "duplicate"
      ? await useDashboardStore.getState().duplicateCard("c1")
      : await useDashboardStore.getState().copyCardTo("c1", "d2", "t2");
    const copy = useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).find((c) => c.id === id)!;
    const nested = Object.keys(source).filter((k) => !["id", "bindings", "layout"].includes(k) && typeof source[k as keyof typeof source] === "object");
    expect(nested).toEqual(expect.arrayContaining(["params", "table", "tableDefinition", "tableSelection"]));
    for (const k of nested) {
      expect(copy[k as keyof typeof copy], k).toEqual(source[k as keyof typeof source]);
      expect(copy[k as keyof typeof copy], k).not.toBe(source[k as keyof typeof source]);
    }
  });
});
