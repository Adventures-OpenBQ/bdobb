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

# Xcode's MAJOR version, or nothing when Xcode is not usable. Two things key
# off it and both apply only from 27 on: the llvm-objcopy preflight and the
# post-build SDK relabel. Parsed once, here, rather than in each of them.
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
        case "$appid" in *".$bundle_id") ;; *) continue ;; esac
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

# An app LINKED against the iOS 27 SDK must adopt the UIScene life cycle, and
# Tauri 2.11.5 -- the latest stable 2.x -- does not. Such a build installs,
# launches, and exits IMMEDIATELY with exit code 0 (not a crash):
#
#   Application failed to launch: UIScene life cycle is required for apps
#   built with this SDK.
#
# The gate keys off the SDK recorded in the binary's LC_BUILD_VERSION, not off
# the OS -- proven 2026-09-19, when the same binary with only that field
# rewritten to 26.0 launched and rendered fully on iOS 27.0. So this rewrites
# it, which costs one `vtool` call and a re-sign.
#
# Adding `UIApplicationSceneManifest` to Info.plist is NOT an alternative and
# has been tried twice: with it the process survives, but Tauri still builds
# its UIWindow the pre-scene way and never attaches it to the UIWindowScene --
# `currentApplicationKeyWindow: 0x0`, and a black screen. Real adoption is
# upstream Tauri code; the generated app is only `ffi::start_app()`.
#
# Delete this function and its caller when Tauri adopts UIScene. Nothing else
# depends on it.
relabel_sdk() {
  local ipa="$1" work app bin exe hash
  command -v vtool >/dev/null 2>&1 || { echo "relabel: vtool not found" >&2; return 1; }
  work="$(mktemp -d)" || return 1
  ( cd "$work" && unzip -q "$ipa" ) || { rm -rf "$work"; return 1; }
  app="$(echo "$work"/Payload/*.app)"
  [ -d "$app" ] || { echo "relabel: no .app inside $ipa" >&2; rm -rf "$work"; return 1; }
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist" 2>/dev/null)"
  bin="$app/$exe"
  [ -n "$exe" ] && [ -f "$bin" ] || { echo "relabel: no executable in $app" >&2; rm -rf "$work"; return 1; }

  # Pulled from the app rather than written here: they are issued with the
  # provisioning profile, and a hand-kept copy would drift from it silently.
  codesign -d --entitlements :- --xml "$app" > "$work/entitlements.plist" 2>/dev/null \
    || { echo "relabel: could not read entitlements from $app" >&2; rm -rf "$work"; return 1; }

  # The signing identity is taken from the signature the build just made,
  # NOT looked up by name. This keychain holds two live certificates with the
  # IDENTICAL name "Apple Development: ... (AF2P7DB694)", so `--sign` by name
  # is ambiguous and codesign refuses it; and hard-coding a SHA-1 would pin
  # the script to one developer's keychain. The leaf certificate of the
  # existing signature is by construction the one Xcode chose and the one the
  # embedded profile names, and its SHA-1 fingerprint IS the identity hash.
  codesign -d --extract-certificates="$work/cert" "$app" 2>/dev/null \
    || { echo "relabel: could not read the signing certificate from $app" >&2; rm -rf "$work"; return 1; }
  hash="$(openssl x509 -inform DER -in "$work/cert0" -noout -fingerprint -sha1 2>/dev/null \
    | sed 's/.*=//; s/://g')"
  [ -n "$hash" ] || { echo "relabel: could not fingerprint the signing certificate" >&2; rm -rf "$work"; return 1; }

  # 2 = IOS (7 would be IOSSIMULATOR). minos stays at the real floor; only the
  # sdk field moves. vtool warns that it has invalidated the signature -- that
  # is expected, and the next line is the re-sign.
  vtool -set-build-version 2 16.4 26.0 -replace -output "$bin" "$bin" >/dev/null 2>&1 \
    || { echo "relabel: vtool failed on $bin" >&2; rm -rf "$work"; return 1; }
  codesign --force --sign "$hash" --entitlements "$work/entitlements.plist" "$app" >/dev/null 2>&1 \
    || { echo "relabel: re-signing failed" >&2; rm -rf "$work"; return 1; }
  # Verified here and not left to the device: an .ipa that fails this installs
  # and then refuses to launch with a message about trust, which sends the
  # reader to the iPad's settings for a problem that is on this Mac.
  codesign --verify --strict "$app" >/dev/null 2>&1 \
    || { echo "relabel: the re-signed app does not verify" >&2; rm -rf "$work"; return 1; }

  # rm first: zip ADDS to an existing archive, so zipping over the .ipa would
  # leave the original, 27-linked Payload inside it alongside the new one.
  ( cd "$work" && rm -f "$ipa" && zip -qry "$ipa" Payload ) \
    || { echo "relabel: could not repack $ipa" >&2; rm -rf "$work"; return 1; }
  rm -rf "$work"
  echo "relabelled the linked SDK to 26.0 and re-signed: $ipa"
}

# A RELEASE build: the frontend is embedded in the binary, so the only network
# dependency left is whatever backends the app is configured to reach.
build() {
  load_env_local
  ( cd "$ROOT" && pnpm tauri ios build "$@" ) || return 1
  # Only from Xcode 27 on: an older SDK does not trip the UIScene gate, and
  # relabelling a 26-linked binary would be a no-op that still invalidates and
  # re-signs it.
  local major ipa
  major="$(xcode_major_version)"
  [ -n "$major" ] && [ "$major" -ge 27 ] || return 0
  for ipa in "$ROOT"/src-tauri/gen/apple/build/*/*.ipa; do
    [ -f "$ipa" ] || continue
    relabel_sdk "$ipa" || return 1
  done
}

# The simulator twin of relabel_sdk, run on a .app (not an .ipa). The
# UIScene/iOS-27-SDK launch gate keys off the LINKED SDK, not the OS, so a
# simulator build made with Xcode >= 27 exits on launch exactly as a device
# build does. simctl runs the app unsigned, so this only rewrites
# LC_BUILD_VERSION (platform 7 = IOSSIMULATOR, sdk 27 -> 26) and ad-hoc
# re-signs -- no provisioning profile, no team. Edits the .app in place.
relabel_sim() {
  local app="$1" exe bin
  command -v vtool >/dev/null 2>&1 || { echo "relabel_sim: vtool not found" >&2; return 1; }
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist" 2>/dev/null)"
  bin="$app/$exe"
  [ -n "$exe" ] && [ -f "$bin" ] || { echo "relabel_sim: no executable in $app" >&2; return 1; }
  # 7 = IOSSIMULATOR (device relabel uses 2 = IOS). minos stays at the floor;
  # only the sdk field moves.
  vtool -set-build-version 7 16.4 26.0 -replace -output "$bin" "$bin" >/dev/null 2>&1 \
    || { echo "relabel_sim: vtool failed on $bin" >&2; return 1; }
  # vtool invalidates the signature. The simulator does not verify one, but an
  # ad-hoc signature keeps codesign and dyld from complaining.
  codesign --force --sign - "$app" >/dev/null 2>&1 \
    || { echo "relabel_sim: ad-hoc re-sign failed" >&2; return 1; }
  echo "relabelled the linked SDK to 26.0 (simulator) and ad-hoc re-signed."
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

  # Same UIScene gate as devices, from Xcode 27 on; a no-op relabel on 26 would
  # only invalidate the signature, so it is skipped there.
  local major; major="$(xcode_major_version)"
  if [ -n "$major" ] && [ "$major" -ge 27 ]; then relabel_sim "$app" || return 1; fi

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
