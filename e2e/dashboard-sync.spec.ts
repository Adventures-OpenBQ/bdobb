// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The Workspace dashboard-sync UI, in real Chromium against a REAL local
// key-mode settings server (the bdobb-dashsync-test container on loopback).
// This is the end-to-end layer the unit suites (runDashboardSync.test.ts,
// LeftRail.sync.test.tsx, bootstrap.test.ts) leave manual.
//
//   docker run … openbq-local:3.0.0-dashsync   # already running on :17400
//   pnpm test:dashsync                          # or the command below
//
// Browser mode talks to the server through the page's own fetch, so the
// browser server runs on a CORS-allowed port:
//   BDOBB_BROWSER_PORT=4491 BDOBB_MOCK_PORT=4492 \
//     pnpm exec playwright test e2e/dashboard-sync.spec.ts
//
// OPT-IN, NOT SKIP-IF-UNREACHABLE (like src/test/integration/reference-backend
// .test.ts): without DASHSYNC_TEST=1 the whole file skips; with it and no
// server, beforeAll fails loudly rather than reporting green against nothing.
//
// The Basic credential is read from the gitignored .env.dashsync-test.local at
// the worktree root and built in memory; it is never written into this file,
// logged, or asserted on.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openRail, read, seedApp, type SeedFiles } from "./fixtures";

const RUN = process.env.DASHSYNC_TEST === "1";
const BACKEND_ID = "dashsrv";
const SERVER_NAME = "Dash Server";

/** Filled by beforeAll from the fixture; unread while the file is skipped. */
let SERVER: { origin: string; basic: string };

function loadFixture(): { origin: string; basic: string } {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.dashsync-test.local");
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  const url = env.DASHSYNC_TEST_URL;
  const user = env.DASHSYNC_TEST_USER;
  const password = env.DASHSYNC_TEST_PASSWORD;
  if (!url || !user || !password) {
    throw new Error(".env.dashsync-test.local is missing DASHSYNC_TEST_URL, DASHSYNC_TEST_USER or DASHSYNC_TEST_PASSWORD");
  }
  return { origin: new URL(url).origin, basic: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}

const authHeaders = () => ({ Authorization: SERVER.basic });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

type OwnedRecord = { content?: { isFolder?: boolean; data?: { name?: string } } };

/** The server's owned dashboards (not folders), by canonical uuid, with their names. */
async function ownedDashboards(request: APIRequestContext): Promise<{ uuid: string; name: string }[]> {
  const res = await request.get(`${SERVER.origin}/pro/dash/sync/owned`, { headers: authHeaders() });
  if (!res.ok()) throw new Error(`GET /pro/dash/sync/owned answered ${res.status()}`);
  const body = (await res.json()) as { owned?: Record<string, OwnedRecord> };
  return Object.entries(body.owned ?? {})
    .filter(([, r]) => r.content?.isFolder !== true)
    .map(([uuid, r]) => ({ uuid: uuid.toLowerCase(), name: r.content?.data?.name ?? "" }));
}

const ownedNames = async (request: APIRequestContext) => (await ownedDashboards(request)).map((d) => d.name);

/** POST one dashboard to the server as another device would — the server wires the root folder itself. */
async function postServerDashboard(request: APIRequestContext, name: string): Promise<string> {
  const uuid = randomUUID();
  const item = { index: uuid, isFolder: false, parentId: null, data: { name, widgets: [], gridLayout: { "tab-1": [] } } };
  const res = await request.post(`${SERVER.origin}/pro/dash/sync`, { headers: jsonHeaders(), data: { items: { [uuid]: item } } });
  if (!res.ok()) throw new Error(`POST /pro/dash/sync answered ${res.status()}`);
  return uuid;
}

/** Reset server state between tests/runs via the API: delete every owned dashboard (folders stay). */
async function resetServer(request: APIRequestContext): Promise<void> {
  const items: Record<string, "DELETE"> = {};
  for (const d of await ownedDashboards(request)) items[d.uuid] = "DELETE";
  if (Object.keys(items).length === 0) return;
  const res = await request.post(`${SERVER.origin}/pro/dash/sync`, { headers: jsonHeaders(), data: { items } });
  if (!res.ok()) throw new Error(`reset POST /pro/dash/sync answered ${res.status()}`);
}

/** settings pointing at the key-mode backend, the backend itself, and the given local dashboards. */
function seedFiles(dashboards: Record<string, string>): SeedFiles {
  const files: SeedFiles = {
    "settings.json": JSON.stringify({ settingsStorage: BACKEND_ID }),
    "backends.json": JSON.stringify([
      { id: BACKEND_ID, name: SERVER_NAME, baseUrl: SERVER.origin, headerName: "Authorization", headerValue: SERVER.basic, authLocation: "header", validateWidgets: false },
    ]),
  };
  for (const [id, name] of Object.entries(dashboards)) {
    files[`dashboards/${id}.json`] = JSON.stringify({ id, name, tabs: [{ id: `${id}-t`, name: "Main", cards: [] }] });
  }
  return files;
}

type Memfs = { list: () => string[]; read: (p: string) => string | undefined };

/**
 * A real relaunch: browser-mode memfs reseeds from __bdobbSeed on every load,
 * so preserve what the app wrote (links, tombstones, dashboards) into a fresh
 * seed before reloading. Server state is external and survives on its own.
 */
async function relaunch(page: Page): Promise<void> {
  const files = await page.evaluate(() => {
    const b = (window as unknown as { __bdobb: Memfs }).__bdobb;
    const out: Record<string, string> = {};
    for (const p of b.list()) {
      const c = b.read(p);
      if (c !== undefined) out[p] = c;
    }
    return out;
  });
  await page.addInitScript((seed) => {
    (window as unknown as { __bdobbSeed?: Record<string, string> }).__bdobbSeed = seed;
  }, files);
  await page.reload();
  await page.locator("nav.left-rail").waitFor();
}

const railLabels = (page: Page) =>
  page.locator("nav.left-rail [data-testid='rail-dashboards'] .rail-item-label");

const syncFile = async (page: Page): Promise<{ links: { uuid: string }[]; tombstones: { uuid: string }[] }> => {
  const raw = await read(page, "workspaceSync.json");
  return raw ? (JSON.parse(raw) as { links: { uuid: string }[]; tombstones: { uuid: string }[] }) : { links: [], tombstones: [] };
};

test.describe("Workspace dashboard sync against a real key-mode server", () => {
  test.skip(!RUN, "opt-in: set DASHSYNC_TEST=1 to run against the local key-mode dashsync server");

  test.beforeAll(async () => {
    SERVER = loadFixture();
    // Opt-in, not skip-if-unreachable: a suite that turned itself off when the
    // server was missing would report green for a broken client.
    const res = await fetch(`${SERVER.origin}/pro/user`, { headers: authHeaders() }).catch((cause: unknown) => {
      throw new Error(`dashsync server unreachable at ${SERVER.origin}; start the bdobb-dashsync-test container`, { cause });
    });
    if (!res.ok) throw new Error(`dashsync server answered ${res.status} at ${SERVER.origin}/pro/user`);
  });

  test.beforeEach(async ({ request }) => {
    await resetServer(request);
  });
  test.afterEach(async ({ request }) => {
    await resetServer(request);
  });

  test("connects in key mode on startup with no sign-in dialog, and the sync runs", async ({ page, request }) => {
    await seedApp(page, seedFiles({ "d-main": "Main" }));
    // The sync ran under key mode: the local dashboard reached the server with
    // no prompt. A login-mode server could not have got here without the user.
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Main");
    // Key mode never opens the sign-in dialog, and an empty server
    // pro_display_settings leaves nothing for the settings conflict to ask.
    await expect(page.getByRole("dialog", { name: /^Sign in to/ })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Settings differ" })).toHaveCount(0);
  });

  test("uploads a local dashboard to the server and records its link", async ({ page, request }) => {
    await seedApp(page, seedFiles({ "d-main": "Main" }));
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Main");
    const uuid = (await ownedDashboards(request)).find((d) => d.name === "Main")!.uuid;
    // The link in workspaceSync.json points at the uuid the server now holds.
    await expect.poll(async () => (await syncFile(page)).links.map((l) => l.uuid.toLowerCase()), { timeout: 15_000 }).toContain(uuid);
  });

  test("renaming the dashboard in the rail reaches the server", async ({ page, request }) => {
    await seedApp(page, seedFiles({ "d-main": "Main" }));
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Main");

    await openRail(page);
    await page.getByRole("button", { name: "Main", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const field = page.getByRole("textbox", { name: "Rename dashboard" });
    await field.fill("Renamed");
    await field.press("Enter");

    // The auto-upload settles after its debounce and carries the new name up.
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Renamed");
    expect(await ownedNames(request)).not.toContain("Main");
  });

  test("a dashboard added on the server appears after relaunch", async ({ page, request }) => {
    await seedApp(page, seedFiles({ "d-local": "Local Home" }));
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Local Home");
    await openRail(page);
    await expect(railLabels(page)).toHaveText(["Local Home"]);

    await postServerDashboard(request, "From Server");
    await relaunch(page);

    await openRail(page);
    await expect.poll(() => railLabels(page).allTextContents(), { timeout: 15_000 }).toContain("From Server");
    await expect(railLabels(page)).toContainText(["Local Home"]);
  });

  test('the rail delete confirm reads: Delete "X" here and on <server>?', async ({ page }) => {
    await seedApp(page, seedFiles({ "d-main": "Main" }));
    // Only a synced dashboard names the server, so wait for its link first.
    await expect.poll(async () => (await syncFile(page)).links.length, { timeout: 15_000 }).toBeGreaterThan(0);

    let message = "";
    page.on("dialog", (d) => {
      message = d.message();
      void d.dismiss();
    });
    await openRail(page);
    await page.getByRole("button", { name: "Main", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect.poll(() => message).toBe(`Delete "Main" here and on ${SERVER_NAME}?`);
  });

  test("an offline rail delete leaves a tombstone that the next sync consumes", async ({ page, request }) => {
    // One route for the server, toggled by a flag: page routes persist across
    // reload and unroute-by-reference is brittle, so a flag is the reliable way
    // to take the server offline for the delete and back online for relaunch.
    let serverBlocked = false;
    await page.route((url) => url.href.startsWith(SERVER.origin), (route) =>
      serverBlocked ? route.abort() : route.continue(),
    );

    await seedApp(page, seedFiles({ "d-main": "Main" }));
    await expect.poll(() => ownedNames(request), { timeout: 15_000 }).toContain("Main");
    const uuid = (await ownedDashboards(request)).find((d) => d.name === "Main")!.uuid;

    // Make the server unreachable for the page, then confirm the delete.
    serverBlocked = true;
    page.on("dialog", (d) => void d.accept());
    await openRail(page);
    await page.getByRole("button", { name: "Main", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // The local file is gone and a tombstone is left for the server delete.
    await expect.poll(() => read(page, "dashboards/d-main.json")).toBeUndefined();
    await expect.poll(async () => (await syncFile(page)).tombstones.map((t) => t.uuid.toLowerCase())).toContain(uuid);
    // The delete never reached the server while it was blocked.
    expect(await ownedNames(request)).toContain("Main");

    // Un-block and relaunch: the next sync sends the tombstone first.
    serverBlocked = false;
    await relaunch(page);
    // By uuid, not name: with its only dashboard gone the app makes a fresh
    // default "Main" and syncs that up as a new server dashboard.
    await expect
      .poll(async () => (await ownedDashboards(request)).map((d) => d.uuid.toLowerCase()), { timeout: 15_000 })
      .not.toContain(uuid);
    await expect.poll(async () => (await syncFile(page)).tombstones.length, { timeout: 15_000 }).toBe(0);
  });
});
