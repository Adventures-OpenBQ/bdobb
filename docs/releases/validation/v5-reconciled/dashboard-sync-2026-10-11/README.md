# v5 Workspace dashboard and app sync (v4 merged) 2026-10-11 — receipts (FREEZE)

Branch `claude/v5-18-first-open`, on top of `origin/release/v5` `604af20`. User ruling 2026-10-11: every line contains the previous line's final freeze as an ancestor, through real merges.

| Commit | What |
|---|---|
| `fa9313f` | Merge of the v4 freeze `600e05f` with the "ours" strategy. The sync is then applied as v4 adapted it (`b7d3af2..fa1547c`, three-way), plus `0254159`'s MagicDNS rule and the scrubbed spec. Every other v4 change since v5's last v4 merge (`c1df908`) already exists on v5 as its own commit: #18 first-open `a395ba7`/`3aa866e`, #5 `1a0d875`, scrub `ebad5fd`, copyright `628ed61`, icons `ab2e4eb`, #9/#10 tests `604af20`. The v3 and v4 receipt folders v5 lacked were brought across. Conflicts beyond v4's, both sides kept: `types.ts` (v5's card `statement`) and the `LeftRail.tsx` imports. |
| `b97115f` | Merge of the v4 re-freeze `667f056`: the sync UI e2e from v3 `461e856`. Clean merge. |

`run-gates.sh` ran every gate once at `fa9313f` (see `head.txt`). Ports 4501/4502.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit |  Test Files 340 passed | 2 skipped (342); 6132 tests passed, 7 skipped |
| build | pass |
| e2e | 256 passed |
| web | ℹ pass 31 ℹ fail 0  |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. At `b97115f`, once those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help |  Tests 52 passed (52) |
| cargo-test | test result: ok. 15 passed; 0 failed; 0  |
| notices-check | up to date |
| diff-check | `git diff --check 604af20 HEAD` over everything except receipt logs, exit 0 |

Run at `b97115f`: `pnpm test:dashsync` 6 passed against the local key-mode server (`merge2-dashsync.log`); typecheck pass (`merge2-typecheck.log`).

Ancestry: `604af20`, `600e05f`, `667f056`, `b7d3af2`, `3b3ab55`, `8c457bb` and `461e856` are all ancestors.

**Frozen.** The freeze is the commit that adds these receipts. Its product source equals `fa9313f`, plus the e2e spec and `package.json` script from `b97115f`. Delivery: nothing pushed, no tag moved.

## Re-freeze: help describes the sync (2026-10-11)

`d38b3b9` merges v4 `645aac3`, bringing the settings help sync text from v3 `bcc11c7`; clean merge. `230760b` fixes v5's own Workspaces page, topic and guide: dashboards now sync, while workspaces, saved layouts and dropped files do not. Its new help test failed first. Re-run: help and help-shots passed (`merge3-help.log`); typecheck and lint pass; scrub-check and header-check clean; `git diff --check 5e5196d HEAD` exit 0. This supersedes `5e5196d`.
