// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { Skill } from "../skillsFiles";
import { forcedSkills, skillsCatalog } from "./skills";

const table: Skill = { slug: "openbb-html-table", description: "Tables.", content: "# T", enabled: true, updated: "2026-09-19T00:00:00.000Z", extra: {} };
const off: Skill = { ...table, slug: "off-skill", enabled: false };

describe("skillsCatalog", () => {
  it("lists enabled skills as slug, description and updatedAt", () => {
    expect(skillsCatalog([table, off])).toEqual([{ slug: "openbb-html-table", description: "Tables.", updatedAt: "2026-09-19T00:00:00.000Z" }]);
  });
});

describe("forcedSkills", () => {
  it("turns each /skill:<slug> in the text into a forced_slash payload, once", () => {
    expect(forcedSkills("/skill:openbb-html-table make a table /skill:openbb-html-table", [table, off])).toEqual([
      { slug: "openbb-html-table", description: "Tables.", contentMarkdown: "# T", source: "forced_slash" },
    ]);
  });

  it("ignores unknown and disabled slugs, and a slash inside a word", () => {
    expect(forcedSkills("/skill:nope /skill:off-skill x/skill:openbb-html-table", [table, off])).toEqual([]);
  });
});
