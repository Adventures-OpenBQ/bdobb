---
type: Note
tags: [bdobb, help, widgets, pdf, documents, files, drop, csv, xlsx]
---

# Documents, PDFs and Files

Three widget families put a document rather than a data table in a card: a PDF fetched from a backend, a picker over several backend documents, and a table made from a file you dropped from your own desktop.

## PDF cards

A `pdf` widget fetches one document and shows it. It has no view dropdown at all — there is no second way to look at a PDF, and dumping several hundred kilobytes of base64 into a raw view helps nobody.

The toolbar, left to right: the filename (hover it for the full one), a **page box**, the page count, the zoom percentage, `−` and `+`, **Fit**, and `🔍`.

**The page box.** Type a number and press Enter, or click away, to jump. The value is clamped, so `0` goes to page 1 and `999` goes to the last page. The box follows you as you scroll.

**Zoom** moves in 25% steps between 50% and 300%. **Fit** is fit-to-width and is the default. Resizing the card re-fits only while you are in Fit mode.

**Find** opens with `⌘F`, but only while the pointer is over that PDF card or the card holds focus. The bar holds a box, a count reading `3 of 12` or *No matches*, and `‹`, `›` and `⨯`. **Enter** goes to the next match and **Shift+Enter** to the previous. Search is always case-insensitive, never whole-word, and always highlights everything. **Escape inside that card closes the find bar** and nothing else; it will not also un-maximize the card.

Text can be selected and copied. Links inside the document work: an internal one scrolls to its page, an external one opens in your browser. There is no outline sidebar, no thumbnails, no print, no download. The viewer is pdf.js.

**A PDF sent as a link.** A backend may answer with the address of a PDF instead of the file itself. The card downloads it and shows it in the same viewer. None of the backend's credentials go with that download, it gives up after 30 seconds, and leaving the card cancels it. A host that refuses reads as the filename and the HTTP status, for example *Sample.pdf: HTTP 403*, with **Retry**. The PDF is not framed: WebKit will not draw a PDF inside a sandboxed frame.

**A refresh keeps your place.** Every fetch decodes the document again, but a card that refetches — on a timer, from **Refresh**, or with `⌘R` — compares what came back with what it already had, and when the bytes are identical it keeps the viewer exactly as it is. You stay on the page you were reading instead of being sent back to page 1 by a document that did not change.

**On older Macs.** The viewer is built against a version of pdf.js chosen to run on WebKit as it shipped in macOS 12.3, rather than the newest one, which quietly requires a much later WebKit. On a Mac before macOS 14.4 the newer build left every PDF card blank; this one draws.

## Multi-file documents

A `multi_file_viewer` widget fetches nothing on its own; its documents arrive once you have picked some. Like a PDF card it has no view dropdown.

The picker is a narrow rail down the left edge of the card body, 28 pixels wide, showing a `▤` and one badge. Point at it and it opens to 260 pixels over the viewer, so nothing reflows. Inside is a checkbox list — each row's tooltip is the document's address — plus **Open** and **Clear**. Opening does not close the rail, because picking documents is usually several Opens in a row.

**The badge** tells you four different things: `…` while the list is loading; `!` if it failed, with the error as its tooltip; a plain number — how many documents are available for your current parameters, `0` included; or `2/7` once you have checked some. That distinction is the point: a bare `0` used to mean both "you have picked nothing" and "this filter matched nothing".

Your selection is not saved and resets whenever you change a parameter. Card **Refresh** re-opens the same files. Several open documents are paged with `‹`, a `1 / 2` readout, and `›`.

A document the backend could not serve takes its place in the pager as one line naming it and the backend's reason; the documents it did serve still open. Documents sent as links are downloaded as described under PDF cards.

## Dropping a file on the dashboard

Drag a file from your desktop onto the dashboard and a veil appears reading *Drop files to add widgets*. Accepted: `.csv`, `.tsv`, `.json`, `.xlsx`, `.xls`. Anything else says *Unsupported file: name*.

A `.json` of 10 MB or less is sniffed first — if it turns out to be an `apps.json` it is imported as dashboards instead of becoming a table (see [[importing-dashboards|Importing Dashboards]]).

Everything else becomes a **Local file** card whose title is the original filename. It lands **below everything already on the tab**, and a drop of several files stacks them downward. The bytes are copied into the app's own data directory, so the card keeps working if you move the original. The result goes through the ordinary table renderer, so filtering, pinning, sorting and transpose all apply; cell clicks do not, because a dropped-file table sets no parameters. Only the first sheet of a workbook is read (SheetJS does the reading, and is credited under **Credits**).

**Removing the card deletes the stored copy.** Duplicating a dashboard does not copy the file — both cards point at the same copy, deleted only when the last card naming it is removed. Exporting such a card in the **Strict OpenBB Workspace** format carries a reference that means nothing on another machine; the **BDOBB Workspace** format refuses the dashboard instead, with *Local assets require a repository archive.*

Data files are capped at **50 MB**, checked before a byte is read: *name is 51.2 MB; the limit is 50 MB.* One drop leaves one notice line, however many files had something to say. Dropping onto a viewer window does nothing — there is no veil there — and neither is a drop taken while a dialog or the widget library is open over the dashboard, because the gesture was aimed at the overlay.

---
*Source: BDOBB v3.1.0 in-app manual, "Documents, PDFs and files"; `BDOBB` `src/components/renderers/PdfView.tsx` and `src/lib/abortSignalAny.ts` at `v3.1.0`; `BDOBB` `src/lib/documents.ts`, `src/lib/dataClient.ts` and `src/components/renderers/DocumentView.tsx` at `v3.0.5`.*
*See also: [[tables|Tables]] · [[importing-dashboards|Importing Dashboards]] · [[app-data-and-settings|App Data and Settings]] · [[keyboard-shortcuts|Keyboard Shortcuts]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
