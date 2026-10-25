# v10.0.0 release: v10 on v9.0.0, paired with openbq-docker v10 (2026-10-14) — receipts (FREEZE)

Branch `claude/clean-v10`. It supersedes the freeze in `../v10-freeze-2026-10-12/` (`423fcb4` after the rebases), whose README covers the v10 build itself.

| Commit | What |
|---|---|
| `05e2d69`, `8dab769` | The rebases onto `release/v8` and onto v8.0.0 `d2c3dce3`, each with a ledger section. |
| (these rebases) | Onto the v9 freeze `1116390`, with no conflicts. Then onto v9.0.0 `be4dec6`, which is `main`, `release/v9` and tag `v9.0.0`; it is `1116390` plus the user's re-pin to openbq-docker's `v9.0.0` tag (`f53bb5c`) and its receipts. Four conflicts, in `package.json`, `web/policy.vendored.json`, the stack help page and `web/README.md`, were each resolved to v10's own text. The tree that results equals the gated tree exactly, apart from those receipts. |
| `170ba22` | Pairing with openbq-docker `claude/openbq-docker-v10` `45c6ae1`, which vendors openbq-kdb 10.0.0 and openbq-eodhd 9.0.0. This rules RB-3. |

**User ruling (2026-10-14).** The kdb tier is `Adventures-OpenBQ/openbq-kdb`. It was renamed from openbq-docker's `kdb-store/` and `kdb-ws/` and is vendored at `v10/kdb/source`. `source.json` names repository, tag `v10.0.0` and commit `9519bbc`. `package.json` `openbqDocker` = `45c6ae1c84dabe34f4ae9d66625e7d46e13ad19f`. The gateway policy is re-vendored from it as `v10.0.0`. Its body is byte-identical to the copy from `ebd1622`; only the recorded commit changes.

`run-gates.sh` is v9's release script with a new header. It ran every gate once at `170ba22` (`head.txt`), before the rebase onto `be4dec6`, in a Linux cloud container: Chromium 1194 and the scratch Playwright configs. An earlier run was stopped during e2e by a session time limit, at 187 passed and 0 failed. It was rerun from the start, and these are the rerun's logs. Logs are scrubbed of local paths. After the rebase onto `be4dec6`, diff-check and scrub were rerun at the new pairing commit and both are clean. Its source differs from `170ba22` only by `../../v9/v9-stack-pin-2026-10-14/`. EODHD calls: 0.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 439 files passed, 6 skipped; 8022 tests passed, 29 skipped |
| revision-test | 54 passed |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 288 passed, 8 skipped |
| web | 52 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| scrub | pass |
| help | 104 passed |
| notices-check | up to date |
| pivot-test | 163 Rust tests passed across 14 suites, 0 failed |
| pivot-verify | pass |
| pivot-packaging | 3 pass, 0 fail |
| pivot-browser | 8 passed |
| diff-check | `git diff --check c0fb324 HEAD` (v9 and v10 together; receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts and the release section of `../../../episode-9-10-morning-report.md`; its source equals `170ba22` plus the v9.0.0 receipts it sits on. Delivery was authorized by the user on 2026-10-14. `release/v10` and `main` fast-forward from `be4dec6` to the freeze, and `v10.0.0` is tagged there.
