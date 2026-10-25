# Built-in widgets

Five widgets need no backend at all. They are listed in the library under the
**Built-in** category, and because they have no provider they appear under
**All providers** but under no particular one.

![Five of the built-in widgets on one tab](./shots/built-in-widgets.png)

## Note

*A free-text markdown note.* Click the body — or focus it and press Enter or
Space — to switch to a text area. Clicking away saves; **Escape** throws the
draft away and puts the stored text back. An empty note reads
*Click to write a note.*

The text is a hidden parameter, so it does not clutter the header's controls
row. A
draft still in the editor is committed if you remove the card or close the app.

## Markdown

*A rich-text markdown note with a formatting toolbar.* The body is a live
editor: type straight into it. Select some text and a toolbar appears with
the block type (Paragraph, Heading 1, 2 or 3, lists, quote), bold, italic
and links; type `/` at the start of a line for the same choices as a menu.
Edits save on their own about half a second after you stop typing, and when
the editor loses focus.

What is stored is Markdown, in a hidden parameter, so it does not clutter
the header's controls row and it travels with the dashboard on export. Raw HTML
or unusual Markdown pasted in may be simplified on the first edit.

The card's **⋯** menu carries two items. **Open file…** copies a `.md`,
`.markdown` or `.txt` file into the note (it asks first if the note is not
empty, and refuses a file over 1 MB). **Save as…** writes the note out as a
`.md` file. Both are copies: the card keeps no link to the file, so editing
the note does not change the file and editing the file does not change the
note.

A note whose stored text cannot be opened in the editor shows read-only with
*Could not open this note in the editor.* above it; nothing is written until
it can.

## Clock

*Current time across several markets.* Four parameters:

- **Time zones** — comma-separated IANA names, in display order. It defaults to
  `America/New_York,America/Chicago,America/Los_Angeles,Europe/London,Asia/Shanghai,Asia/Tokyo,Australia/Sydney`.
  It is free text; there is no picker.
- **Layout** — **Vertical** (the default) or **Horizontal**.
- **Hour format** — **24-hour** (the default) or **12-hour**.
- **Face** — **Dot matrix** (the default) or **Solid**. It only applies to the
  vertical layout.

Vertical is a digital list, one row per zone: city, region, GMT offset and the
time. Horizontal is a sideways gallery of analog faces, where the face
setting does nothing. There is no second hand in either; the clock updates on
the minute.

An unrecognised zone never breaks the card — it is named in a notice above,
reading *Unknown time zone: Foo/Bar*, and the rest still render.

## Website

*Frames any web page.* One parameter, **URL**. With it empty the card reads
*Enter a URL in Parameters to frame a page.*, which is a normal state rather
than an error.

Plenty of sites refuse to be framed. See **HTML and iframe widgets** for what
the card does about that and what **Open externally ↗** is for.

## RSS feed

*Headlines from any RSS or Atom feed.* Two parameters: **Feed URL**, and
**Items**, which defaults to `20`.

Each headline shows its title and, underneath, the source and how long ago it
was published — or an em dash if the feed gave no usable date. The relative
time keeps advancing once a minute even with auto-refresh off. Clicking a
headline opens it in your browser; an item the feed gave no link for is a
disabled row.

**Refresh** and `⌘R` re-fetch, and the widget declares no interval of its own,
so automatic refresh follows your app-wide setting. A feed larger than 5 MB is
refused, and there is a 30-second connect timeout. An **Items** value that is
missing, zero, negative or nonsense falls back to 20.

If a feed fails you get an error card with **Retry** and one of
*Could not reach the feed.*, *Not an RSS or Atom feed*,
*Feed is too large to show.* or an HTTP status. The underlying error is
deliberately not shown, because feed addresses routinely carry a personal
token.

## Parameter echo

A card with three controls — a Ticker, a Date and a Year — and no data source.
It shows the values it would send, exactly as a request would carry them, with
`$currentDate` resolved. It exists to try parameter groups on: its Ticker is
labelled as a `symbol`, so it can join a symbol group from any other widget,
its Date joins any date group, and its Year joins a `year` group.

[shot-pending]: #24

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
