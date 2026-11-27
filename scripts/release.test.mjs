// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: this drives a shell script through execFile.
//
// Build, signature, scanner and GitHub commands are stubs. The release script
// and checksum utilities run normally. The stubs read FAKE_*
// variables so each case can put origin and GitHub into the state it needs;
// the six signing values are dummy files under a sandbox APPLE_SIGNING_DIR.
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./release.sh", import.meta.url));
const HEAD = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const SIGNING_VALUES = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
];

/** A checkout with a built, "signed" app and dmg and a stub PATH; nothing real is touched. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "release-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts", "release.sh"));
  writeFileSync(join(root, "scripts", "scrub-check.sh"), "exit 0\n");
  const bundle = join(root, "src-tauri", "target", "release", "bundle");
  mkdirSync(join(bundle, "macos", "BDOBB.app"), { recursive: true });
  mkdirSync(join(bundle, "dmg"), { recursive: true });
  const dmg = join(bundle, "dmg", "BDOBB_1.2.3_aarch64.dmg");
  writeFileSync(dmg, "dmg");
  const secrets = join(root, "signing", "secrets");
  mkdirSync(secrets, { recursive: true });
  for (const name of SIGNING_VALUES) writeFileSync(join(secrets, name), "x");
  const log = join(root, "calls.log");
  const tools = {
    node: "echo 1.2.3",
    python3: `echo "python3 $*" >> "${log}"
if [ "$1" = "security/gate.py" ]; then
  if [ "$2" = "--exceptions" ]; then exit "\${FAKE_HISTORY_GATE_CODE:-0}"; fi
  exit "\${FAKE_GATE_CODE:-0}"
fi
if [ "$1" = "scripts/public-release.py" ]; then
  if [ "\${FAKE_PUBLIC_SCAN_CODE:-0}" != "0" ]; then exit "$FAKE_PUBLIC_SCAN_CODE"; fi
  if [ "\${FAKE_REJECT_STAPLED:-}" = "1" ] && grep -q stapled "\${!#}"; then exit 23; fi
  if [ "$3" = "--checksum" ]; then (cd "$(dirname "$4")" && shasum -a 256 "$(basename "$4")"); fi
  exit 0
fi
exit 99`,
    cargo: 'printf "%s\\n" "${FAKE_CARGO_GRAPH:-}"; exit "${FAKE_CARGO_CODE:-0}"',
    pnpm: `echo "pnpm $*" >> "${log}"`,
    xcrun: `echo "xcrun $1 $2" >> "${log}"
if [ "$1 $2" = "stapler staple" ]; then printf 'stapled' >> "$3"; fi`,
    codesign: `echo "codesign $1" >> "${log}"`,
    spctl: `echo "spctl $1" >> "${log}"`,
    git: `case "$1" in
  rev-parse) echo ${HEAD} ;;
  ls-remote) if [ -n "\${FAKE_REMOTE_TAG:-}" ]; then printf '%s\\trefs/tags/v1.2.3\\n' "$FAKE_REMOTE_TAG"; fi ;;
  push) echo "git $*" >> "${log}"; exit "\${FAKE_PUSH_CODE:-0}" ;;
esac
exit 0`,
    gh: `if [ "$1 $2" = "release view" ]; then
  if [ -n "\${FAKE_REPLACE_AFTER_SCAN:-}" ]; then
    printf 'replacement' >> "${dmg}"
    if [ "$FAKE_REPLACE_AFTER_SCAN" = "pair" ]; then
      (cd "$(dirname "${dmg}")" && shasum -a 256 "$(basename "${dmg}")") > "${dmg}.sha256"
    fi
  fi
  [ -n "\${FAKE_RELEASE_EXISTS:-}" ]; exit
fi
echo "gh $*" >> "${log}"`,
  };
  for (const [name, body] of Object.entries(tools)) {
    const path = join(bin, name);
    // Keep fixture launchers deterministic: env-based shell lookup adds seconds
    // per stub on the local macOS test host. Both supported hosts provide Bash here.
    writeFileSync(path, `#!/bin/bash\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return { root, bin, log };
}

function run(box, env = {}) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [join(box.root, "scripts", "release.sh"), "v1.2.3"],
      {
        env: {
          PATH: `${box.bin}:/usr/bin:/bin`,
          HOME: box.root,
          APPLE_SIGNING_DIR: join(box.root, "signing"),
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const calls = existsSync(box.log) ? readFileSync(box.log, "utf8").trim().split("\n") : [];
        resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr, calls });
      },
    );
  });
}

const published = (calls) => calls.filter((c) => c.startsWith("gh release"));

describe("release.sh", () => {
  it("refuses to build without every signing value", async () => {
    // `tauri build` skips signing SILENTLY when a value is missing, so the
    // script must stop before the build, or an unsigned dmg ships.
    const box = sandbox();
    unlinkSync(join(box.root, "signing", "secrets", "APPLE_TEAM_ID"));
    const r = await run(box);
    expect(r.code).not.toBe(0);
    expect(r.calls.some((c) => c.startsWith("pnpm tauri:build"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it("refuses to publish when origin's tag points at another commit", async () => {
    // A moved tag: git would reject a plain push of it, and a release attached
    // to origin's stale tag would ship a dmg built from a different commit.
    const r = await run(sandbox(), { FAKE_REMOTE_TAG: OTHER, FAKE_PUSH_CODE: "1" });
    expect(r.code).not.toBe(0);
    expect(published(r.calls)).toEqual([]);
  });

  it("stops before publishing when the tag push fails", async () => {
    const r = await run(sandbox(), { FAKE_PUSH_CODE: "1" });
    expect(r.code).not.toBe(0);
    expect(published(r.calls)).toEqual([]);
  });

  it("stops before building or publishing when the source privacy gate fails", async () => {
    const r = await run(sandbox(), { FAKE_GATE_CODE: "1" });
    expect(r.code).not.toBe(0);
    expect(r.calls).toContain("python3 security/gate.py tree");
    expect(r.calls.some((c) => c.startsWith("pnpm tauri:build"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it("runs the source privacy gate before reading signing files", async () => {
    const box = sandbox();
    unlinkSync(join(box.root, "signing", "secrets", "APPLE_TEAM_ID"));
    const r = await run(box, { FAKE_GATE_CODE: "37" });
    expect(r.code, r.out).toBe(37);
    expect(r.calls).toContain("python3 security/gate.py tree");
    expect(r.out).not.toContain("missing signing value");
  });

  it("stops before building when the complete source history is refused", async () => {
    const r = await run(sandbox(), { FAKE_HISTORY_GATE_CODE: "29" });
    expect(r.code, r.out).toBe(29);
    expect(r.calls.some(c => c.includes("history --revision HEAD"))).toBe(true);
    expect(r.calls.some(c => c.startsWith("pnpm tauri:build"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it.each([{FAKE_CARGO_CODE:"41"}, {FAKE_CARGO_GRAPH:"tauri-plugin-mcp-bridge v0.1.0"}])("refuses an unverified native dependency graph %j", async env => {
    const r = await run(sandbox(), env);
    expect(r.code, r.out).not.toBe(0);
    expect(r.calls.some(c => c.startsWith("pnpm tauri:build"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it("stops before publishing when the unpacked installer privacy scan fails", async () => {
    const r = await run(sandbox(), { FAKE_PUBLIC_SCAN_CODE: "1" });
    expect(r.code).not.toBe(0);
    expect(r.calls.some((c) => c.startsWith("python3 scripts/public-release.py check "))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("git push"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it.each([undefined, "1"])("blocks a gate finding in stapled bytes for release state %s", async (releaseExists) => {
    const r = await run(sandbox(), {
      FAKE_REJECT_STAPLED: "1",
      ...(releaseExists && { FAKE_RELEASE_EXISTS: releaseExists }),
    });
    expect(r.code, r.out).toBe(23);
    const scan = r.calls.findIndex((c) => c.startsWith("python3 scripts/public-release.py check "));
    for (const verification of ["codesign --verify", "xcrun stapler validate", "spctl --assess"]) {
      expect(r.calls.indexOf(verification)).toBeGreaterThanOrEqual(0);
      expect(r.calls.indexOf(verification)).toBeLessThan(scan);
    }
    expect(r.calls.some((c) => c.startsWith("git push"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it.each([undefined, "1"])("blocks replacement of both checked files for release state %s", async (releaseExists) => {
    const r = await run(sandbox(), {
      FAKE_REPLACE_AFTER_SCAN: "pair",
      ...(releaseExists && { FAKE_RELEASE_EXISTS: releaseExists }),
    });
    expect(r.code, r.out).not.toBe(0);
    expect(published(r.calls)).toEqual([]);
  });

  it("blocks a changed DMG even when the checksum file stays intact", async () => {
    const r = await run(sandbox(), { FAKE_REPLACE_AFTER_SCAN: "dmg" });
    expect(r.code, r.out).not.toBe(0);
    expect(published(r.calls)).toEqual([]);
  });

  it("a dry run checks final stapled bytes without any tag or release write", async () => {
    const r = await run(sandbox(), { BDOBB_RELEASE_DRY_RUN: "1" });
    expect(r.code, r.out).toBe(0);
    expect(r.calls.some(c => c.startsWith("python3 scripts/public-release.py check --checksum "))).toBe(true);
    expect(r.calls.some(c => c.startsWith("git push"))).toBe(false);
    expect(published(r.calls)).toEqual([]);
  });

  it("pushes an absent tag, then creates the release against that tag only", async () => {
    const r = await run(sandbox());
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toContain("git push origin refs/tags/v1.2.3");
    const create = published(r.calls);
    expect(create).toHaveLength(1);
    expect(create[0]).toMatch(/^gh release create v1\.2\.3 /);
    // Without it gh creates a missing tag from the default branch's HEAD.
    expect(create[0]).toContain("--verify-tag");
  });

  it("publishes this version's dmg even when an older build left another in the bundle dir", async () => {
    // `ls dmg/*.dmg` answered two paths then, and notarytool cannot take two.
    const box = sandbox();
    writeFileSync(join(box.root, "src-tauri", "target", "release", "bundle", "dmg", "BDOBB_1.2.2_aarch64.dmg"), "old");
    const r = await run(box);
    expect(r.code, r.out).toBe(0);
    const [create] = published(r.calls);
    expect(create).toContain("BDOBB_1.2.3_aarch64.dmg");
    expect(create).not.toContain("1.2.2");
  });

  it("replaces an existing release's files in place, never deleting the release first", async () => {
    // Delete-then-create leaves the tag with no release at all if the create
    // fails; an in-place upload cannot.
    const r = await run(sandbox(), { FAKE_REMOTE_TAG: HEAD, FAKE_RELEASE_EXISTS: "1" });
    expect(r.code, r.out).toBe(0);
    const calls = published(r.calls);
    expect(calls.some((c) => c.startsWith("gh release delete"))).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^gh release upload v1\.2\.3 .*\.dmg .*\.dmg\.sha256 --clobber$/);
  });
});
