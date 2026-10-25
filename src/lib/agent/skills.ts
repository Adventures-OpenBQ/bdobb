// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Skill } from "../skillsFiles";
import type { SkillCatalogEntry, SkillPayload } from "./types";

/** The menu Rita scans before answering: enabled skills only, bodies withheld. */
export function skillsCatalog(skills: Skill[]): SkillCatalogEntry[] {
  return skills.filter((s) => s.enabled).map((s) => ({ slug: s.slug, description: s.description, updatedAt: s.updated }));
}

/** A `/skill:<slug>` token at the start of the text or after whitespace, as the Workspace reads it. */
const SLASH_SKILL = /(?:^|\s)\/skill:([a-z0-9-]+)/g;

/**
 * The skills the typed text forces. The text itself is sent unchanged --
 * Rita's prompt says a typed slug is preferred -- so this only adds the
 * bodies. Disabled and unknown slugs are ignored.
 */
export function forcedSkills(text: string, skills: Skill[]): SkillPayload[] {
  const slugs = new Set<string>();
  for (const m of text.matchAll(SLASH_SKILL)) slugs.add(m[1]);
  return skills
    .filter((s) => s.enabled && slugs.has(s.slug))
    .map((s) => ({ slug: s.slug, description: s.description, contentMarkdown: s.content, source: "forced_slash" as const }));
}
