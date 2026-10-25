// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./dialogs/ImportConflictDialog", () => ({ decideImportConflicts: vi.fn() }));

import { __failPath, __read, __reset } from "../test/memfs";
import { IMPORT_MAX_BYTES } from "../lib/importLimits";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";
import { runAppsImport } from "./runAppsImport";

const decide = vi.mocked(decideImportConflicts);

/** One app per [name, tab name]. */
const appsFile = (...apps: [string, string][]) =>
  JSON.stringify(
    apps.map(([name, tab]) => ({ name, tabs: { t1: { id: "t1", name: tab, layout: [] } } })),
  );

const run = (text: string) => runAppsImport(text, text.length);

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  decide.mockReset();
  useWidgetRegistryStore.setState({ widgets: [] });
  useDashboardStore.setState({
    dashboards: [
      { id: "dA", name: "A", tabs: [{ id: "tA", name: "Main", cards: [] }] },
      { id: "dB", name: "B", tabs: [{ id: "tB", name: "Main", cards: [] }] },
    ],
    activeId: "dA",
    activeTabId: "tA",
    previousId: null,
    maximizedCardId: null,
    viewer: false,
  });
});

describe("runAppsImport", () => {
  it("imports a conflict-free file exactly as before", async () => {
    decide.mockResolvedValue([]);

    expect(await run(appsFile(["New", "Main"]))).toBe(
      "Imported 1 dashboard, 0 cards",
    );
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["A", "B", "New"]);
  });

  it("asks about the conflicts and replaces in place on Replace", async () => {
    decide.mockResolvedValue(["replace"]);

    const notice = await run(appsFile(["B", "From file"]));

    expect(notice).toBe("Imported 1 dashboard (1 replaced), 0 cards");
    expect(decide.mock.calls[0][0].map((c) => c.imported.name)).toEqual(["B"]);
    const { dashboards } = useDashboardStore.getState();
    expect(dashboards.map((d) => d.id)).toEqual(["dA", "dB"]);
    expect(dashboards[1].name).toBe("B");
    expect(dashboards[1].tabs[0].name).toBe("From file");
    // Nothing was added, so the order was not touched.
    expect(__read("settings.json")).toBeUndefined();
  });

  it("hands the dialog the Keep both name the import will use", async () => {
    decide.mockImplementation(async (_conflicts, hint) => {
      expect(hint(0, [])).toBe("B (2)");
      return ["keep"];
    });

    await run(appsFile(["B", "Main"]));

    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["A", "B", "B (2)"]);
  });

  it("counts a skip in the notice", async () => {
    decide.mockResolvedValue(["skip"]);

    expect(await run(appsFile(["B", "Main"]))).toBe(
      "Imported 0 dashboards (1 skipped), 0 cards",
    );
    expect(useDashboardStore.getState().dashboards).toHaveLength(2);
  });

  it("writes nothing when the import is cancelled", async () => {
    decide.mockResolvedValue("cancelled");
    const before = useDashboardStore.getState().dashboards;

    expect(await run(appsFile(["B", "Main"], ["New", "Main"]))).toBe(
      "Import cancelled; nothing changed.",
    );
    expect(useDashboardStore.getState().dashboards).toBe(before);
    expect(__read("dashboards/dB.json")).toBeUndefined();
  });

  it("refuses an oversize file without asking anything", async () => {
    expect(await runAppsImport("[]", IMPORT_MAX_BYTES + 1)).toBe(
      "File is 10.1 MB; the limit is 10 MB.",
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("goes on after a failed Replace, and names it in the notice", async () => {
    decide.mockResolvedValue(["replace", "replace"]);
    __failPath("dashboards/dA.json");

    const notice = await run(appsFile(["A", "New A"], ["B", "New B"]));

    // __failPath makes the write throw an `EIO: <path>` error.
    expect(notice).toContain(
      'Imported 1 dashboard (1 replaced), 0 cards; Could not replace "A": EIO',
    );
    const { dashboards } = useDashboardStore.getState();
    expect(dashboards[0].tabs[0].name).toBe("Main");
    expect(dashboards[1].tabs[0].name).toBe("New B");
    expect(__read("logs/bdobb.log") ?? "").toContain("failed to replace dashboard dA");
  });

  it("totals a mixed file: one added, one replaced, one skipped", async () => {
    decide.mockResolvedValue(["replace", "skip"]);

    const notice = await run(appsFile(["New", "Main"], ["A", "From file"], ["B", "Main"]));

    expect(notice).toBe("Imported 2 dashboards (1 replaced, 1 skipped), 0 cards");
    const { dashboards } = useDashboardStore.getState();
    expect(dashboards.map((d) => d.name)).toEqual(["A", "B", "New"]);
    expect(dashboards[0].tabs[0].name).toBe("From file");
    expect(dashboards[1].tabs[0].name).toBe("Main");
  });

  it("rejects, and applies no pending Replace, when adding the new dashboards fails", async () => {
    decide.mockResolvedValue(["replace"]);
    const text = appsFile(["New", "Main"], ["A", "From file"]);
    // Every id the import mints is "u<n>", so every new dashboard file can be failed;
    // the Replace writes to the existing dA.json, which stays healthy.
    let n = 0;
    const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(() => `u${++n}` as `${string}-${string}-${string}-${string}-${string}`);
    for (let k = 1; k <= 20; k++) __failPath(`dashboards/u${k}.json`);

    await expect(run(text)).rejects.toThrow();

    uuid.mockRestore();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].name).toBe("Main");
  });

  it("logs a failed order write and still returns the normal notice", async () => {
    decide.mockResolvedValue([]);
    __failPath("settings.json");

    expect(await run(appsFile(["New", "Main"]))).toBe(
      "Imported 1 dashboard, 0 cards",
    );
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).toContain("failed to persist dashboard order: EIO");
  });
});

// Moved from appsJson.test.ts (v5.0.0): the notice is built here now, after
// the conflict answers, from the cards actually written.
describe("the import notice", () => {
  it("lists unresolved ids rather than only counting them", async () => {
    const layout = ["a", "b", "c", "d", "e", "f"].map((i, n) => ({
      i,
      x: 0,
      y: n,
      w: 20,
      h: 9,
    }));
    const app = { name: "Ref", tabs: { t1: { id: "t1", name: "T", layout } }, groups: [] };
    decide.mockResolvedValue([]);
    const notice = await run(JSON.stringify([app]));
    expect(notice).toContain("a, b, c, d, e");
    expect(notice).toContain("…");
    expect(notice).toContain("6");
  });

  it("counts the widgets it names, not the cards showing them", async () => {
    // One missing widget on six tabs is ONE thing to fix. Counting cards read
    // as "6 unresolved: nowhere" -- six claimed, one named, no ellipsis to
    // explain the gap.
    const layout = [0, 1, 2, 3, 4, 5].map((n) => ({ i: "nowhere", x: 0, y: n, w: 20, h: 9 }));
    const app = { name: "Ref", tabs: { t1: { id: "t1", name: "T", layout } }, groups: [] };
    decide.mockResolvedValue([]);
    const notice = await run(JSON.stringify([app]));
    expect(notice).toBe("Imported 1 dashboard, 6 cards (1 unresolved: nowhere)");
  });

  it("names what it dropped from a dev Pivot card", async () => {
    const state = { params: { symbol: "AAPL" }, pivotView: { enabled: true, grouping: ["symbol"] } };
    const app = { name: "Dev", tabs: { t1: { id: "t1", name: "T", layout: [{ i: "income", x: 0, y: 0, w: 20, h: 9, state }] } } };
    decide.mockResolvedValue([]);
    const notice = await run(JSON.stringify([app]));
    expect(notice).toBe(
      "Imported 1 dashboard, 1 card (1 unresolved: income); dropped at $[0].tabs.t1.layout[0].state.pivotView.grouping: Pivot state with no Statement equivalent.",
    );
    expect(useDashboardStore.getState().dashboards.at(-1)!.tabs[0].cards[0].view).toBe("statement");
  });
});
