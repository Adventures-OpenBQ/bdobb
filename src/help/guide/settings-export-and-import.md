---
type: Note
tags: [bdobb, help, configuration, settings, export, import, bundle, folders]
---

# Settings Export and Import

Your preferences and your rail's folder tree travel between machines as one file, `bdobb-settings.json`. It is the answer to "I have BDOBB set up the way I like it on this Mac, and I want the other one to match" — a question that, before this version, had only the partial answer that dashboards travel as `apps.json`.

## Two ways out, two ways in

**Export…** and **Import…** sit in the Settings dialog's header, beside the `✕`. Export opens a save dialog defaulting to `bdobb-settings.json`; cancelling does nothing and says nothing.

Import has two ways in, and both parse the file with the same limits — but they no longer end the same way:

- **Import…** in the Settings dialog header, which opens a file picker and shows a per-field review of what the file would change before anything is staged; see "The notices" below.
- **A drop of the file on the dashboard.** It is recognised by its *shape*, not its name, so a file you renamed still imports — see [[documents-pdf-and-files|Documents, PDFs and Files]] for what else a drop can be. A settings bundle is a JSON object; an `apps.json` is a JSON array; the two sniffs can never both say yes. A drop applies immediately, with no review step.

A drop's result is one line in the rail. **Import…** in the dialog shows the review instead, and needs an **Apply**, then a **Done**, before anything reaches disk.

## What leaves

Two things, and only two:

- **Your preferences** — every control on the Settings dialog's **General**, **Widget** and **Layout** tabs: theme, font size, the auto-refresh interval, the default widget ticker, *Match the symbol on the dashboard*, maximum decimal places, the minimize button, the widget-controls chevron, corner drag handles, the quick-add toolbar and the collapsed rail width.
- **The rail's folder tree** — your folders, their sibling order, where each dashboard sits, and which folders are collapsed. A machine with no folders of its own writes no folder tree at all, deliberately; see the notices below.

Deliberately **not** exported:

- **The dashboard order.** Importing dashboards gives every one of them a new id, so an exported order would name dashboards that exist nowhere on the machine reading it.
- **Your connections, and any credential in them.** Those live in `backends.json` and have no export at this version — see [[backends-and-connections|Backends and Connections]].
- **Your dashboards themselves.** Those are `apps.json`, one dashboard at a time; see [[import-and-export|Import and Export]].
- **Provider keys**, which are the backend's, not the app's. See [[provider-keys|Provider Keys]].

The file carries a `version` field. A file too new for this build to understand is refused outright, naming both versions; an older file written before this field existed still imports, under its own notice. Within a version every member is optional and additive, so a reader takes the parts it understands and ignores the rest.

## What comes back

The two halves are restored by deliberately different rules.

**Preferences are applied one field at a time.** A setting the file does not mention keeps the value it already had, so an older file, or one you trimmed by hand, cannot quietly reset the rest of your preferences to their defaults. A field the app recognises carrying a value it does not — a theme it has never heard of — is downgraded to its default exactly as it would be in `settings.json` itself, rather than costing you the import.

**The folder tree is replaced.** Not merged: merging two trees has no sensible answer for two folders that share an id and disagree about their parent. What arrives is what you get.

Your dashboards are untouched either way. A folder tree that names a dashboard this machine does not have simply has nothing to place.

## The notices

A **dropped** file applies immediately and ends in one of three notices, which say exactly what happened to the folder tree. (**Import…** in the dialog shows the per-field review described above instead, and only an older, pre-`version` file gets a notice there — *Older settings file; imported the fields it names.*)

- *Imported settings and 3 folders.* — the file carried a folder tree with folders in it, and that tree is now yours.
- *Imported settings.* — the file carried no folder tree at all. This is what **Export…** writes on a machine with no folders, so exporting from a flat setup can never wipe the folders on the machine reading it.
- *Imported settings and cleared the folder tree.* — the file carried an *empty* folder tree: a hand-edited file, say. The tree is still replaced, because that is the rule above rather than an exception to it, and the notice says so plainly instead of leaving you to notice your folders are gone.

## The guards

A file that is not JSON is refused with *That file is not JSON.* One that is JSON of the wrong shape is refused with *That file is not a bdobb-settings.json: expected a settings object.* Either way nothing changes — no half-import, no partially applied preferences.

**Import…** in the dialog checks the same **10 MB** ceiling the `apps.json` import uses, from the file's size before a byte is read, and refuses above it with *File is … MB; the limit is 10 MB.*

A **dropped** file is checked differently, and the difference is worth knowing. A dropped `.json` is only sniffed for being a settings bundle when it is 10 MB or smaller. An oversize `bdobb-settings.json` dropped on the dashboard is therefore never recognised as one: it falls through and becomes a **Local file** card instead, exactly as any other large `.json` you drop would. That is the local-table path, with its own much larger ceiling — see [[documents-pdf-and-files|Documents, PDFs and Files]].

---
*Source: BDOBB v3.0.1 in-app manual, "Import and export"; `BDOBB` `src/lib/settingsBundle.ts`, `src/lib/saveTextFile.ts`, `src/components/dialogs/SettingsDialog.tsx`, `src/components/DropZone.tsx` and `src/stores/foldersStore.ts`.*
*See also: [[import-and-export|Import and Export]] · [[settings-and-logs|Settings and Logs]] · [[app-data-and-settings|App Data and Settings]] · [[dashboards-and-folders|Dashboards and Folders]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
