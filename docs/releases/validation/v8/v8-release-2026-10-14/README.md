# v8.0.0 release: the published v8 merged in (2026-10-14) — receipts (FREEZE)

Branch `claude/v8-release`. It supersedes the freeze in `../v7-merge-2026-10-14/` (`87367c6`), whose README covers the v7 merge, the openbq-docker v8.0.0 pin and the port-10000 help.

| Commit | What |
|---|---|
| `87367c6` | Our gated v8 freeze: v7.0.0 `6cd2c6a` merged into the v8 line `a9b447d`, paired with openbq-docker v8.0.0. |
| `5e3a58b` | Real merge of `88267ba`, the v8 the cloud v8 session pushed to `main` and `release/v8`. |

**Why a second merge.** While `87367c6` was gating, the cloud v8 session pushed its own v7 merge as `88267ba`. It merged a second rewritten copy of v7, `11c0913`, whose tree is identical to `6cd2c6a`. That v8 carries no tag, pins the pre-release stack commit `cab61a9`, and documents the gateway on 8443. Its 399 new blobs match none of the private patterns.

User ruling: merge theirs into ours, so `main` and `release/v8` fast-forward and nothing is force-pushed.
- **Conflicts (16):** ours wins: the v8.0.0 pin, port 10000 and our v7-merge resolutions.
- **Taken from theirs:**
  - a locked card opens no Pivot panel;
  - two LeftRail tests: the Save… v8 envelope, and File ▸ Import apps.json… through the docks guard;
  - the Save… and File ▸ Import wording in the v8 help;
  - the retaken Save… shot;
  - their receipts (`../v8-refreeze-2026-10-14/`).
- **Fixed in the merge:** the stack page's duplicate intro is folded into one, and README now cites v7.0.0 as `6cd2c6a`.

openbq-docker `v8.0.0` now resolves to `ebd3b85`. Its moves since `d507ff5` touched only that repo's own receipt; `funnel-gateway/policy.mjs` is unchanged.

`run-gates.sh` ran every gate once at `5e3a58b` (`head.txt`), on macOS. Logs are scrubbed of local paths.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 437 files passed, 6 skipped; 7945 tests passed, 29 skipped |
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
| help | 94 passed |
| cargo-test | 17 passed, 0 failed |
| notices-check | up to date |
| diff-check | `git diff --check a9b447d HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its source equals `5e3a58b`. Delivery waits for the user's confirmation: `release/v8` and `main` fast-forward from `88267ba` to the freeze, and `v8.0.0` is tagged there.
