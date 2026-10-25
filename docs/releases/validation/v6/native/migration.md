# v6 migration and rollback on QA profiles (Task 8)

Date 2026-10-08. Host load average at start: ~155 (`uptime`). QA profiles only: `com.artcashin.bdobb.clean.v5.reconciled` and `com.artcashin.bdobb.clean.v6`. The production identifier `com.artcashin.bdobb2` was never opened, copied, moved or launched.

**Status: PARTIAL. Every GUI observation is BLOCKED.** Desktop control was requested for the two QA apps and denied (`user_denied`); `screencapture -x` fails ("could not create image from display") and `osascript` System Events has no assistive access. No screenshots exist. Nothing below marked BLOCKED is claimed as passed.

## Apps (selected by CFBundleIdentifier via PlistBuddy, asserted)
- v6: `BDOBB Clean v6.app` = `com.artcashin.bdobb.clean.v6` (built by Task 7).
- v5: `BDOBB Clean v5 Reconciled.app` = `com.artcashin.bdobb.clean.v5.reconciled` in the bdobb-clean-v5-reconciled bundle dir (read only). The same dir also holds v4 Integration, v5 Candidate and `BDOBB2.app` (production id, never opened); `ls | head -1` from the brief would pick v4 Integration.

## Step 1: copy the v5 QA profile (PASS)
`cp -R "$SUP/com.artcashin.bdobb.clean.v5.reconciled" "$SUP/com.artcashin.bdobb.clean.v6"` (no pre-existing v6 profile). Before-manifest of the v5 profile (6 files, sha256 + dir listing with sizes/mtimes/modes) saved to scratch; v5 profile contents: backends.json, 2 dashboards, 1 workspace, settings.json, logs/bdobb.log. Pre-launch hashes of the v6 copy equal the v5 originals.

## Step 2: migrate with the v6 app
| Item | Result | Evidence |
|---|---|---|
| `open` v6 app, stays running | PASS | pid alive 15 s after launch; exited cleanly on quit via bundle id |
| No startup settings warning in the app log | PASS (log only) | `logs/bdobb.log` gained only the pre-existing "discovery failed for backend Local (localhost:6900)" line, same as v5 logs; no settings/parse error |
| `skills/` created with bundled skills | PASS | `arrange-table`, `build-dashboard`, `openbb-html-chart`, `openbb-html-report`, `openbb-html-table` (each SKILL.md); brief said four bundled plus arrange-table = five, matches |
| Dashboards/workspaces present on screen | BLOCKED | no screenshot access; files byte-identical on disk |
| AI Library shows Rita off, sharing off, no MCP servers, rounds 40 | BLOCKED | needs GUI |
| Set Rita URL and rounds 12 in AI Library, Done | BLOCKED | needs GUI. Settings were untouched by the app: settings.json hash unchanged after the v6 run (no `ritaUrl`, no `ritaMaxFunctionRounds`) |
| No v5 file other than settings.json changed | PASS | after the v6 run only `logs/bdobb.log` differs from the v5 hashes; backends, dashboards, workspaces, settings byte-identical; `skills/` is new |

**SIMULATED (not a GUI result):** to still exercise rollback with the new keys, `settings.json` in the v6 QA copy was edited by script to add `"ritaUrl": "http://127.0.0.1:9"` (placeholder) and `"ritaMaxFunctionRounds": 12`. This proves only that v5 tolerates those keys, not that the v6 UI writes them. Real GUI verification of the v6 write path remains BLOCKED. `chat.json`, `mcpTokens.json` and `ai-library.json` were not produced (no AI interaction occurred), so "present and ignored" is shown only for `skills/` and the two settings keys.

## Step 3: rollback with the v5 Reconciled binary
Commands: `mv "$V5" "$V5.keep"; cp -R "$V6" "$V5"; open "$APP5"`; wait 15 s; quit via bundle id; `rm -rf "$V5" && mv "$V5.keep" "$V5"`.
| Item | Result | Evidence |
|---|---|---|
| v5 starts on the v6-shaped profile | PASS | pid alive after 15 s; clean exit |
| No settings warning | PASS (log only) | log gained only the same localhost:6900 discovery line |
| Same dashboards/workspaces | BLOCKED on screen; files byte-identical on disk and untouched by v5 |
| No AI UI | BLOCKED | needs GUI |
| v5 rewrote or removed v6 data | PASS | after the v5 run, `settings.json` (with the Rita keys) and `skills/` hashes are unchanged; only `logs/bdobb.log` differs. v6 data was present and ignored |

Rollback remains "reinstall the v5 build"; no data was removed.

## Restore verification (PASS)
The real v5 profile (set aside as `.keep`) was moved back and re-manifested: hash list, sizes, mtimes and modes are byte-for-byte identical to the pre-swap manifest (`cmp` exit 0). No `.keep` or stray v5 directory remains; no QA app instance is running. The `com.artcashin.bdobb.clean.v6` profile directory was left in place (QA scratch).

## Production profile untouched
Read-only checks only. The newest mtime anywhere under `com.artcashin.bdobb2` is 2026-10-07 10:38 EDT, before this task began; `com.artcashin.bdobb2-backups` mtime is unchanged (Oct 1 11:16). Caveat: a metadata hash of `ls -laR` taken before and after differed for a reason not identified (nothing in the tree has a newer mtime; repeated runs now agree with each other), so byte-level before/after equality for production is not proven by that hash alone.
