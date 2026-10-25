# Card parameters

Most widgets take parameters — a symbol, a date range, a provider. The card's
header carries its parameters as chips on the title line — one per visible
parameter, showing the value, named by its tooltip — and they wrap to a
second line when the title bar is narrow. What a card is asking for is
always in view; the `▸` chevron before the title, or **Parameters** in the
`⋯` menu, opens a panel docked under the title bar with the same controls and
their names, as a form. It stays open until you close it, and open or closed
is saved with the card.

Uncheck **Display on title bar** at the bottom of that form to take a card's
chips off its title line. The form still edits them, and the choice is
saved with the card. A **Date expression** card starts with the box
unchecked; check it to put its chips on the title line.

![Two cards with their parameter rows](./shots/card-parameters.png)

Some parameters are declared hidden by the backend. They never appear here, but
they are still sent with every request — that is how `provider` rides along on
nearly every widget.

## When a change takes effect

A dropdown, a multi-select and a checkbox take effect the moment you change
them. A text, number or date field takes effect when you leave it or press
Enter, so a half-typed symbol does not refetch the card on every keystroke.
Typing a value and typing it back writes nothing.

A card whose widget declares a **Run** button is the exception: its controls
save what you chose and mark the card stale (a dot beside the title); nothing
is fetched until you press Run.

## The kinds of control

Which control you get is decided in this order:

- A **tabs** parameter with options becomes a segmented control in the card
  body — see below.
- A **form** parameter becomes a form in the card body — see below.
- **Multi-select** becomes a list you can pick several from. The value is sent
  comma-joined, as `a,b`.
- An **endpoint-backed** parameter becomes a dropdown whose options are
  fetched. Any static options it also declares are ignored; the endpoint is
  authoritative.
- A dropdown marked **`multiple`** becomes a text field that suggests its
  options as you type and takes anything else too; with multi-select, type
  several values separated by commas.
- **Static options** become a plain dropdown. A parameter another one names
  as its fiscal year end is a **month** dropdown: the months in your system's
  own abbreviations (`Jan`–`Dec` in English), sending the value the widget
  declared; with no options of its own it offers the twelve months, sent as
  `1`–`12`.
- `date`, `time`, `datetime`, `date_range`, `week`, `quarter`,
  `quarter_range` and `fiscal_year` become the period controls described
  below.
- `number` becomes a number field, `boolean` a checkbox that sends the
  strings `true` or `false`.
- `ticker` and `symbol` are text fields, as a parameter named `symbol` is.
- Everything else, including a parameter with no declared type, becomes a text
  field.

Each control shows its label beside it and carries the parameter's description
as its tooltip.

## Defaults and the default ticker

A new card starts from whatever defaults the widget declares. A default may
be a date expression — `T` is today, `T-1w` a week ago; see *Period controls*
below. A control shows the resolved value but keeps storing the expression until
you edit it. Picking an absolute value replaces it with a literal; re-picking
the value it already resolves to deliberately does not count as an edit, so it
will not burn the expression. To keep a value live, write it on the control's
**Relative** tab instead — see below. `$currentDate` is the older spelling of
`T` and still works, offsets included.

**Settings ▸ General ▸ Default widget ticker** is used when you add a widget
that takes a `symbol`. Directly under it is a switch, **Match dashboard
symbol** (*Use the dashboard's symbol when adding a widget.*), off by default —
when that is on it wins, and the new card copies the symbol from the most recently added
sibling card on the same tab that has one, falling back to the default ticker
only when there is none.

If a required parameter is empty the card does not fetch at all, and says so:
*Enter Commodity, Year, Month to load this widget.* A card with a **Run**
button shows *Parameters changed — press Run to load this widget.* instead
when an edit lands after a send was already queued but before it went out;
the queued send is dropped, and Run sends what the row shows now.

## Cascading parameters

An endpoint-backed dropdown fetches its options from the values the card is
currently showing, so a cascade happens live, as soon as you change it. Change
**Chamber** and the **Committee** list refills immediately; if the committee
you were holding is not in the new list it is cleared, and the cleared value is
written along with the change.

While a list is loading the dropdown is disabled and keeps showing its current
value rather than going blank, and a refetch keeps the old list visible. A
stored value that is not in the fetched list is shown as its own extra option
rather than snapping silently to the first entry.

If the options request fails, the control falls back to a plain text field and
the error takes the place of the description. Option lists are cached for as
long as the app is running, so a backend whose choice lists change needs a
restart to show them.

The endpoint is sent each parameter it depends on as the card's own request
would send it: a date holding `T-1w` arrives as a date, and a date range as
its start under its own name and its end under the widget's end name.

## Period controls

Eight parameter types are periods, and each gets a control that speaks its
own unit. The date box and the time field sit inline in the row; every
other period control is a compact button showing the current value, which
opens a small popover. A pick — by click, or Enter/Space on a cell or grid
button — commits at once and closes the popover; **Escape** closes it
without changing anything.

![The quarter popover](./shots/period-quarter.png)

- `date` — a text box showing what is stored, with a calendar chip beside
  it; an expression such as `T-1bd` stays in the box with its resolved date
  read underneath. Sends `2026-09-14`.
- `time` — a segmented field, 24-hour, to the second; sends `09:30:00`.
- `datetime` — a button reading `2026-09-14 09:30:15 EDT`, with a field and a
  calendar in the popover; sends local time with its UTC offset:
  `2026-09-14T09:30:15-04:00`.
- `date_range` — a button reading `2025-01-01 – 2026-09-14`, with two fields
  and a range calendar; sends **two** parameters — the control's own name for
  the start, the widget's `rangeEnd` name for the end.
- `week` — a button reading `W37 2026 · Sep 7–13`, with a calendar whose days
  select their whole week; sends ISO 8601, `2026-W37`.
- `quarter` — a button reading `FY2027-Q3`, with a year header and a 2×2
  grid; sends `2027-Q3`.
- `fiscal_year` — a button reading `FY2027`, with a decade grid; sends
  `2027`.
- `quarter_range` — a button reading `FY2025-Q4 – FY2026-Q4`, with two
  quarter grids, **Start** and **End**. Pick the start, then the end, which
  commits both and closes; an end before the start cannot be picked. Sends
  **two** parameters, as `date_range` does.

![The date-time popover](./shots/period-datetime.png)

![The quarter range popover](./shots/period-quarter-range.png)

A date-time's field goes as deep as the widget asks: `year`, `month` and
`day` show the date only and pick midnight; `hour`, `minute` and `second` add
the time. What is sent is always to the second. A widget may also set how
wide a control's popover opens (200–1000 pixels); a plain dropdown's list is
drawn by the system and keeps its own width.

### Expressions

A stored value may be an expression instead of a literal. It re-resolves every
time the card fetches — on load, Refresh, `⌘R`, `↻`, auto-refresh and window
focus — and never on a timer of its own, so `now` moves only when the card
does. An expression is an **anchor**, then any number of offsets:

- `T` — now, in your own zone: today, this week, this quarter, whichever the
  control's type is.
- `now` — the current instant, for a `datetime`.
- `W0`, `M0`, `Q0`, `Y0` — the start of the current ISO week, month, calendar
  quarter, year.
- `FQ0`, `FY0` — the start of the current fiscal quarter or year, under the
  control's fiscal year end.
- `trade_date` — the most recent completed session on the widget's exchange:
  Friday, on a Monday morning.
- `prev_trade_date` — the open day before that.
- `session_open`, `session_close` — today's session open or close on the
  exchange (early closes honoured), or the next open day's when today is
  closed.

`W-1`, `Q-4`, `FQ-1`, `FY-1` are shorthand for one week, four quarters, one
fiscal quarter, one fiscal year back from `W0`, `Q0`, `FQ0`, `FY0`; the number
must follow the letters directly (`Q-4`), since `Q0-4` is four *days* before
the quarter starts.

- `-1`, `+1` — a bare number is days.
- `-2w`, `-1m` (or `-1mo`), `-1q`, `-5y` — weeks, months, quarters, years —
  months clamp to the last day of the target month.
- `-1fq`, `-1fy` — three months, twelve months: the same arithmetic as `q`
  and `y`, reading naturally after `FQ0` and `FY0`.
- `-5bd` — five **business days** on the widget's exchange calendar: weekends
  and closures are skipped, the time of day kept.
- `-90s`, `-3min`, `-2h` — seconds, minutes, hours.

An amount is at most six digits, and a `bd` amount four — each business day is
a step through the calendar, and a longer walk would stall the card. A longer
number does not parse and is sent as typed.

Offsets chain left to right: `T-1y+1d`. A range control takes two
expressions with a slash, `T-7d/T`; `M0/T` is month to date. `T` and every
other anchor resolve only on the period controls — a text field keeps `T`
exactly as typed, so AT&T's ticker is never turned into a date; `$currentDate`
is the older spelling of `T` and still resolves everywhere it always did.
Anything that does not parse is sent exactly as written. Spaces between the
parts are allowed and dropped; a range typed with `..` is stored with `/`.

`earliest` and `latest` are the first and last date of the data the card has
loaded, and take offsets like any other anchor: `earliest + 1y`, `latest - 30d`,
`earliest .. today`. The first request cannot know them, so that value is left
out and the provider answers from its own earliest (or to its own latest); once
the rows arrive the card asks again with the dates they reported. They are
typed, not picked: the Relative tab has no row for them, so an expression that
uses one opens on Absolute.

**`EXP` is an option contract's expiry.** `EXP` is the contract's own, read
straight out of an OCC symbol — `AAPL260918C00150000` expires 2026-09-18, and
nothing is looked up. `EXP-1` is the monthly expiry before it and `EXP+1` the one after, so `EXP-1` to
`EXP` is the window that contract has traded. The count binds tighter than an
offset, exactly as `Q-4` does — but where that reading cannot work the other
one is taken, so `EXP-1w` is a week before expiry (same as `EXP0-1w`) and
`EXP-1-1w` is a week before the previous one.

`EXP-1/EXP` is the contract's whole life, so while it is live the right edge
is a future date and a chart drawn on it has empty space that fills in.
`EXP-1/T` is what has traded so far. The two meet on expiry day.

It refuses rather than guesses. An **expired** contract refuses — `EXP` names
a live contract's expiry, and a contract is live through its expiry date (it
trades to the close that day, on the exchange's clock, not the viewer's) and
dead from the next. No symbol, a symbol that is not an option, or
stepping back or forward from a **weekly** (whose previous expiry is the previous week,
which nothing here knows) all leave the value a literal. Futures expiries are
a per-root exchange rule and are not available at this version.

**Weekdays.** `T-MON` is the Monday on or before today, `T+FRI` the Friday on
or after it, and a count steps a week further out: on a Tuesday, `T-2MON` is
the Monday before last and `T+2FRI` the Friday after next. On the day itself
the step does not move — on a Monday, `T-MON` and `T+MON` are both today. All
seven are `MON TUE WED THU FRI SAT SUN`, in any case, and so is the anchor
in front: `t+fri`, `T-Mon` and `T+FRI` all work. They are
calendar arithmetic and need no exchange; a Saturday is a Saturday whatever is
trading. (`bd` and `trade_date` are the trading answers.) They cannot be built
from the Relative tab's rows — a weekday is not an amount of anything — so a
card holding one opens on Absolute.

Capitals do not matter when you type an expression: `t-1w`, `T-1W` and
`Today-1w` are all `T-1w`, and that one spelling is what is stored. The only
distinction left is one of meaning — `m`, `mo` and `M` are a month, `min` a
minute.

**`$today` is the start of the day.** `T`, `now`, `today` and `$currentDate`
all mean *this instant* — on a datetime parameter they carry the current
time, which is the usual surprise. `$today` is midnight of the same day, and
is offered in the Relative tab as **Start of today**, beside Start of week and
Start of month. On a date parameter it makes no difference: the time is
projected away either way.

**OpenBB's spelling.** `$currentDate` and `today` are both spellings of `T`,
and a capital `M` is a month wherever a unit goes: `$currentDate-3M`. (Lower
case `m` and `mo` are months too, and minutes are `min`.) When **Apply** or
**Save as preset** writes an expression OpenBB can also read — `T` with at
most one offset in hours, days, weeks, months or years, or a range of two
such — it is written OpenBB's way: `$currentDate-2y`,
`$currentDate-7d/$currentDate`. Anything else keeps this app's spelling:
`T-5bd`, `FQ-4`, `T-7d/trade_date`. A value a widget or a dashboard file
already holds is never rewritten, and the `◷` badge shows it as stored.
Quarter and fiscal-year labels may be written `FY2026-Q3` and `FY2026`; they
are stored and sent as `2026-Q3` and `2026`.

### The Relative tab and presets

Every period popover — the day picker's calendar included — has two tabs,
**Absolute** and **Relative**. Absolute is the picker described above.
Relative builds an expression: an **anchor** dropdown, then offset rows of
sign, number and unit (a range has a second anchor and its own rows for the
end), with a line underneath reading *resolves now to …* as you change them.
Each control offers only the anchors and units that make sense for its type
— a quarter offers `T`, `Q0` and `FQ0` with quarter and year units; a
date-time offers `now`, the session anchors and units down to seconds.

A quarter range offers `T`, `Q0`, `FQ0`, `Y0` and `FY0` for each end, with
quarter and year units, and its presets are **Last 4 quarters**, **Last 4
fiscal quarters** (five quarters, counting the current one), **Fiscal year to
date** and **Year ago to now**.

![The Relative tab](./shots/period-relative.png)

**Presets** are chips above the preview: the built-in catalog for the
control's type (Today, Yesterday, Last 7 days, MTD, QTD, YTD, Last trading
day, Last 5 trading days, Now, One hour ago, Session open, Prior close, This
week, Last week, This quarter, Same quarter last year, Fiscal YoY, Prior,
and so on), then this dashboard's saved ones. A chip loads its rows so the
preview shows what it means today; **Apply** writes the expression. **Save as
preset** asks for a name and keeps the current expression on the dashboard —
saving the same name again replaces it, and the `×` beside a saved chip
deletes it. Saved presets export with the dashboard and come back on import.
A viewer window still offers the chips and **Apply**, but neither **Save as
preset** nor the `×` — a viewer window cannot write presets.

A control whose stored value is an expression opens on the Relative tab with
its rows filled in. An expression the rows cannot express (one typed into a
dashboard file by hand) is shown as text with its preview, and Apply is off.

### Trading calendars

The trading anchors, the `bd` unit and `@open`/`@close` read an exchange
calendar. The first of six answers wins: the expression's own `(MIC)`, as in
`T-1bd(XLON)` or `T-1bd@close(XNYS)`; the card's symbol by its suffix (`.L`
London, `.T` Tokyo, `.TO` Toronto, and the rest of the table in the guide);
the parameter's MIC; the widget's; the dashboard's; then `XNYS`, shown as
**Default (XNYS)**. The calendars are the 71 exchange_calendars defines, listed
in the guide; anything else is an error on the card. The
calendar comes from the card's own backend, one year at a time as the
expressions need them; when the backend serves none, the app uses its bundled
NYSE calendar for `XNYS` (2026–2028) and plain weekdays for the others, and
says so with a badge. The five overnight calendars (`24/5`, `24/7`, `CMES`,
`IEPA`, `us_futures`) never fall back to weekdays: they come from the backend's
calendar bundles, or the card shows an error. `XBOM`, `XSES` and `XSHG` are
served to 2026-12-31 and `XSAU` to 2029-12-31; past those dates business-day and
session values error and calendar-free ones still send. Years outside 1990–2040
are never asked for.

A dashboard can name its own default exchange: right-click it in the rail and
choose **Exchange**. It applies to every widget and parameter that names none;
**Default (XNYS)** clears it.

### Badges

`◷` beside a value means it is an expression; its tooltip shows the
expression, what it resolves to now, and that it updates when the card
refreshes. `⚠` means the last resolution used a fallback calendar — the
tooltip names why: no calendar for this exchange on this backend, or a year
outside 1990–2040. A card with a **Run** button re-resolves its expressions
on every refresh too, but if the resolved values have moved (a `T` that
crossed midnight) it goes stale and waits for Run rather than sending values
you have not seen.

On a date or period chip that holds an expression, the chip's own tooltip is
that same reading.

`⚠` also marks a fiscal year end that fell back — *Fiscal year end: no fiscal
data for AAPL on this backend; using December*. A control with a calendar
reason and a fiscal one shows a single `⚠` whose tooltip gives both.

### Fiscal year ends

A `quarter`, `fiscal_year` or `quarter_range` control labels its periods
under a **fiscal year end**, the calendar month the issuer's year ends in,
and a `date` or `date_range` holding `FQ0`, `FY-1` or `T-1fq` resolves
against one too. The first answer wins:

- the card's own **FY ends** choice, below;
- the parameter's own: an endpoint the app asks for the symbol, a sibling
  parameter (a "FY ends" dropdown, say), a fixed month, or the month the
  fiscal year starts (a start in July means a June year end);
- the same, declared once for the whole widget;
- when the widget has exactly one ticker holding one symbol, the card's own
  backend, asked for that symbol's year end (an openbq-docker backend answers
  from Yahoo Finance's last fiscal year end for the symbol; a symbol Yahoo has
  none for gets December and a `⚠`);
- December.

Labels always say `FY`, December included, so `FY2026-Q3` is calendar
July–September 2026 while a September issuer's `FY2026-Q4` is the same three
months.

While the backend is being asked the card waits, rather than send a period it
is about to relabel. A backend that cannot answer — most cannot — is asked
once per symbol per session; the card then uses December and shows `⚠`. A
widget with several tickers, or none, uses what it declares or December, with
no `⚠`: nothing failed.

**FY ends.** A card whose widget has such a control, and no month dropdown of
its own, ends its row with an **FY ends** dropdown. **Automatic (Sep · AAPL)**
is the answer above and where it came from — the ticker for a backend's
answer, otherwise `widget`, `parameter` or `default`. Choosing a month
overrides all of that for this card only; it is saved with the card and
exported with it. **Automatic** goes back to the chain.

![FY ends](./shots/fy-ends.png)

### What a quarter group shares

Two quarter controls in one group share a **calendar span**, not a label. The
group stores the calendar (December year-end) quarter, and each member shows
it under its own fiscal year end — so one group can read `FY2026-Q3` on a
December card and `FY2026-Q4` on a September card, and picking either moves
both. The tab-bar chip always shows the group's stored calendar label. A
group holding an expression such as `T-1q` gives every member its own
previous quarter.

### Statement periods

A statement widget's `period` parameter, one offering an annual and a
quarterly form, names its choices **FY**, **FQ**, **TTM** and **FQ YoY**,
whichever the provider offers. A provider offering both `quarter` and
`quarterly` shows one **FQ**. Only the names change: the value sent is the
provider's own. A grouped period's chip and the **Groups** menu use the same
names. `frequency` and `calendar_period` are calendar periods and keep their
own labels.

## Parameter groups

Every control carries a small chain-link button before its label. Press it to
open the **Groups** menu for that control:

- **+ New group** creates a group from the control's current value and puts
  this control in it. The link becomes a numbered badge.
- Each existing group of a compatible kind is listed with its number, name
  and value. Tick one to join it — the control immediately shows the group's
  value — and untick it to leave. A control is in one group or none.

Two controls are compatible when they are the same kind of thing: two `symbol`
parameters, two controls of the same period type, or any two the backend
labels with the same group type. Once grouped, editing any member moves every
member on that dashboard in one write; the group's value wins over whatever
each card held.
Leaving a group keeps the value the control was showing.

The tab bar lists every group on the dashboard as a chip — number, name,
value. Double-click the name to rename it; ✕ deletes the group after a
confirmation, and each member keeps the value it had.

Groups are per dashboard and never reach across to another. To switch them
off for a dashboard, right-click its rail row and tick **Disable grouping** —
the groups are kept, not deleted, every link greys out, and the tab strip
shows a `grouping off` tag while it is on.

A file imported from OpenBB Workspace arrives with its groups already made;
see Import and export.

A widget can mark a parameter as not groupable. It shows no chain link, and a
dashboard that had grouped it drops it from the group when the card loads,
keeping the card's own value.

## Tabs and forms in the card body

A **tabs** parameter is drawn as a segmented control at the top of the card
body rather than in the header row. Choosing a tab commits immediately,
through the ordinary parameter path, so grouping and persistence apply exactly
as they would from the header. A stored value that is not one of the options
highlights nothing rather than falsely highlighting the first tab.

A **form** parameter is drawn in the card body too. Its fields can be text,
number, date, dropdown or multi-select, plus one or more buttons. Typed fields
commit when you leave them, everything else on change — but **a field edit on
its own never triggers a fetch**. (A field that is *shared* with a parameter
group is the exception: editing it moves the group, and every member card
refetches.) A form is a request you assemble and then send. The submit
button's label is whatever the backend named it; on a successful submit the
card refetches, and on anything else an error line appears above the buttons.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v6.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
