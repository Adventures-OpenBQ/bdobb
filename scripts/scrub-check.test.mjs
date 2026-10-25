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
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
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

function run(root) {
  return new Promise((resolve) => {
    execFile("bash", [join(root, "scripts", "scrub-check.sh")], (error, stdout, stderr) =>
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

  it("leaves a URL whose path has a /home/ segment alone", async () => {
    const url = "https://www.ecb.europa.eu" + LINUX_HOME.replace("alice/bdobb", "shared/img/x.jpg");
    const r = await run(sandbox({ "docs/services/apps.json": `[{"img":"${url}"}]\n` }));
    expect(r.code, r.out).toBe(0);
  });

  it("flags a MagicDNS tailnet hostname, but not the YOUR-TAILNET placeholder", async () => {
    const bad = await run(sandbox({ "docs/spec.md": `Server: https://${MAGIC_HOST}/api\n` }));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("docs/spec.md");
    const ok = await run(sandbox({ "docs/spec.md": "Server: https://openbq-workspace.YOUR-TAILNET.ts.net/api\n" }));
    expect(ok.code, ok.out).toBe(0);
  });

  it("ignores the gitignored iOS build output under src-tauri/gen, but still scans other gen folders", async () => {
    const r = await run(sandbox({ "src-tauri/gen/apple/build/x.yml": `binary-path: '${MAC_HOME}/Library/x'\n` }));
    expect(r.code, r.out).toBe(0);
    const other = await run(sandbox({ "src/gen/x.ts": `const p = "${MAC_HOME}";\n` }));
    expect(other.code).toBe(1);
  });
});
