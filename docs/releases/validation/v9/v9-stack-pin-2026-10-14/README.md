# v9.0.0: paired with openbq-docker v9.0.0 (2026-10-14) — receipts (FREEZE)

Branch `claude/v9-release`, from `release/v9` = `main` `1116390`. That is the v9.0.0 freeze the Episode 9/10 cloud session pushed; its own receipts are in `../v9-release-2026-10-14/`. User order: "yes, cut openbq-docker v9 and tag v9.0.0".

| Commit | What |
|---|---|
| `f53bb5c` | `openbqDocker` moves from openbq-docker's v9 branch commit `d66e4d0` to the tag `v9.0.0` (`e6826b1`). `web/policy.mjs` is re-vendored from the tag; its body is unchanged (sha256 `dfa61ddf…`), so `policy.vendored.json` drops the commit. The stack page and `web/README.md` drop the "until the tag is cut" wording. |

**openbq-docker v9.0.0** (`release/v9` = `e6826b1`): v8.0.0 `ebd3b85` plus the EODHD extension, openbq-eodhd 9.0.0. It vendors Adventures-OpenBQ/openbq-eodhd `v9.0.0` (`8da2435`), byte-identical. Ports, serve files and the funnel gateway are unchanged from v8.0.0. Its 19 gates pass, as recorded in its `docs/v9/release-receipt.md`.

`run-gates.sh` (the v8 script, with the diff-check base set to v8.0.0 `d92a863`) ran every gate once at `f53bb5c` (`head.txt`), on macOS. Logs are scrubbed of local paths.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 438 files passed, 6 skipped; 7967 tests passed, 29 skipped |
| revision-test | 54 passed |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 294 passed, 8 skipped |
| web | 42 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| pivot-test | 17 passed |
| pivot-packaging | pass |
| cargo | pass |
| scrub | pass |
| help | 98 passed |
| cargo-test | 17 passed, 0 failed |
| notices-check | up to date |
| diff-check | `git diff --check d92a863 HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its source equals `f53bb5c`. Delivery waits for the user's confirmation: `release/v9` and `main` fast-forward from `1116390` to the freeze, and `v9.0.0` is tagged there.
