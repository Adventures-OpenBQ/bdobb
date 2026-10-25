// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: this drives a shell script through execFile.
//
// Every case runs against a stub PATH holding fake xcode-select/xcodebuild/
// xcrun/pod/rustup, so the branches can be exercised on a machine whose real
// toolchain is complete — and so a CI box with no Xcode at all does not fail
// the suite.
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./ios.sh", import.meta.url));

/** A stub PATH whose tools behave as `tools` says. */
function sandbox(tools) {
  const root = mkdtempSync(join(tmpdir(), "ios-check-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  copyFileSync(SCRIPT, join(root, "ios.sh"));
  for (const [name, body] of Object.entries(tools)) {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return { root, bin };
}

function run(box, args = ["check"]) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [join(box.root, "ios.sh"), ...args],
      { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
    );
  });
}

/** Every tool healthy — the shape a complete toolchain reports. */
const HEALTHY = {
  "xcode-select": 'echo "/Applications/Xcode.app/Contents/Developer"',
  xcodebuild: 'echo "Xcode 26.6"; echo "Build version 17F113"',
  xcrun: 'if [ "$1" = "simctl" ]; then echo "iOS 26.5 (26.5 - 23F77)"; fi',
  pod: 'echo "1.17.0"',
  rustup: 'echo "aarch64-apple-ios"; echo "aarch64-apple-ios-sim"; echo "x86_64-apple-ios"',
};

describe("ios.sh check", () => {
  it("passes when every piece is present", async () => {
    const result = await run(sandbox(HEALTHY));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Xcode 26\.6/);
  });

  it("distinguishes the command-line tools from full Xcode, and names the fix", async () => {
    // The gotcha this preflight exists for: "installed" and "selected" report
    // identically to a naive check, and xcodebuild then claims Xcode is
    // missing on a machine that plainly has it.
    const result = await run(
      sandbox({
        ...HEALTHY,
        "xcode-select": 'echo "/Library/Developer/CommandLineTools"',
      }),
    );
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/command-line tools/i);
    expect(result.out).toMatch(/sudo xcode-select -s/);
  });

  it("names the missing simulator runtime", async () => {
    const result = await run(
      sandbox({ ...HEALTHY, xcrun: 'if [ "$1" = "simctl" ]; then echo ""; fi' }),
    );
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/simulator runtime/i);
    // The word "simulator runtime" also appears on the healthy `pass` line,
    // so that assertion alone can't tell "failed" from "succeeded while
    // printing the ok line for some unrelated reason." The remediation
    // string appears ONLY on the fail path.
    expect(result.out).toMatch(/Xcode > Settings > Components/);
  });

  it("names missing CocoaPods", async () => {
    const box = sandbox(HEALTHY);
    // Remove the stub entirely rather than making it fail, so `command -v`
    // is what reports it — the same way a real machine without it would.
    // (A non-executable file left in place is not enough: macOS's system
    // bash 3.2 resolves `command -v` to a match on PATH regardless of the
    // executable bit, so the file must actually be gone.)
    unlinkSync(join(box.bin, "pod"));
    const result = await run(box);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/cocoapods/i);
    // "CocoaPods" also appears on the healthy `pass` line ("CocoaPods
    // 1.17.0"), so that match alone doesn't distinguish failure from
    // success. The fix string appears only when the check actually failed.
    expect(result.out).toMatch(/brew install cocoapods/);
  });

  it("names missing Rust iOS targets, and the command that adds them", async () => {
    const result = await run(sandbox({ ...HEALTHY, rustup: 'echo "x86_64-apple-darwin"' }));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/aarch64-apple-ios/);
    expect(result.out).toMatch(/rustup target add/);
  });

  it("checks all three Rust targets, not just the first", async () => {
    // Every other fixture leaves all three targets missing at once, so a
    // check hard-coded to look at only `aarch64-apple-ios` would satisfy
    // every assertion above — that string is always in the missing set.
    // Here only x86_64-apple-ios is missing; the other two are present.
    const result = await run(
      sandbox({
        ...HEALTHY,
        rustup: 'echo "aarch64-apple-ios"; echo "aarch64-apple-ios-sim"',
      }),
    );
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/x86_64-apple-ios/);
    // The two that ARE installed must not be reported missing. Without this,
    // a check that simply lists all three targets on any failure would pass.
    expect(result.out).not.toMatch(/missing:.*aarch64-apple-ios-sim/);
  });

  it("reports every missing piece at once, not just the first", async () => {
    // A preflight that stops at the first failure turns one setup session
    // into four.
    const result = await run(
      sandbox({
        ...HEALTHY,
        xcrun: 'if [ "$1" = "simctl" ]; then echo ""; fi',
        rustup: 'echo "x86_64-apple-darwin"',
      }),
    );
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/simulator runtime/i);
    expect(result.out).toMatch(/aarch64-apple-ios/);
  });

  // --- llvm-objcopy, Xcode 27 and later ------------------------------------
  //
  // The component is asked for only from Xcode 27 on, so these cases stub
  // BOTH the Xcode version and rustc's target-libdir. HEALTHY reports Xcode
  // 26.6, which is why every case above is unaffected by this branch.

  /** HEALTHY, but on Xcode 27, with rustc pointing at `libdir`. */
  function xcode27(box, libdir) {
    writeFileSync(join(box.bin, "xcodebuild"), '#!/usr/bin/env bash\necho "Xcode 27.0"\n');
    chmodSync(join(box.bin, "xcodebuild"), 0o755);
    writeFileSync(
      join(box.bin, "rustc"),
      `#!/usr/bin/env bash\nif [ "$1" = "--print" ]; then echo "${libdir}"; fi\n`,
    );
    chmodSync(join(box.bin, "rustc"), 0o755);
    return box;
  }

  it("passes on Xcode 27 when llvm-objcopy is installed", async () => {
    const box = sandbox(HEALTHY);
    const toolchain = join(box.root, "toolchain");
    mkdirSync(join(toolchain, "bin"), { recursive: true });
    mkdirSync(join(toolchain, "lib"), { recursive: true });
    writeFileSync(join(toolchain, "bin", "llvm-objcopy"), "#!/usr/bin/env bash\n");
    chmodSync(join(toolchain, "bin", "llvm-objcopy"), 0o755);
    const result = await run(xcode27(box, join(toolchain, "lib")));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/llvm-objcopy/);
  });

  it("names missing llvm-objcopy on Xcode 27, and the component that adds it", async () => {
    // The failure it prevents is silent: swift-rs skips the symbol repair
    // without printing anything (cargo shows a dependency build script's
    // warnings to nobody), and the build dies much later in the linker.
    const box = sandbox(HEALTHY);
    const toolchain = join(box.root, "toolchain");
    mkdirSync(join(toolchain, "lib"), { recursive: true });
    const result = await run(xcode27(box, join(toolchain, "lib")));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/rustup component add llvm-tools/);
  });

  it("does not ask for llvm-objcopy on Xcode 26", async () => {
    // Pre-27 SDKs do not internalize @_cdecl exports, so the component is not
    // needed — and HEALTHY has no rustc stub at all, which is the point: the
    // check must not run. Without the version guard this case fails.
    const result = await run(sandbox(HEALTHY));
    expect(result.code).toBe(0);
    expect(result.out).not.toMatch(/llvm-objcopy/);
  });

  it("refuses an unknown subcommand", async () => {
    const result = await run(sandbox(HEALTHY), ["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/frobnicate/);
  });
});

describe("ios.sh dev", () => {
  it("refuses to run with no device name", async () => {
    // Without one, Tauri waits on an interactive picker that cannot render
    // when stdin is not a terminal: the command hangs with no output, which
    // is the single most confusing failure in this toolchain.
    const result = await run(sandbox(HEALTHY), ["dev"]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/device name/i);
    expect(result.out).toMatch(/xcrun devicectl list devices/);
  });

  it("refuses a device name that looks like a flag", async () => {
    // The name must come FIRST. Passed after a flag that takes an optional
    // value it is silently swallowed as that value, and the run hangs the
    // same way.
    const result = await run(sandbox(HEALTHY), ["dev", "--release"]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/device name/i);
  });
});

/**
 * A sandbox holding provisioning profiles.
 *
 * `team` reads the PROFILE, not the keychain, so these tests stub the two
 * tools that read one: `security cms` to decode it and `plutil -extract` to
 * pull a field out. The file contents never matter — plutil's stub answers
 * from `fields` — so a profile is just an empty file with the right name in
 * the right directory under the sandbox HOME.
 */
function profileSandbox({ profiles = [], fields = {}, bundleId = "com.example.app", dir } = {}) {
  // Laid out like the real repo -- scripts/ios.sh beside src-tauri/ -- because
  // the script resolves ROOT as its own parent directory, and reads the bundle
  // id from ROOT/src-tauri/tauri.conf.json.
  const plutil = Object.entries(fields)
    .map(([k, v]) => `    ${k}) echo ${JSON.stringify(v)} ;;`)
    .join("\n");
  const box = sandbox({
    ...HEALTHY,
    // `security cms -D -i FILE` must exit 0; what it prints is irrelevant.
    security: 'echo "<plist/>"',
    // plutil -extract KEY raw -   ->   KEY is $2
    plutil: `case "$2" in\n${plutil}\n    *) exit 1 ;;\nesac`,
  });
  const repo = join(box.root, "repo");
  const scripts = join(repo, "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(SCRIPT, join(scripts, "ios.sh"));
  mkdirSync(join(repo, "src-tauri"), { recursive: true });
  writeFileSync(
    join(repo, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ identifier: bundleId }),
  );
  const where = dir ?? "Library/Developer/Xcode/UserData/Provisioning Profiles";
  const full = join(box.root, where);
  mkdirSync(full, { recursive: true });
  for (const name of profiles) writeFileSync(join(full, name), "");
  return { ...box, script: join(scripts, "ios.sh") };
}

/** `run`, but for a box whose script lives at `box.script`. */
function runTeam(box) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [box.script, "team"],
      { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
    );
  });
}

describe("ios.sh team", () => {
  it("reports when no profile exists, and names the only thing that makes one", async () => {
    // A certificate is not a profile. The keychain can be full and the answer
    // still be "Xcode has not issued one".
    const result = await runTeam(profileSandbox({ profiles: [] }));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/no provisioning profile/i);
    expect(result.out).toMatch(/Automatically manage signing/);
  });

  it("prints the team the profile names", async () => {
    const result = await runTeam(profileSandbox({
        profiles: ["a.mobileprovision"],
        fields: {
          "Entitlements.application-identifier": "TEAM123456.com.example.app",
          "TeamIdentifier.0": "TEAM123456",
          ExpirationDate: "2099-01-01T00:00:00Z",
        },
      }));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/APPLE_DEVELOPMENT_TEAM=TEAM123456/);
  });

  it("reads the legacy profile directory too", async () => {
    // Xcode 26 moved managed profiles to UserData. Reading only one location
    // reports "none" on a Mac that has one — which is how a live profile got
    // mistaken for a missing Apple account.
    const result = await runTeam(profileSandbox({
        dir: "Library/MobileDevice/Provisioning Profiles",
        profiles: ["old.mobileprovision"],
        fields: {
          "Entitlements.application-identifier": "TEAM654321.com.example.app",
          "TeamIdentifier.0": "TEAM654321",
          ExpirationDate: "2099-01-01T00:00:00Z",
        },
      }));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/APPLE_DEVELOPMENT_TEAM=TEAM654321/);
  });

  it("ignores a profile belonging to a different app", async () => {
    // THE bug this rewrite exists for, in miniature: an unrelated profile must
    // not answer for this app. The old keychain lookup could not tell.
    const result = await runTeam(profileSandbox({
        bundleId: "com.example.app",
        profiles: ["other.mobileprovision"],
        fields: {
          "Entitlements.application-identifier": "TEAM123456.com.someone.else",
          "TeamIdentifier.0": "TEAM123456",
          ExpirationDate: "2099-01-01T00:00:00Z",
        },
      }));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/no provisioning profile/i);
    expect(result.out).not.toMatch(/^APPLE_DEVELOPMENT_TEAM=/m);
  });

  it("still answers for an expired profile, and says so", async () => {
    // The team is right even when the profile is stale; returning nothing
    // would send the reader hunting for an account problem they do not have.
    const result = await runTeam(profileSandbox({
        profiles: ["old.mobileprovision"],
        fields: {
          "Entitlements.application-identifier": "TEAM123456.com.example.app",
          "TeamIdentifier.0": "TEAM123456",
          ExpirationDate: "2001-01-01T00:00:00Z",
        },
      }));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/APPLE_DEVELOPMENT_TEAM=TEAM123456/);
    expect(result.out).toMatch(/EXPIRED/);
  });
});

describe("ios.sh init", () => {
  function iconFixture(box) {
    mkdirSync(join(box.root, "scripts"));
    copyFileSync(SCRIPT, join(box.root, "scripts", "ios.sh"));
    copyFileSync(new URL("./sync-ios-icons.mjs", import.meta.url), join(box.root, "scripts", "sync-ios-icons.mjs"));
    // The stub PATH intentionally excludes the real installation directory.
    writeFileSync(join(box.bin, "node"), `#!/usr/bin/env bash\nexec "${process.execPath}" "$@"\n`);
    chmodSync(join(box.bin, "node"), 0o755);
    const source = join(box.root, "src-tauri/icons/apple/AppIcon.appiconset");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "AppIcon-120.png"), "ours");
    writeFileSync(join(source, "Contents.json"), JSON.stringify({
      images: [{ idiom: "iphone", size: "60x60", scale: "2x", filename: "AppIcon-120.png" }],
      info: { author: "xcode", version: 1 },
    }));
  }

  it("puts our icon in the iOS asset catalog, not the Tauri default `ios init` stamps", async () => {
    // A fake repo: ios.sh in scripts/, so the script's ROOT is this sandbox.
    const box = sandbox({
      ...HEALTHY,
      pnpm: [
        'if [ "$2" = "ios" ] && [ "$3" = "init" ]; then',
        "  mkdir -p src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset",
        "  echo tauri-default > src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-60x60@2x.png",
        "fi",
      ].join("\n"),
    });
    iconFixture(box);
    const result = await new Promise((resolve) => {
      execFile(
        "bash",
        [join(box.root, "scripts", "ios.sh"), "init"],
        { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
        (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
      );
    });
    expect(result.code, result.out).toBe(0);
    const icon = join(box.root, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-120.png");
    expect(readFileSync(icon, "utf8").trim()).toBe("ours");
    const catalog = JSON.parse(readFileSync(join(box.root, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json"), "utf8"));
    expect(catalog.images[0].filename).toBe("AppIcon-120.png");
  });

  it("fails init when the icon sync fails, rather than reporting success", async () => {
    // The hole this closes: `node sync-ios-icons.mjs` used to run unchecked, so
    // a sync that died left init printing nothing wrong and exiting 0 with the
    // Tauri default icon still in the catalog.
    const box = sandbox({
      ...HEALTHY,
      pnpm: [
        'if [ "$2" = "ios" ] && [ "$3" = "init" ]; then',
        "  mkdir -p src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset",
        "fi",
      ].join("\n"),
    });
    iconFixture(box);
    // A catalog that names an icon which is not there: the sync validates
    // every reference before copying, so this is a real failure, not a stub.
    writeFileSync(
      join(box.root, "src-tauri/icons/apple/AppIcon.appiconset/Contents.json"),
      JSON.stringify({ images: [{ filename: "AppIcon-999.png" }], info: { author: "xcode", version: 1 } }),
    );
    const result = await new Promise((resolve) => {
      execFile(
        "bash",
        [join(box.root, "scripts", "ios.sh"), "init"],
        { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
        (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
      );
    });
    expect(result.code, result.out).toBe(1);
    expect(result.out).toMatch(/AppIcon-999\.png/);
  });

  it("exports .env.local's team to `tauri ios init`, which stamps it into the project", async () => {
    // `ios init` writes DEVELOPMENT_TEAM into project.yml only when the
    // variable is in its environment at generation time; a project generated
    // without it fails every later build with "requires a development team",
    // and no later step puts it back (2026-09-24).
    const box = sandbox({
      ...HEALTHY,
      pnpm: [
        'if [ "$2" = "ios" ] && [ "$3" = "init" ]; then',
        "  mkdir -p src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset",
        '  echo "team=${APPLE_DEVELOPMENT_TEAM:-}" > src-tauri/gen/apple/project.yml',
        "fi",
      ].join("\n"),
    });
    iconFixture(box);
    writeFileSync(join(box.root, ".env.local"), "APPLE_DEVELOPMENT_TEAM=TEAM123456\n");
    const result = await new Promise((resolve) => {
      execFile(
        "bash",
        [join(box.root, "scripts", "ios.sh"), "init"],
        { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
        (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr }),
      );
    });
    expect(result.code, result.out).toBe(0);
    expect(readFileSync(join(box.root, "src-tauri/gen/apple/project.yml"), "utf8").trim()).toBe("team=TEAM123456");
  });
});

// Review S-nat-1: `sim` asked for xcode_major_version, which nothing
// defined, so on Xcode 27 the relabel was skipped and the simulator app
// exited on launch. The function body is lifted out of the script and run
// against a stub xcodebuild.
describe("xcode_major_version", () => {
  const major = (version) =>
    new Promise((resolve) => {
      const box = sandbox({ xcodebuild: `echo "${version}"; echo "Build version 27A1"` });
      execFile(
        "bash",
        ["-c", `eval "$(sed -n '/^xcode_major_version() {/,/^}/p' "$1")"; xcode_major_version`, "_", join(box.root, "ios.sh")],
        { env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.root } },
        (_err, stdout) => resolve(stdout),
      );
    });

  it("prints Xcode's major version, or nothing when it cannot be read", async () => {
    expect(await major("Xcode 27.0")).toBe("27");
    expect(await major("Xcode 16.4")).toBe("16");
    expect(await major("not xcode")).toBe("");
  });
});
