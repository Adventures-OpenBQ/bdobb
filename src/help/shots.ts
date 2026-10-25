// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A topic writes `![The left rail](./shots/the-left-rail.png)` and never names
 * a theme; this resolves it to `-light.png` or `-dark.png` from the app's own
 * `settings.theme` (D9). A <picture> with prefers-color-scheme would be the
 * web answer and is wrong here: the app's theme is a saved setting, not the OS
 * scheme, so the two can legitimately disagree.
 */
const SHOTS = import.meta.glob("./shots/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

/** Exactly `./shots/<slug>.png`. Anchored, and the slug charset excludes
 * `.` and `/`, so `./shots/../x.png` cannot match. */
/**
 * The guide's attachments that are NOT one of the manual's shots -- copied in
 * by scripts/help-sync.mjs only when no themed shot of that name exists. One
 * file serves both themes; guide.ts rewrites the guide's image paths to
 * `./shots/`, so the lookup below falls through to this when the theme
 * variant is missing. Empty today: every attachment in the v3.0 snapshot is
 * a manual shot.
 */
const GUIDE_ATTACHMENTS = import.meta.glob("./guide/attachments/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const SRC = /^\.\/shots\/([a-z0-9-]+)\.png$/;

/** A src that already names a theme is a mistake, not an alternative spelling. */
const ALREADY_THEMED = /-(light|dark)$/;

/**
 * A topic whose screenshot cannot be taken yet -- because the feature it
 * documents is on a branch that has not merged -- says so with a CommonMark
 * LINK REFERENCE DEFINITION on its own line:
 *
 *   [shot-pending]: #19
 *   [shot-pending]: form-tabs-params
 *
 * A link reference definition renders as nothing at all. An HTML comment does
 * NOT: react-markdown with no rehype-raw renders `<!-- x -->` as visible
 * literal text, which was measured before this was chosen.
 *
 * shots.test.ts skips the both-themes check for such a topic. So does
 * scripts/help-shots.mjs, but only because a pending topic has no entry in its
 * SHOTS list: a slug that IS in SHOTS and still marked pending is taken and
 * logged, which is exactly the run that unblocks it. The image reference
 * itself stays in the topic, so when the branch lands the only edit is
 * deleting this line -- shotUrl already returns null for the missing file, and
 * a null renders no <img> rather than a broken-image glyph.
 */
export const PENDING_MARKER = /^\[shot-pending\]:[ \t]*\S+[ \t]*$/m;

export function shotUrl(src: string, theme: "light" | "dark"): string | null {
  const match = SRC.exec(src);
  if (match === null) return null;
  const slug = match[1];
  if (ALREADY_THEMED.test(slug)) return null;
  return SHOTS[`./shots/${slug}-${theme}.png`] ?? GUIDE_ATTACHMENTS[`./guide/attachments/${slug}.png`] ?? null;
}
