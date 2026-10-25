// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: under jsdom vitest hands the module an http:// import.meta.url,
// which fileURLToPath refuses.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./reference-backend.sh", import.meta.url));

/**
 * A throwaway repo root holding a copy of the script, because the script
 * derives its checkout from its OWN location and would `rm -rf` the real
 * .reference-backend/ if a refusal ever regressed and let it reach the clone.
 * A test must not be able to delete the thing it is testing against.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "refbe-root-"));
  mkdirSync(join(root, "scripts"));
  const copy = join(root, "scripts", "reference-backend.sh");
  copyFileSync(SCRIPT, copy);
  return copy;
}

/** Runs the script with a PATH containing only the stubs we put in `binDir`. */
function run(binDir, env = {}) {
  return new Promise((resolve) => {
    execFile(
      "/bin/bash",
      [sandbox()],
      { env: { PATH: binDir, HOME: binDir, ...env }, timeout: 20_000 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: `${stdout}${stderr}` }),
    );
  });
}

function stub(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe("reference-backend.sh refusals", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "refbe-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("names git when git is missing", async () => {
    stub(dir, "python3", "echo 'Python 3.13.0'");
    const { code, out } = await run(dir);
    expect(code).not.toBe(0);
    expect(out).toMatch(/git/i);
  });

  it("names python when python3 is missing", async () => {
    const d = mkdtempSync(join(tmpdir(), "refbe-"));
    stub(d, "git", "exit 0");
    const { code, out } = await run(d);
    expect(code).not.toBe(0);
    // The exact message, not just /python/i: without the guard the version
    // heredoc fails too, and reports a MISSING python as an out-of-date one.
    expect(out).toContain("was not found on PATH");
    rmSync(d, { recursive: true, force: true });
  });

  it("refuses a python older than 3.10, naming the floor", async () => {
    // The other stubs exit 0 for every heredoc, so this gate was passing
    // vacuously everywhere else in this file.
    const d = mkdtempSync(join(tmpdir(), "refbe-"));
    stub(d, "git", "exit 0");
    stub(d, "python3", "exit 1");
    const { code, out } = await run(d);
    expect(code).not.toBe(0);
    expect(out).toContain("3.10");
    rmSync(d, { recursive: true, force: true });
  });

  it("refuses a port already in use, naming the port and the override", async () => {
    const d = mkdtempSync(join(tmpdir(), "refbe-"));
    stub(d, "git", "exit 0");
    stub(d, "python3", "echo 'Python 3.13.0'");
    const server = createServer();
    await new Promise((r) => server.listen(7893, "127.0.0.1", r));
    try {
      const { code, out } = await run(d, { PORT: "7893" });
      expect(code).not.toBe(0);
      expect(out).toContain("7893");
      expect(out).toContain("PORT=");
    } finally {
      await new Promise((r) => server.close(r));
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("reference-backend.sh checkout origin", () => {
  // The reference backend moved from OpenBB's archived repo to the
  // bdobb-dev fork (its S3 sample PDFs went dark). A checkout cloned from the
  // old origin would otherwise be served forever, dead links and all, because
  // an existing .reference-backend/ is never re-cloned.
  it("re-clones a checkout whose origin is not REPO", async () => {
    const root = mkdtempSync(join(tmpdir(), "refbe-root-"));
    mkdirSync(join(root, "scripts"));
    const copy = join(root, "scripts", "reference-backend.sh");
    copyFileSync(SCRIPT, copy);
    mkdirSync(join(root, ".reference-backend", "getting-started", "reference-backend"), { recursive: true });
    const bin = mkdtempSync(join(tmpdir(), "refbe-"));
    const calls = join(bin, "calls.log");
    // `remote get-url` answers the OLD origin; a clone is recorded and then
    // fails, which stops the script before it would try to build a venv.
    stub(bin, "git", `echo "$@" >> ${calls}\ncase "$*" in *"remote get-url"*) echo https://github.com/OpenBB-finance/backends-for-openbb;; *clone*) exit 1;; esac`);
    stub(bin, "python3", "exit 0");
    stub(bin, "rm", `/bin/rm "$@"`);
    try {
      const out = await new Promise((resolve) =>
        execFile("/bin/bash", [copy], { env: { PATH: bin, HOME: bin, PORT: "7897" }, timeout: 20_000 }, (e, so, se) =>
          resolve(`${so}${se}`),
        ),
      );
      const log = existsSync(calls) ? readFileSync(calls, "utf8") : "";
      expect(out).toContain("re-cloning");
      expect(log).toMatch(/clone .*github\.com\/bdobb-dev\/backends-for-openbb/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
