# v10.0.0 stack pin: paired with the openbq-docker v10.0.0 tag (2026-10-14) — receipts (FREEZE)

Branch `claude/clean-v10`. It follows the v10.0.0 release in `../v10-release-2026-10-14/` (`862e9b9`), as `../../v9/v9-stack-pin-2026-10-14/` follows v9's.

| Commit | What |
|---|---|
| `beb9bae` | `openbqDocker` moves from the v10 branch commit `45c6ae1` to the `v10.0.0` tag. openbq-docker `release/v10` is `c19106a`: `e6cb490` plus its release receipt. `web/policy.mjs` is re-vendored from the tag with the same body and hash (`1e6aa6c…`), so `web/policy.vendored.json` drops its commit. The help, `web/README.md` and the comments name the tag. REVIEW: `guide.test.ts` pins the tag form. RB-3 is revisited. |

User order: "tag openbq-docker v10.0.0 and re-pin bdobb", then "move the v10.0.0 tag" to this freeze.

**Rebased onto `5600608`.** While this gate ran, the v8 session pushed its own "pair with openbq-docker v10.0.0" (`5600608`) to `main`: the same pin and policy record, with the stack page, `web/README.md` and RB-3 changed. `beb9bae` was rebased onto it, keeping this branch's text where the two overlap, and is now `21cd6e3`. It adds the rest: Example Dashboards, Web Preview, the `web/` comments, the REVIEWed `guide.test.ts` assertion and the ledgers. The tree that results is byte-identical to the gated tree, so these receipts stand for it.

`run-gates.sh` is the v10 release script with the diff check taken from `862e9b9`. It ran every gate once at `beb9bae` (`head.txt`), in a Linux cloud container: Chromium 1194 and the scratch Playwright configs. Logs are scrubbed of local paths. EODHD calls: 0.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 8022 passed, 29 skipped |
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
| diff-check | `git diff --check 862e9b9 HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its source equals `beb9bae`'s, which is `21cd6e3`'s. `main` fast-forwards from `5600608` to it, `release/v10` and `claude/clean-v10` from `862e9b9`, and `v10.0.0` moves there.
