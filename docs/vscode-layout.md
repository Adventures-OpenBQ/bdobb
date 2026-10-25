<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The bdobb-v2 VS Code layout

The window is a 5x5 grid with four regions:

```
 col:   1        2        3        4        5
      +-------+-----------------+-----------------+
row 1 |       |                 |                 |
row 2 | file  |   file editor   |                 |
row 3 | tree  |                 |   Claude Code   |
      |       +-----------------+      CLI        |
row 4 |       |                 |                 |
row 5 |       |  shell terminal |                 |
      +-------+-----------------+-----------------+
```

| Region | VS Code surface |
|---|---|
| Col 1 | Explorer sidebar, ~20% width |
| Cols 2-3, rows 1-3 | Left editor group — source files |
| Cols 2-3, rows 4-5 | Terminal-as-editor below it — shell |
| Cols 4-5, rows 1-5 | Right editor group — terminal-as-editor running `claude` |

Two deliberate choices:

- **The sidebar spans all five rows, not four.** VS Code's sidebar is always
  full height. There is no way to stop it at row 4.
- **Both terminals are editor tabs, not the bottom panel.** The bottom panel
  always spans the full editor width, so it cannot be confined to columns 2-3.
  Terminals hosted in the editor area can be split and sized freely.

## Building it — every session

The two terminal panes do not survive quitting VS Code (see below). Rebuilding
them is part of starting a session, not a recovery step:

1. Open the folder: `code ~/Developer/bdobb-v2`
2. Drag the Explorer sidebar border to roughly 20% of the window width.
   *(Persists — only needed once.)*
3. Command Palette → **Terminal: Create New Terminal in Editor Area**.
   Drag that terminal tab to the **right edge** of the editor area to make it
   its own group. Size that group to ~40% of the editor area's width. Run
   `claude --continue` in it to pick up the last conversation.
4. Focus the left editor group. Command Palette → **Terminal: Create New
   Terminal in Editor Area**, then drag it to the **bottom** of the left group.
   Size it to ~40% of that group's height.
5. Open a source file in the left group's top half.

Use the Command Palette entry, not `` Ctrl+` `` or the Terminal menu — those
open in the bottom panel, which spans the full editor width and cannot be
confined to columns 2-3.

## What survives a restart, and what does not

There is no save-layout command. VS Code writes workbench state itself, per
workspace folder, into
`~/Library/Application Support/Code/User/workspaceStorage/<hash>/state.vscdb`
— the editor grid under `memento/workbench.parts.editor`, panel terminals under
`terminal.integrated.layoutInfo`.

| Element | Survives `Cmd+Q`? |
|---|---|
| Sidebar width and position | yes |
| File editor tabs, and their group's geometry | yes |
| Panel terminals | yes |
| **Terminals in the editor area** | **no** |
| Groups that contained only a terminal | no — removed with the terminal |

**Terminals in the editor area are destroyed on quit, by design.** VS Code's
`TerminalEditorInput` registers this on shutdown:

```js
this._configurationService.getValue("terminal.integrated.enablePersistentSessions") && r.reason === 3
  ? e.detachProcessAndDispose(1)   // preserved
  : e.dispose(1)                   // destroyed
```

The terminal is preserved only when `reason === 3` — `ShutdownReason.RELOAD`.
`CLOSE` is 1 and `QUIT` is 2, so both `Cmd+Q` and closing the window destroy
it. `Developer: Reload Window` is the only shutdown that keeps it.

Consequence: after a quit the grid comes back with at most one leaf (the file
editor group). That is expected, not a fault. Rebuild the two terminal panes
using the steps above.

## Resuming the Claude Code session

Losing the pane does not lose the conversation. The CLI writes transcripts to
`~/.claude/projects/-Users-artcashin-Developer-bdobb-v2/` as JSONL, independent
of the terminal process, so a destroyed pane leaves them untouched.

| Command | Effect |
|---|---|
| `claude --continue` (`-c`) | resume the most recent conversation for this directory |
| `claude --resume` (`-r`) | pick a conversation from a list |
| `claude --resume <id>` | resume a specific session id |
| `claude --fork-session` | resume but branch to a new session id |

## One way to silently lose the layout

**Opening the folder by a different path.** The storage directory is keyed by a
hash of the folder URI, so a symlinked path, a trailing slash, or opening the
folder as part of a multi-root `.code-workspace` each get their own separate
storage — and the saved state will not appear. Always open it the same way:
`code ~/Developer/bdobb-v2`.
