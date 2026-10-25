# v9.0.0 release: v9 on main c0fb324, paired with openbq-docker v9 (2026-10-14) — receipts (FREEZE)

Branch `claude/clean-v9`. It supersedes the freeze in `../v9-freeze-2026-10-12/` (`2c158f2`), whose README covers the v9 build itself.

| Commit | What |
|---|---|
| `2c158f2` | The gated v9 freeze, now rebased onto `main`. |
| `eb8105c`, `262356b`, `dfb8c7e` | The three rebases: onto `release/v8`, onto v8.0.0 `d2c3dce3`, onto `d92a863` (backend tables on the worker). Each has a ledger section. |
| `4f000d1` | Pairing with openbq-docker `claude/openbq-docker-v9` `d66e4d0`, which vendors openbq-eodhd 9.0.0. |

**Base.** `main` = `release/v8` = `c0fb324`: `d92a863` plus the v8 commit that closes the Connections question. `main` and `release/v9` fast-forward to this freeze; nothing is force-pushed.

**User ruling (2026-10-14).** The EODHD extension is `Adventures-OpenBQ/openbq-eodhd`. It was renamed from `openbb-eodhd`; the donor was v9.6.3, with fixes through v9.6.6, recorded in its NOTICE. openbq-docker v9 vendors it at `v9/eodhd/source`, and `source.json` names repository, tag `v9.0.0` and commit `8da2435`. This settles V9-P3. `package.json` `openbqDocker` = `d66e4d0ae5596d81c1e46a1f87d1d8f5769d4c30`. The gateway policy is re-vendored from it as `v9.0.0`; it is byte-identical to v8.0.0's. Help, README, the example and comments now say openbq-eodhd. RB-4 records the extension's version, 9.0.0, as provisional.

`run-gates.sh` ran every gate once at `4f000d1` (`head.txt`), in a Linux cloud container: Chromium 1194 and the scratch Playwright configs. Logs are scrubbed of local paths. EODHD calls: 0.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 438 files passed, 6 skipped; 7967 tests passed, 29 skipped |
| revision-test | 54 passed |
| build | pass |
| smoke | clean, React mounted, no console errors |
| e2e | 286 passed, 8 skipped |
| web | 42 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| scrub | pass |
| help | 98 passed |
| notices-check | up to date |
| pivot-test | 163 Rust tests passed across 14 suites, 0 failed |
| pivot-verify | pass |
| pivot-packaging | 3 pass, 0 fail |
| pivot-browser | 8 passed |
| diff-check | `git diff --check c0fb324 HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its source equals `4f000d1`. Delivery was authorized by the user on 2026-10-14. `release/v9` and `main` fast-forward from `c0fb324` to the freeze, and `v9.0.0` is tagged there.
