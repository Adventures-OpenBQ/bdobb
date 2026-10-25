---
type: Note
tags: [bdobb, help, interface, parameters, groups, forms, periods, dates, fiscal]
---

# Card Parameters

Most widgets take parameters — a symbol, a date range, a provider. At this version the card's header carries them as **chips on the title line itself**, one per visible parameter, and the separate controls row under the title is gone. There is nothing to open: what a card is asking for is still always in view. A card with many parameters wraps the chips onto a second line rather than clipping them.

A chip shows its **value**, not its name — the name is its tooltip, and remains the control's accessible name, so nothing is lost to a screen reader. That is the whole trade: a row of values is readable at a glance where a row of `Symbol: AAPL` pairs was not. Parameters whose value says nothing by itself keep their label on screen instead: **text**, **number**, suggest-style, **form** and **tabs** controls are not chips, because a bare number or a half-typed string means nothing without the word beside it.

When the chips are more than you can identify at a glance — or the card is too narrow to show them — the `▸` chevron after the card's timer, or the `⋯` menu's **Parameters**, opens the **Parameters** panel: the very same controls with their names showing, laid out as a form and docked under the title bar. Editing there is editing the card: it is one set of controls in two places, not a copy. The panel stays until you close it — the chevron reads `▾` while it is open, and **Escape** or a click outside does not close it — and whether it is open is saved with the card, and included in a **BDOBB Workspace** save. Focus moves into it only when you open it, and every picker it contains opens inside it. Uncheck **Display on title bar** at the bottom of the panel to take a card's chips off its title line; the panel still edits them, and the choice is saved with the card. A **Date expression** card starts with the box unchecked; check it to put its chips on the title line. See [[widget-cards|Widget Cards]].

![Two cards with their parameter chips](../attachments/card-parameters.png)

Some parameters are declared hidden by the backend. They never appear here, but they are still sent with every request — that is how `provider` rides along on nearly every widget, and how a Note stores its text without cluttering the row.

## When a change takes effect

A dropdown, a multi-select and a checkbox take effect the moment you change them. A text, number, date or time field takes effect when you leave it or press **Enter**, so a half-typed symbol does not refetch the card on every keystroke. A pick from a date field's calendar counts as leaving it: it takes effect as the calendar closes. Every other period control takes effect when you pick in its popover, and **Apply** on a popover's **Relative** tab takes effect at once — see *Period controls* below. Only a genuine change is written: typing a value and typing it back writes nothing, and re-picking the value a stored expression such as `T` already resolves to does not count as a change either.

A card whose widget declares a **Run** button is the exception: its controls save what you chose and mark the card stale — the `▶` timer at the left of the title bar pulses, where earlier versions put a dot beside the title — and nothing is fetched until you press **Run**. See [[running-and-refreshing|Running and Refreshing]].

## The kinds of control

Which control you get is decided in this order:

- A **tabs** parameter with options becomes a segmented control in the card body — see below.
- A **form** parameter becomes a form in the card body — see below.
- A dropdown the widget marks **`multiple`** becomes a text field that suggests its options as you type and takes anything else too — it is a list of hints, not a closed set. With multi-select on the same parameter, type several values separated by commas. Because any typed value is legitimate, a freshly fetched option list never clears what such a field holds.
- **Multi-select** becomes a list you can pick several from; the value is sent comma-joined, as `a,b`.
- An **endpoint-backed** parameter becomes a dropdown whose options are fetched. Any static options it also declares are ignored; the endpoint is authoritative.
- **Static options** become a plain dropdown. A parameter that another parameter — or the widget itself — names as its fiscal year end is a **month** dropdown instead: the months in your own system's abbreviations (`Jan`–`Dec` in English), sending whatever value the widget declared for each. Declaring no options of its own, it offers the twelve months and sends `1`–`12`. Only the label is localised; the value on the wire is untouched, so the **Period echo**'s `fy_end` goes on sending `December`.
- `date`, `time`, `datetime`, `date_range`, `week`, `quarter`, `quarter_range` and `fiscal_year` become the period controls described below. A `date_range` or a `quarter_range` that does not name where its end is sent (`rangeEnd`) gets no control at all; the log records *date_range param start_date declares no rangeEnd; hidden*, or the same sentence for a `quarter_range`.
- `number` becomes a number field, `boolean` a checkbox that sends the strings `true` or `false`.
- `ticker` and `symbol` are text fields, as a parameter named `symbol` has always been. Naming the type rather than the parameter is what lets a widget call its ticker something else and still be recognised as one — which matters for the fiscal lookup below.
- Everything else, including a parameter with no declared type, becomes a text field.

Each control shows its label beside it and carries the parameter's description as its tooltip. Before the label sits the control's group link — see *Parameter groups* below, and note that a parameter the widget marks `groupable: false` has none.

## Defaults and the default ticker

A new card starts from whatever defaults the widget declares. A default may be a date expression — `T` is today, `T-1w` a week ago; see *Expressions* below. A control shows the resolved value but keeps storing the expression until you edit it. Picking an absolute value replaces it with a literal; re-picking the value it already resolves to deliberately does not count as an edit, so it will not burn the expression. To keep a value live, write it on the control's **Relative** tab instead — see *The Relative tab and presets* below. `$currentDate` is the older spelling of `T` and still works, offsets included — so OpenBB's own `$currentDate-1w` resolves rather than being sent verbatim.

A range's default may also be written the way OpenBB writes one, as an object with a `start` and an `end`; it is read as the single `start/end` value every range control stores.

**Settings ▸ General ▸ Default widget ticker** is used when you add a widget that takes a `symbol`. Directly under it is a **Match dashboard symbol** switch — when that is on it wins, and the new card copies the symbol from the most recently added sibling card on the same tab that has one, falling back to the default ticker only when there is none.

If a required parameter is empty the card does not fetch at all, and says so: *Enter Commodity, Year, Month to load this widget.* A card with a **Run** button has a second such message, *Parameters changed — press Run to load this widget.*, for the case where a control moved after a send was queued but before it went out: the queued send is dropped rather than sent stale, and **Run** sends what the row shows now. See [[running-and-refreshing|Running and Refreshing]].

## Cascading parameters

An endpoint-backed dropdown fetches its options from the values the card is currently showing, so a cascade happens live, as soon as you change it. Change **Chamber** and the **Committee** list refills immediately; if the committee you were holding is not in the new list it is cleared, and the cleared value is written along with the change. A `multiple` field is never cleared this way, because a value outside the list is exactly what it is for.

While a list is loading the dropdown is disabled and keeps showing its current value rather than going blank, and a refetch keeps the old list visible. A stored value that is not in the fetched list is shown as its own extra option rather than snapping silently to the first entry. If the options request fails, the control falls back to a plain text field — committing on leave or **Enter**, like any typed field — with the error as its tooltip in place of the description. Option lists are cached for as long as the app is running, so a backend whose choice lists change needs a restart to show them.

**What the endpoint is sent** is each parameter it depends on exactly as the card's own request would send it, rather than as the card stores it: a date holding `T-1w` arrives as a date, a quarter arrives under its year end, and a range gives its start under its own name and its end under the widget's `rangeEnd` name. So a cascade sees the same values the data request does.

## Period controls

Eight parameter types are periods, and each gets a control that speaks its own unit. The date field and the time field sit inline in the row; every other period control is a compact button showing the current value (an em dash when there is none), which opens a small popover under it. A pick in a popover — by click, or **Enter** or **Space** on a calendar day or a grid button — commits at once and closes the popover; **Escape** closes it without changing anything, and so does the **Close** button every popover now carries at its foot. Close is popover-level rather than beside **Apply**, so the **Absolute** tab — which has no action row at all, committing on the pick — has a visible way out too; it is named Close rather than Cancel because the Relative tab already uses Cancel for its preset-naming field. Calendars start their weeks on Monday. Every popover, the date field's calendar included, has two tabs: **Absolute**, the picker described here, and **Relative**, which builds an expression — see *The Relative tab and presets* below. The time field has neither popover nor tabs.

![The quarter popover on a card whose fiscal year ends in September](../attachments/period-quarter.png)

- `date` — a free-text box showing what is **stored**, with a calendar chip beside it and the resolution read underneath: type `T-1bd` and the box goes on saying `T-1bd` while `2026-09-11` appears below it. The chip opens the same popover — **Absolute** calendar and **Relative** tabs — as every other period control. Sends `2026-09-14`. Picking a date *replaces* the expression, because choosing a literal is an explicit choice; cancelling or **Escape** leaves the box alone. The box is not a segmented field, so there is no arrow-key stepping of a literal's day or month: the chip is how a date is chosen without typing.
- `time` — a segmented field, 24-hour, to the second; sends `09:30:00`.
- `datetime` — a button reading `2026-09-14 09:30:15 EDT`, opening a segmented field with the zone shown, and a calendar; sends local time with its UTC offset, `2026-09-14T09:30:15-04:00`.
- `date_range` — a button reading `2025-01-01 – 2026-09-14`, opening two fields and a range calendar; sends **two** parameters — the control's own name for the start, the widget's `rangeEnd` name for the end.
- `week` — a button reading `W37 2026 · Sep 7–13`, opening a calendar whose days select their whole week, Monday to Sunday; sends ISO 8601, `2026-W37`.
- `quarter` — a button reading `FY2027-Q3`, opening a `◀ FY2027 ▶` year header over a 2×2 grid of `Q1`…`Q4`; sends `2027-Q3`. Each grid button's full name carries its calendar months, so a September issuer's first quarter is announced as `FY2027-Q1 (Oct–Dec 2026)`.
- `fiscal_year` — a button reading `FY2027`, opening a `◀ 2020–2029 ▶` header over a grid of twelve years — the decade, plus the year either side of it greyed so it is one click away; sends `2027`.
- `quarter_range` — a button reading `FY2025-Q4 – FY2026-Q4`, opening two quarter grids side by side, **Start** and **End**, each with its own year header and its own group name so a screen reader says which end you are choosing. Sends **two** parameters, as `date_range` does, and both halves are labelled under the same fiscal year end.

![The date-time popover: the field above, the calendar below](../attachments/period-datetime.png)

![The quarter-range popover: the Start grid beside the End grid](../attachments/period-quarter-range.png)

**A quarter range is pick-then-commit**, the same gesture the date range uses. Picking in the **Start** grid only moves the draft; picking in the **End** grid commits `start/end` and closes. Until a start is drafted every end cell reads **disabled**, and once one is drafted every end cell before it does too — a reversed pair is not a range, so it cannot be picked at all rather than being picked and then refused.

The date-time and date-range popovers also hold typed fields, and those work as a draft: typing in them writes nothing, **Enter** in a field commits and closes, and **Escape** throws the draft away. A range is only written when its start is on or before its end; **Enter** on a reversed pair leaves the popover open on it rather than discarding what you typed. A calendar pick in the date-time popover keeps the draft's time of day.

**How deep a date-time's field goes** is the widget's to declare, through a `granularity` of `year`, `month`, `day`, `hour`, `minute` or `second`. The first three show the date alone and pick midnight; the last three add the time. It is a display choice only — what is sent is always to the second.

**How wide a popover opens** is the widget's to declare too, between 200 and 1000 pixels, and it applies to every popover the app draws itself. A plain dropdown ignores it: that list is drawn by the system, which does not let a page size it.

### Expressions

A stored value may be an expression instead of a literal. It re-resolves every time the card fetches — on load, **Refresh**, `⌘R`, `↻`, auto-refresh and window focus — and never on a timer of its own, so "now" moves only when the card does. An expression is an **anchor**, then any number of offsets.

The anchors:

- `T` — now, in your own zone: today, this week, this quarter, whichever the control's type is. `$currentDate` and `today` are two more spellings of the same anchor.
- `now` — the current instant, for a date-time.
- `$today` — midnight of the current day, in your own zone. `T`, `now`, `today` and `$currentDate` all mean *this instant*: on a date control the projection throws the time away and the difference never shows, but on a date-time they carry the current clock, which is the standing surprise. `$today` is offered on `datetime` only, as **Start of today** on the Relative tab, one scale down from Start of week. Note that bare `today` is still a spelling of `T` — `today` and `$today` differ by a `$` and mean different things, kept that way so dashboards and manifests already written go on meaning what they meant.
- `W0`, `M0`, `Q0`, `Y0` — the start of the current ISO week, month, calendar quarter, year.
- `FQ0`, `FY0` — the start of the current fiscal quarter or year, under the control's fiscal year end.
- `trade_date` — the most recent *completed* session on the widget's exchange: Friday, on a Monday morning.
- `prev_trade_date` — the open day before that.
- `session_open`, `session_close` — today's session open or close on the exchange (early closes honoured), or the next open day's when today is closed.

`W-1`, `Q-4`, `FQ-1`, `FY-1` are shorthand for one week, four quarters, one fiscal quarter, one fiscal year back from `W0`, `Q0`, `FQ0`, `FY0`. The number must follow the letters directly: `Q-4` is four quarters back, but `Q0-4` is four *days* before the quarter starts. Where the counted reading cannot be finished the other one is taken instead, so `Q-4w`, `M-1w`, `W-2d` and `FY-1q` read as `Q0-4w`, `M0-1w`, `W0-2d` and `FY0-1q` rather than falling through to a literal. The counted reading is still tried first and still wins whenever it consumes the whole value, so nothing that already resolved has changed meaning. A **sign must follow the anchor** for the second reading to be tried at all: a bare `Q`, `M` or `EXP` stays a literal, because those are ticker symbols.

The offsets:

- `-1`, `+1` — a bare number is days.
- `-2w`, `-1m` (or `-1mo`, or `-1M`), `-1q`, `-5y` — weeks, months, quarters, years. Months clamp to the last day of the target month, so `T+1m` on 31 January is the last day of February.
- `-1fq`, `-1fy` — three months, twelve months: the same arithmetic as `q` and `y`, reading naturally after `FQ0` and `FY0`.
- `-5bd` — five **business days** on the widget's exchange calendar: weekends and closures are skipped, and the time of day is kept. **A `bd` step always lands on an open session, whatever day it starts from.** Starting on a closed day it once could not: `T-5bd` from a Saturday answered the Saturday a fortnight earlier. It is counted rather than walked — the target is estimated arithmetically, the window's holidays are consulted **once**, and only the difference is stepped through — so a large count costs the same as a small one.
- `-90s`, `-3min`, `-2h` — seconds, minutes, hours. Minutes are `min`; lower-case `m` is a month, and so is capital `M`.

**Weekday offsets.** `T-MON` is the Monday on or before today, `T+FRI` the Friday on or after it, and a leading count steps a week further out: on a Tuesday, `T-2MON` is the Monday before last and `T+2FRI` the Friday after next. On the day itself the step does not move — on a Monday, `T-MON` and `T+MON` are both today, and `T-2MON` is a week back. All seven are `MON TUE WED THU FRI SAT SUN`, in any case, and so is the anchor in front: `t+fri`, `T-Mon` and `T+FRI` all work. They are plain calendar arithmetic and consult no exchange; `bd` and `trade_date` are the trading answers. A weekday is a name rather than an amount, so the Relative tab's rows cannot build one and a control holding one opens on **Absolute**. (Weekdays are read before units, which is what keeps `T-2M` a month and `T-2MON` a Monday.)

Capitals do not matter anywhere in an expression: `t-1w`, `T-1W` and `Today-1w` are all `T-1w`, and that one spelling is what is stored. The only distinction left is one of meaning — `m`, `mo` and `M` are a month, `min` a minute.

**`EXP`, an option contract's expiry.** `EXP` is the contract's own, read straight out of the OCC symbol the card is showing — `AAPL260918C00150000` expires 2026-09-18, and nothing is looked up. `EXP-1` is the monthly expiry before it and `EXP+1` the one after, so `EXP-1/EXP` is the window that contract has traded, and `EXP-1/T` is what it has traded so far. The count binds tighter than an offset, as `Q-4` does, so `EXP0-1w` — or `EXP-1w`, by the backtracking above — is a week before expiry.

It refuses rather than guesses, and a refusal leaves the value a literal, sent as written: no symbol, a symbol that is not an option, a **weekly** contract when you step back or forward from it (its previous expiry is the previous week, its next the next, and nothing here knows a weekly chain — its own expiry is still exact), and an **expired** contract. A contract is live *through* its expiry date and dead from the next day, judged on the exchange's date rather than yours, so looking back at a contract that has already expired refuses too. Futures expiries are a per-root exchange rule and are not available at this version. `EXP` is not one of the Relative tab's anchors, so a control holding it opens on **Absolute**.

Offsets chain left to right: `T-1y+1d` is a year ago, plus a day. The offsets are applied to the anchor's instant first, and the result is then read in the control's own unit — so `T-1h` just after midnight on a date control is yesterday, and `T-1` on a quarter control is the quarter containing yesterday. The trading anchors live in the exchange's own zone, so on a date control `trade_date` is the exchange's date, and on a date-time it carries the exchange's UTC offset.

A range control takes two values with a slash, and either half may be an expression: `T-7d/T`, `2026-01-01/T`; `M0/T` is month to date. A quarter range's halves are quarters rather than dates, so `FQ-4/FQ0` is the last five fiscal quarters counting this one. Spaces between the parts are allowed and dropped, and a range typed with `..` is read the same as one with `/`.

**`earliest` and `latest` are the data's own bounds** — the first and last date of the rows the card has loaded, read off the same date column the chart plots against. They take offsets like any other anchor: `earliest + 1y`, `latest - 30d`, `earliest .. today`. The first request cannot know them, so a value that names one is simply **left out** of that request and the provider answers from its own earliest (or to its own latest); once the rows come back the card asks again with the dates they reported, and settles there. The word itself never goes on the wire. They are typed, not picked: the Relative tab has no row for either, so a control holding one opens on **Absolute**, as an `EXP` one does. A card that names neither anchor pays nothing for their existence.

`T` and every other anchor resolve only on the period controls. A text field keeps `T` exactly as typed, so a ticker such as AT&T's `T` is never turned into a date.

Anything that does not parse is sent exactly as written. One that looks meant as an expression — `T` or `today` followed by a sign, one of the named anchors, a period letter followed by a number, or anything starting `$currentDate` — also leaves one line in the log, *unsupported date token, sent as-is: T-1x*.

Amounts are capped, and a value past a cap does not parse, so it is sent exactly as written. An offset's amount, and the number in a `W`, `Q` or `FQ`-style shorthand, is at most six digits. A business-day amount is at most four (`-9999bd`); a leading zero counts toward either cap. The `bd` cap is an input bound on what may be typed, not a cost ceiling — since the counted resolution above, a four-digit `bd` costs no more than a one-digit one. The Relative tab's number fields clamp to the same caps, so the rows never write a value that does not parse.

### OpenBB's spelling

OpenBB Workspace ships a smaller version of the same idea, and this app reads and writes it rather than sitting beside it.

**Reading.** `$currentDate` and `today` are both `T`; a capital `M` is a month wherever a unit goes, so `$currentDate-3M` is three months ago; and a quarter or fiscal year written with OpenBB's `FY` prefix — `FY2026-Q3`, `FY2026` — is read as the `2026-Q3` and `2026` that storage and the wire use. The prefix is only ever four unsigned digits, so the expression shorthands `FY-1` and `FY+2` are never mistaken for labels.

**Writing.** When **Apply** or **Save as preset** produces an expression OpenBB can also read — anchored on `T`, with at most one offset in hours, days, weeks, months or years, or a range whose halves both qualify — it is written OpenBB's way: `$currentDate-2y`, `$currentDate-7d/$currentDate`. Anything outside that grammar keeps this app's spelling: `T-5bd`, `FQ-4`, `T-7d/trade_date`. The point is that a dashboard exported to Workspace reads there too, wherever it can.

A value a widget or a dashboard file already holds is **never rewritten** — only a fresh Apply or preset save chooses a spelling — and the `◷` badge shows the value exactly as stored.

### The Relative tab and presets

Every period popover — the date field's calendar included — has two tabs, **Absolute** and **Relative**. Absolute is the picker described above. Relative builds an expression: an **anchor** dropdown, then offset rows of sign, number and unit, each with a `×` to remove it and a **+ offset** button to add one. A range has a second anchor and its own rows for the end. A line underneath reads *resolves now to …* as you change them.

![The Relative tab on a range control, with the Last 7 days preset loaded](../attachments/period-relative.png)

Each control offers only the anchors and units that make sense for its type:

| Control | Anchors | Units |
|---|---|---|
| `date`, `date_range` | Today, Last trading day, Prior session, Start of week, month, quarter, year, fiscal quarter, fiscal year | days, trading days, weeks, months, quarters, years, fiscal quarters, fiscal years |
| `datetime` | Now, Today, Start of today, Session open, Session close, Last trading day, Prior session | seconds, minutes, hours, days, trading days, weeks, months |
| `week` | Today, Start of week, Last trading day | weeks, days, trading days, months, quarters, years |
| `quarter` | Today, Start of quarter, Start of fiscal quarter | quarters, fiscal quarters, years, fiscal years |
| `quarter_range` | Today, Start of quarter, Start of fiscal quarter, Start of year, Start of fiscal year — for each end | quarters, fiscal quarters, years, fiscal years |
| `fiscal_year` | Today, Start of fiscal year | fiscal years, years |

A quarter range offers no trading-day unit: a quarter is never a count of trading days.

**Presets** are chips above the preview, in labelled groups: first the built-in catalog for the control's type, then this dashboard's saved ones under **Saved**. The catalog: **Today**, **Yesterday**, **Last 7 days**, **Last 30 days**, **MTD**, **QTD**, **YTD**, **Last 12 months**; **Last trading day**, **Prior session**, **Last 5 trading days**; **Now**, **One hour ago**, **Five minutes ago**, **Session open**, **Prior close**; **This week**, **Last week**; **This quarter**, **Last quarter**, **Same quarter last year**; the fiscal **Current**, **Prior** and **Fiscal YoY**; and, for a quarter range, **Last 4 quarters**, **Last 4 fiscal quarters**, **Fiscal year to date** and **Year ago to now** — each offered only on the controls it fits. **Last 4 fiscal quarters** is inclusive, `FQ-4/FQ0`: five quarters counting the current one. A chip loads its rows, so the preview shows what it means today; **Apply** writes the expression and closes the popover. The card's value is not touched until Apply.

**Save as preset** asks for a name in a small field, and **Save** or **Enter** keeps the current expression on the dashboard; **Cancel** or **Escape** gives up the name without closing the popover. Saving the same name again replaces that preset, and the `×` beside a saved chip deletes it. A saved preset is offered on every control on the dashboard whose rows can express it. Saved presets go with the dashboard when it is duplicated, exported or imported — see [[import-and-export|Import and Export]].

A control whose stored value is an expression opens on the Relative tab, with its rows filled in. An expression the rows cannot express is shown as text with its preview, and **Apply** is off until a chip or a fresh set of rows replaces it. That covers `now-1h` on a date control, anything typed into a dashboard file by hand, and — because the rows cannot hold a literal half — a range with one literal end, which is what the **Period echo**'s own `2026-01-01/T` default is. At this version **Save as preset** stays available on such a value. A preset saved from an expression the rows can express on *no* control — a half-literal range, again — is kept on the dashboard and travels with it, but is offered as a chip nowhere, so its `×` never appears to delete it.

In a viewer window the Relative tab is still there: chips load and **Apply** commits, as any parameter change does there. **Save as preset** and the saved chips' `×` are not shown, because the viewer cannot save.

### Trading calendars

The trading anchors, the `bd` unit and `@open`/`@close` read an exchange calendar, and the first of six answers wins: the expression's own `(MIC)`; the card's **Symbol**, by its suffix (`.L` London, `.T` Tokyo, `.PA` Paris, `.KS` Seoul and the rest of the table in [[date-expression|The Date Expression Card]] — an unsuffixed, crypto or FX symbol names none, and so do the ambiguous `.NX` and the unmapped suffixes); the parameter's own MIC; the widget's; **the dashboard's** — right-click its rail row and choose **Exchange**, and for a locked widget the dashboard you are viewing; then `XNYS`, shown as **Default (XNYS)**. The app knows every calendar exchange_calendars defines — 71, listed in [[date-expression|The Date Expression Card]] — and the dashboard menu lists them all by name and MIC, with a search box that filters the list as you type (`paris` finds `XPAR`, `cmes` finds `CMES`); clearing it restores the full list. A name outside them is an error on the card. See [[date-expression|The Date Expression Card]] for `@` and `(MIC)`, and [[dashboards-and-folders|Dashboards and Folders]].

The calendar comes from the card's own backend, one exchange-year at a time, at `api/v1/calendar/trading?exchange=<MIC>&year=<YYYY>`, with the connection's credential. The app asks for the current and previous year up front, and for any other year an expression's resolution actually looks at. A card whose values need a year still on its way stays in its loading state and holds its request until that year lands or is refused, so nothing is sent on a calendar about to change; a card of literal dates, or a bare `T`, never waits. A backend that answers 404, or fails, is remembered for the rest of the session and not asked again for that year.

When the card's backend serves no calendar, the app uses its bundled NYSE calendar for `XNYS` (2026–2028) and plain weekdays — no holidays — for anything else, and says so with a badge. The five overnight calendars (`24/5`, `24/7`, `CMES`, `IEPA` and `us_futures`) are the exception: they always come from the backend's calendar bundles, and when none can be had the card shows the error rather than counting weekdays. A calendar is served only within its dates: `XBOM`, `XSES` and `XSHG` end 2026-12-31 and `XSAU` ends 2029-12-31, and past them business-day and session values are an error while calendar-free ones still send. Years outside 1990–2040 are never asked for. The built-in echo cards have no backend, so they always resolve on the bundled calendar. The app never uses this route for the five overnight calendars; they always come from the bundle route. See [[openbq-docker-stack|The openbq-docker Stack]].

### Badges

`◷` beside a value means it is an expression. Its tooltip — which is also its accessible name — reads *Expression T-1bd, resolves now to 2026-08-25, updates when the card refreshes*, and it shows the expression as stored, in whichever spelling it was written.

On a chip holding an expression, **that same sentence is the chip's own tooltip**, in place of the parameter's name. A chip shows the resolved value, so what it is hiding is the expression behind it, and the tooltip is where that goes — you do not have to find the `◷` to read it.

`⚠` means the last resolution fell back to something less exact, and its tooltip names why. A calendar reason: *Fallback calendar: No trading calendar for XNYS on this backend; using the bundled NYSE calendar*, *…; weekdays only* for another exchange, or *No XNYS calendar for 2029; weekdays assumed* for a year the calendar does not hold. A fiscal reason: *Fiscal year end: no fiscal data for AAPL on this backend; using December*. **A control with both shows one `⚠`**, whose tooltip gives both reasons joined by a semicolon. A value that consults neither a calendar nor a year end — a bare `T`, an `M0` — never shows it.

A card with a **Run** button re-resolves its expressions on every refresh too, but if the resolved values have moved — a `T` that crossed midnight, a calendar that landed — it goes stale and waits for **Run** rather than sending values you have not seen. See [[running-and-refreshing|Running and Refreshing]].

### Fiscal year ends

A **fiscal year end** is the calendar month an issuer's year ends in, and at this version it reaches every control whose value depends on one: a `quarter`, a `fiscal_year` and a `quarter_range` are labelled under it, and a `date` or a `date_range` holding a fiscal token — `FQ0`, `FY-1`, `T-1fq` — resolves against it too. A date holding no such token consults nothing, which is why a plain date never carries a fiscal `⚠`.

Where the month comes from is a chain, and the first answer wins:

1. **the card's own FY ends choice**, below — set, it answers for every control on that card and the rest of the chain is not consulted at all;
2. **the parameter's own declaration** — an endpoint the app asks for the symbol, a sibling parameter (a "FY ends" dropdown, say) read as the card is currently showing it, a fixed month, or the month the fiscal year *starts*, which is the same fact from the other end (a start in July means a June year end, and January means December);
3. **the same, declared once for the whole widget**, in the same order, for any parameter whose own fields do not answer;
4. **the card's own backend**, asked for the year end of the one symbol the card is showing — see the lookup below;
5. **December.**

A declared endpoint is one rung like the others: answered, its month wins; failed or unreadable, the chain falls through past it; still in flight, the chain stops there and shows what the rungs *after* the endpoint would give until it settles, without consulting the backend lookup and without a `⚠`.

Labels always say `FY`, December included, so `FY2026-Q3` is calendar July–September 2026 while a September issuer's `FY2026-Q4` is the same three months.

**The lookup.** When nothing above answers, and the widget has **exactly one** ticker parameter holding **exactly one** symbol, the app asks the card's own backend: `GET api/v1/fundamentals/fiscal_year_end?symbol=AAPL`, with the connection's credential, answered `{"fiscalYearEnd": "September"}`. Three things follow from it being a real request:

- **The card waits.** While the lookup is in flight the card holds its request rather than send a period it is about to relabel — the same hold a pending calendar year gets, and on a run-button card it releases a request a real trigger was holding rather than starting one.
- **It is asked once.** The answer is cached per backend and per symbol for as long as the app is running, and two cards asking the same backend about the same symbol share one request. A **failure is cached too** — a 404, an error, an unreadable body — because most backends do not serve this route at all and asking again on every card mount would cost a request per card for an answer that cannot change until you restart.
- **A miss is a fallback, not an error.** The card uses December and shows `⚠` — *Fiscal year end: no fiscal data for AAPL on this backend; using December* — on every control that consults one.

A widget with several tickers, or none, never reaches the lookup: it uses what it declares, or December, with **no** `⚠`, because nothing failed.

Which backends answer it is worth knowing before you read a `⚠` as a fault. The route is openbq-docker's own, served by its API. It reads the year end Yahoo Finance reports for the symbol, and a symbol Yahoo has no year end for answers 404, so that card uses December and shows `⚠` correctly. See [[openbq-docker-stack|The openbq-docker Stack]].

**The FY ends control.** A card whose widget has a control that consults a year end, and which has no month dropdown of its own, ends its parameter row with an **FY ends** dropdown.

![A card's FY ends dropdown, reading Automatic (Sep · AAPL)](../attachments/fy-ends.png)

It sits as the last chip in the row, like any other control. Its first entry is **Automatic**, and while it is chosen the entry names what the chain gave and where it came from: **Automatic (Sep · AAPL)** for a backend's answer about that ticker, and otherwise **Automatic (Jun · widget)**, **(Mar · parameter)** or **(Dec · default)**. Choosing a month instead overrides the whole chain for this card only — including the lookup, which is then not asked at all, so no request goes out, nothing is held and no `⚠` appears. The override is saved with the card and carried in an `apps.json` export; **Automatic** removes it and hands the card back to the chain.

### What a quarter group shares

Two quarter controls in one group share a **calendar span**, not a label. The group stores the calendar (December year-end) quarter, and each member shows it under its own fiscal year end — so one group can read `FY2026-Q3` on a December card and `FY2026-Q4` on a September card, and picking either moves both. The tab-strip chip always shows the group's stored calendar label, `2026-Q3`. A group holding an expression such as `T-1q` gives every member its own previous quarter. Fiscal-year groups and quarter-range groups work the same way, a range relabelling half by half.

**+ New group** from a quarter control stores the calendar label of what the control shows. Leaving the group keeps the quarter the control was showing, under its own year end. Deleting the group hands each member the same, with one exception at this version: deletion cannot wait for an answer that has to be fetched, so a member whose year end came from an **endpoint** or from **the backend lookup** is handed the value under the sources the app can read on the spot — the card's own **FY ends** override, then what the parameter and the widget declare, then December. Such a member can therefore come away showing a different quarter from the one it had.

### Statement periods

A statement widget's `period` parameter, one offering an annual and a quarterly form, names its choices **FY**, **FQ**, **TTM** and **FQ YoY**, whichever the provider offers. FQ, not Q: a statement's quarter is the reporting company's fiscal quarter, while Q stays the calendar quarter of economic series. A provider offering both `quarter` and `quarterly` shows one **FQ**, the stored one. Only the names change: the value sent is the provider's own. A grouped period's chip and the **Groups** menu use the same names. `frequency` and `calendar_period` are calendar periods and keep their own labels. The rows such a widget returns are relabelled from the company's fiscal year end; see [[statement-view|Statement View]].

## Parameter groups

A group ties one control on several cards together, so changing the symbol on one card moves every card in the group. At this version groups are made in the app, not only imported.

Every control carries a small chain-link button (`⛓`) before its label. Press it to open the **Groups** menu for that control:

- **+ New group** creates a group from the control's current value — what is on screen, even half-typed — and puts this control in it. Groups are named `Group 1`, `Group 2` and so on, taking the first unused number. The link becomes a numbered badge.
- Each existing group of a compatible kind is listed with its number, name and value. Tick one to join it — the control immediately shows the group's value — and untick the ticked one to leave. A control is in one group or none, and a card joins a given group through at most one of its controls, so a group this card already holds through another control is not offered.

Escape or a click elsewhere closes the menu.

Two controls are compatible when they are the same kind of thing: two `symbol` parameters, two controls of the same period type whatever they are named — two date fields, two quarter controls — or any two the widget labels with the same group type. Once grouped, editing any member moves every member on that dashboard in one write, and the group's value wins over whatever each card held. Leaving a group keeps the value the control was showing. The numbered badge's tooltip names the group, *— shared across grouped cards*.

**A widget can refuse grouping for a parameter**, by marking it `groupable: false`. Such a control shows no chain link at all, so there is nothing to press, and it is never bound even by a binding a saved dashboard already holds: a dashboard that had grouped it drops that binding from the file the first time the card loads with the widget known, keeps the card's own value, and writes one line to the log. Nothing is handed back from the group, because the card was never really taking the group's value.

The tab strip lists every group on the dashboard as a chip — number, name, value. Double-click the name to rename it; `✕` deletes the group after a confirmation reading *Delete group "Group 1"? Its 2 cards keep their current values.*, and each member keeps the value it had. See [[dashboard-tabs|Dashboard Tabs]].

Groups are per dashboard and never reach across to another. To switch them off for one dashboard, right-click its rail row and tick **Disable grouping** — the groups are kept, not deleted, every link greys out with the tooltip *Grouping is off for this dashboard*, and the tab strip shows a `grouping off` tag while it is on.

In a viewer window the chips cannot be renamed or deleted, and joining, leaving or creating a group from the menu does nothing; the refusal is written to the log.

A file imported from OpenBB Workspace arrives with its groups already made — see [[importing-dashboards|Importing Dashboards]]. The built-in **Parameter echo** and **Period echo** cards exist to try groups on; see [[built-in-widgets|Built-in Widgets]].

## Tabs and forms in the card body

A **tabs** parameter is drawn as a segmented control at the top of the card body rather than in the header row. Choosing a tab commits immediately, through the ordinary parameter path, so grouping and persistence apply exactly as they would from the header.

A **form** parameter is drawn in the card body too. Its fields can be text, number, date, dropdown or multi-select, plus one or more buttons, and each field carries the same group link as a header control. A form's date field stays the plain date field it always was — the period controls belong to the header row — and one whose default is `T` sends today's date. Typed fields commit when you leave them, everything else on change — but **a field edit on its own never triggers a fetch**; a form is a request you assemble and then send. (A field shared with a parameter group is the exception: editing it moves the group, and every member card refetches.) The submit button's label is whatever the backend named it; on a successful submit the card refetches, and on anything else an error line appears above the buttons. The submitted request resolves its dates on the same exchange the card's own request does, the dashboard's included.

## Parameters set from elsewhere

Three other things write a card's parameters through the same path as the header's controls, so grouping and persistence apply to them too: a click on a table cell whose column is set up to drive a parameter (see [[tables|Tables]]); a framed page asking its card to change a parameter (see [[html-and-iframe-widgets|HTML and iframe Widgets]]); and a run-button card, which records the edit but waits for **Run** (see [[running-and-refreshing|Running and Refreshing]]).

---
*See also: [[widget-cards|Widget Cards]] · [[running-and-refreshing|Running and Refreshing]] · [[dashboard-tabs|Dashboard Tabs]] · [[importing-dashboards|Importing Dashboards]] · [[tables|Tables]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
