# v6 fix batch 2026-10-08 — receipts

Branch `codex/clean-v6`, HEAD `485ed5f` (see `head.txt`). Merged `codex/clean-v5-reconciled` at `50b6c0b` (no hand resolutions), then added Window ▸ Keep Rita Open (`ec603a4`) and the native-shortcut fix (`485ed5f`).
Fixes carried: D-005, D-008, D-002 (v3), D-007 (v4), Window ▸ Keep Sidebar Open (v5), Window ▸ Keep Rita Open (v6).

Host load during the gates: 18-31 (1-minute average, see `gates.tsv`).

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit=0 | |
| lint | exit=0 | |
| unit | exit=0 | 386 files passed / 5 skipped; 6598 tests passed / 28 skipped |
| build | exit=0 | |
| e2e | exit=1, then green on rerun | COMPOSITE EVIDENCE: original run 258 passed / 1 skipped / 1 failed (`table.spec.ts:19`, 2000ms poll under load); `e2e-rerun-1.log` (`e2e/table.spec.ts` only) 5 passed |
| web | exit=0 | |
| build-web | exit=0 | |
| web-browser | exit=0 | D-002 closed: first v6 run where it passes |
| cargo | exit=0 | `cargo check --locked --offline` |
| scrub | exit=0 | |
| help | exit=0 | |

Native QA bundle (`bundle.txt`, `build.log`): `BDOBB Clean v6.app`, identifier `com.artcashin.bdobb.clean.v6`, version 6.0.0, ad-hoc signed.
Binary SHA-256 `347b6881dd97deab55b5e4aab8a3cd488777b2ce6af1372f1af1603cdd0f4bce` (previous `7b752cfa…1e67`). The build carries this batch: `window-keep-rita-open` is in `dist/assets/index-SfCWVTAs.js`.

Native Window-menu check (`native-menu.md`): PARTIAL. The menu entries were read through the macOS menu bar; the enabled/checked state, pin toggling and ⌘⇧A behaviour were not run. The desktop ⌘⇧A behaviour is unverified in a packaged build. No screenshot saved.

Optional live Rita gate: not run.

Delivery: nothing pushed, no tag made or moved.
