---
type: Note
tags: [bdobb, help, widgets, built-in, note, markdown, clock, website, rss]
---

# Built-in Widgets

Six widgets need no backend at all. They are listed in the library under the **Built-in** category — and because they have no provider they appear under **All providers** but under no particular one. A seventh, **Local file**, is deliberately not listed, because such a card only makes sense created by dropping a data file on the dashboard (see [[documents-pdf-and-files|Documents, PDFs and Files]]).

## Note

*A free-text markdown note.* Click the body — or focus it and press Enter or Space — to switch to a text area. Clicking away saves; **Escape** throws the draft away and puts the stored text back. An empty note reads *Click to write a note.* The text is a hidden parameter, so it does not clutter the header's controls row, and it travels with the dashboard on export.

## Markdown

*A rich-text markdown note with a formatting toolbar.* The body is a live editor: type straight into it. Select some text and a toolbar appears with the block type (Paragraph, Heading 1, 2 or 3, lists, quote), bold, italic and links; type `/` at the start of a line for the same choices as a menu. Edits save on their own about half a second after you stop typing, and when the editor loses focus.

What is stored is Markdown, in a hidden parameter, so it travels with the dashboard on export. Raw HTML or unusual Markdown pasted in may be simplified on the first edit.

The card's **⋯** menu carries two extra items. **Open file…** copies a `.md`, `.markdown` or `.txt` file into the note (it asks first if the note is not empty, and refuses a file over 1 MB). **Save as…** writes the note out as a `.md` file. Both are copies: the card keeps no link to the file.

## Clock

*Current time across several markets.* Four parameters:

- **Time zones** — comma-separated IANA names, in display order, defaulting to `America/New_York,America/Chicago,America/Los_Angeles,Europe/London,Asia/Shanghai,Asia/Tokyo,Australia/Sydney`. Free text; there is no picker.
- **Layout** — **Vertical** (the default) or **Horizontal**.
- **Hour format** — **24-hour** (the default) or **12-hour**.
- **Face** — **Dot matrix** (the default) or **Solid**. It applies only to the vertical layout.

Vertical is a digital list, one row per zone: city, region, GMT offset and the time. Horizontal is a sideways gallery of analog faces. There is no second hand in either; the clock updates on the minute. An unrecognised zone never breaks the card — it is named in a notice above, reading *Unknown time zone: Foo/Bar*, and the rest still render. The dot-matrix and solid faces are drawn as real SVG dots from a 5×7 bitmap, not a typeface.

## Website

*Frames any web page.* One parameter, **URL**. With it empty the card reads *Enter a URL in Parameters to frame a page.*, which is a normal state rather than an error -- the message still names a **Parameters** button the card no longer has; the **URL** field is in the controls row under the title. Plenty of sites refuse to be framed; see [[html-and-iframe-widgets|HTML and iframe Widgets]] for what the card does about that and what **Open externally ↗** is for.

## RSS feed

*Headlines from any RSS or Atom feed.* Two parameters: **Feed URL**, and **Items**, which defaults to `20`. It reads one feed, directly, with no server in between.

Each headline shows its title and, underneath, the source and how long ago it was published — or an em dash if the feed gave no usable date. The relative time keeps advancing once a minute even with auto-refresh off. Clicking a headline opens it in your browser; an item the feed gave no link for is a disabled row.

**Refresh** and `⌘R` re-fetch, and the widget declares no interval of its own, so automatic refresh follows your app-wide setting. A feed larger than 5 MB is refused, and there is a 30-second connect timeout. If a feed fails you get an error card with **Retry** and one of *Could not reach the feed.*, *Not an RSS or Atom feed*, *Feed is too large to show.* or an HTTP status. The underlying error is deliberately not shown, because feed addresses routinely carry a personal token.

## What built-ins have in common

None of them fetches through a connection, so none has an **Export ▸** menu, and none is polled by auto-refresh (the RSS feed excepted). They all travel with the dashboard in an `apps.json` export, because everything they need is in their parameters.

---
## Parameter echo

*Shows the parameter values a widget would send. For trying out parameter groups.* A card with three controls and no data source: **Ticker** (default `AAPL`), **Date** (default today, stored as `$currentDate`) and **Year** (a dropdown of `2024`, `2023` and `2022`, default `2024`). Its body lists each parameter by name, sorted, with the value a request would carry -- `$currentDate` resolved to a date, and a grouped control showing its group's value rather than the card's own.

It exists to try parameter groups on. Its Ticker is labelled as a `symbol`, so it can join a symbol group from any other widget even though it is named `ticker`; its Date joins any date group; and its Year joins a `year` group. See [[card-parameters|Card Parameters]].

*Source: BDOBB v3.3.0 in-app manual, "Built-in widgets"; `BDOBB` `src/lib/builtins.ts`, `src/lib/dotFont.ts` and `src/components/renderers/DotMatrix.tsx`.*
*See also: [[widget-library|The Widget Library]] · [[widget-cards|Widget Cards]] · [[html-and-iframe-widgets|HTML and iframe Widgets]] · [[documents-pdf-and-files|Documents, PDFs and Files]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
