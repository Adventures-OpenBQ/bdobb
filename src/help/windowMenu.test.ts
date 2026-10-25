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
