// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, defaultSeed, openAILibrary, read, seedApp } from "./fixtures";

const MCP_URL = `${MOCK_URL}/mcp`;
const TOOL = "equity_price_historical";

async function seed(page: Page) {
  await seedApp(page, {
    ...defaultSeed(),
    "settings.json": JSON.stringify({
      ritaUrl: MOCK_URL,
      mcpServers: [{ id: "m1", url: MCP_URL, enabled: true, name: "OpenBQ MCP" }],
    }),
  });
}

/** Counts the JSON-RPC "tools/call" requests the browser sends to the MCP stub. */
function countToolCalls(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.url() === MCP_URL && r.method() === "POST" && (r.postData() ?? "").includes('"tools/call"')) n += 1;
  });
  return () => n;
}

async function ask(page: Page) {
  await page.getByRole("complementary", { name: "Rita AI pane" }).hover();
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("textbox", { name: "Message Rita" }).fill("proxied-tools-probe");
  await page.keyboard.press("Enter");
}

test("a proxied tool turned off in the AI Library is refused before anything is sent", async ({ page }) => {
  await seed(page);
  const toolCalls = countToolCalls(page);

  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  await dialog.getByRole("tab", { name: "MCP Servers" }).click();
  await dialog.getByRole("textbox", { name: `Proxied tool name for ${MCP_URL}` }).fill(TOOL);
  await dialog.getByRole("button", { name: `Add proxied tool for ${MCP_URL}` }).click();
  await expect(dialog.getByRole("checkbox", { name: new RegExp(TOOL) })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  const saved = JSON.parse((await read(page, "settings.json"))!);
  expect(saved.mcpDisabledTools[MCP_URL]).toEqual([TOOL]);
  expect(saved.mcpSeenProxiedTools[MCP_URL]).toEqual([TOOL]);

  await ask(page);
  const alert = page.getByRole("alert").filter({ hasText: "Tool call failed" });
  await expect(alert).toContainText(`${TOOL} (via call_tool)`);
  await expect(alert).toContainText("TOOL_DISABLED");
  await expect(alert).toContainText("not sent");
  await expect(page.getByText(/· 1 error$/)).toBeVisible();
  await expect(page.getByText("A stock ticker symbol")).toBeVisible();
  expect(toolCalls()).toBe(0);
});

test("the same call goes through when the name is not turned off, and the name is remembered", async ({ page }) => {
  await seed(page);
  const toolCalls = countToolCalls(page);
  await ask(page);
  // An external MCP call waits for the user (back-port of dev b1e6612):
  // nothing is sent until Run.
  const prompt = page.getByRole("group", { name: "Confirm tool call" });
  await expect(prompt).toBeVisible();
  expect(toolCalls()).toBe(0);
  await prompt.getByRole("button", { name: "Run" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByText("A stock ticker symbol")).toBeVisible();
  expect(toolCalls()).toBe(1);
  await expect(page.getByRole("alert").filter({ hasText: "Tool call failed" })).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await read(page, "settings.json")) ?? "{}").mcpSeenProxiedTools?.[MCP_URL])
    .toEqual([TOOL]);
});

// bdobb#43: Deny is a failed call the trail names and counts; Stop is not.
test("Deny sends nothing, and the trail shows the call as Denied, counted as the one error", async ({ page }) => {
  await seed(page);
  const toolCalls = countToolCalls(page);
  await ask(page);
  const prompt = page.getByRole("group", { name: "Confirm tool call" });
  await prompt.getByRole("button", { name: "Deny" }).click();
  await expect(prompt).toHaveCount(0);
  const trail = page.locator(".status-trail");
  await expect(trail.locator("summary")).toContainText("· 1 error");
  await trail.locator("summary").click();
  await expect(trail.locator("li.trail-error")).toContainText("Denied");
  expect(toolCalls()).toBe(0);
});

test("Stop during a running MCP call shows the call as Stopped, not as an error", async ({ page }) => {
  await seed(page);
  // Hold tools/call open, as a slow tool would; everything else reaches the stub.
  let held = false;
  await page.route(MCP_URL, async (route) => {
    if ((route.request().postData() ?? "").includes('"tools/call"')) {
      held = true;
      return; // never answered: Stop has to cut it short
    }
    await route.fallback();
  });
  await ask(page);
  await page.getByRole("group", { name: "Confirm tool call" }).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => held).toBe(true);
  await page.getByRole("button", { name: "Stop" }).click();
  const trail = page.locator(".status-trail");
  await expect(trail.locator("summary")).toContainText("· 0 errors");
  await trail.locator("summary").click();
  await expect(trail).toContainText("Stopped");
  await expect(page.getByRole("alert").filter({ hasText: "Tool call failed" })).toHaveCount(0);
});
