# v6 Workspace dashboard and app sync (v5 merged) 2026-10-11 — receipts (FREEZE)

Branch `codex/clean-v6`, on top of `origin/release/v6` `b2969be`. User ruling 2026-10-11: every line contains the previous line's final freeze as an ancestor, through real merges.

| Commit | What |
|---|---|
| `13cec6a` | Merge of the v5 freeze `5e5196d` with the "ours" strategy, then:<br>- the sync as v5 adapted it, with `LeftRail.sync.test` also passing v6's `onOpenAI`;<br>- the scrubbed sync spec;<br>- `0254159`'s MagicDNS scrub rule, its test joined with v6's URL-segment test;<br>- the sync UI e2e (`e2e/dashboard-sync.spec.ts`, `pnpm test:dashsync`).<br>Every other v5 change since v6's last v5 merge (`5f5aaa5`) already exists on v6 as its own commit: copyright `628ed61`=`d70fbf4`, icons `ab2e4eb`=`bd6b3fd`, #9/#10 tests `604af20`=`b2969be`. The v3, v4 and v5 receipt folders v6 lacked were brought across. |
| `e9f9a99` | Merge of the v5 re-freeze `6c9f676`: help describes the sync (settings and workspaces pages). The only conflict was in `src/help/guide.test.ts`, where both sides appended tests; both are kept. |

`run-gates.sh` ran every gate once at `13cec6a` (see `head.txt`). Ports 4511/4512, WebKit 4811/4812.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 401 files passed, 6 skipped; 6992 tests passed, 29 skipped |
| build | pass |
| e2e | 271 passed |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. At `e9f9a99`, once those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 65 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the earlier v6 receipts: Playwright WebKit on macOS never Tabs onto buttons. |
| notices-check | up to date |
| diff-check | `git diff --check b2969be HEAD` over everything except receipt logs, exit 0 |

Re-run at `e9f9a99`: help + help-shots 69 passed (`merge2-help.log`); typecheck and lint pass; `pnpm test:dashsync` 6 passed against the local key-mode server (`merge2-dashsync.log`, run at the first `e9f9a99` attempt, with the same source); diff-check exit 0 (`merge2-diff-check.log`).

Ancestry: `b2969be`, `6c9f676`, `5e5196d`, `604af20`, `645aac3`, `b7d3af2`, `bcc11c7` and `3b3ab55` are all ancestors.

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
