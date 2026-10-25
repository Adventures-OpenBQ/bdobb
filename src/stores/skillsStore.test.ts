// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import type { Skill } from "../lib/skillsFiles";
import { __list, __read, __reset, __seed } from "../test/memfs";
import { useSkillsStore } from "./skillsStore";

const a: Skill = { slug: "a-skill", description: "A", content: "# A", enabled: true, updated: "2026-01-01T00:00:00.000Z", extra: {} };
const file = (s: Skill) =>
  `---\nname: ${s.slug}\ndescription: ${s.description}\nenabled: ${s.enabled}\nupdated: ${s.updated}\n---\n\n${s.content}\n`;

beforeEach(() => {
  __reset();
  useSkillsStore.setState({ skills: [] });
});

describe("skillsStore", () => {
  it("load reads what is on disk", async () => {
    __seed("skills/a-skill/SKILL.md", file(a));
    await useSkillsStore.getState().load();
    expect(useSkillsStore.getState().skills).toEqual([a]);
  });

  it("upsert adds a skill to disk and to the sorted list", async () => {
    __seed("skills/.keep", "");
    const z: Skill = { ...a, slug: "z-skill" };
    await useSkillsStore.getState().upsert(z);
    await useSkillsStore.getState().upsert(a);
    expect(useSkillsStore.getState().skills.map((s) => s.slug)).toEqual(["a-skill", "z-skill"]);
    expect(__read("skills/z-skill/SKILL.md")).toBe(file(z));
  });

  it("upsert with the same slug replaces in place, keeping preserved frontmatter", async () => {
    const withExtra: Skill = { ...a, extra: { copyright: "OpenBB Inc." } };
    __seed("skills/a-skill/SKILL.md", `---\nname: a-skill\ndescription: A\nenabled: true\nupdated: ${a.updated}\ncopyright: OpenBB Inc.\n---\n\n# A\n`);
    await useSkillsStore.getState().load();
    await useSkillsStore.getState().upsert({ ...withExtra, description: "A2" });
    expect(useSkillsStore.getState().skills).toEqual([{ ...withExtra, description: "A2" }]);
    expect(__read("skills/a-skill/SKILL.md")).toContain("copyright: OpenBB Inc.");
    expect(__list().filter((p) => p.startsWith("skills/a-skill/"))).toEqual(["skills/a-skill/SKILL.md"]);
  });

  it("upsert with a previous slug renames: new folder written, old one gone", async () => {
    __seed("skills/a-skill/SKILL.md", file(a));
    await useSkillsStore.getState().load();
    await useSkillsStore.getState().upsert({ ...a, slug: "b-skill" }, "a-skill");
    expect(useSkillsStore.getState().skills.map((s) => s.slug)).toEqual(["b-skill"]);
    expect(__list()).toContain("skills/b-skill/SKILL.md");
    expect(__list()).not.toContain("skills/a-skill/SKILL.md");
  });

  it("remove deletes the file and the entry", async () => {
    __seed("skills/a-skill/SKILL.md", file(a));
    await useSkillsStore.getState().load();
    await useSkillsStore.getState().remove("a-skill");
    expect(useSkillsStore.getState().skills).toEqual([]);
    expect(__list()).not.toContain("skills/a-skill/SKILL.md");
  });

  it("setEnabled rewrites the file with the flag and a fresh updated stamp", async () => {
    __seed("skills/a-skill/SKILL.md", file(a));
    await useSkillsStore.getState().load();
    await useSkillsStore.getState().setEnabled("a-skill", false);
    const [s] = useSkillsStore.getState().skills;
    expect(s.enabled).toBe(false);
    expect(s.updated).not.toBe(a.updated);
    expect(__read("skills/a-skill/SKILL.md")).toContain("enabled: false");
  });

  it("setEnabled on an unknown slug is a no-op", async () => {
    await useSkillsStore.getState().setEnabled("nope", false);
    expect(useSkillsStore.getState().skills).toEqual([]);
    expect(__list()).toEqual([]);
  });
});
