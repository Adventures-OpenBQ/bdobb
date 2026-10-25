# v3 Workspace dashboard and app sync 2026-10-11 — receipts (FREEZE)

Branch `codex/clean-v3-repair`, on top of `origin/release/v3` `3b3ab55` (v3.0.0 + the #9/#10 evidence). User order 2026-10-11: bring the v3 Workspace dashboard sync forward, then walk it up to v4, v5, v6 and v7.

| Commit | What |
|---|---|
| `22c79d1` | Merge of `claude/v3-workspace-dashboard-sync` `cc0ff2d` (fetched from the `openbq-relaunch/bdobb` clone): 21 commits on `17abd08`, covering spec `57002a9`, plan `4b1e773`, the sync implementation and review fixes F1–F9. Clean merge, no conflicts. |

Two-way dashboard and app sync with a Workspace or key-mode server: a revision counter, mapping both ways, `workspaceSync.json` for links and tombstones, a pure decision table, conflict questions, sync on sign-in, auto-upload after saves settle, and a rail delete that also deletes on the server. See the spec.

Checks for the merged code: header-check, scrub-check and `notices:check` are clean. No dependency, lockfile or icon changes, so nothing new to credit.

`run-gates.sh` ran every gate once at `22c79d1` (see `head.txt`). Ports 4471/4472.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 157 files passed, 2 skipped; 3209 tests passed, 8 skipped |
| build | pass |
| e2e | 93 passed, 1 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on the run's own unscrubbed logs. Once they were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 51 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| diff-check | `git diff --check 3b3ab55 HEAD` exit 0 |

The sync UI checks against a local key-mode server are automated separately (step 4 of the order). The NAS Workspace sign-in stays NOT_RUN, for the user.

**Frozen.** The freeze is the commit that adds these receipts. Its source equals `22c79d1`. Delivery: nothing pushed, no tag moved.

## Re-freeze: tailnet name scrubbed (2026-10-11)

The regression privacy grep on `e862cd8` found the real NAS Workspace tailnet hostname in the sync spec (`docs/superpowers/specs/2026-10-10-workspace-dashboard-sync-design.md:154`). Commit `0254159` replaces it with `YOUR-TAILNET`. It also adds a generic MagicDNS rule (`word-word.ts.net`) to `scripts/scrub-check.sh`, with a test that failed first. The literal name is not written into the committed script, because that would publish it. No product source changes.

Gates re-run for that commit: scrub-check + header-check clean (`refreeze-scrub.log`); scrub-check and header-check tests passed (`refreeze-check-tests.log`); `git diff --check e862cd8 HEAD` over everything except receipt logs, exit 0 (`refreeze-diff-check.log`).

## Sync UI checks automated (2026-10-11)

Commit `b1c50b5` adds `e2e/dashboard-sync.spec.ts`, run with `pnpm test:dashsync`. It is opt-in and skipped without `DASHSYNC_TEST=1`. It runs in browser mode against `openbq-local:3.0.0-dashsync` (openbq-docker `87b6a7c`) in key mode.

- **Server.** Container `bdobb-dashsync-test`, published on `127.0.0.1:17400` only. `OPENBB_API_AUTH` is on, with a throwaway Basic credential in the gitignored `.env.dashsync-test.local`. The credential is built in memory and never printed, written or asserted.
- **Seed.** `settingsStorage` names a backend whose own credential is that Basic header, so the app connects in key mode at startup and syncs.
- **Checks.** Six:
  1. Connect with no sign-in or "Settings differ" dialog.
  2. Upload: the server owns "Main", and `workspaceSync.json` links its uuid.
  3. A rail rename reaches the server.
  4. A dashboard POSTed straight to the server appears in the rail after a relaunch. The relaunch re-seeds memfs from the files the app wrote, because browser-mode memfs reseeds on load.
  5. The rail delete confirm reads exactly `Delete "Main" here and on Dash Server?`.
  6. With the server unreachable, a delete removes the local file and leaves a tombstone in `workspaceSync.json`; the next sync, once the server is reachable, deletes it there and empties the tombstones. That check matches the deleted dashboard by uuid, because with its only dashboard gone the app makes a fresh default "Main" and syncs that up.
- **Fail-first.** Each check failed when deliberately broken, and was then reverted.
- **Results.**
  - `DASHSYNC_TEST=1`: 6 passed (`e2e-sync-dashsync.log`); two further consecutive runs were green on v3, and two on v4 with the spec copied over.
  - Default run: 6 skipped (`e2e-sync-default-skip.log`).
  - typecheck and lint pass; scrub-check and header-check are clean.

The NAS Workspace sign-in stays NOT_RUN, for the user.

## Re-freeze: help describes the sync (2026-10-11)

`9effc5e`: the settings help (topic and guide) said User Settings "does not synchronize dashboards", which the sync made false. Both now describe the two-way sync. New help tests failed first. Re-run: help 45 + help-shots 9 passed (`help-docs-help.log`); typecheck and lint pass; scrub-check and header-check clean; `git diff --check 461e856 HEAD` exit 0. No product change.
