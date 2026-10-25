# v5 #9 and #10 automated evidence 2026-10-10 — receipts (FREEZE)

Branch `claude/v5-18-first-open`, on top of the tag `ab2e4eb`. User order 2026-10-10: close #9 and #10 with automated evidence instead of a manual morning check. Both fixes were already on this line. This commit adds the tests that prove them; no product code changes.

- **#10, column fitting.** `TableRenderer`'s data table is `widget-table sized`: `table-layout: fixed`, as wide as the sum of its columns. `KeysRenderer` is unchanged. New `e2e/column-resize.spec.ts` uses a real pointer: a 60 px drag on a column edge grows that column by 56–64 px, the other columns stay within 1 px, and a table narrower than the card leaves the spare space on the right. A 500 px drag in a narrower card makes the table wider than the card, and `.table-scroll` then scrolls sideways. With the `sized` class and width removed (checked on v3), both tests fail: a 60 px drag grew the column 44 px, and a 500 px drag grew it 25 px.
- **#9, Workspace sign-in.** `workspaceSignIn` reads `user.pro_display_settings` and `uuid` from the `/pro/login` response (from `c8c7f7c`). It makes no `GET /pro/user` and sends only `Authorization: Bearer`. New opt-in `src/test/integration/workspace-login.test.ts` (`pnpm test:workspace`) runs against a REAL self-hosted server:
  - **Server.** openbq-docker v2.0.0's Workspace image `openbq-workspace-local:2.0.0`, on `127.0.0.1:17300` only. No Tailscale sidecar, no tailnet, a fresh throwaway data volume, and a throwaway admin account. The account is in the gitignored `.env.workspace-test.local` and is never printed or committed.
  - **Path.** The test drives the store's `probe` and `signIn` (what the sign-in form calls) over the browser-mode transport (`browser-shim/http`), then the sign-in sync's `readSessionSettings`.
  - **Assertions.** Mode is `login`. The settings stage (font size medium, 2 decimals, the account's defaults). Sign-in is exactly `POST /api/pro/login 200`. The only 401 is the probe's deliberate unauthenticated `GET /pro/user`. `X-OpenBB-Authorization` is never sent. No profile file holds the password or the session token.
  - **Root cause, confirmed against that server.** `GET /pro/user` with `Authorization: Bearer` alone returns 200. Adding `X-OpenBB-Authorization`, or sending it alone, returns 401.
  - **Fails without the fix.** With the pre-`c8c7f7c` sign-in reinstated (a `GET /pro/user` carrying both headers), the test fails: sign-in returns "Workspace settings could not be downloaded" (checked on v3).
- `package.json` gains `test:workspace`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6023 passed | 7 skipped (6030) |
| e2e-column-resize | 2 passed |
| workspace-login | 1 passed, against the local server |
| notices-check | up to date |
| diff-check | `git diff --check ab2e4eb` exit 0 |
| scrub | scrub-check clean, header-check clean |

Every gate ran once, one line at a time. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is this commit; the product source equals `ab2e4eb`. Delivery: nothing pushed, no tag moved.
