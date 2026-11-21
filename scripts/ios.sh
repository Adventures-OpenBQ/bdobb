#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# BDOBB on iPadOS: a preflight-checked wrapper around Tauri's iOS target.
#
#   pnpm ios:check                 # is the toolchain complete?
#   pnpm ios:init                  # generate the Xcode project (gitignored)
#   pnpm ios:team                  # print the signing team ID, for .env.local
#
# .env.local is read by THIS script (load_env_local) and exported before
# xcodebuild runs -- the Tauri CLI does not read it. An assignment already in
# the environment wins, so a one-off override still works.
#   pnpm ios:dev "iPad (221)"      # iterate; frontend streams from this Mac
#   pnpm ios:build                 # release .ipa, self-contained
#
# The device name goes FIRST, before any other flag. See `dev` below.
set -uo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="."; fi
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED=0

# The Tauri CLI does NOT read .env.local -- it reads the environment. So the
# workflow `ios:team` documents ("add that line to .env.local") only works if
# something exports it, and until this existed nothing did: the build reached
# codesign and failed with "Signing for bdobb2_iOS requires a development
# team" while the file sat there with the right value in it.
#
# Parsed, not sourced: `. .env.local` would execute whatever is in the file,
# and this runs before every build. Only well-formed KEY=VALUE lines are
# taken, comments and blanks skipped, and an assignment already present in the
# environment WINS -- so `APPLE_DEVELOPMENT_TEAM=... pnpm ios:build` still
# overrides the file for a one-off.
load_env_local() {
  local file="$ROOT/.env.local" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    # Trim one layer of surrounding quotes, the shape a .env conventionally has.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    # A key that is not a plain identifier is not an assignment we will make.
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    [ -n "${!key-}" ] || export "$key=$value"
  done < "$file"
}

# Xcode's major version controls the Swift symbol-tool preflight from SDK27.
xcode_major_version() {
  local v
  v="$(xcodebuild -version 2>/dev/null | head -1)"
  v="${v#Xcode }"
  v="${v%%.*}"
  case "$v" in ''|*[!0-9]*) return 0 ;; esac
  printf '%s' "$v"
}

pass() { printf '  ok    %s\n' "$1"; }
fail() {
  # Every failure names its fix. A preflight that only says what is missing
  # leaves the reader to search for how to get it.
  printf '  MISSING %s\n         fix: %s\n' "$1" "$2"
  FAILED=1
}

check() {
  echo "iOS toolchain preflight"

  # "Installed" and "selected" are different states that report identically to
  # a naive check, and xcodebuild's own error claims Xcode is missing on a
  # machine that plainly has it. Both are checked, separately.
  local developer_dir xcode_major=""
  developer_dir="$(xcode-select -p 2>/dev/null)"
  if [ -z "$developer_dir" ]; then
    fail "Xcode is not selected" "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  elif [[ "$developer_dir" != *".app/Contents/Developer" ]]; then
    fail "xcode-select points at the command-line tools ($developer_dir), not full Xcode" \
         "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  else
    local version
    version="$(xcodebuild -version 2>/dev/null | head -1)"
    if [ -z "$version" ]; then
      fail "xcodebuild is not usable" "open Xcode once to finish its first-run setup"
    else
      pass "$version ($developer_dir)"
      xcode_major="$(xcode_major_version)"
    fi
  fi

  # The one multi-gigabyte download in the chain.
  # Not grep -q: under pipefail, -q's early exit can hand simctl a SIGPIPE
  # and report a runtime that is there as missing.
  if xcrun simctl list runtimes 2>/dev/null | grep -i "iOS" >/dev/null; then
    pass "iOS simulator runtime"
  else
    fail "no iOS simulator runtime" "Xcode > Settings > Components, install an iOS runtime"
  fi

  if command -v pod >/dev/null 2>&1; then
    pass "CocoaPods $(pod --version 2>/dev/null)"
  else
    fail "CocoaPods is not installed" "brew install cocoapods"
  fi

  # Tauri builds the Rust side for the device and the simulator separately.
  local installed missing
  installed="$(rustup target list --installed 2>/dev/null)"
  missing=""
  for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
    case "$installed" in
      *"$target"*) ;;
      *) missing="$missing $target" ;;
    esac
  done
  if [ -z "$missing" ]; then
    pass "Rust iOS targets"
  else
    fail "Rust iOS targets missing:$missing" "rustup target add$missing"
  fi

  # Xcode 27's SwiftPM internalizes the `@_cdecl` exports of a static Swift
  # product, so the Rust side fails to link against them. swift-rs promotes
  # them back with llvm-objcopy -- which ships in rustup's llvm-tools
  # component, NOT with Xcode. Without it swift-rs skips the repair SILENTLY:
  # cargo prints a build script's warnings only for the local package, and
  # swift-rs runs as a dependency's build script, so its `cargo:warning` never
  # reaches the terminal. The build then dies hundreds of lines later with
  # "Undefined symbols ... _register_plugin", which names nothing that leads
  # back here. Asked for only from Xcode 27 on: earlier SDKs do not
  # internalize, and demanding the component on them would be noise.
  #
  # target-libdir, not a hand-built `<arch>-apple-darwin` path: rustc reports
  # the host triple itself, so this does not have to map `arm64` to
  # `aarch64` -- the mapping swift-rs gets for free from Rust's own consts.
  if [ -n "$xcode_major" ] && [ "$xcode_major" -ge 27 ]; then
    local libdir objcopy
    libdir="$(rustc --print target-libdir 2>/dev/null)"
    objcopy="${libdir%/lib}/bin/llvm-objcopy"
    if [ -n "$libdir" ] && [ -x "$objcopy" ]; then
      pass "llvm-objcopy (Xcode $xcode_major internalizes Swift @_cdecl exports)"
    else
      fail "llvm-objcopy, which Xcode $xcode_major's build needs to link the Swift side" \
           "rustup component add llvm-tools"
    fi
  fi

  if [ "$FAILED" -eq 0 ]; then
    echo "toolchain complete."
  else
    echo "toolchain incomplete — fix the items above and re-run." >&2
  fi
  return "$FAILED"
}

# The generated Xcode project is NOT committed: once it is opened and signed,
# Xcode writes the team ID straight into project.pbxproj, so a committed
# project leaks the developer's Apple account identity even if .env.local is
# handled perfectly. Regenerate it after a fresh clone.
init() {
  check || return 1
  # `ios init` writes the team into project.yml only if APPLE_DEVELOPMENT_TEAM
  # is in its environment NOW; nothing later puts it back, and a project
  # generated without it fails every build with "requires a development
  # team". dev and build already export .env.local; init has to as well.
  load_env_local
  ( cd "$ROOT" && pnpm tauri ios init ) || return 1
  # The generated project is private and gitignored; the artwork is not.
  # Install the dedicated opaque Apple catalog, NOT the rounded desktop
  # icon. The build/dev hooks also sync it for already-initialized projects.
  # Last command in the function on purpose: its status is init's, so a failed
  # sync fails init instead of leaving the Tauri default icon in the catalog
  # under a success report. Anything appended below has to carry that forward.
  node "$SCRIPT_DIR/sync-ios-icons.mjs"
}

# The team ID comes from the PROVISIONING PROFILE, because that is what the
# build actually signs against.
#
# It used to be parsed out of `security find-identity`, and that quietly
# returned the wrong answer: the keychain holds every certificate this Mac has
# ever had, including ones from a superseded team, and the parenthetical team
# in a stale cert looks exactly like a live one. On this machine it reported a
# team the signed-in Apple account is not a member of, xcodebuild answered
# `No Account for Team "..."`, and the value looked authoritative the whole way
# down.
#
# A profile cannot be stale in that way: Xcode issues it for a specific app id
# against the account actually signed in, so its TeamIdentifier is the team the
# build will use.
#
# The team ID identifies the Apple account, so it lands in gitignored
# .env.local rather than in tauri.conf.json.
team() {
  local bundle_id dirs found=0 best_team="" best_exp="" f plist appid team exp now
  # sed, not node: this runs inside a stub PATH under test, and shelling out
  # to a runtime that may not be there would turn "no bundle id" into "no
  # profile" -- the same silent wrong answer this function exists to stop.
  bundle_id="$(sed -n 's/.*"identifier"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$ROOT/src-tauri/tauri.conf.json" 2>/dev/null | head -1)"

  # Xcode 26 writes managed profiles to UserData; older Xcodes used
  # ~/Library/MobileDevice. Both are read, newest first -- looking in only the
  # legacy path reports "no profiles" on a Mac that has one.
  dirs=(
    "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
    "$HOME/Library/MobileDevice/Provisioning Profiles"
  )
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.mobileprovision; do
      [ -e "$f" ] || continue
      plist="$(security cms -D -i "$f" 2>/dev/null)" || continue
      appid="$(printf '%s' "$plist" | plutil -extract Entitlements.application-identifier raw - 2>/dev/null)"
      team="$(printf '%s' "$plist" | plutil -extract TeamIdentifier.0 raw - 2>/dev/null)"
      exp="$(printf '%s' "$plist" | plutil -extract ExpirationDate raw - 2>/dev/null)"
      [ -n "$team" ] || continue
      # `TEAM.com.example.app` -- the app id is the team-prefixed bundle id, so
      # a profile for another app of the same team is not this app's profile.
      # With no bundle id to match on, every profile is a candidate: a wrong
      # team is better caught by xcodebuild than by silently reporting none.
      if [ -n "$bundle_id" ]; then
        # A development wildcard profile is valid for every bundle beneath
        # its prefix. Match its declared team first; do not infer a team from
        # an unrelated certificate or a different app's scoped wildcard.
        case "$appid" in "$team."*) ;; *) continue ;; esac
        local profile_bundle="${appid#"$team."}" prefix
        case "$profile_bundle" in
          "$bundle_id") ;;
          *\*)
            prefix="${profile_bundle%\*}"
            case "$prefix" in *\*) continue ;; esac
            case "$bundle_id" in "$prefix"*) ;; *) continue ;; esac
            ;;
          *) continue ;;
        esac
      fi
      found=1
      # An expired profile still names the right team, so it is a usable
      # answer -- but a live one is preferred, and the newest of those wins.
      if [ -z "$best_team" ] || { [ -n "$exp" ] && [ "$exp" \> "$best_exp" ]; }; then
        best_team="$team"; best_exp="$exp"
      fi
    done
  done

  if [ "$found" -eq 0 ]; then
    echo "no provisioning profile for ${bundle_id:-this app} on this Mac." >&2
    echo "  A profile is what names the team the build will actually use, and only" >&2
    echo "  Xcode can issue one." >&2
    echo "  fix: sign into Xcode with your Apple ID (Settings > Accounts), then open" >&2
    echo "       src-tauri/gen/apple/*.xcodeproj once, pick the target and let" >&2
    echo "       'Automatically manage signing' create the profile." >&2
    return 1
  fi

  echo "APPLE_DEVELOPMENT_TEAM=$best_team"
  if [ -n "$best_exp" ] && [ "$best_exp" \< "$now" ]; then
    echo "warning: that profile EXPIRED on $best_exp -- rebuild in Xcode to renew." >&2
  elif [ -n "$best_exp" ]; then
    echo "profile expires $best_exp." >&2
  fi
  echo "add that line to .env.local (gitignored); ios:init, ios:dev and ios:build export it." >&2
}

# A DEVELOPMENT build: the iPad loads its entire frontend live, over the
# network, from this Mac. Stop this command or leave the network and the app
# stops working — nothing on the iPad is broken.
dev() {
  local device="${1:-}"
  if [ -z "$device" ] || [ "${device#-}" != "$device" ]; then
    echo "ios.sh dev: a device name is required, and must come FIRST." >&2
    echo "  With none, Tauri waits on an interactive picker that cannot render" >&2
    echo "  when stdin is not a terminal, and the command hangs with no output." >&2
    echo "  Passed after another flag, it is swallowed as that flag's value." >&2
    echo '  usage: pnpm ios:dev "iPad (221)"' >&2
    echo "  names: xcrun devicectl list devices" >&2
    return 1
  fi
  shift
  load_env_local
  ( cd "$ROOT" && pnpm tauri ios dev "$device" "$@" )
}

# Locked Tauri 2.12/Tao 0.37.2 uses UIScene and includes the scene-configuration
# ownership repair. Info.ios.plist declares its delegate. Preserve the actual
# SDK and Xcode signature; the former SDK26 relabel workaround is obsolete.
build() {
  load_env_local
  ( cd "$ROOT" && pnpm tauri ios build "$@" )
}

# A SIMULATOR build+install+launch. Separate from `dev` because Tauri's own
# `ios dev` installs with `devicectl`, which supports only real hardware and
# fails on a simulator UDID with CoreDeviceError 1001 -- so this drives
# xcodebuild and simctl directly. The frontend is EMBEDDED (release config,
# like `build`), so the installed app is self-contained: no dev server, and
# closing this command does not stop it. Signing is disabled -- simulators run
# unsigned -- so unlike `dev`/`build` this needs no team and no .env.local.
sim() {
  local device="${1:-}"
  if [ -z "$device" ] || [ "${device#-}" != "$device" ]; then
    echo "ios.sh sim: a simulator name or UDID is required, and must come FIRST." >&2
    echo '  usage: pnpm ios:sim "iPad Pro (11-inch) (4th generation)"' >&2
    echo "  names: xcrun simctl list devices available" >&2
    return 1
  fi
  shift

  # Resolve a name to a UDID (a name can match several runtimes; take the first
  # AVAILABLE one, which is what `simctl boot <name>` would also pick). A value
  # that is already a UDID is accepted as-is.
  local udid
  udid="$(xcrun simctl list devices available 2>/dev/null | grep -F "$device" | grep -oE '[0-9A-Fa-f-]{36}' | head -1)"
  if [ -z "$udid" ]; then
    case "$device" in
      [0-9A-Fa-f]*-*-*) udid="$device" ;;
      *) echo "ios.sh sim: no available simulator matches '$device'." >&2
         echo "  list them: xcrun simctl list devices available" >&2
         return 1 ;;
    esac
  fi

  if [ ! -d "$ROOT/src-tauri/gen/apple" ]; then
    echo "ios.sh sim: the Xcode project is missing -- run 'pnpm ios:init' first." >&2
    return 1
  fi

  # Boot it (idempotent -- "already booted" is fine) and raise the Simulator UI.
  xcrun simctl boot "$udid" 2>/dev/null || true
  open -a Simulator >/dev/null 2>&1 || true

  # Build through Tauri's own flow, NOT a bare xcodebuild: the generated Xcode
  # project's "Build Rust Code" phase runs `tauri ios xcode-script`, which reads
  # its options over a WebSocket from the `tauri` CLI -- a bare xcodebuild has no
  # such server and the phase dies with ConnectionRefused. `tauri ios build`
  # runs that server, runs beforeBuildCommand to embed the frontend, and
  # `--target aarch64-sim` builds the Apple-silicon simulator arch. A simulator
  # build is not signed, so no team or .env.local is needed.
  local proj="$ROOT/src-tauri/gen/apple"
  # Tauri renames the fresh .app into build/<arch>-sim/ and cannot replace a
  # previous one there ("Directory not empty", os error 66), so every rebuild
  # after the first failed. Clear the old simulator output first.
  rm -rf "$proj"/build/*-sim
  ( cd "$ROOT" && pnpm tauri ios build --target aarch64-sim ) || return 1

  # Locate the freshly built simulator .app. Tauri writes it to
  # build/<arch>-sim/<Product>.app (e.g. build/arm64-sim). Match the `-sim/`
  # path so a stale device build under build/Payload is never picked.
  local app
  app="$(find "$proj/build" -type d -name '*.app' -path '*-sim/*' -prune 2>/dev/null | head -1)"
  [ -n "$app" ] && [ -d "$app" ] || { echo "ios.sh sim: no simulator .app under $proj/build/*-sim/" >&2; return 1; }

  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  [ -n "$bundle_id" ] || { echo "ios.sh sim: could not read the bundle id from $app" >&2; return 1; }

  xcrun simctl install "$udid" "$app" || return 1
  xcrun simctl launch "$udid" "$bundle_id" || return 1
  echo "installed and launched $bundle_id on '$device' ($udid)."
}

case "${1:-check}" in
  check) check ;;
  init)  init ;;
  team)  team ;;
  dev)   shift; dev "$@" ;;
  build) shift; build "$@" ;;
  sim)   shift; sim "$@" ;;
  *) echo "ios.sh: unknown subcommand: ${1}" >&2; exit 1 ;;
esac
