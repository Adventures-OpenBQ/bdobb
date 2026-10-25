---
type: Note
tags: [bdobb, help, configuration, app-data, settings, files, quarantine]
---

# App Data and Settings

Everything the app remembers is plain JSON on your own disk, in the app's data directory. Knowing where it is, what each file holds and what the app does when one goes wrong answers most "where did my dashboards go" questions before they are asked.

## Where it is

On macOS: `~/Library/Application Support/com.artcashin.bdobb/`. The folder is named after the app's **bundle identifier**, not its display name.

This BDOBB uses the original BDOBB's identifier. On its first launch it copies in the data of the clean v3 repair build (`com.artcashin.bdobb.clean.v3.repair/`, which is left as it was) and renames any folder already there, the original BDOBB's, to `com.artcashin.bdobb.v1-backup/`. Nothing is deleted, and the copy happens only once.

## What is in it

| File | Holds |
|---|---|
| `settings.json` | everything in the Settings dialog, plus the AI Library's fields — Rita URL, context sharing, tool-round limit, MCP servers and their per-tool switches, share targets, the pane's hover delay |
| `chat.json` | the Rita conversation and the cards shared with it; created on the first turn, deleted by **Clear** |
| `mcpTokens.json` | bearer tokens you pasted for MCP servers, in the clear; never in `settings.json` and never exported; created on first use |
| `skills/<slug>/SKILL.md` | one file per Rita skill; the five bundled skills are written only when `skills/` does not exist |
| `backends.json` | your connections, including any credential you typed, in the clear |
| `folders.json` | the rail's folder tree, sibling order, placement and collapsed state |
| `dashboards/<id>.json` | one file per dashboard — its tabs, cards, layouts, parameters, groups, and every card's saved state (table columns) |
| `workspaces/<id>.json` | one file per workspace — its name, its layout, which dashboard sits in each tile, its minimum resolution, its launch tick and its rail pin |
| `layouts/<id>.json` | one file per saved layout — tiles only, no dashboards |
| `workspace.json` | your OpenBB Workspace connections — never a password or a session token |
| `workspaceSync.json` | the links between your dashboards and the Workspace server dashboards they sync with |
| `files/<uuid>.<ext>` | a copy of every data file you have dropped on a dashboard, deleted when the last card naming it is removed |
| `logs/bdobb.log` | the app log, plus up to five rotated generations |

## Writes are atomic

The app writes a temporary file and renames it over the target, so a crash can never leave you with half a dashboard. Position and size are saved when you let go of a card; a slider setting is saved when you release it; a rename is saved on Enter or on clicking away — so one adjustment is one write.

## When a file is unreadable: quarantine

If one of these files is present but cannot be parsed, or has a field of the wrong type, the app **renames it to `<name>.corrupt`** (then `.corrupt.1`, `.corrupt.2`, and so on) and carries on with defaults. Nothing is ever overwritten and the original is still there.

Nothing is shown in the UI when this happens. The only trace is a log line reading `quarantined <path> -> <path>.corrupt`, which you can find in **Settings ▸ Logs**. If your settings or dashboards have apparently reset themselves, that is the first place to look — and the `.corrupt` file beside the fresh one is your data.

## A file that cannot be read is not a corrupt one

Unparseable *bytes* are the file's fault, and quarantine is the right answer. A read that never produced bytes at all — no permission, a volume that went away, a bad sector — says nothing whatever about the contents, which may be perfectly good. The app treats the two as the different events they are.

Such a file is **left exactly where it is**. It is not renamed, nothing is reseeded over it, and the load genuinely fails rather than quietly succeeding with defaults. The app runs on in-memory defaults for the rest of the session, and — this is the half that matters — it **refuses to save over that file** until a later read of it succeeds. Every store writes whole files from memory, so without that refusal the first folder you made or backend you added would replace a perfectly good `settings.json`, `backends.json` or `folders.json` with defaults. The refusal is logged, naming the file and saying that saving would replace it with what the app has in memory.

What that means in practice: fix the cause — remount the volume, repair the permission — and restart. Your file is still there, untouched.

Smaller problems are handled more gently: an unrecognised theme, font size or auto-refresh value, or an out-of-range decimal-places number, is downgraded to its default rather than quarantining the whole file. One bad entry in `backends.json` *does* quarantine the file, deliberately — dropping it silently would look like mystery data loss. The chat transcript is deliberately loose: only its message list must be an array, because the cost of a slightly wrong message is far lower than the cost of losing the conversation.

## Moving a configuration to another machine

In three pieces, which between them cover everything but your connections, your pasted MCP tokens and your skill files: dashboards travel one at a time as `apps.json`, the AI Library's settings as `ai-library.json`, and your preferences and folder tree together as `bdobb-settings.json` — see [[settings-export-and-import|Settings Export and Import]]. Connections travel separately, through **Export…** and **Import…** in the Connections dialog, because `backends.json` holds credentials in the clear. See [[import-and-export|Import and Export]].

---
*Source: BDOBB v3.0.1 in-app manual, "Getting started ▸ Where your data lives" and "Troubleshooting"; `BDOBB` `src/lib/jsonStore.ts` at `v3.0.1`.*
*See also: [[settings-and-logs|Settings and Logs]] · [[settings-export-and-import|Settings Export and Import]] · [[import-and-export|Import and Export]] · [[troubleshooting-using-bdobb|Using BDOBB]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
