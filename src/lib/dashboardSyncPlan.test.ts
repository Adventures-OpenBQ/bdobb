// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { planDashboardSync, type ServerItem } from "./dashboardSyncPlan";
import type { SyncLink } from "./types";

const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "u1", serverUpdatedDate: "t1", localRevisionAtSync: 2, shared: false, ...over });
const item = (over: Partial<ServerItem> = {}): ServerItem => ({ store: "dashboard", uuid: "u1", updated: "t1", shared: false, dashboard: { id: "server", name: "S", tabs: [] }, ...over });
const local = (revision: number) => [{ id: "d1", revision }];
const kinds = (actions: ReturnType<typeof planDashboardSync>) => actions.map((a) => a.kind);

describe("planDashboardSync", () => {
  it.each([
    ["server changed, local unchanged: take server", local(2), [item({ updated: "t2" })], ["take"]],
    ["server unchanged, local changed: upload", local(3), [item()], ["upload"]],
    ["both changed: ask", local(3), [item({ updated: "t2" })], ["conflict"]],
    ["deleted on server, local unchanged: delete local", local(2), [], ["deleteLocal"]],
    ["deleted on server, local changed: ask", local(3), [], ["deletedConflict"]],
    ["neither changed: nothing", local(2), [item()], []],
  ] as const)("%s", (_, dashboards, items, expected) => {
    expect(kinds(planDashboardSync("ws1", [link()], [...dashboards], [...items]))).toEqual(expected);
  });

  it("creates a server item no link names, and uploads a local dashboard no link names", () => {
    const actions = planDashboardSync("ws1", [], [{ id: "d1" }], [item()]);
    expect(actions).toEqual([{ kind: "create", item: item() }, { kind: "uploadNew", dashboardId: "d1" }]);
  });

  it("never counts a shared dashboard as changed locally", () => {
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), [item({ shared: true })]))).toEqual([]);
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), [item({ shared: true, updated: "t2" })]))).toEqual(["take"]);
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), []))).toEqual(["deleteLocal"]);
  });

  it("never downloads a dismissed shared dashboard again", () => {
    expect(planDashboardSync("ws1", [link({ shared: true, dismissed: true })], [], [item({ shared: true })])).toEqual([]);
  });

  it("drops a link whose dashboard is gone here, so its server item is new", () => {
    expect(kinds(planDashboardSync("ws1", [link()], [], [item()]))).toEqual(["dropLink", "create"]);
  });

  it("reads only this connection's links, and tells a dashboard from an app with the same uuid", () => {
    const actions = planDashboardSync("ws1", [link({ connectionId: "ws2" })], local(2), [item({ store: "app" })]);
    expect(kinds(actions)).toEqual(["create", "uploadNew"]);
  });
});
