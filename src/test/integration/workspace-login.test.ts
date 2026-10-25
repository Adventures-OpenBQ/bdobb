// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// bdobb#9 against a REAL self-hosted Workspace server: the store's probe and
// sign-in (what the sign-in form calls), then the sign-in sync's staging
// (readSessionSettings), with every request recorded.
//
//   1. Run openbq-docker v2.0.0's Workspace image on loopback only, with a
//      throwaway admin account (see docs/releases/validation/*/fix-9-10-26-*/).
//   2. Put that account in .env.workspace-test.local (gitignored):
//        WORKSPACE_TEST_URL=http://127.0.0.1:<port>/api
//        WORKSPACE_TEST_EMAIL=...
//        WORKSPACE_TEST_PASSWORD=...
//   3. pnpm test:workspace
//
// OPT-IN, NOT SKIP-IF-UNREACHABLE: without WORKSPACE_TEST=1 the file skips;
// with it and no server, it fails.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readSessionSettings } from "../../lib/workspaceAccount";
import { useBackendsStore } from "../../stores/backendsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toSettingsConnections, useWorkspaceStore } from "../../stores/workspaceStore";
import { __list, __read } from "../memfs";

// The transport browser mode uses: the browser's own fetch (browser-shim/http).
vi.mock("@tauri-apps/plugin-http", () => import("../../browser-shim/http"));

const enabled = process.env.WORKSPACE_TEST === "1";

function fixture(): Record<string, string> {
  const text = readFileSync(resolve(__dirname, "../../../.env.workspace-test.local"), "utf8");
  return Object.fromEntries(
    text.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

type Seen = { method: string; path: string; headers: Record<string, string>; status: number };

describe.skipIf(!enabled)("Workspace sign-in against a self-hosted server (bdobb#9)", () => {
  const seen: Seen[] = [];
  let env: Record<string, string>;

  beforeAll(() => {
    env = fixture();
    const real = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const response = await real(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        status: response.status,
      });
      return response;
    };
  });

  it("signs in from POST /pro/login alone, stages the account's settings, and stores no secret", async () => {
    const store = useWorkspaceStore.getState();
    await store.load();
    const saved = await store.saveConnection({ name: "Local test Workspace", serverUrl: env.WORKSPACE_TEST_URL, askOnStartup: false });
    const connection = toSettingsConnections(useWorkspaceStore.getState().connections, useBackendsStore.getState().backends).find(
      (c) => c.id === saved.id,
    )!;

    expect(await store.probe(connection)).toBe("login");
    const probes = seen.length;

    expect(await store.signIn(connection, env.WORKSPACE_TEST_EMAIL, env.WORKSPACE_TEST_PASSWORD, true)).toBeNull();
    const session = useWorkspaceStore.getState().sessions[saved.id];
    expect(session?.mode).toBe("login");
    if (session?.mode !== "login") return;

    // The settings stage from the login response (no further request).
    const staged = readSessionSettings(session, useSettingsStore.getState().settings);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.value.patch.fontSize).toBe("medium");
      expect(staged.value.patch.maxDecimalPlaces).toBe(2);
    }

    // Sign-in is exactly one request: the login. No GET /pro/user rides on it.
    expect(seen.slice(probes).map((r) => `${r.method} ${r.path} ${r.status}`)).toEqual(["POST /api/pro/login 200"]);
    // The only 401 is the probe's deliberate unauthenticated GET /pro/user.
    expect(seen.filter((r) => r.status === 401).map((r) => r.path)).toEqual(["/api/pro/user"]);
    expect(seen[0].headers.authorization).toBeUndefined();
    // Nothing ever sends X-OpenBB-Authorization: that header is what the
    // server turns into "Not enough segments" for an opaque token.
    expect(seen.some((r) => "x-openbb-authorization" in r.headers)).toBe(false);

    // The profile holds the username (Remember me) and nothing secret.
    const files = __list();
    expect(files).toContain("workspace.json");
    for (const path of files) {
      const content = __read(path) ?? "";
      expect(content, path).not.toContain(env.WORKSPACE_TEST_PASSWORD);
      expect(content, path).not.toContain(session.token);
    }
  });
});
