// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { MOCK_URL, read, seedApp, defaultSeed } from "./fixtures";

/**
 * Art's Charts against a local part 1 stack (openbq-docker v12, `charts-v12` profile) with fakes for
 * everything external: a test gateway token, a test ARTS_CHARTS_SECRET, a fake ODP, a local ntfy.
 * ARTS_E2E_GATEWAY is the stack's door as this machine reaches it (http://127.0.0.1:<port>);
 * ARTS_E2E_COMPOSE_DIR is the part 1 checkout, and COMPOSE_PROJECT_NAME / COMPOSE_FILE /
 * COMPOSE_PROFILES in the environment tell `docker compose exec` which project that is.
 */
const gw = process.env.ARTS_E2E_GATEWAY, token = process.env.ARTS_E2E_TOKEN, compose = process.env.ARTS_E2E_COMPOSE_DIR;
test.skip(!gw || !token || !compose, "needs a local charts-v12 stack with fakes (ARTS_E2E_*)");
const unique = (title: string) => `${title} ${Math.random().toString(36).slice(2, 8)}`; // the stack's inbox outlives a run
const auth = { Authorization: `Bearer ${token}` };

async function mcp(request: APIRequestContext, method: string, params: object) {
  const r = await request.post(`${gw}/charts/mcp`, { headers: { ...auth, Accept: "application/json, text/event-stream", "Content-Type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method, params } });
  expect(r.ok()).toBeTruthy();
  return r;
}

/** The tool's structured result (or the JSON in its first text block). */
async function callTool(request: APIRequestContext, name: string, args: object): Promise<{ document: { id: string; revision: number } }> {
  const r = await mcp(request, "tools/call", { name, arguments: args });
  const text = await r.text();
  const data = text.startsWith("event:") || text.startsWith("data:")
    ? JSON.parse(text.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) : JSON.parse(text);
  expect(data.error, JSON.stringify(data.error)).toBeUndefined();
  return data.result.structuredContent ?? JSON.parse(data.result.content[0].text);
}

/** Runs python inside the arts-charts container, with the stack's own env (secret, Basic pair) and no argv secrets. */
function inContainer(code: string): string {
  return execFileSync("docker", ["compose", "exec", "-T", "arts-charts", "python", "-c", code], { cwd: compose, encoding: "utf8" }).trim();
}

/**
 * The worker's own route (POST /inbox), reached from inside the stack the way the worker reaches it:
 * a signed worker token and the stack pair. Returns the new item's id.
 */
function postInboxItem(title: string, chartIds: string[]): string {
  return inContainer(`
import os, httpx
from arts_charts.tokens import sign
r = httpx.post("http://localhost:8000/inbox",
  headers={"x-arts-charts-worker": sign(os.environ["ARTS_CHARTS_SECRET"], "worker", 60)},
  auth=(os.environ["OPENBB_API_USERNAME"], os.environ["OPENBB_API_PASSWORD"]),
  json={"kind": "watch", "title": ${JSON.stringify(title)}, "body": "e2e", "chart_ids": ${JSON.stringify(chartIds)}, "snapshots": []})
assert r.status_code == 201, r.text
print(r.json()["id"])`);
}

/** Connections dialog -> Connect Art's Charts server (gateway door), as a user would. */
async function addArtsChartsConnection(page: Page) {
  await page.hover("nav.left-rail");
  await page.locator("nav.left-rail[data-expanded='true']").waitFor();
  await page.getByRole("button", { name: "Connections" }).click();
  await page.getByRole("button", { name: "Connect Art's Charts server" }).click();
  const form = page.getByRole("dialog", { name: "Connect backend" });
  await form.getByLabel("Name").fill("Local Art's Charts");
  await form.getByLabel("Endpoint URL").fill(gw!);
  await form.getByLabel("Key").fill("Authorization");
  await form.getByLabel("Value").fill(`Bearer ${token}`);
  await form.getByRole("button", { name: "Add" }).click();
  await form.waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.mouse.move(640, 400);
}

async function addCardFromLibrary(page: Page, name: string) {
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();
  await overlay.locator(".library-card", { hasText: name }).first().click();
  await page.keyboard.press("Escape");
}

type Card = { id: string; widgetId: string; params: Record<string, string> };
async function cards(page: Page): Promise<Card[]> {
  const raw = await read(page, "dashboards/d1.json");
  if (!raw) return [];
  return (JSON.parse(raw) as { tabs: { cards: Card[] }[] }).tabs.flatMap((t) => t.cards);
}
const cardCount = async (page: Page) => (await cards(page)).length;
const lastCardParams = async (page: Page) => {
  const last = (await cards(page)).at(-1);
  return last?.widgetId === "arts_chart" ? last.params : undefined;
};
async function chartIdOfLastCard(page: Page): Promise<string> {
  await expect.poll(async () => (await lastCardParams(page))?.chart_id ?? "", { timeout: 15_000 }).not.toBe("");
  return (await lastCardParams(page))!.chart_id!;
}

async function createChartViaMcp(request: APIRequestContext): Promise<string> {
  const made = await callTool(request, "create_chart", { symbol: "AAPL", interval: "1d", title: "E2E" });
  return made.document.id as string;
}

test("a library card creates a document; a Rita MCP edit reaches it within 1 s", async ({ page, request }) => {
  await seedApp(page, { ...defaultSeed() });
  await addArtsChartsConnection(page);
  await addCardFromLibrary(page, "Art's Charts");
  const id = await chartIdOfLastCard(page);
  const doc = await (await request.get(`${gw}/charts/${id}`, { headers: auth })).json();
  const t0 = Date.now();
  await callTool(request, "arrange_chart", { chart_id: id, expected_revision: doc.revision, ops: [{ op: "set_interval", interval: "1h" }] });
  // The chart's own status line reads "<interval> @ <time>" for the bar under the cursor.
  await expect(page.getByText(/^1h @/)).toBeVisible({ timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1000);
});

test("an inbox item raises the badge; Open chart, Add to dashboard, Add as live chart", async ({ page, request }) => {
  await seedApp(page, { ...defaultSeed() });
  await addArtsChartsConnection(page);
  const chartId = await createChartViaMcp(request);
  const title = unique("AAPL crossed");
  postInboxItem(title, [chartId]);
  await page.getByRole("button", { name: /^Inbox, \d+ unread$/ }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Inbox, \d+ unread$/ }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  const before = await cardCount(page);
  await page.getByRole("button", { name: "Add to dashboard" }).first().click();
  // The card carries the widget's defaults too (symbol, interval, provider, panels); the link is chart_id.
  await expect.poll(() => lastCardParams(page)).toMatchObject({ chart_id: chartId });
  expect(await lastCardParams(page)).not.toHaveProperty("live");
  await page.getByRole("button", { name: "Add as live chart" }).first().click();
  await expect.poll(() => lastCardParams(page)).toMatchObject({ chart_id: chartId, live: "true" });
  await expect(page.locator(".chart-live-note")).toHaveCount(1);
  await page.getByRole("button", { name: "Open chart" }).first().click();
  await expect(page.locator(".card-reveal")).toHaveCount(1);
  await expect.poll(() => cardCount(page)).toBe(before + 2); // focused, not added
});

test("a link opens that inbox item", async ({ page }) => {
  const title = unique("Link target");
  const itemId = postInboxItem(title, []);
  await seedApp(page, { ...defaultSeed(), "backends.json": JSON.stringify([
    { id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false },
    { id: "ac", name: "Local Art's Charts", baseUrl: gw, kind: "arts-charts", door: "gateway", headerName: "Authorization", headerValue: `Bearer ${token}`, authLocation: "header", validateWidgets: false },
  ]) }, `/?inbox=${itemId}`);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("e2e", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);                    // the query is cleared
});
