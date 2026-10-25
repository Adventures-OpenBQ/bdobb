// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The written manual, one CommonMark file per topic under `topics/`.
 *
 * Nothing here is generated and nothing is gitignored: a branch that changes
 * behaviour edits its topic in the same commit and the same review, which is
 * the only mechanism that actually keeps a manual honest (D2).
 *
 * No React, no store, no DOM. If the dialog is ever replaced by a second
 * native window, this file and search.ts move across unchanged (D1).
 */
export type Topic = { slug: string; title: string; body: string };

/**
 * Which help set a dialog shows: `quick` is this manual (the topics below),
 * `manual` is the vendored user guide (guide.ts). Type-only, so App can name
 * it without pulling every topic into its own chunk.
 */
export type HelpSet = "quick" | "manual";

/**
 * `?raw` so the file arrives as its own text rather than a parsed module, and
 * `eager` because nineteen files of a few kilobytes each is not worth a
 * dynamic import's ceremony. Vite serves both under vitest too -- verified by
 * running it -- so there is no test-only stub.
 */
const RAW = import.meta.glob("./topics/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PREFIX = "./topics/";
const SUFFIX = ".md";

/**
 * Every file actually on disk, sorted. Exported ONLY so index.test.ts can
 * compare it against TOPIC_ORDER in both directions (D13). Nothing renders it.
 */
export const GLOBBED_SLUGS: string[] = Object.keys(RAW)
  .map((path) => path.slice(PREFIX.length, -SUFFIX.length))
  .sort();

/**
 * The reading order, which is not the glob's alphabetical one. This array is
 * the truth; the test fails if it and the directory disagree either way.
 */
export const TOPIC_ORDER = [
  "getting-started",
  "the-left-rail",
  "dashboards-and-folders",
  "dashboard-tabs",
  "workspaces",
  "widget-library",
  "widget-cards",
  "card-parameters",
  "running-and-refreshing",
  "tables",
  "statement-view",
  "charts",
  "calendar-view",
  "linked-widgets",
  "documents-pdf-and-files",
  "built-in-widgets",
  "html-and-iframe-widgets",
  "connections",
  "provider-keys",
  "settings-and-logs",
  "rita",
  "ai-library",
  "import-and-export",
  "troubleshooting",
  "keyboard-shortcuts",
  "ipad",
  "credits",
] as const satisfies readonly string[];

/**
 * The first ATX H1. A file without one is a bug in the file, so it throws at
 * module load and takes the test suite down with it -- a runtime fallback
 * would ship a topic labelled with its own filename and nobody would notice.
 */
export function titleOf(body: string, slug: string): string {
  const match = /^#[ \t]+(.+?)\s*$/m.exec(body);
  if (match === null) throw new Error(`help topic "${slug}" has no H1`);
  return match[1];
}

export const TOPICS: Topic[] = TOPIC_ORDER.map((slug) => {
  const body = RAW[`${PREFIX}${slug}${SUFFIX}`];
  if (body === undefined) throw new Error(`help topic "${slug}" is listed but has no file`);
  return { slug, title: titleOf(body, slug), body };
});
