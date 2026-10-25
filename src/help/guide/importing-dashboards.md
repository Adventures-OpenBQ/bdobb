---
type: Note
tags: [bdobb, help, getting-started, dashboards, import, apps-json]
---

# Importing Dashboards

Once a backend is connected (see [[connecting-a-backend|Connecting a Backend]]), don't build dashboards widget by widget if someone has already arranged them. An `apps.json` — OpenBB Workspace's format for a set of dashboards with widgets already arranged, parameterised and grouped — unfolds into the whole set in one import. A backend's own `apps.json` needs no file at all: the rail's **Apps** row lists the apps every connected backend serves, grouped by backend, and opens the one you pick as a dashboard (the example dashboards arrive this way; see [[example-dashboards|Example Dashboards]]). An `apps.json` you hold as a file imports as below.

## Importing an `apps.json` file

For a file you were sent, or exported from another machine, there are three ways in, and all three run exactly the same import with the same limits and the same notice:

- Right-click empty space in the rail's *MY DASHBOARDS* area and choose **Import apps.json…**.
- In the desktop app, choose **File ▸ Import apps.json…** from the menu bar.
- **Drop the file on the dashboard.** A `.json` of 10 MB or less is sniffed first; if it turns out to be an `apps.json` it is imported as dashboards instead of becoming a table.

Every app in the file becomes a new dashboard, unless its name is already one of yours (below). A name repeated *inside* the file is not asked about: the second copy becomes `Macro (2)`. The notice in the rail reads *Imported 3 dashboards, 12 cards (1 unresolved: `<id>`)*. The bracket appears only when a card is unresolved.

## When a dashboard's name is already taken

When a dashboard in the file has **exactly** the name of one of yours (capitals count), you are asked about it before anything is written: one dialog per conflicting dashboard, in file order, with *Conflict 2 of 3* when there are several. Each dialog shows both sides — *Yours: 3 tabs, 12 cards* and *In the file: 2 tabs, 9 cards* — and four buttons:

- **Replace** swaps in the file's tabs, cards and groups. Yours keeps its name and its place in the rail, and anything you added to it since is gone. When two of your dashboards share the name, Replace is unavailable, and says so, until you rename one.
- **Keep both** — the default, focused when the dialog opens — adds the file's dashboard under the first unused name, such as `Macro (2)`. The button shows the name it will get.
- **Skip** leaves that dashboard out.
- **Cancel import**, or Escape, stops the whole import. Nothing is written, and the notice reads *Import cancelled; nothing changed.*

The answers are collected first and written once, at the end. The notice then counts what happened: *Imported 3 dashboards (1 replaced, 1 skipped), 21 cards (1 unresolved: `<id>`)*; the counts in parentheses appear only when they are not zero. A Replace that fails to write leaves your dashboard as it was and adds *Could not replace "Macro": …* to the notice; the other dashboards still import. A file with no conflicts imports without a dialog.

An imported card asks for what a card added from the library would. A multi-select value that the file saves as a list arrives as the comma-separated text the control itself writes. A parameter the file leaves out takes the group's default, then the widget's own default. The file's own value always wins.

## Unresolved cards

"Unresolved" means a card whose widget id no backend currently serves — usually an import from someone else's machine. It is not discarded: it reads *Widget `<id>` is not on any connected backend.* and comes alive by itself the moment a backend serving that id connects. The notice counts widgets, not cards, and names up to five of them: one missing widget placed on six tabs reads as `1 unresolved` with its id. To find the cards, look for the ones that carry that sentence.

## The size guard

Two hard ceilings, and hitting either imports nothing at all:

- **10 MB**, checked from the file's size *before it is read*. The refusal reads *File is … MB; the limit is 10 MB.* A dropped `.json` larger than this is not even examined for being an `apps.json`; it is treated as data and takes the local-table path, which has its own larger ceiling.
- **500 dashboards**, checked after parsing but before anything is written: *File holds 501 dashboards; the limit is 500.*

Both limits are inclusive, and a file that is not an array of apps fails with *Import failed: not an apps.json file*.

## Parameter groups arrive with the import

Some dashboards link cards together through **parameter grouping**: several widgets share a control, so changing the symbol on one card moves every card in the group in one write. This is what turns a pile of independent widgets into a single instrument.

A file's groups arrive as groups on the new dashboard. Each card's membership is read from the card itself, as OpenBB Workspace writes it, or from a member list on the group, as a hand-written file may -- both are read. A group's kind is taken from the file when it names one, otherwise from the control of the first member the app can resolve, so an imported date group can be joined by any date picker.

Once imported they are ordinary groups, the same as ones made in the app: a bound control shows its group's number where the chain-link would be, the tab strip shows a chip for each group, and you can join, leave, rename or delete them. To switch groups off for one dashboard without deleting them, right-click its rail row and tick **Disable grouping**; the tab strip then shows a small `grouping off` tag. See [[card-parameters|Card Parameters]].

## Exporting the other way

Right-click a dashboard row for **Save…** and pick the format, in the Save panel on a Mac or from a small menu elsewhere: **Strict OpenBB Workspace** writes the plain OpenBB app shape; **BDOBB Workspace** also preserves custom names and ordinary table state in validated extensions. Dropped file bytes and credentials do not travel. See [[import-and-export|Import and Export]] for everything that can be exported and imported.

## When a widget type isn't natively rendered

Any widget type the app does not know how to draw falls through to a raw-JSON view rather than erroring — the app telling you it fetched something fine and does not know how to draw it. OpenBB's server-side tables (`ssrm_table` and `table_ssrm`) are drawn as tables: managed ones from the configured table service, and standard OpenBB SSRM providers as LIVE pages; see [[troubleshooting-using-bdobb|Using BDOBB]].

---
*Source: BDOBB v3.1.0 in-app manual, "Import and export" and "Card parameters"; `BDOBB` `src/lib/appsJson.ts` and `src/lib/dataClient.ts` at `v3.1.0`; `BDOBB` `src/lib/appsJson.ts` at `v3.0.5`.*
*See also: [[dashboards-and-folders|Dashboards and Folders]] · [[widget-library|The Widget Library]] · [[import-and-export|Import and Export]] · [[card-parameters|Card Parameters]]*
