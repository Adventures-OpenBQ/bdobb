// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { GUIDE_PAGES, GUIDE_PREFIX } from "./guide";
import { TOPICS } from "./index";

const guide = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)!.body;

it("documents Window ▸ Keep Sidebar Open on the shortcut and workspace pages", () => {
  for (const body of [guide("keyboard-shortcuts"), topic("keyboard-shortcuts"), guide("workspaces"), topic("workspaces")]) {
    expect(body).toContain("Keep Sidebar Open");
  }
});

it("documents Window ▸ Keep Rita Open and where ⌘⇧A works in the desktop app", () => {
  for (const body of [guide("keyboard-shortcuts"), topic("keyboard-shortcuts"), guide("rita-chat"), topic("rita")]) {
    expect(body).toContain("Keep Rita Open");
  }
  expect(guide("keyboard-shortcuts")).not.toContain("`⌘⇧A` does nothing while the message box has focus, like every global shortcut");
});
