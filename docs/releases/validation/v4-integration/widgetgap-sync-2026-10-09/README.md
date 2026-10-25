# v4 widgetGap sync 2026-10-09 — receipts

Branch `codex/clean-v4-integration`, on top of `ed0fa4c` (user ruling 2026-10-09: v3 becomes tolerant, then v4 adds widgetGap):
- `15393ba` merges `refs/integration/v3-widgetgap-tolerance-2026-10-09` = v3 `3b2aa75`, with no conflicts. A download now ignores `extensions.bdobb.settings` keys outside NATIVE_KEYS, with a note, instead of refusing.
- `4da6b9a` adds widgetGap to NATIVE_KEYS, so it uploads and downloads with User Settings on a server. The profile stays "v3". The spec's synced-keys line is amended.

USER-APPROVED TEST CHANGES:
- mergeUpload's bdobb block now has 12 keys, not 11.
- The carried "later version" test uses a hypothetical `laterKey`.
- v3's two former refusal cases (headerValue, settingsStorage) now assert the key is never applied and is named in the note.

`run-gates.sh` ran every gate once at HEAD `4da6b9a` (see `head.txt`), with e2e ports 4683/4684. Every gate exited 0; there were no reruns, so there is no composite evidence. Load per gate is in `gates.tsv`. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 9s |
| lint | pass | 7s |
| unit | pass | 309 files passed, 1 skipped; 5607 tests passed, 6 skipped; 310s |
| build | pass | 17s |
| e2e | pass | 215 passed, 1 skipped; 445s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 17s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |

Not verified: sync against a live Workspace server.

Delivery: nothing pushed, no tag moved.
