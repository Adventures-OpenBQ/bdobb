// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The user guide, vendored from the BDOBB-V2 Help repository by
 * scripts/help-sync.mjs into `guide/`, one CommonMark file per page.
 *
 * It sits beside the reference manual (index.ts) in the Help dialog: the
 * manual is edited in the same commit as the behaviour it describes and is
 * the authority; the guide is the longer-form, task-organised account written
 * against it, and is refreshed by `pnpm help:sync`. Same Topic shape, so the
 * dialog's search and list code do not know which is which -- only the slug
 * prefix tells them apart.
 *
 * The files are kept verbatim so they diff clean against the vault; the
 * three things Tolaria understands and this renderer does not are rewritten
 * here at load time: YAML frontmatter is dropped, `[[slug|Text]]` wikilinks
 * become `#guide/slug` fragment links (which MarkdownRenderer routes back to
 * this dialog), and `attachments/x.png` becomes `./shots/x.png` so the
 * existing themed-shot resolver serves the image.
 */
import { titleOf, type Topic } from "./index";

export const GUIDE_PREFIX = "guide/";

const RAW = import.meta.glob("./guide/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PREFIX = "./guide/";
const SUFFIX = ".md";

/** A page's file slug, without the `guide/` prefix the dialog uses. */
export type GuideSection = { title: string; pages: Topic[] };

export function stripFrontmatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

/**
 * `[[slug|Text]]`, `[[slug\|Text]]` (the escape a wikilink needs inside a
 * GFM table cell) and bare `[[slug]]` all become an ordinary link whose href
 * is a fragment. A fragment, not a custom scheme: react-markdown's default
 * URL transform keeps relative and fragment hrefs and drops unknown schemes.
 */
export function rewriteWikilinks(body: string): string {
  return body.replace(
    /\[\[([a-z0-9-]+)(?:\\?\|([^\]]+))?\]\]/g,
    (_, slug: string, text: string | undefined) => `[${text ?? slug}](#${GUIDE_PREFIX}${slug})`,
  );
}

/** `(../attachments/x.png)` from a section folder, `(attachments/x.png)` from the root. */
export function rewriteImages(body: string): string {
  return body.replace(/\]\((?:\.\.\/)?attachments\/([a-z0-9-]+\.png)\)/g, "](./shots/$1)");
}

const bySlug = new Map<string, Topic>();
for (const [path, raw] of Object.entries(RAW)) {
  const slug = path.slice(PREFIX.length, -SUFFIX.length);
  const body = rewriteImages(rewriteWikilinks(stripFrontmatter(raw)));
  bySlug.set(slug, { slug: GUIDE_PREFIX + slug, title: titleOf(body, slug), body });
}

const HOME = "home";
const home = bySlug.get(HOME);
if (home === undefined) throw new Error("help guide has no home.md");

/**
 * The reading order and the sections are home.md's own index -- a `## Section`
 * heading followed by `- [[slug|Title]] — …` bullets -- so the nav list shows
 * exactly what the guide's front page shows, in its order. A page the index
 * does not list is a bug in the guide, and throws here the way a listed slug
 * with no file throws in index.ts.
 */
function sectionsFromHome(): GuideSection[] {
  const sections: GuideSection[] = [{ title: "", pages: [home as Topic] }];
  const placed = new Set<string>([HOME]);
  let current: GuideSection | null = null;
  for (const line of (home as Topic).body.split("\n")) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading !== null) {
      current = { title: heading[1], pages: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^- \[[^\]]*\]\(#guide\/([a-z0-9-]+)\)/.exec(line);
    if (bullet === null || current === null) continue;
    const page = bySlug.get(bullet[1]);
    if (page === undefined) throw new Error(`help guide home.md lists "${bullet[1]}" but there is no such page`);
    if (placed.has(bullet[1])) continue;
    current.pages.push(page);
    placed.add(bullet[1]);
  }
  const unlisted = [...bySlug.keys()].filter((slug) => !placed.has(slug)).sort();
  if (unlisted.length > 0) throw new Error(`help guide pages not listed on home.md: ${unlisted.join(", ")}`);
  return sections.filter((section) => section.pages.length > 0);
}

export const GUIDE_SECTIONS: GuideSection[] = sectionsFromHome();

/** Every page, flat, in the order the sections list them; home first. */
export const GUIDE_PAGES: Topic[] = GUIDE_SECTIONS.flatMap((section) => section.pages);
