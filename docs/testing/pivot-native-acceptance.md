<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Portable Pivot native acceptance

An unchecked item is **not run**, never passed. Keep a separate dated record for each OS/device and candidate. Browser mode uses a memory filesystem adapter; browser reseeding proves adapter output/reopen behavior, not macOS disk durability or Tauri cross-window events.

## Candidate and isolation gate

Record source commit and dirty diff, app/executable SHA256, bundle identifier, engine, generated WASM build-stamp, OS/build, CPU/RAM, display/pointer, dataset SHA256, commands and evidence directory. Use only the current built candidate. Never open a historical installed app or overwrite its profile.

Build with an external Tauri override (`productName` unique; `identifier` unique), `CARGO_TARGET_DIR` pointing to a new isolated directory, locked/offline dependencies and `PIVOT_WASM_VERIFY_ONLY=1`. Keep output outside Git. Record the override and CLI/toolchain versions. Verify the bundled Info.plist identifier and hash executable before launch.

**Migration isolation:** before first launch create only the new identifier's `~/Library/Application Support/<identifier>/` directory and `.migrated-from-clean-v3-repair` marker. Existing migration checks this marker before examining/copying the historical source. Do not inspect, copy or modify user profiles. Verify resolved app-data path before recording disk evidence. Do not reuse uncertain Cargo outputs.

## Steps and evidence

1. [ ] Launch the fingerprinted candidate. Import the bounded SEC fixture built by `e2e/fixtures/sec-statements/fixtureBuilder.ts`. Record dataset hash and exact imported bytes. Show NVDA Revenue FY2024 **60922000000**; Google **350018000000**. Capture screenshots and source revisions.
2. [ ] Persist a pinned statement rename, mapping, template snapshot, row selection and linked chart fields. Record actual app-data dashboard JSON and local-file bytes/hashes after save. Exclude runtime datasets, calculated revisions and evaluator state from saved card intent.
3. [ ] Quit normally, verify process exited, launch same artifact. Assert exact authored definitions/selections/links/chart fields and correct numeric output without re-dropping files. Capture before/after disk files independently of app memory.
4. [ ] Export compatible app, import into a fresh isolated dashboard. Verify remapped owners, pinned snapshot/bindings, chart fields and explicit empty selection. Preserve error provenance by recomputing from saved source, never serializing private evaluator objects.
5. [ ] Open a viewer window. Change Company to Google; verify chart **350018000000** while on-disk authoring remains unchanged. Close viewer and reopen: initial authored Company must return. Separately verify authoring changes survive restart.
6. [ ] Open two native windows. Publish an authoring parameter change; verify native event propagation/reload in the other window and exact source/child revision chain. A browser shim event or Rust worker test does not pass this item.
7. [ ] Trigger real native worker failure/termination using a supported debug seam; capture failed/updating UI, retained completed delivery revision and recovery/retry. Confirm current selection applies after recovery and a disposed/replaced worker cannot deliver. If no supported seam exists record **not run**, explaining the blocker. Browser Worker.terminate coverage is separate evidence.
8. [ ] With app quit, rename only the isolated imported local file. Reopen: explicit missing-source repair state, saved reference retained. Restore it, then replace isolated file with incompatible schema: unavailable-field repair state without silently rewriting authored bindings.
9. [ ] Change a copied pinned template version without remapping identities; reopen and assert inspectable invalid intent/repair. Bind a removed chart measure: `Field … is unavailable. Repair chart fields.` Restore valid intent and verify output.
10. [ ] At desktop and 390px width test keyboard Enter/Space activation, focus, Escape and Apply; coarse-pointer targets at least 44px. Keep selected Revenue row collapsed/offscreen and verify linked child still receives it. Record screenshots and exact viewport/device.

## Acceptance record

| Item | Status (passed / failed / not run) | Evidence path and assertion |
|---|---|---|
| Import | not run | |
| Actual disk persistence and restart | not run | |
| Export/import | not run | |
| Viewer reopen semantics | not run | |
| Native cross-window propagation | not run | |
| Native worker recovery | not run | |
| Source/template/chart repair | not run | |
| Keyboard/coarse pointer/offscreen rows | not run | |

Linux, Windows, iOS and Android remain **not run** until an independent record supplies actual device/artifact evidence. macOS WebKit Playwright is not native Tauri qualification.
