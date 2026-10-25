// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { buildSeed, injectIntoHead, seedScript } from "./demo-seed.mjs";

// The backend URL comes from an environment variable and lands inside a
// <script> in index.html: a "</script>" in it ended the tag, and a "$&" in the
// replacement string was expanded by String.replace.
describe("the demo seed in index.html", () => {
  const hostile = "https://x.test/</script><script>alert(1)</script>$&";

  it("cannot be closed early by a </script> in a value, and reads back unchanged", () => {
    const tag = seedScript(buildSeed(hostile));
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    const json = tag.slice("<script>window.__bdobbSeed = ".length, -";</script>".length);
    expect(JSON.stringify(JSON.parse(json))).toContain(hostile);
  });

  it("is inserted before </head> as written, $ patterns included", () => {
    const html = injectIntoHead("<html><head></head><body></body></html>", "<i>$&</i>");
    expect(html).toBe("<html><head><i>$&</i></head><body></body></html>");
  });
});
