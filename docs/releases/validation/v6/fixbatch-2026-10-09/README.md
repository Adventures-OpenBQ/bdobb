# v6 fix batch 2026-10-09 — receipts

Branch `codex/clean-v6`, HEAD `00db955` (see `head.txt`). Merged v5 at exactly `4cf5663` as `e5a78ce` (one hand resolution in `src/lib/tableModel/validation.ts`, see the ledger in `docs/releases/v6-assembly.md`), then `fe1dd1c` (D-014 agent surface), `20e842c` (D-009 follow-up), `e65514b` (D-012 follow-up docs) and `00db955` (review follow-ups).

Host load was extreme throughout: 1-minute averages from 232 to 744 on 10 cores (`gates.tsv`, `uptime-before.txt`, `e2e-webkit.uptime`).
A first gate run was stopped by hand after typecheck and lint to apply code-review fixes. It is not counted; its logs were discarded. Every gate below is ONE run at `00db955`, with no reruns.

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit=0 | |
| lint | exit=0 | |
| unit | exit=0 | 388 files passed / 5 skipped; 6624 tests passed / 28 skipped |
| build | exit=0 | |
| e2e (Chromium, full suite) | exit=0 | 262 passed / 1 skipped. Includes rita, rita-arrange, layout, rail, drop, smoke, rita-edit-bar, rita-no-url |
| web | exit=0 | |
| build-web | exit=0 | |
| web-browser | exit=0 | |
| cargo | exit=0 | `cargo check --locked --offline` |
| scrub | exit=0 | |
| help | exit=0 | |
| e2e (WebKit, 8 specs) | exit=1 | `e2e-webkit.log`: 22 passed / 1 failed. The failure is `rail.spec.ts:109` (keyboard focus inside the rail expands it), PRE-EXISTING: it also fails at base `131e4fe`. Not fixed, by instruction. Temporary gitignored config, ports 4583/4584 |

Native QA bundle (`bundle.txt`, `qa-build.log`): `BDOBB Clean v6.app`, identifier `com.artcashin.bdobb.clean.v6` (through the gitignored `.superpowers/qa-v6-overlay.json`), version 6.0.0, ad-hoc signed. Not installed or launched.
- Main binary SHA-256: `97a4a2545dbd3fb1f6b79296c50f73d4a865986b15f9c4a86f8fa5bb62679137`.
- Bundle tree SHA-256: `47f584813340d94f7b0a99a6436fb6f4af7abb141297d7b0220d12e320ed190e`. This is the SHA-256 of the sorted list of per-file SHA-256 values, with paths relative to the `.app`.
- The build carries this batch: the first/last hint is in `index-B-LRXQdc.js`, and the preview-mode help bullet is in `HelpDialog-BLbQf8PC.js`.

Delivery: nothing pushed, no tag made or moved.
