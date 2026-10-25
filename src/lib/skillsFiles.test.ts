// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __list, __read, __reset, __seed } from "../test/memfs";
import {
  bundledSkills,
  deleteSkill,
  formatSkillFile,
  isSkillSlug,
  loadSkills,
  parseSkillFile,
  saveSkill,
  type Skill,
} from "./skillsFiles";

vi.mock("./logger", () => ({ logError: vi.fn(async () => {}) }));
import { logError } from "./logger";

const FILE = `---
name: my-skill
description: Does a thing.
enabled: false
updated: 2026-09-19T20:00:00.000Z
copyright: Someone
---

# My skill

Body line.
`;

const skill: Skill = {
  slug: "my-skill",
  description: "Does a thing.",
  content: "# My skill\n\nBody line.",
  enabled: false,
  updated: "2026-09-19T20:00:00.000Z",
  extra: { copyright: "Someone" },
};

beforeEach(() => {
  __reset();
  vi.mocked(logError).mockClear();
});

describe("isSkillSlug", () => {
  it.each(["a", "my-skill", "openbb-html-report", "x1-2"])("accepts %s", (s) => expect(isSkillSlug(s)).toBe(true));
  it.each(["", "-a", "a-", "My-Skill", "a b", "a/b", "..", "a".repeat(65)])("refuses %j", (s) =>
    expect(isSkillSlug(s)).toBe(false),
  );
});

describe("parseSkillFile / formatSkillFile", () => {
  it("round-trips, keeping unknown frontmatter keys", () => {
    expect(parseSkillFile("my-skill", FILE)).toEqual(skill);
    expect(formatSkillFile(skill)).toBe(FILE);
  });

  it("treats a missing enabled as true and a missing updated as empty", () => {
    const parsed = parseSkillFile("s", "---\nname: s\ndescription: d\n---\nbody\n");
    expect(parsed).toMatchObject({ enabled: true, updated: "", content: "body" });
  });

  it("keeps a colon inside the description", () => {
    expect(parseSkillFile("s", "---\nname: s\ndescription: a: b\n---\nx\n")?.description).toBe("a: b");
  });

  it("returns null when the name disagrees with the folder, the description is missing, or there is no frontmatter", () => {
    expect(parseSkillFile("s", "---\nname: other\ndescription: d\n---\nx\n")).toBeNull();
    expect(parseSkillFile("s", "---\nname: s\n---\nx\n")).toBeNull();
    expect(parseSkillFile("s", "# just markdown\n")).toBeNull();
  });

  it("reads a CRLF file (Windows save, or a CRLF-writing editor) the same as its LF twin", () => {
    expect(parseSkillFile("my-skill", FILE.replace(/\n/g, "\r\n"))).toEqual(skill);
  });

  it("keeps a body that begins with --- and a frontmatter value of ---", () => {
    const text = "---\nname: s\ndescription: d\nnote: ---\n---\n\n---\n\nrule first\n";
    const parsed = parseSkillFile("s", text);
    expect(parsed).toMatchObject({ description: "d", extra: { note: "---" }, content: "---\n\nrule first" });
    expect(parseSkillFile("s", formatSkillFile(parsed!))).toEqual(parsed);
  });
});

describe("bundledSkills", () => {
  it("ships this project's own skills (no copyright line) and the three openbb-html skills (OpenBB's, with one), sorted", () => {
    const seeds = bundledSkills();
    expect(seeds.map((s) => s.slug)).toEqual([
      "arrange-table",
      "build-dashboard",
      "openbb-html-chart",
      "openbb-html-report",
      "openbb-html-table",
    ]);
    for (const s of seeds) {
      expect(s.enabled).toBe(true);
      expect(s.content.length).toBeGreaterThan(100);
      // The vendored OpenBB skills carry a copyright line; this project's own do not.
      if (s.slug.startsWith("openbb-html-")) expect(s.extra.copyright).toMatch(/OpenBB/);
      else expect(s.extra.copyright).toBeUndefined();
    }
  });
});

describe("loadSkills", () => {
  it("seeds the bundled skills when the skills directory does not exist, and stamps updated", async () => {
    const loaded = await loadSkills();
    expect(loaded.map((s) => s.slug)).toEqual([
      "arrange-table",
      "build-dashboard",
      "openbb-html-chart",
      "openbb-html-report",
      "openbb-html-table",
    ]);
    expect(loaded[0].updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(__list()).toContain("skills/openbb-html-report/SKILL.md");
    expect(__read("skills/openbb-html-chart/SKILL.md")).toContain("copyright: ");
    expect(__read("skills/arrange-table/SKILL.md")).not.toContain("copyright: ");
  });

  it("never reseeds once the directory exists, even empty", async () => {
    // memfs infers a directory only from files under it (or an explicit
    // mkdir), so deleting the only file would make exists("skills") read
    // false and loadSkills() would reseed -- memfs behaviour, not disk
    // behaviour (on disk the folder stays). A placeholder file keeps the
    // directory present across the delete, same as it would be on disk.
    __seed("skills/.keep", "");
    __seed("skills/my-skill/SKILL.md", FILE);
    expect(await loadSkills()).toEqual([skill]);
    await deleteSkill("my-skill");
    expect(await loadSkills()).toEqual([]);
  });

  it("skips a folder whose file is not a skill and logs it, and skips a folder with a bad name silently", async () => {
    __seed("skills/my-skill/SKILL.md", FILE);
    __seed("skills/broken/SKILL.md", "---\nname: nope\n---\nx\n");
    __seed("skills/Bad Name/SKILL.md", FILE);
    expect((await loadSkills()).map((s) => s.slug)).toEqual(["my-skill"]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logError).mock.calls[0][0]).toContain("broken");
  });

  it("admits a symlinked skill folder — readDir reports isDirectory: false, isSymlink: true — and the exists() check after it decides", async () => {
    // memfs has no notion of a symlink, so the only cheap way to exercise
    // this guard is to hand loadSkills a readDir result shaped the way
    // Tauri's real plugin reports one, for this one call only; exists()
    // and readTextFile() below it still run against the real memfs state.
    __seed("skills/linked-skill/SKILL.md", FILE.replace(/my-skill/g, "linked-skill"));
    const fsMod = await import("@tauri-apps/plugin-fs");
    vi.spyOn(fsMod, "readDir").mockResolvedValueOnce([
      { name: "linked-skill", isFile: false, isDirectory: false, isSymlink: true },
    ]);
    expect((await loadSkills()).map((s) => s.slug)).toEqual(["linked-skill"]);
  });
});

describe("saveSkill / deleteSkill", () => {
  it("writes SKILL.md under the slug's folder and reads it back", async () => {
    __seed("skills/.keep", "");
    await saveSkill(skill);
    expect(__read("skills/my-skill/SKILL.md")).toBe(FILE);
    expect(await loadSkills()).toEqual([skill]);
    expect(__list().filter((p) => p.includes(".tmp"))).toEqual([]);
  });

  it("refuses a slug that is not a slug before touching the disk", async () => {
    await expect(saveSkill({ ...skill, slug: "../x" })).rejects.toThrow("not a skill slug");
    await expect(deleteSkill("../x")).rejects.toThrow("not a skill slug");
    expect(__list()).toEqual([]);
  });

  it("deleting a skill that is already gone is not an error", async () => {
    await expect(deleteSkill("my-skill")).resolves.toBeUndefined();
  });
});


it("bundles provider-preserving recovery instead of inventing a fallback operator", () => {
  const skill = bundledSkills().find(s => s.slug === "arrange-table")!;
  expect(skill.content).not.toContain("choose by meaning instead");
  expect(skill.content).toMatch(/do not substitute a different operator/i);
  expect(skill.content).toMatch(/leave `aggregation` out/);
  expect(skill.content).toMatch(/user explicitly named an operator/);
  expect(skill.content).toContain('aggregation_intent: "user_override"');
  expect(skill.content).toMatch(/date category does not mean.*only/i);
  expect(skill.content).toMatch(/only if the user explicitly excludes/i);
});
