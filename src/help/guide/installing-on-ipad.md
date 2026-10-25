---
type: Note
tags: [bdobb, help, ipad, install, xcode, build, signing]
---

# Installing on iPad

From 7.0.0, BDOBB runs on iPadOS as a native app, built from the same source with Tauri's iOS target. There is no App Store listing and no downloadable `.ipa`: you build it on a Mac with Xcode and install it on your own device. This page covers that, including the gates Apple puts in the way, each of which reports a misleading error until you have cleared it.

The v7 release receipts qualify the toolchain check and a simulator build (`pnpm ios:check` and `pnpm ios:sim`). Installing on a physical iPad follows the same scripts but is not part of those receipts.

## The toolchain wrapper

`scripts/ios.sh` wraps Tauri's iOS target in a preflight check, reached through six `pnpm` aliases:

| Command | Does |
|---|---|
| `pnpm ios:check` | walks the toolchain and names each missing piece **with its fix**: full Xcode selected by `xcode-select` (the command-line tools alone are not enough), an iOS simulator runtime, CocoaPods and the Rust iOS targets. From Xcode 27 on it also asks for `llvm-objcopy` (`rustup component add llvm-tools`) |
| `pnpm ios:init` | generates the Xcode project under `src-tauri/gen/`. It is gitignored, so run it again after every fresh clone |
| `pnpm ios:team` | reads your signing team ID from the provisioning profile Xcode issued for `com.artcashin.bdobb` and prints the line to put in `.env.local`. It prefers a live profile to an expired one, warns when the one it found has expired, and with no profile on the Mac says so and names the fix |
| `pnpm ios:sim "<simulator>"` | builds a self-contained app, then installs and launches it on a simulator. Simulators run unsigned, so it needs no team |
| `pnpm ios:dev "<device name>"` | the iteration loop on a device: a development build |
| `pnpm ios:build` | the release `.ipa` |

Device names come from `xcrun devicectl list devices`, and simulator names from `xcrun simctl list devices available`. **The name must come first, before any other flag.** With none, Tauri waits on an interactive picker that cannot render outside a terminal and the command hangs with no output, so the script refuses to start without it.

With Xcode 27 or later, `ios:build` and `ios:sim` relabel the built binary's SDK to 26.0 and re-sign it, because Tauri does not yet adopt the UIScene life cycle that apps linked against the iOS 27 SDK must use; without the relabel the app exits as soon as it launches.

## Dev build vs. release build

The two look identical on the home screen and are not:

- **Development build** (`ios:dev`). The app on the iPad loads its whole frontend live, over the network, from the Mac running the command. Stop the command, or take the iPad off the Mac's network, and the app stops working. Nothing on the iPad is broken; it has lost the Mac it was loading from.
- **Release build** (`ios:build`). The frontend is embedded in the binary. The app's only network dependency is whatever backends it is configured to reach.

**To tell which you have:** a development build is the one `pnpm ios:dev` put on the device, and it stops loading when that command stops. A release build is the one you installed from the `.ipa` (below), and it keeps working with the Mac switched off.

## Free Apple ID vs. Developer Program

For running your own build on your own device, a **free Apple ID** is enough:

| | Free Apple ID | Apple Developer Program |
|---|---|---|
| Install on your own devices | yes | yes |
| App keeps launching for | 7 days, then rebuild | 1 year |
| Distribute to others | no | yes |

On the free tier the app stops launching after 7 days until you rebuild and reinstall from your Mac. That is the free tier working as designed, not a defect, so decide up front whether a weekly rebuild is tolerable.

## One-time setup

1. Sign into Xcode with your Apple ID (Xcode ▸ Settings ▸ Accounts). This is the one step that needs a typed password; nothing in the toolchain can do it for you.
2. Run `pnpm ios:init`, then open the generated project under `src-tauri/gen/apple/` once, pick the target and let **Automatically manage signing** create the signing certificate and provisioning profile.
3. Run `pnpm ios:team` and add its output to `.env.local` as `APPLE_DEVELOPMENT_TEAM=…`. The Tauri CLI reads the team from the environment, not from that file, so `ios:init`, `ios:dev` and `ios:build` read `.env.local` themselves and export what it holds, parsed as plain `KEY=VALUE` lines and never executed. A value already set in your shell wins, so `APPLE_DEVELOPMENT_TEAM=… pnpm ios:build` still works as a one-off override. Then run `pnpm ios:init` again, so the generated project carries the team: `ios init` writes the team into the project only when `APPLE_DEVELOPMENT_TEAM` is set as it runs, and a project generated without it fails every build with *requires a development team*.

`.env.local` is gitignored, and so is the generated Xcode project: once opened and signed, Xcode writes your team ID into the project files, so a committed project would leak your account identity. `ios:team` reads the team from the **provisioning profile** rather than the keychain on purpose: the keychain holds every certificate the Mac has ever had, including ones from a superseded team, while a profile is issued for this app against the account signed into Xcode.

## Build and install

1. `pnpm ios:check`, and fix whatever it names.
2. Plug in the iPad. Enable **Developer Mode** when the toggle appears (Gate 1 below); the iPad reboots.
3. Iterate with `pnpm ios:dev "<device name>"`.
4. Make the release build with `pnpm ios:build`, then install the `.ipa` it writes under `src-tauri/gen/apple/build/`:
   ```bash
   xcrun devicectl device install app --device <udid> src-tauri/gen/apple/build/<arch>/<name>.ipa
   ```
   with `<udid>` from `xcrun devicectl list devices`.

## The three gates

None of these tells you, while it is closed, what is actually blocking you.

**Gate 1: Developer Mode.** The toggle does not exist in Settings until a Mac has first attempted a developer connection. Until then a build fails with *"Timed out waiting for all destinations."* That is not a timeout in the usual sense: attempt a build to make the toggle appear (**Settings ▸ Privacy & Security ▸ Developer Mode**), enable it, and let the iPad reboot.

**Gate 2: Device registration.** Apple will not provision your app for a device it has not met. Registration happens on its own once Gate 1 is open, but one step early you see *"Your team has no devices from which to generate a provisioning profile."* It reads like a broken account; it is sequencing. Open Gate 1 and it resolves.

**Gate 3: Trust.** With both gates open the app installs, then refuses to launch. One visit fixes it: **Settings ▸ General ▸ VPN & Device Management ▸ your Apple ID ▸ Trust.**

## The floor: iPadOS 16.4

`src-tauri/tauri.conf.json` sets the minimum system version to 16.4. pdf.js sets it: the PDF viewer is pinned to `pdfjs-dist` major 5 and loaded only through its legacy build, which targets Safari 16.4. The next major's legacy build targets Safari 18, and on older WebKit a PDF card throws, or loads and paints no glyphs. A test in the repository fails if the viewer leaves the legacy build or major 5.

## After installing

See [[ipad-interface-differences|iPad interface differences]] for how the interface adapts to touch and how to move your Mac configuration across, and [[app-data-and-settings|App Data and Settings]] for what the app keeps on disk.

---
*Source: `BDOBB` `scripts/ios.sh`, the `ios:*` scripts in `package.json`, `src-tauri/tauri.conf.json` (`identifier`, `iOS.minimumSystemVersion`), `.gitignore`, `src/lib/pdfLegacy.test.ts`, the README's iPadOS section and `docs/releases/validation/v7/`, all at `7.0.0`; Adventures in OpenBB, Ep. 7, "The iPadOS Adventure."*
*See also: [[ipad-interface-differences|iPad interface differences]] · [[installing-and-running|Installing and Running BDOBB]] · [[app-data-and-settings|App Data and Settings]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
