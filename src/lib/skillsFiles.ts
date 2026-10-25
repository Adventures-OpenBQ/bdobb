// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { BaseDirectory, exists, readDir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { saveText } from "./jsonStore";
import { logError } from "./logger";

const fsOpts = { baseDir: BaseDirectory.AppData } as const;

/** Every skill lives here, under the app's own data directory: `skills/<slug>/SKILL.md`. */
export const SKILLS_DIR = "skills";

/**
 * A skill slug is a path segment, so it is validated before any path is
 * built (the localFiles.ts discipline): lowercase letters, digits and
 * single hyphens, 1–64 characters, never starting or ending with a hyphen.
 * "../" and an absolute path both fail this shape.
 */
export const SKILL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isSkillSlug(s: string): boolean {
  return SKILL_SLUG.test(s);
}

/**
 * One skill as the app holds it. `slug` is the folder name AND the
 * frontmatter `name`; `content` is the markdown body Rita reads; `extra`
 * carries every frontmatter key this app does not interpret, so a bundled
 * skill's `copyright:` and `source:` lines survive an edit.
 */
export type Skill = {
  slug: string;
  description: string;
  content: string;
  enabled: boolean;
  /** ISO timestamp of the last save; "" when the file never carried one. */
  updated: string;
  extra: Record<string, string>;
};

const KNOWN_KEYS = new Set(["name", "description", "enabled", "updated"]);

/**
 * A minimal frontmatter reader: `---`, `key: value` lines, `---`. Values are
 * single-line strings and are split on the FIRST colon, so a description may
 * itself contain one. Not YAML — nothing here needs a parser. Returns null
 * when the file is not a skill: no frontmatter, a `name` that disagrees with
 * the folder, or no description.
 */
export function parseSkillFile(slug: string, text: string): Skill | null {
  // A hand-edited file saved on Windows, or by an editor that writes CRLF,
  // must still read: the frontmatter anchors are plain "\n", so normalise
  // line endings before anything else touches them.
  text = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (fields.name !== slug || !fields.description) return null;
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  return {
    slug,
    description: fields.description,
    content: text.slice(m[0].length).replace(/^\n+/, "").replace(/\s+$/, ""),
    enabled: fields.enabled !== "false",
    updated: fields.updated ?? "",
    extra,
  };
}

/** The inverse of parseSkillFile: known keys first, preserved keys after, one blank line, the body, one trailing newline. */
export function formatSkillFile(skill: Skill): string {
  const lines = [
    `name: ${skill.slug}`,
    `description: ${skill.description}`,
    `enabled: ${skill.enabled}`,
    `updated: ${skill.updated}`,
    ...Object.entries(skill.extra).map(([k, v]) => `${k}: ${v}`),
  ];
  return `---\n${lines.join("\n")}\n---\n\n${skill.content.replace(/\s+$/, "")}\n`;
}

/**
 * The skills shipped in the app: OpenBB's own, captured from the Workspace
 * and carrying its copyright line. `?raw` + `eager`, the help topics' idiom,
 * so they arrive as text at build time.
 */
const SEEDS = import.meta.glob("../skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function bundledSkills(): Skill[] {
  return Object.entries(SEEDS)
    .flatMap(([path, text]) => {
      const slug = path.slice("../skills/".length, -"/SKILL.md".length);
      const skill = parseSkillFile(slug, text);
      return skill ? [skill] : [];
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function pathOf(slug: string): string {
  if (!isSkillSlug(slug)) throw new Error("not a skill slug");
  return `${SKILLS_DIR}/${slug}/SKILL.md`;
}

/**
 * Reads every `skills/<slug>/SKILL.md`. A missing `skills` directory is a
 * fresh install: the bundled skills are written and returned. Once the
 * directory exists — even empty — it is never reseeded, the backends.json
 * rule. A folder that fails the slug rule or has no SKILL.md is skipped
 * silently; one whose SKILL.md is not a skill is skipped with a logged
 * error, never repaired. A symlinked folder is followed: Tauri's readDir
 * reports a symlink with isDirectory: false, so the guard below admits it
 * on isSymlink too and leaves the exists() check after it to decide.
 */
export async function loadSkills(): Promise<Skill[]> {
  if (!(await exists(SKILLS_DIR, fsOpts))) {
    const now = new Date().toISOString();
    const seeded = bundledSkills().map((s) => ({ ...s, updated: now }));
    for (const s of seeded) await saveSkill(s);
    return seeded;
  }
  const out: Skill[] = [];
  for (const entry of await readDir(SKILLS_DIR, fsOpts)) {
    if (!(entry.isDirectory || entry.isSymlink) || !isSkillSlug(entry.name)) continue;
    const path = pathOf(entry.name);
    try {
      if (!(await exists(path, fsOpts))) continue;
      const skill = parseSkillFile(entry.name, await readTextFile(path, fsOpts));
      if (skill) out.push(skill);
      else await logError(`skills: ${path} is not a skill (name must equal the folder, description required)`);
    } catch (err) {
      await logError(`skills: failed to read ${path}: ${err}`);
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * `async`, so a slug that fails validation REJECTS rather than throwing
 * synchronously (see localFiles.ts). Atomic: saveText writes a temp file,
 * then renames it over the target.
 */
export async function saveSkill(skill: Skill): Promise<void> {
  await saveText(pathOf(skill.slug), formatSkillFile(skill));
}

/** The file, then its folder. A skill that is already gone is not an error. */
export async function deleteSkill(slug: string): Promise<void> {
  const path = pathOf(slug);
  if (await exists(path, fsOpts)) await remove(path, fsOpts);
  const dir = `${SKILLS_DIR}/${slug}`;
  // memfs infers a folder as gone once its only file is gone, so exists(dir)
  // reads false there and this is a no-op; on disk it is what lets a
  // re-added skill start clean. Checking existence first, instead of
  // swallowing whatever remove() throws, means a genuine removal failure
  // now propagates instead of being silently discarded.
  if (await exists(dir, fsOpts)) await remove(dir, { ...fsOpts, recursive: true });
}
