# Documents, PDFs and files

## PDF cards

A `pdf` widget fetches one document and shows it. Its header mode reads **PDF**,
and it has no table/chart/raw toggle — dumping several hundred kilobytes of
base64 into a raw view helps nobody.

![A PDF card with its find bar open](./shots/documents-pdf-and-files.png)

The toolbar, left to right: the filename (hover it for the full one), a **page
box**, the page count, the zoom percentage, `−` and `+`, **Fit**, and `🔍`.

**The page box.** Type a number and press Enter, or click away, to jump. The
value is clamped, so `0` goes to page 1 and `999` goes to the last page.
Anything that is not a number restores the page you were on. The box follows
you as you scroll.

**Zoom** moves in 25% steps between 50% and 300%. **Fit** is fit-to-width and
is the default. Resizing the card re-fits only while you are in Fit mode; at an
explicit percentage a resize leaves the scale alone.

**Find** opens with `⌘F` (or `Ctrl+F`), but only while the pointer is over that
PDF card or the card holds focus — clicking the body focuses it, so it stays
the target after the pointer moves away. The bar holds a box, a count reading
`3 of 12` or *No matches*, and `‹`, `›` and `⨯`. **Enter** goes to the next
match and **Shift+Enter** to the previous. Search is always case-insensitive,
never whole-word, and always highlights everything — there are no toggles.

**Escape inside that card closes the find bar** and nothing else; it will not
also un-maximize the card. Escape anywhere else in the app leaves the find bar
alone, because that press belongs to whatever you are actually in.

Text can be selected and copied. Links inside the document work: an internal
one scrolls to its page, an external one opens in your browser.

There is no outline sidebar, no thumbnails, no print, no download, and no
searching across the *other* documents in a multi-file card.

## Multi-file documents

A `multi_file_viewer` widget fetches nothing on its own. Its header mode reads
**Files**, and its documents arrive once you have picked some.

The picker is a narrow rail down the left edge of the card body, 28 pixels
wide, showing a `▤` and one badge. Point at it and it opens to 260 pixels over
the viewer, so nothing reflows. Inside is a checkbox list — each row's tooltip
is the document's address — plus **Open** and **Clear**. Opening does not close
the rail, because picking documents is usually several Opens in a row.

**The badge** tells you four different things:

- `…` while the list of available documents is still loading
- `!` if that list failed, with the error as its tooltip
- a plain number — how many documents are available for your current
  parameters, `0` included
- `2/7` once you have checked some — checked over available

That distinction is the point: a bare `0` used to mean both "you have picked
nothing" and "this filter matched nothing".

Your selection is not saved — it is not written to the card and does not
survive a restart — and it resets whenever the available list changes, which is
to say whenever you change a parameter. Card **Refresh** re-opens the same files.

Several open documents are paged with `‹`, a `1 / 2` readout, and `›`.

## Dropping a file on the dashboard

Drag a file from your desktop onto the dashboard and a veil appears reading
*Drop files to add widgets*. Accepted: `.csv`, `.tsv`, `.json`, `.xlsx`,
`.xls`. Anything else says *Unsupported file: name*.

A `.json` of 10 MB or less is sniffed first — if it turns out to be an
`apps.json` it is imported as dashboards instead of becoming a table.

Everything else becomes a card whose title is the original filename, landing
where you dropped it; several files stack downward. The bytes are copied into
the app's own data directory, so the card keeps working if you move the
original. The result goes through the ordinary table renderer, so filtering,
pinning, sorting and cell clicks all apply. Only the first sheet of a workbook
is read.

**Removing the card deletes the stored copy.** Duplicating a dashboard does not
copy the file — both cards point at the same copy, which is deleted only when
the last card naming it goes. Exporting such a card to `apps.json` in the
**Strict OpenBB Workspace** format carries a reference that means nothing on
another machine; the **BDOBB Workspace** format refuses the dashboard with
*Local assets require a repository archive.*

Data files are capped at 50 MB, checked before a byte is read:
*name is 51.2 MB; the limit is 50 MB.* Dropping onto a viewer window does
nothing at all — there is no veil there.

[shot-pending]: #25

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
