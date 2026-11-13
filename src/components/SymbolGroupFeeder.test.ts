// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import type { ChartResult, Revision } from "../lib/tableExecution/types";
import type { Dashboard, ParamGroup } from "../lib/types";
import type { ViewState } from "../stores/tableExecutionStore";
import { card } from "../test/fixtures";
import { createFeeder, type FeedStore } from "./SymbolGroupFeeder";

const rev = (output: number): Revision => ({ widgetId: "s", input: 1, model: 1, output });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The three store calls the feeder makes, over a view the test moves and answers it resolves by hand. */
function fakeStore() {
  const listeners = new Set<() => void>();
  let view = { status: "pending", requested: rev(0), definition: { table: {}, search: "" }, selection: { kind: "none" }, stale: false } as unknown as ViewState;
  const answers: Array<{ resolve: (cells: unknown[]) => void; reject: (e: Error) => void }> = [];
  const chartData = vi.fn((revision: Revision, fields: string[], _signal?: AbortSignal) => new Promise<ChartResult>((resolve, reject) => {
    answers.push({
      reject,
      resolve: (cells) => resolve({ revision, rows: cells.map((v, i) => ({ id: `r${i}`, values: { [fields[0]]: v } })) } as unknown as ChartResult),
    });
  }));
  const store = {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    readView: () => view,
    readExecutor: () => ({ chartData }),
  } as unknown as FeedStore;
  /** The source reports `status` at output revision `output`, presenting `columns`. */
  const show = (status: ViewState["status"], output: number, columns = ["symbol"]) => {
    view = { ...view, status, active: rev(output), ready: { columns: columns.map((id) => ({ id, label: id })) } } as unknown as ViewState;
    listeners.forEach((fn) => fn());
  };
  return { store, show, answers, chartData };
}

function harness(group: Partial<ParamGroup> = {}) {
  const fake = fakeStore();
  let dashboard: Dashboard = {
    id: "d", name: "D",
    tabs: [{ id: "t", name: "T", cards: [card({ id: "s", widgetId: "local_table", backendId: "builtin" })] }],
    groups: [{ id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value: "OLD", source: { sourceWidgetId: "s", columnId: "symbol" }, ...group }],
  };
  const setValue = (value: string) => {
    dashboard = { ...dashboard, groups: dashboard.groups!.map((g) => ({ ...g, value })) };
  };
  const write = vi.fn((_groupId: string, value: string) => setValue(value));
  const notes = new Map<string, string | undefined>();
  const feeder = createFeeder({ dashboardId: "d", store: fake.store, read: () => dashboard, write, note: (id, text) => notes.set(id, text) });
  fake.store.subscribe(feeder.run);
  /** A person types over the group: the dashboard store changes, and the feeder runs on it. */
  const type = (value: string) => { setValue(value); feeder.run(); };
  return { ...fake, feeder, write, notes, type, value: () => dashboard.groups![0].value };
}

describe("createFeeder (spec 2026-11-13 §2)", () => {
  it("writes the chosen column of the presented output once per revision", async () => {
    const h = harness();
    h.show("ready", 1);
    expect(h.chartData).toHaveBeenCalledWith(rev(1), ["symbol"], expect.any(AbortSignal));
    h.answers[0].resolve([" aapl", "msft"]);
    await flush();
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledWith("g", "AAPL,MSFT");
    h.show("ready", 1);
    await flush();
    expect(h.chartData).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("drops an answer for a revision the source has moved past", async () => {
    const h = harness();
    h.show("ready", 1);
    h.show("ready", 2);
    h.answers[0].resolve(["STALE"]);
    h.answers[1].resolve(["NEW"]);
    await flush();
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledWith("g", "NEW");
  });

  it("keeps the last list while the source is loading, failed, blocked or validly empty, and says why", async () => {
    const h = harness();
    h.show("pending", 0);
    expect(h.notes.get("g")).toBe("Source loading");
    h.show("failed", 1);
    expect(h.notes.get("g")).toBe("Source failed");
    h.show("blocked", 1);
    expect(h.notes.get("g")).toBe("Source blocked");
    h.show("empty", 2);
    expect(h.notes.get("g")).toBe("Source returned no rows");
    expect(h.chartData).not.toHaveBeenCalled();
    h.show("ready", 3);
    h.answers[0].resolve(["", null]);
    await flush();
    expect(h.notes.get("g")).toBe("Source returned no rows");
    h.show("ready", 4);
    h.answers[1].reject(new Error("worker gone"));
    await flush();
    expect(h.notes.get("g")).toBe("Source failed");
    expect(h.write).not.toHaveBeenCalled();
    expect(h.value()).toBe("OLD");
  });

  it("keeps the list when the chosen column is gone, and says so", () => {
    const h = harness();
    h.show("ready", 1, ["name"]);
    expect(h.notes.get("g")).toBe("Column unavailable");
    expect(h.chartData).not.toHaveBeenCalled();
  });

  it("says Source unavailable when the table is not on the dashboard", () => {
    const h = harness({ source: { sourceWidgetId: "gone", columnId: "symbol" } });
    h.feeder.run();
    expect(h.notes.get("g")).toBe("Source unavailable");
    expect(h.chartData).not.toHaveBeenCalled();
  });

  it("notes the cap and keeps the first 500", async () => {
    const h = harness();
    h.show("ready", 1);
    h.answers[0].resolve(Array.from({ length: 501 }, (_, i) => `T${i}`));
    await flush();
    expect(h.notes.get("g")).toBe("Capped at 500 tickers");
    expect(h.value().split(",")).toHaveLength(500);
  });

  it("keeps a typed-over value until the table's next output", async () => {
    const h = harness();
    h.show("ready", 1);
    h.answers[0].resolve(["AAPL"]);
    await flush();
    h.type("NVDA");
    await flush();
    expect(h.chartData).toHaveBeenCalledTimes(1);
    expect(h.value()).toBe("NVDA");
    h.show("ready", 2);
    h.answers[1].resolve(["AAPL"]);
    await flush();
    expect(h.value()).toBe("AAPL");
  });

  it("keeps the saved list until the source answers, and writes nothing when it agrees", async () => {
    const h = harness({ value: "AAPL,MSFT" });
    h.feeder.run();
    expect(h.chartData).not.toHaveBeenCalled();
    h.show("ready", 1);
    h.answers[0].resolve(["aapl", "msft"]);
    await flush();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.notes.get("g")).toBeUndefined();
  });

  it("stop aborts what is in flight", () => {
    const h = harness();
    h.show("ready", 1);
    h.feeder.stop();
    expect((h.chartData.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  });
});
