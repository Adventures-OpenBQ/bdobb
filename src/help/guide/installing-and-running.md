---
type: Note
tags: [bdobb, help, getting-started, install, quickstart, build]
---

# Installing and Running BDOBB

BDOBB is a Tauri desktop app that speaks OpenBB Workspace's published widget and app protocols against backends you point it at. At this version you build it from source.

## Building from source

The repository's CI workflow, `.github/workflows/ci.yml`, runs the type check, lint, an unused-code check, the third-party notices check, the unit suite, the web layer's tests, a web build, a `cargo check` and the tests of the Rust side, the scrub check, the browser end-to-end suite and the reference-backend conformance suite (see [[reference-validation|Reference Validation]]) on every push and pull request, with a read-only token. It builds no disk image and publishes nothing.

Releases are cut locally instead, by `pnpm release v4.0.0`. That script builds the app, signs it with an Apple Developer ID, notarizes and staples both the app and its disk image, verifies the result with `codesign`, `stapler` and `spctl`, and publishes the disk image. It refuses to start unless the tag already exists and points at exactly the commit being built, and unless the working tree is clean — so a disk image and its tag can never disagree about where they came from.

Prerequisites: Node with `pnpm`, and Rust. The tables' Pivot engine is Rust compiled to WebAssembly, and its build output is not committed, so you also need the toolchain `scripts/pivot-toolchain.json` names — Rust 1.98.1 with the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` 0.2.128 — and must build it once before the app will build:

```bash
cd /path/to/bdobb
pnpm install
pnpm pivot:build
pnpm dev
```

`pnpm dev` runs the app in development mode (`tauri dev`). `pnpm tauri:build` runs `tauri build`, which bundles the app and its disk image for the machine you build on.

A bundle from `pnpm tauri:build` on its own is **not signed** — `src-tauri/tauri.conf.json` names no signing identity, and the signing credentials live outside the repository. If such a copy arrives on another Mac by download, macOS refuses it on first open. Either right-click the app and choose **Open**, or clear the quarantine flag once it is in `/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/BDOBB.app
```

A disk image produced by `pnpm release` needs none of that: it is signed and notarized, so it opens the way any other downloaded Mac app does.

The app installs as **BDOBB** and keeps its data under its own bundle identifier, separate from any original BDOBB you may still have — see [[app-data-and-settings|App Data and Settings]] for where.

## First launch

You are looking at an empty dashboard and a thin rail down the left edge. Three things to do, in order:

1. **Connect a backend.** Open the rail, click **Connections**. The app ships with one entry already listed, named `Local` at `http://localhost:6900`. That address is a placeholder, not a promise: the openbq-docker stack publishes no host port for its API, so on almost every machine you will edit it to the address your stack actually answers on. See [[connecting-a-backend|Connecting a Backend]].
2. **Open the widget library** with `⌘K`, or the rail's **Add widget (⌘K)** row. Everything every connected backend serves is listed, plus the built-ins.
3. **Put a widget on the grid.** Click a card once to add it; drag it by its title to move it and by its bottom-right corner to resize it. Both are saved as you go.

![The left rail and a dashboard with three cards](../attachments/getting-started.png)

Or skip the widget-by-widget route and import a whole dashboard set — see [[importing-dashboards|Importing Dashboards]].

## What you need to connect to

BDOBB serves no data of its own. `pnpm reference-backend` runs OpenBB's keyless reference backend locally to try it against (see [[reference-validation|Reference Validation]]); otherwise you need an OpenBB-compatible backend of your own. For the companion stack, see [[openbq-docker-stack|The openbq-docker Stack]].

---
*Source: `BDOBB` `package.json`, `src-tauri/tauri.conf.json`, `scripts/release.sh` and `.github/workflows/ci.yml` at `v3.3.3`; `BDOBB` `.github/workflows/ci.yml`, `scripts/build-pivot-wasm.mjs`, `scripts/pivot-toolchain.json` and `.gitignore` at `v4.0.0`; BDOBB v3.0.1 in-app manual, "Getting started".*
*See also: [[connecting-a-backend|Connecting a Backend]] · [[importing-dashboards|Importing Dashboards]] · [[app-data-and-settings|App Data and Settings]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v4.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
