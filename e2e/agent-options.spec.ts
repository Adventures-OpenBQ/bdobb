// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { MOCK_URL, defaultSeed, seedApp } from "./fixtures";

test("a chat turn sends workspace_options as a keyed object with the stored agent options", async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  // Installed BEFORE seedApp (see its contract): the request can go out early.
  page.on("request", (req) => {
    if (req.url().endsWith("/v1/query") && req.method() === "POST") bodies.push(req.postDataJSON() as Record<string, unknown>);
  });
  const seed = defaultSeed();
  const settings = JSON.parse(seed["settings.json"] ?? "{}") as Record<string, unknown>;
  await seedApp(page, {
    ...seed,
    "settings.json": JSON.stringify({ ...settings, ritaUrl: MOCK_URL, agentOptions: { openbb_agent_rita: { "prompt-suggestions": false } } }),
  });
  await page.keyboard.press("Control+Shift+A");
  const pane = page.getByRole("complementary", { name: "Rita AI pane" });
  // Discovery must be online before the send, or workspace_options is {}.
  await expect(pane.getByText("openai:nemotron-3.5-lightning")).toBeVisible();
  await pane.getByRole("textbox").fill("hi");
  await pane.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.length).toBeGreaterThan(0);
  expect(bodies[0].workspace_options).toEqual({ "prompt-suggestions": false, model: "openai:nemotron-3.5-lightning" });
});
