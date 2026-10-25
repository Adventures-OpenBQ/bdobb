// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { backend } from "../test/fixtures";
import { KEY_REFUSED, canonicalUuid, deleteApp, fetchOwnedDashboards, fetchServerStore, postDashboardItems, putApp, type WorkspaceSession } from "./workspaceAccount";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const UUID = "aaaaaaaa-0000-4000-8000-000000000002";
const login: WorkspaceSession = { mode: "login", connection: { id: "ws1", name: "Work", baseUrl: "https://workspace.example/api" }, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {} };
const keyed = (): WorkspaceSession => {
  const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "X-Key", headerValue: "synthetic-key" });
  return { mode: "key", connection: { id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b }, displaySettings: {} };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const record = (content: unknown, updated = "2026-10-11T00:00:01Z") => ({ creator: true, content, created_date: updated, updated_date: updated, created_by: "Example User", is_shared: false });
/** Answers by path; anything unlisted is 404. */
function routes(map: Record<string, () => Response>) {
  vi.mocked(fetch).mockImplementation(async (url) => (map[new URL(String(url)).pathname] ?? (() => json({}, 404)))());
}
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => [init?.method ?? "GET", new URL(String(url)).pathname, init?.headers as Record<string, string>] as const);
// A block body: an arrow returning the mock would hand vitest a cleanup hook that calls fetch().
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

describe("canonicalUuid", () => {
  it("dashes a hex uuid and lowercases either spelling", () => {
    expect(canonicalUuid(UUID.replace(/-/g, "").toUpperCase())).toBe(UUID);
    expect(canonicalUuid(UUID.toUpperCase())).toBe(UUID);
  });
});

describe("fetchServerStore", () => {
  it("reads owned, shared and apps under canonical keys, with the session token as Bearer", async () => {
    routes({
      "/api/pro/dash/sync/owned": () => json({ owned: { [UUID.replace(/-/g, "")]: record({ data: {} }) } }),
      "/api/pro/dash/sync/shared": () => json({ shared: { s1: record({ data: {} }, "d2") }, entity_shared: { s2: record({ data: {} }, "d3") } }),
      "/api/pro/user-apps/sync": () => json({ owned: { a1: { content: { name: "A" }, updatedDate: "d4" } }, shared: {} }),
    });
    const result = await fetchServerStore(login);
    expect(result).toEqual({ ok: true, value: {
      owned: { [UUID]: { content: { data: {} }, updated: "2026-10-11T00:00:01Z" } },
      shared: { s1: { content: { data: {} }, updated: "d2" }, s2: { content: { data: {} }, updated: "d3" } },
      apps: { a1: { content: { name: "A" }, updated: "d4" } },
    } });
    expect(calls().every(([, , headers]) => headers.Authorization === "Bearer synthetic-session")).toBe(true);
  });

  it("is null when owned answers 404, and treats a missing shared or apps route as empty", async () => {
    routes({});
    expect(await fetchServerStore(login)).toEqual({ ok: true, value: null });
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: {} }) });
    expect(await fetchServerStore(login)).toEqual({ ok: true, value: { owned: {}, shared: {}, apps: {} } });
  });

  it("expires a login session on 401 and reports a key-mode 401 as a refused key", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({}, 401) });
    expect(await fetchServerStore(login)).toMatchObject({ ok: false, expired: true });
    routes({ "/pro/dash/sync/owned": () => json({}, 401) });
    expect(await fetchServerStore(keyed())).toEqual({ ok: false, message: KEY_REFUSED, expired: false });
    expect(calls().at(-1)?.[2]["X-Key"]).toBe("synthetic-key");
  });

  it("refuses a list without dates, and never repeats server text", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: { x: { content: {} } } }) });
    expect(await fetchServerStore(login)).toMatchObject({ ok: false, expired: false });
    routes({ "/api/pro/dash/sync/owned": () => json({ detail: "secret-server-text" }, 500) });
    const failed = await fetchServerStore(login);
    expect(failed).toMatchObject({ ok: false, message: expect.stringContaining("HTTP 500") });
    expect(JSON.stringify(failed)).not.toContain("secret-server-text");
  });
});

describe("dashboard and app writes", () => {
  it("posts items to /pro/dash/sync and reports 404 as absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ success: true }));
    expect(await postDashboardItems(login, { [UUID]: "DELETE" })).toEqual({ ok: true, value: "ok" });
    expect(calls()[0].slice(0, 2)).toEqual(["POST", "/api/pro/dash/sync"]);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ items: { [UUID]: "DELETE" } });
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 404));
    expect(await postDashboardItems(login, {})).toEqual({ ok: true, value: "absent" });
  });

  it("upserts and deletes one app by uuid", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json({}, 404));
    expect(await putApp(login, UUID, { name: "A" })).toEqual({ ok: true, value: "ok" });
    expect(await deleteApp(login, UUID)).toEqual({ ok: true, value: "absent" });
    expect(calls().map(([m, p]) => [m, p])).toEqual([["POST", `/api/pro/user-apps/${UUID}`], ["DELETE", `/api/pro/user-apps/${UUID}`]]);
  });

  it("reads owned dashboards alone", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: { [UUID]: record({ isRoot: true }) } }) });
    expect(await fetchOwnedDashboards(login)).toEqual({ ok: true, value: { [UUID]: { content: { isRoot: true }, updated: "2026-10-11T00:00:01Z" } } });
  });
});
