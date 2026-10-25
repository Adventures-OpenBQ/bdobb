# Native Window-menu check (2026-10-08) — PARTIAL

Bundle: BDOBB Clean v6 (com.artcashin.bdobb.clean.v6), built from HEAD 485ed5f (see bundle.txt).

| # | Check | Result |
|---|---|---|
| 1 | Window menu lists the stock items, then Keep Sidebar Open and Keep Rita Open | PASS (read through the macOS menu bar with app_menu: Minimize ... Close Window, Keep Sidebar Open, Keep Rita Open). Separator, greyed/unchecked state and the accelerator glyph were NOT visually confirmed. |
| 2-5 | Enabled/checked state follows the workspace pin; choosing the item toggles the pin; ⌘⇧A toggles the Rita pin once; Keep Sidebar Open greys out outside a workspace | NOT RUN |

Why: the app window cannot be captured in background mode (the webview renders blank), and the full-screen capture attempt was interrupted by the user, so no screen takeover was retried. No screenshot was saved.

Open risk (review finding, wry-0.55.1 source reading, unverified in a packaged build): macOS hands cmd-key events to the webview first and only forwards UNHANDLED keys to the main menu. Commit 485ed5f therefore makes the JS shortcut return before preventDefault in the native app. If checks 2-5 show ⌘⇧A not toggling, revert 485ed5f and rethink.
