// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: this drives a shell script through execFile, against a
// sandbox copy of the tree so the real repo is never what is scanned.
//
// Every "secret" below is assembled at runtime from pieces, so this file
// itself never matches the patterns it tests -- the real gate scans it too.
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, symlinkSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./scrub-check.sh", import.meta.url));
const TAILNET_HOST = ["openbb", "tail" + "1234ab", "ts", "net"].join(".");
const GITHUB_TOKEN = "gh" + "p_" + "A1b2C3d4".repeat(5);
const MAC_HOME = "/" + "Users/alice/Developer/bdobb";
// A MagicDNS tailnet name (word-word.ts.net), assembled so this file never matches.
const MAGIC_HOST = ["openbq-workspace", "brave" + "-otter", "ts", "net"].join(".");
const LINUX_HOME = "/" + "home/alice/bdobb";

/** A sandbox tree holding `files` (path -> content) plus the script. */
function sandbox(files) {
  const root = mkdtempSync(join(tmpdir(), "scrub-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts", "scrub-check.sh"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(root, env = process.env) {
  return new Promise((resolve) => {
    execFile("bash", [join(root, "scripts", "scrub-check.sh")], { env }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
    );
  });
}

describe("scrub-check", () => {
  it("passes a clean tree", async () => {
    const r = await run(sandbox({ "src/a.ts": "export const x = 1;\n" }));
    expect(r.code, r.out).toBe(0);
  });

  it("scans the design and plan documents under docs/superpowers", async () => {
    const r = await run(
      sandbox({ "docs/superpowers/specs/design.md": `Probed against https://${TAILNET_HOST}\n` }),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("docs/superpowers/specs/design.md");
  });

  it("still skips the verbatim rebuild documents in docs/specs", async () => {
    const r = await run(sandbox({ "docs/specs/v3.0.0-features.md": `https://${TAILNET_HOST}\n` }));
    expect(r.code, r.out).toBe(0);
  });

  it("flags a GitHub token", async () => {
    const r = await run(sandbox({ "src/config.ts": `const token = "${GITHUB_TOKEN}";\n` }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/config.ts");
  });

  it("flags a PEM private key", async () => {
    const pem = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
    const r = await run(sandbox({ "deploy/key.pem": `${pem}\nMIIE\n` }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("deploy/key.pem");
  });

  it("flags a macOS or Linux home path", async () => {
    for (const home of [MAC_HOME, LINUX_HOME]) {
      const r = await run(sandbox({ "docs/receipt/unit.log": `FAIL ${home}/src/a.test.ts\n` }));
      expect(r.code, home).toBe(1);
      expect(r.out).toContain("docs/receipt/unit.log");
    }
  });

  it("ignores a worktree's .git file and the gitignored .vercel build output", async () => {
    const r = await run(
      sandbox({
        ".git": `gitdir: ${MAC_HOME}/.git/worktrees/x\n`,
        ".vercel/output/assets/vendor.js": `"${LINUX_HOME}"\n`,
      }),
    );
    expect(r.code, r.out).toBe(0);
  });

  it("flags a MagicDNS tailnet hostname, but not the YOUR-TAILNET placeholder", async () => {
    const bad = await run(sandbox({ "docs/spec.md": `Server: https://${MAGIC_HOST}/api\n` }));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("docs/spec.md");
    const ok = await run(sandbox({ "docs/spec.md": "Server: https://openbq-workspace.YOUR-TAILNET.ts.net/api\n" }));
    expect(ok.code, ok.out).toBe(0);
  });
});

const REVIEWED_FILES = ["security/README.md", "security/test_gate.py", "security/gate.py", "scripts/test_public_release.py"];
function reviewedSandbox() {
  return sandbox(Object.fromEntries(REVIEWED_FILES.map(path => [path, readFileSync(new URL(`../${path}`, import.meta.url))])));
}
describe("reviewed canonical fixture integration", () => {
  it("accepts only the exact four reviewed canonical source files", async () => {
    expect((await run(reviewedSandbox())).code).toBe(0);
  });
  it.each(REVIEWED_FILES)("refuses any changed bytes in %s, including a benign edit", async path => {
    const root = reviewedSandbox();
    writeFileSync(join(root, path), Buffer.concat([readFileSync(join(root, path)), Buffer.from("\n# changed fixture\n")]));
    const r = await run(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain("reviewed fixture changed");
    expect(r.out).toContain(path);
  });
  it("still applies operator patterns to the exact reviewed bytes", async () => {
    const root = reviewedSandbox();
    writeFileSync(join(root, "scripts/scrub-private-patterns.txt"), "Requires Python\n");
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("security/README.md");
    expect(r.out).not.toContain("Requires Python");
  });
  it("never exempts another source file in security or prints its matching value", async () => {
    const root = reviewedSandbox();
    writeFileSync(join(root, "security/other.py"), `token = "${GITHUB_TOKEN}"\n`);
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("security/other.py:1");
    expect(r.out).not.toContain(GITHUB_TOKEN);
  });
  it("refuses a reviewed path replaced with a symlink even to identical bytes", async () => {
    const root = reviewedSandbox();
    copyFileSync(join(root, "security/README.md"), join(root, "same-bytes.md"));
    unlinkSync(join(root, "security/README.md"));
    symlinkSync("../same-bytes.md", join(root, "security/README.md"));
    const r = await run(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain("reviewed fixture is not a regular file");
  });
  it("refuses malformed custom regex without printing the private pattern", async () => {
    const r = await run(sandbox({ "scripts/scrub-private-patterns.txt": "[" + GITHUB_TOKEN + "\n" }));
    expect(r.code).toBe(2);
    expect(r.out).toContain("malformed pattern");
    expect(r.out).not.toContain(GITHUB_TOKEN);
  });
  it("preserves line-scoped markers while reporting unmarked line numbers", async () => {
    const r = await run(sandbox({ "src/a.ts": `// ${TAILNET_HOST} scrub-allow\n// ${TAILNET_HOST}\n` }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/a.ts:2");
    expect(r.out).not.toContain("src/a.ts:1");
    expect(r.out).not.toContain(TAILNET_HOST);
  });
});

it("refuses a reviewed path replaced by a directory", async () => {
  const root = reviewedSandbox();
  unlinkSync(join(root, "security/README.md"));
  mkdirSync(join(root, "security/README.md"));
  const r = await run(root);
  expect(r.code).toBe(2);
  expect(r.out).toContain("reviewed fixture is not a regular file");
});
it("still fails closed when the actual tree grep errors", async () => {
  const root = sandbox({ "src/a.ts": "clean\n" });
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/grep"), '#!/bin/sh\nif [ "$1" = "-rEn" ]; then exit 2; fi\nexec /usr/bin/grep "$@"\n');
  chmodSync(join(root, "bin/grep"), 0o700);
  const r = await run(root, { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` });
  expect(r.code).toBe(2);
  expect(r.out).toContain("tree scan errored");
  expect(r.out).not.toContain("scrub-check: clean");
});
