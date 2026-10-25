# Calendar-qualified date expressions (v4 and up)

Status: approved 2026-10-23. Home: BDOBB v4.0.0, with PR #67
(exchange calendar bundles). Carried to v5 through v10; v11 folds it in with
its TemporalDB work.

## Intent

Any date or datetime parameter can resolve against a calendar other than
XNYS. The calendar comes from the expression itself, the card's symbol, or
the card and dashboard settings, in that order, and the card says which one
it used. User rulings, 2026-10-23: follow the symbol when the card has a
symbol parameter, and allow an explicit calendar in the expression
(`T-1bd@close(XNYS)`).

## Grammar

The `@` production is ported from bdobb-v2 v12.3.0 (`f8fcfdc16`, documented in
its `web/README.md`). The `(MIC)` suffix is new.

```text
atom := anchor ( sign offset )* at? cal?
at   := "@" ( HH ":" MM | "open" | "close" )
cal  := "(" MIC ")"            -- MIC: four capital letters
```

- `T-1bd(XLON)`: the London trading day before today.
- `T-1bd@close(XNYS)`: the prior NYSE trading day's close. An early close
  shortens it.
- `T@09:30(XTKS)`: 09:30 today on Tokyo's clock.
- `FQ0@open(XHKG)`: the first Hong Kong session open of the fiscal quarter.
- `T-5bd(XLON)..T(XLON)`: in a range, each atom carries its own calendar.
  `T-5bd(XLON)..T` mixes calendars, and that is allowed.

`@` keeps bdobb-v2's rules. Two digits sit each side of the colon. `open` and
`close` are that date's session hours. `@` is applied after every offset, on
the calendar's clock. `(MIC)` applies to the whole atom: `bd` offsets,
`trade_date`, `session_open`/`session_close` and `@`. `(MIC)` never reaches the
wire, because the client resolves the atom to an ISO literal, as today. An
atom with `(…)` that is not a known MIC is a visible error on the card, never
a literal and never XNYS: `T(XNYZ)` reads "Unknown calendar XNYZ".

## Which calendar a field uses

The first of these that applies wins:

1. The expression's `(MIC)`.
2. The card's `symbol` parameter, mapped by suffix (table below).
3. The parameter's `exchange` field.
4. The widget's calendar: `calendarBinding` from PR #67, else its `exchange`
   field.
5. The dashboard's Exchange menu.
6. XNYS. This default is shown as "Default (XNYS)" in the footer.

This replaces `exchangeOf`, so preview, Run, the PR #67 bundle path and
`resolvedCalendarValues` all resolve the same field the same way. The
design's acceptance gate 4 calls this "parameter override wins over widget,
then dashboard". The Date expression footer names both the calendar and its
source, for example "Calendar: XLON (from the expression)" or "XTKS (from
symbol 7203.T)".

## Symbol to calendar

The mapping uses the last dot-suffix, case-insensitive, with both the EODHD
and Yahoo forms, for the nine calendars openbq-docker serves (PR #14):

| Calendar | Suffixes |
|---|---|
| XNYS | `.US` |
| XLON | `.LSE`, `.L` |
| XTSE | `.TO` |
| XETR | `.XETRA`, `.DE` |
| XTKS | `.TSE`, `.T` |
| XHKG | `.HK` |
| XASX | `.AU`, `.AX` |
| XTAE | `.TA` |
| XTAI | `.TW` |

These symbols infer nothing and fall through to step 3, so today's
behaviour is unchanged for them:
- an unsuffixed symbol (`AAPL`, `T`);
- crypto (`BTC-USD`, `.CC`);
- FX (`EURUSD=X`, `.FOREX`);
- any other suffix.

## Calendars available

The set is the nine above. On cards that opt into bundles (PR #67), the
calendar comes from openbq-docker's versioned bundle route. On legacy cards it
comes from the existing backend trading calendar, then the bundled file, then
the weekday table. `EXCHANGE_HOURS` gains XASX, XTAE and XTAI, so their
weekday fallback has real hours and zones. A MIC outside the nine is unknown.
It is never run on XNYS hours, as v4 does today for an unknown code.

## Evidence strictness (ruling 2026-10-23)

Under `operational-v1`, a day whose evidence is `provisional` or `conflict`
blocks the date. `library_baseline`, `authority_confirmed`, `market_final`
and `operator_final` resolve. `planning-v1` also accepts `provisional`, and
the card shows a Provisional badge. This reverses PR #67, which blocked
`authority_confirmed` and accepted `library_baseline`.

## Review findings fixed in the same change

From the 2026-10-23 review of PRs #67 and #14. Every finding is fixed:
- One resolver serves every `wireParams` caller: preview, forms, the param
  echo, SSRM, the table provider and the Run-button check.
- The bundle fetch window covers the expression's own reach, not a fixed
  plus or minus one year.
- The client bundle cache is shared, scoped by backend and credentials, and
  cleared on a credential change.
- The provider bundle cache is bounded, and discovery is taken off the event
  loop.
- Only qualified calendars are advertised.
- Failure details reach the card.
- Tests that locked in bugs or asserted nothing are corrected, and the
  vendoring test runs.
- License headers come first, and the code follows the surrounding style.

## Out of scope

- Joint calendars in expression syntax: `fxCalendarSet` stays manifest-level.
- Replacing the dashboard's six-MIC menu (design boundary 5).
- TemporalDB bindings (v11).

## Tests

- Parser:
  - every example above;
  - `@` strictness;
  - `(MIC)` with and without `@`, and on range atoms;
  - unknown MIC and `T(XNYS` are rejected;
  - `T` and `TSLA` stay literals in symbol fields.
- Resolution:
  - the same `T-1bd` on XNYS and XLON across 2026-12-28, where London's
    Boxing Day holiday falls on a Monday;
  - `@close` on an NYSE early close.
- Precedence: each step beats the next, and XNYS appears in the footer only
  when nothing else applies.
- Symbol map: every suffix; `.T` versus `.TO`; crypto and FX fall through.
- One field gives the same result in preview, Run and the bundle path.
- Help: the date-expressions page documents `@` and `(MIC)` with these
  examples.
