# v4 Workspace dashboard and app sync (v3 merged) 2026-10-11 — receipts (FREEZE)

Branch `claude/v4-18-first-open`, on top of `origin/release/v4` `b7d3af2`. User ruling 2026-10-11: every line contains the previous line's final freeze as an ancestor, through real merges.

| Commit | What |
|---|---|
| `fa1547c` | Merge of the v3 freeze `e862cd8`, which carries all of v3 through `origin/release/v3` `3b3ab55`. It uses the "ours" strategy, then applies the sync's own diff (`17abd08..cc0ff2d`) three-way. Every other v3 change since the last v3 merge already exists on v4 as its own commit: `1c764d8`=`3e4630d`, `462b850`=`f5dc718`, `3b68278`=`70cd1fe`, `e023983`=`ecf5dde`, `17abd08`=`2260bd6`, `3b3ab55`=`b7d3af2`. v3's missing receipt folders were brought across. Conflicts were resolved by keeping both sides: `types.ts`, `dashboardsFile.ts`, `dashboardStore.ts` (rename keeps v4's guard and reconcile and takes the sync's revision bump), `bootstrap.ts` (`workspaceSync.json` loads through v4's `attempt()`), and the tests. `LeftRail.sync.test.tsx` passes v4's `onOpenApps`. |
| `324c1e1` | Merge of the v3 re-freeze `8c457bb`: the tailnet hostname is scrubbed from the sync spec, and scrub-check now refuses MagicDNS names. Clean merge. |

`run-gates.sh` ran every gate once at `fa1547c` (see `head.txt`). Ports 4481/4482.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 319 files passed, 2 skipped; 5775 tests passed, 7 skipped |
| build | pass |
| e2e | 219 passed |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. At `324c1e1`, once those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 51 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| diff-check | `git diff --check b7d3af2 HEAD` exit 0 at `fa1547c`. At `324c1e1`, exit 0 over everything except receipt logs (`merge2-diff-check.log`). |

Re-run for `324c1e1` (docs and scrub script only): scrub-check and header-check tests passed, 12 tests (`merge2-check-tests.log`).

Ancestry: `3b3ab55`, `e862cd8` and `8c457bb` are ancestors of this freeze.

**Frozen.** The freeze is the commit that adds these receipts. Its product source equals `fa1547c`. Delivery: nothing pushed, no tag moved.

## Re-freeze: sync UI e2e merged from v3 (2026-10-11)

`e4ef384` merges v3 `461e856`. It adds `e2e/dashboard-sync.spec.ts` (`pnpm test:dashsync`, opt-in) against the local key-mode server; see v3's receipt. Clean merge. Run on v4 at `e4ef384`:

- dashsync: 6 passed (`merge3-dashsync.log`);
- typecheck and lint pass (`merge3-typecheck.log`, `merge3-lint.log`);
- scrub-check and header-check are clean (`merge3-scrub.log`).

No product change. This supersedes the freeze `600e05f`. Ancestry: `461e856` is an ancestor.

## Re-freeze: help describes the sync (2026-10-11)

`968e0a6` merges v3 `bcc11c7`. The settings help (topic and guide) now describes the two-way dashboard and app sync instead of "does not synchronize dashboards". v4's page layout, with User Settings last, is kept. Re-run: help 45 + help-shots 9 passed; typecheck and lint pass; scrub-check and header-check clean; `git diff --check 667f056 HEAD` exit 0 (`merge4-*.log`). This supersedes `667f056`.
