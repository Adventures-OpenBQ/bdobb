// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "vitest";
import { __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import type { SyncLink } from "../lib/types";
import { linkFor, useWorkspaceSyncStore } from "./workspaceSyncStore";

const link: SyncLink = { dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "u1", serverUpdatedDate: "t1", localRevisionAtSync: 2, shared: false };
beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
});

describe("workspaceSyncStore", () => {
  it("starts empty without a file, and keeps links and tombstones across a restart", async () => {
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState().links).toEqual([]);
    await useWorkspaceSyncStore.getState().update((f) => ({ links: [...f.links, link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] }));
    expect(JSON.parse(__read("workspaceSync.json") ?? "null")).toEqual({ links: [link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] });
    useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] });
  });

  it("reads an invalid file as empty", async () => {
    __seed("workspaceSync.json", JSON.stringify({ links: [{ dashboardId: 1 }], tombstones: [] }));
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState().links).toEqual([]);
  });

  it("does not let two overlapping updates revert each other", async () => {
    await Promise.all([
      useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links, link] })),
      useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links, { ...link, dashboardId: "d2" }] })),
    ]);
    expect(useWorkspaceSyncStore.getState().links.map((l) => l.dashboardId)).toEqual(["d1", "d2"]);
  });

  it("finds a dashboard's live link on one connection, never a dismissed one", () => {
    const links = [link, { ...link, dashboardId: "d2", dismissed: true }];
    expect(linkFor(links, "ws1", "d1")).toBe(link);
    expect(linkFor(links, "ws1", "d2")).toBeUndefined();
    expect(linkFor(links, "ws2", "d1")).toBeUndefined();
  });
});
