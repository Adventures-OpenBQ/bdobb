# Built-in widgets

Eight widgets need no backend at all. They are listed in the library under the
**Built-in** category, and because they have no provider they appear under
**All providers** but under no particular one.

There is a ninth built-in, **Local file**, which the library deliberately does
not list: such a card only makes sense created by dropping a data file on the
dashboard, which is what puts a file behind it. See
**Documents, PDFs and files**.

![Five of the built-in widgets on one tab](./shots/built-in-widgets.png)

## Note

*A free-text markdown note.* Click the body — or focus it and press Enter or
Space — to switch to a text area. Clicking away saves; **Escape** throws the
draft away and puts the stored text back. An empty note reads
*Click to write a note.*

The text is a hidden parameter, so it does not clutter the header's controls
row. A
draft still in the editor is committed if you remove the card.

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

The card's **⋯** menu carries two items of its own. **Open file…** copies a `.md`,
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

## Date expression

*A scratchpad for the date language.* Type an expression into **Expression**
and the card shows what it resolves to twice over: once as a `date` and once
as a `datetime`. That pairing is the point — the same expression answers
differently depending on the parameter type it lands in (`T` is a day in one
control and an instant in another), and everywhere else you only ever see
whichever your parameter happens to be.

![The Date expression card resolving T-1bd](./shots/date-expression.png)

**Fiscal year end (month)** is a number, 1–12, and only `FQ`/`FY` anchors
consult it; December is the default, as it is everywhere else in the app.

Underneath, the card says whether the value was **read as an expression** at
all — an unparseable value is not an error in this grammar, it is sent
unchanged, and saying so is the difference between "my expression did nothing"
and "I typed it wrong". It then names the calendar behind the answer: the
dashboard's exchange, and whether that calendar came from a backend, from the
bundled NYSE file, or is a weekday table with no holidays in it.

The card loads that calendar itself, for the dashboard's exchange (or the
widget's own, then `XNYS`), the same way a period-typed control does — even
though its two parameters are deliberately a text field and a number, not a
period type. Its `bd` steps and trading anchors run against real holidays and
early closes, and the `⚠` appears only when no backend or bundled calendar is
available and the card falls back to a plain weekday table.

Resolution is the client's own — the same function a fetching card's
parameters go through — so what you read here is what a real card would send.

## Parameter echo

A card with three controls — a Ticker, a Date and a Year — and no data source.
It shows the values it would send, exactly as a request would carry them, with
the date's `T` resolved to today. It exists to try parameter groups on: its
Ticker is labelled as a `symbol`, so it can join a symbol group from any other
widget, its Date joins any date group, and its Year joins a `year` group.

## Period echo

Every period control on one card, and no data source: **FY ends** (a
dropdown), **Quarter**, **Fiscal year**, **Week**, **As of** (a date-time to
the second), **Range** (a start and an end) and **Session** (a time). Each
period defaults to `T`, so the card shows what "now" is in every unit, and
the echo underneath shows what a widget would receive: the range as two
parameters, the quarter and fiscal year labelled under whatever **FY ends**
says. Add two of them, set different year ends, and put both Quarter controls
in one group to watch one stored quarter read two ways.
