// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The document shell's own share of the theme: the app must paint its own
 * colour, in the right palette, before React has read the settings file --
 * so a light Mac launching a System install does not flash dark.
 *
 * index.html used to do that with a blocking inline script that stamped
 * `data-theme` from matchMedia. It no longer can: the packaged app's CSP sets
 * `script-src 'self'` (src-tauri/tauri.conf.json, pinned by
 * src/lib/csp.test.ts), which refuses an inline script outright, and hashing
 * one would put the hash in tauri.conf.json while the script's post-Vite
 * bytes live in dist/index.html with nothing keeping them in step. The job
 * moved into the cascade instead -- styles.css's
 * `@media (prefers-color-scheme: light)` layer -- which needs nothing to run.
 *
 * Everything here is asserted against the FILES, because nothing else does:
 * styles.css is excluded from the test build (`css: false`), and index.html
 * is never loaded as a document under vitest.
 */
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");

/** The body of the first block matching `selector`, at the top level or
 *  inside an @media. Selectors are matched literally, brackets and all. */
function block(selector: string): string {
  const escaped = selector.replace(/[[\]().*+?^$|\\{}]/g, "\\$&");
  const found = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!found) throw new Error(`styles.css has no ${selector} block`);
  return found[1];
}

/** The value of one declaration inside the first block matching `selector`. */
function declaration(selector: string, property: string): string {
  const body = block(selector);
  const found = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  if (!found) throw new Error(`${selector} declares no ${property}`);
  return found[1].trim();
}

/** Every declaration in a block as `name: value`, sorted -- comments stripped,
 *  so prose inside a block cannot be mistaken for a declaration. Names ALONE
 *  would not be enough: two blocks can declare the same property set and still
 *  give `--accent` two different colours, which is a drift no one would see
 *  until a System-light user looked at the app. */
function declarations(selector: string): string[] {
  return block(selector)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const at = line.indexOf(":");
      return `${line.slice(0, at).trim()}: ${line.slice(at + 1).trim()}`;
    })
    .sort();
}

/** index.html's own <style> block -- the ground painted before styles.css. */
function shellStyles(): string {
  const shell = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!shell) throw new Error("index.html has no inline shell stylesheet");
  return shell[1];
}

describe("index.html has no inline script", () => {
  // The strict CSP's `script-src 'self'` refuses an inline script, with no
  // hash or nonce available that would survive Vite's build (design D7). The
  // ONLY script the document may carry is the module entry, which is an
  // external same-origin file and so is admitted.
  it("carries only the module entry", () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual(['<script type="module" src="/src/main.tsx">']);
  });

  it("has no bare <script> tag at all", () => {
    expect(html).not.toContain("<script>");
  });
});

describe("the ground painted behind the app", () => {
  // The literals in index.html cannot reference a custom property -- the
  // stylesheet that defines it has not loaded yet, which is the whole point --
  // so this is what keeps them the same colours.
  it("uses styles.css's own --bg for each theme", () => {
    expect(shellStyles()).toContain(declaration(":root", "--bg"));
    expect(shellStyles()).toContain(declaration(':root[data-theme="light"]', "--bg"));
  });

  // And once styles.css HAS loaded, the token is what paints it, so a later
  // change to either palette cannot leave the root element behind.
  it("hands the root element back to the token in styles.css", () => {
    expect(declaration("html", "background-color")).toBe("var(--bg)");
  });

  // The rules App's own effect selects between once it has stamped
  // data-theme. Both must still key off the attribute, or a stamped
  // attribute would paint nothing.
  it("still keys both palettes off data-theme", () => {
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="light"]');
  });

  // The shell block has to follow the OS on its own. It used to be enough for
  // it to key off data-theme alone, because the inline script stamped the
  // attribute before this block was consulted; with the script gone nothing
  // stamps the document pre-paint, so an unstamped System install on a light
  // Mac would take the dark literal for precisely the interval the block
  // exists to cover. Same shape as styles.css's layer, one file earlier.
  it("follows the OS while nothing has stamped the document yet", () => {
    expect(shellStyles()).toMatch(
      /@media \(prefers-color-scheme: light\)\s*\{\s*html:not\(\[data-theme="dark"\]\)\s*\{\s*background-color:\s*#eef1f5;?\s*\}\s*\}/,
    );
  });

  // ...and an explicit choice still wins, in both directions: the media rule
  // excludes an explicit dark by :not(), and an explicit light is carried by
  // its own attribute rule for a light install on a dark Mac.
  it("still lets an explicitly saved theme win over the OS", () => {
    expect(shellStyles()).toMatch(
      /html\[data-theme="light"\]\s*\{\s*background-color:\s*#eef1f5;?\s*\}/,
    );
  });
});

describe("the pre-paint theme layer that replaced the script", () => {
  // What actually removes the flash now: an unstamped document on a light
  // Mac matches this and paints light before any JavaScript runs. Its
  // selector is the mirror of :root:not([data-theme="light"]) -- both are
  // specificity (0,2,0), so it has to come LATER in the file to win.
  it("paints light for an unstamped document on a light Mac", () => {
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(css).toContain(':root:not([data-theme="dark"])');
    expect(css.indexOf(':root:not([data-theme="dark"])')).toBeGreaterThan(
      css.indexOf(':root:not([data-theme="light"])'),
    );
  });

  it("resolves the whole light palette, not just the ground", () => {
    expect(declaration(':root:not([data-theme="dark"])', "--bg")).toBe(
      declaration(':root[data-theme="light"]', "--bg"),
    );
    expect(declaration(':root:not([data-theme="dark"])', "color-scheme")).toBe("light");
  });

  // CSS cannot alias a declaration block across an @media boundary, so the
  // light tokens are spelled out twice. Nothing in the language stops the two
  // copies drifting -- a token added to one and not the other would leave a
  // System-light user on a dark value with no error anywhere, and a VALUE
  // edited in one and not the other would give the same install two different
  // accents depending on whether it had been stamped yet. Comparing
  // `name: value` catches both; comparing names alone catches only the first.
  it("declares exactly the same properties, at the same values, as :root[data-theme=\"light\"]", () => {
    expect(declarations(':root:not([data-theme="dark"])')).toEqual(
      declarations(':root[data-theme="light"]'),
    );
  });
});
