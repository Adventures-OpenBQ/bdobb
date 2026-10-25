// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __read, __reset } from "../test/memfs";
import { DASHBOARD_CHANGED, notifyDashboardChanged, onDashboardChanged } from "./dashboardSync";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("dashboardSync", () => {
  it("carries the dashboard id to a listener in the same context", async () => {
    // Tauri's emit reaches the emitting window too, which is the property the
    // shim reproduces and the one the viewer depends on.
    const seen: string[] = [];
    const off = await onDashboardChanged((id) => seen.push(id));
    await notifyDashboardChanged("d1");
    expect(seen).toEqual(["d1"]);
    off();
    await notifyDashboardChanged("d2");
    expect(seen).toEqual(["d1"]);
  });

  it("names the event once, for both halves", () => {
    expect(DASHBOARD_CHANGED).toBe("dashboard-changed");
  });

  it("logs and swallows a failed emit rather than failing the save", async () => {
    // The write has already landed by the time this runs. A window that never
    // hears the event shows stale data; a save that threw would lose an edit.
    // The suite-wide mock is the real BroadcastChannel shim, so a rejecting
    // emit needs its own module registry rather than a spy on that one.
    vi.resetModules();
    vi.doMock("@tauri-apps/api/event", () => ({
      emit: () => Promise.reject(new Error("no bus")),
      listen: () => Promise.resolve(() => {}),
    }));
    const fresh = await import("./dashboardSync");
    await expect(fresh.notifyDashboardChanged("d1")).resolves.toBeUndefined();
    expect(__read("logs/bdobb.log") ?? "").toContain("could not announce a change to dashboard d1");
    vi.doUnmock("@tauri-apps/api/event");
    vi.resetModules();
  });
});
