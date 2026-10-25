// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDING_MARKER } from "./shots";

/**
 * process.cwd() is the vitest root, which is the repo root -- vite.config.ts
 * sets no `root`. import.meta.url is NOT usable here: vitest serves this
 * module over its own http-scheme URL and fileURLToPath throws
 * "The URL must be of scheme file". Measured, not assumed.
 */
const HELP_DIR = resolve(process.cwd(), "src/help");
const TOPICS_DIR = resolve(HELP_DIR, "topics");
const SHOTS_DIR = resolve(HELP_DIR, "shots");

/** Deliberately a literal regex over the file text, not the markdown AST:
 * this test's whole job is to be a second opinion on the glob. */
const IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const SRC = /^\.\/shots\/([a-z0-9-]+)\.png$/;

/** keyboard-shortcuts carries none, because a picture of a key list is a
 * worse key list. Every other topic must show something. */
const NO_SHOT = new Set(["keyboard-shortcuts"]);

type Ref = { file: string; slug: string; alt: string; pending: boolean };

function topicFiles(): string[] {
  return readdirSync(TOPICS_DIR).filter((f) => f.endsWith(".md")).sort();
}

function references(): Ref[] {
  const out: Ref[] = [];
  for (const file of topicFiles()) {
    const body = readFileSync(resolve(TOPICS_DIR, file), "utf8");
    const pending = PENDING_MARKER.test(body);
    for (const match of body.matchAll(IMAGE)) {
      const src = SRC.exec(match[2]);
      expect(src, `${file}: image src "${match[2]}" is not ./shots/<slug>.png`).not.toBeNull();
      out.push({ file, slug: src![1], alt: match[1], pending });
    }
  }
  return out;
}

describe("help shots on disk", () => {
  it("gives every image real alt text", () => {
    for (const ref of references()) {
      expect(ref.alt.trim(), `${ref.file}: image ${ref.slug} has empty alt text`).not.toBe("");
    }
  });

  it("has both themes on disk for every image that is not pending", () => {
    const files = new Set(readdirSync(SHOTS_DIR));
    for (const ref of references()) {
      if (ref.pending) continue;
      expect(files.has(`${ref.slug}-light.png`), `${ref.slug}-light.png is missing`).toBe(true);
      expect(files.has(`${ref.slug}-dark.png`), `${ref.slug}-dark.png is missing`).toBe(true);
    }
  });

  it("has no orphaned shot", () => {
    const wanted = new Set<string>();
    for (const ref of references()) {
      wanted.add(`${ref.slug}-light.png`);
      wanted.add(`${ref.slug}-dark.png`);
    }
    for (const file of readdirSync(SHOTS_DIR)) {
      if (file === ".gitkeep") continue;
      expect(wanted.has(file), `${file} is referenced by no topic`).toBe(true);
    }
  });

  it("gives every topic but keyboard-shortcuts at least one image", () => {
    const withImages = new Set(references().map((r) => r.file));
    for (const file of topicFiles()) {
      const slug = file.slice(0, -".md".length);
      if (NO_SHOT.has(slug)) {
        expect(withImages.has(file), `${file} should carry no image`).toBe(false);
      } else {
        expect(withImages.has(file), `${file} references no image`).toBe(true);
      }
    }
  });

  // A marker left behind after its shot was taken is a shot that silently
  // stopped being checked. Keeping the list here makes removing one a
  // deliberate edit rather than something a hurried commit can skip.
  it("declares exactly the shots that have not been taken yet", () => {
    const pending = new Set(
      topicFiles()
        .filter((f) => PENDING_MARKER.test(readFileSync(resolve(TOPICS_DIR, f), "utf8")))
        .map((f) => f.slice(0, -".md".length)),
    );
    expect([...pending].sort()).toEqual([
      "built-in-widgets",
      "card-parameters",
      "documents-pdf-and-files",
      "html-and-iframe-widgets",
      "running-and-refreshing",
      "troubleshooting",
    ]);
  });
});
