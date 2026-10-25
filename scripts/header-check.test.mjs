// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Drives scripts/header-check.sh against a sandbox git repository, so the real
// tree is never what is checked. The header text is assembled at runtime.
import { describe, it, expect } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./header-check.sh", import.meta.url));
const OWNER = "SecretoftheUniverse" + ".com LLC";
const HEADER = `// Copyright 2026 ${OWNER}. Licensed under the GNU Affero General Public License, version 3 only.\n// SPDX-License-Identifier: AGPL-3.0-only\n`;

/** A git repository holding `files` (path -> content), all tracked, plus the script. */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "headers-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts", "header-check.sh"));
  writeFileSync(join(root, "scripts", "x.sh"), `#!/usr/bin/env bash\n${HEADER.replaceAll("//", "#")}`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

function run(root) {
  return new Promise((resolve) => {
    execFile("bash", [join(root, "scripts", "header-check.sh")], { cwd: root }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
    );
  });
}

describe("header-check", () => {
  it("passes when every source file carries the house header", async () => {
    const r = await run(repo({ "src/a.ts": `${HEADER}export const a = 1;\n` }));
    expect(r.code, r.out).toBe(0);
  });

  it("fails on a source file without it, and names the file", async () => {
    const r = await run(repo({ "src/a.ts": `${HEADER}export {};\n`, "e2e/b.spec.ts": "export {};\n" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("e2e/b.spec.ts");
    expect(r.out).not.toContain("src/a.ts");
  });

  it("accepts the header below a shebang, in a CSS comment or an HTML comment", async () => {
    const r = await run(
      repo({
        "web/x.mjs": `#!/usr/bin/env node\n${HEADER}`,
        "src/a.css": `/* Copyright 2026 ${OWNER}. Licensed under the GNU Affero General Public License, version 3 only. */\n/* SPDX-License-Identifier: AGPL-3.0-only */\n`,
        "index.html": `<!doctype html>\n<!-- Copyright 2026 ${OWNER}. Licensed under the GNU Affero General Public License, version 3 only. -->\n<!-- SPDX-License-Identifier: AGPL-3.0-only -->\n`,
      }),
    );
    expect(r.code, r.out).toBe(0);
  });

  it("does not check data or docs, and skips paths listed in scripts/header-exempt.txt", async () => {
    const r = await run(
      repo({
        "src/data.json": "{}\n",
        "docs/a.md": "# A\n",
        "vendor/lib.js": "/* (c) Someone Else, MIT */\n",
        "scripts/header-exempt.txt": "# third-party, keeps its own notice\nvendor/\n",
      }),
    );
    expect(r.code, r.out).toBe(0);
  });
});
