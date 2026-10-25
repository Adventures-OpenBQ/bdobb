---
type: Note
tags: [bdobb, help, widgets, built-in, dates, expressions, calendars]
---

# The Date Expression Card

*A scratchpad for the date language.* Type an expression and the card shows what it resolves to — twice over, once as a `date` and once as a `datetime`. It is a built-in, so it needs no backend; add it from the library under **Built-in**, where it is listed as **Date expression**.

![The Date expression card resolving T-1bd](../attachments/date-expression.png)

## Why both resolutions

That pairing is the whole point. The same expression answers differently depending on the parameter type it lands in — `T` is a day in one control and an instant in another, `$today` is midnight where `T` is now — and on an ordinary card you only ever see whichever projection your parameter happens to be. Here you see both side by side.

Resolution is the app's own, through the same function a fetching card's parameters go through, so what the card reads is what a real card would send. Asking a backend to resolve the expression would answer a different question.

## The three parameters

- **Expression** — a plain **text** field, deliberately. A `date` parameter would hand the value to the calendar chip, which resolves the expression into the box and so destroys the thing this card exists to show. Empty, the card reads *Enter a date expression — try `T-1bd`, `Q-4` or `FY0`.*
- **Fiscal year end (month)** — a number, `1`–`12`, consulted only by the `FQ` and `FY` anchors. It defaults to `12`, which is what the rest of the app falls back to as well, so the card agrees with a real one rather than inventing a different default.
- **As of** — a datetime, itself accepting an expression, that the calculation starts from: `T` in **Expression** means this instant. It defaults to `T`, the real now, and the card shows the resolved instant on its own **as of** row above the result.

Everything the grammar admits works here: anchors, offsets, the counted shorthands, weekday offsets, `EXP`. See [[card-parameters|Card Parameters]] for the grammar itself.

## Times of day and calendars

Two suffixes can close an expression. **`@`** pins a time of day onto the date the anchor and its offsets land on: `@HH:MM` (two digits each side of the colon), `@open` or `@close` — that date's own session hours, so an early close shortens `@close`, and a closed date takes the next session's. **`(MIC)`** names the calendar for the whole of it — its `bd` steps, its trading anchors and its `@`:

- `T-1bd(XLON)` — the London trading day before today.
- `T-1bd@close(XNYS)` — the prior NYSE trading day's close; the day after Thanksgiving, that is 13:00.
- `T@09:30(XTKS)` — 09:30 today on Tokyo's clock.
- `FQ0@open(XHKG)` — the first Hong Kong session open of the fiscal quarter.
- `T-5bd(XLON)..T(XLON)` — in a range each half carries its own calendar, and mixing them (`T-5bd(XLON)..T`) is allowed.

`@` only means something where a time is sent, so it works on a `datetime` parameter. On any other parameter type an `@` is a visible error — *@ needs a date-and-time parameter* — and is never sent. This card is display only, so for an `@` expression its **date** row shows the date part of the datetime. The calendars are the 71 in the table below, and the name is not case-sensitive. Anything else in the parentheses is an error on the card — `T(XNYZ)` reads *Unknown calendar XNYZ* — never a literal and never New York's hours. A wall-clock `@14:00` is on the clock of the calendar the field resolves on, which is New York's when that is `Default (XNYS)`.

## Exchange calendars

The app knows every calendar the exchange_calendars library defines. A symbol's last dot-suffix picks its calendar from the **Symbol suffixes** column, in EODHD's or Yahoo's spelling. A suffix that is not there names no calendar, and the card falls back to the parameter's, the widget's or the dashboard's. Two kinds of suffix are deliberately left out and infer nothing: `.NX` (Yahoo's Euronext-as-one-venue) is ambiguous across Amsterdam, Brussels, Dublin, Lisbon and Paris, and the unmapped suffixes (`.NS`, `.NSE`, `.SZ`, `.SHE`, `.TWO`, `.CC`, `.FOREX` and others) are venues the library has no calendar for, or that cannot be verified. A symbol carrying one is treated like an unsuffixed symbol.

A calendar is served only between the dates in the **Served** column. Four end before 2040: `XBOM`, `XSES` and `XSHG` on 2026-12-31, and `XSAU` on 2029-12-31. Outside those dates a value that needs the calendar — a business day (`bd`), `@open` or `@close` — is an error on every card, whether or not it is bound to a calendar. A value that needs no calendar, such as `T-7d`, is still sent.

Five calendars run overnight: `24/5`, `24/7`, `CMES`, `IEPA` and `us_futures`. Their sessions are labelled the way the library labels them. CME's Monday session opens on Sunday at 17:00 Chicago time, so `T@open(CMES)` on a Monday is Sunday evening, and `T@close(CMES)` is Monday at 17:00. Each session is dated as the library dates it, which for `24/5` and `24/7` is the date the session opens. These five always come from the backend's calendar bundles, on every card. When a bundle cannot be had, the card shows the error. It never counts weekdays for them.

| Calendar | Name | Symbol suffixes | Served |
|---|---|---|---|
| `24/5` | 24/5 (around the clock, Monday to Friday) | — | 1990-01-01 to 2040-12-31 |
| `24/7` | 24/7 (every minute of every day) | — | 1990-01-01 to 2040-12-31 |
| `AIXK` | Astana International Exchange | — | 2017-01-01 to 2040-12-31 |
| `ASEX` | Athens Stock Exchange | `.AT` | 1990-01-01 to 2040-12-31 |
| `BVMF` | B3 (Brasil Bolsa Balcão) | `.SA` | 1990-01-01 to 2040-12-31 |
| `CMES` | Chicago Mercantile Exchange | `.CBT`, `.CME`, `.CMX`, `.NYM` | 1990-01-01 to 2040-12-31 |
| `IEPA` | ICE Futures US | `.NYB` | 1990-01-01 to 2040-12-31 |
| `XAMS` | Euronext Amsterdam | `.AS` | 1990-01-01 to 2040-12-31 |
| `XASX` | Australian Securities Exchange | `.AU`, `.AX` | 1990-01-01 to 2040-12-31 |
| `XBDA` | Bermuda Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XBEL` | Belgrade Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XBKK` | Stock Exchange of Thailand | `.BK` | 1990-01-01 to 2040-12-31 |
| `XBOG` | Colombia Stock Exchange | `.CL` | 1990-01-01 to 2040-12-31 |
| `XBOM` | BSE (Bombay Stock Exchange) | `.BO` | 1997-01-01 to 2026-12-31 |
| `XBRA` | Bratislava Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XBRU` | Euronext Brussels | `.BR` | 1990-01-01 to 2040-12-31 |
| `XBSE` | Bucharest Stock Exchange | `.RO` | 1990-01-01 to 2040-12-31 |
| `XBUD` | Budapest Stock Exchange | `.BD`, `.BUD` | 1990-01-01 to 2040-12-31 |
| `XBUE` | Buenos Aires Stock Exchange | `.BA` | 1990-01-01 to 2040-12-31 |
| `XCBF` | Cboe Futures Exchange | — | 1990-01-01 to 2040-12-31 |
| `XCSE` | Nasdaq Copenhagen | `.CO` | 1990-01-01 to 2040-12-31 |
| `XCYS` | Cyprus Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XDUB` | Euronext Dublin | `.IR` | 1990-01-01 to 2040-12-31 |
| `XDUS` | Börse Düsseldorf | `.DU` | 1990-01-01 to 2040-12-31 |
| `XEEE` | European Energy Exchange | — | 1990-01-01 to 2040-12-31 |
| `XETR` | Xetra | `.DE`, `.XETRA` | 1990-01-01 to 2040-12-31 |
| `XEUR` | Eurex | — | 1990-01-01 to 2040-12-31 |
| `XFRA` | Frankfurt Stock Exchange | `.F` | 1990-01-01 to 2040-12-31 |
| `XHAM` | Börse Hamburg | `.HM` | 1990-01-01 to 2040-12-31 |
| `XHEL` | Nasdaq Helsinki | `.HE` | 1990-01-01 to 2040-12-31 |
| `XHKG` | Hong Kong Stock Exchange | `.HK` | 1990-01-01 to 2040-12-31 |
| `XICE` | Nasdaq Iceland | `.IC` | 1990-01-01 to 2040-12-31 |
| `XIDX` | Indonesia Stock Exchange | `.JK` | 1990-01-01 to 2040-12-31 |
| `XIST` | Borsa Istanbul | `.IS` | 1990-01-01 to 2040-12-31 |
| `XJSE` | Johannesburg Stock Exchange | `.JO` | 1990-01-01 to 2040-12-31 |
| `XKAR` | Pakistan Stock Exchange | `.KAR` | 1990-01-01 to 2040-12-31 |
| `XKLS` | Bursa Malaysia | `.KL`, `.KLSE` | 1990-01-01 to 2040-12-31 |
| `XKRX` | Korea Exchange | `.KO`, `.KQ`, `.KS` | 1990-01-01 to 2040-12-31 |
| `XLIM` | Lima Stock Exchange | `.LIM` | 1990-01-01 to 2040-12-31 |
| `XLIS` | Euronext Lisbon | `.LS` | 1990-01-01 to 2040-12-31 |
| `XLIT` | Nasdaq Vilnius | `.VS` | 1990-01-01 to 2040-12-31 |
| `XLJU` | Ljubljana Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XLON` | London Stock Exchange | `.IL`, `.L`, `.LSE` | 1990-01-01 to 2040-12-31 |
| `XLUX` | Luxembourg Stock Exchange | — | 1990-01-01 to 2040-12-31 |
| `XMAD` | Madrid Stock Exchange | `.MC` | 1990-01-01 to 2040-12-31 |
| `XMEX` | Mexican Stock Exchange | `.MX` | 1990-01-01 to 2040-12-31 |
| `XMIL` | Borsa Italiana | `.MI` | 1990-01-01 to 2040-12-31 |
| `XMOS` | Moscow Exchange | — | 1990-01-01 to 2040-12-31 |
| `XNYS` | New York Stock Exchange | `.US` | 1990-01-01 to 2040-12-31 |
| `XNZE` | New Zealand Exchange | `.NZ` | 1990-01-01 to 2040-12-31 |
| `XOSL` | Oslo Stock Exchange | `.OL` | 1990-01-01 to 2040-12-31 |
| `XPAR` | Euronext Paris | `.PA` | 1990-01-01 to 2040-12-31 |
| `XPHS` | Philippine Stock Exchange | `.PS`, `.PSE` | 1990-01-01 to 2040-12-31 |
| `XPRA` | Prague Stock Exchange | `.PR` | 1990-01-01 to 2040-12-31 |
| `XRIS` | Nasdaq Riga | `.RG` | 1990-01-01 to 2040-12-31 |
| `XSAU` | Saudi Exchange | `.SAU` | 2021-01-01 to 2029-12-31 |
| `XSES` | Singapore Exchange | `.SI` | 1990-01-01 to 2026-12-31 |
| `XSGO` | Santiago Stock Exchange | `.SN` | 1990-01-01 to 2040-12-31 |
| `XSHG` | Shanghai Stock Exchange | `.SHG`, `.SS` | 1990-12-03 to 2026-12-31 |
| `XSTO` | Nasdaq Stockholm | `.ST` | 1990-01-01 to 2040-12-31 |
| `XSTU` | Börse Stuttgart | `.SG`, `.STU` | 1990-01-01 to 2040-12-31 |
| `XSWX` | SIX Swiss Exchange | `.SW` | 1990-01-01 to 2040-12-31 |
| `XTAE` | Tel Aviv Stock Exchange | `.TA` | 1990-01-01 to 2040-12-31 |
| `XTAI` | Taiwan Stock Exchange | `.TW` | 2019-01-01 to 2040-12-31 |
| `XTAL` | Nasdaq Tallinn | `.TL` | 1990-01-01 to 2040-12-31 |
| `XTKS` | Tokyo Stock Exchange | `.T`, `.TSE` | 1997-01-01 to 2040-12-31 |
| `XTSE` | Toronto Stock Exchange | `.TO`, `.V` | 1990-01-01 to 2040-12-31 |
| `XWAR` | Warsaw Stock Exchange | `.WA`, `.WAR` | 1990-01-01 to 2040-12-31 |
| `XWBO` | Wiener Börse | `.VI` | 1990-01-01 to 2040-12-31 |
| `XZAG` | Zagreb Stock Exchange | `.ZSE` | 1990-01-01 to 2040-12-31 |
| `us_futures` | US futures (synthetic) | — | 1990-01-01 to 2040-12-31 |

## What it tells you underneath

**Whether it is an expression at all.** The card reads either *Read as an expression.* or *Not an expression — a literal, sent unchanged.* An unparseable value is not an error in this grammar — it is sent exactly as written — so a typo looks like silence everywhere else in the app. This is the line that tells the two apart.

**Which calendar is behind the answer, and why.** The line always shows. It names each calendar the answer used and where it came from — *Calendar: XLON (from the expression)*, *XTKS (from symbol 7203.T)* on a card that has a `symbol` parameter, *XHKG (from the widget)*, *XETR (from the dashboard)*, or *Default (XNYS)* when nothing names one — and where that calendar's data came from: a backend, the bundled NYSE file, or a weekday table with no holidays in it. A `⚠` follows when, and only when, it is a weekday table, because the bundled file is real data and a permanent caveat on every `XNYS` card would be furniture rather than information. A calendar that cannot answer is an error line of its own. See [[dashboards-and-folders|Dashboards and Folders]].

## Getting its own calendar

**The card loads a trading calendar for itself, the same way a period-typed control does, even though its own two parameters are deliberately a text field and a number, not a period type.** It asks for the calendars the expression names with `(MIC)` first, then — for atoms without one — the card's `symbol` suffix if it has such a parameter, the widget's own exchange, the dashboard's, then `XNYS`, reads each calendar back under that same key, and is given whatever that exchange resolves to — a backend calendar, the bundled NYSE file, or, failing both, a weekday table.

`bd` steps and the trading anchors run against real holidays and early closes when either a backend or the bundled file answers. The `⚠` under the calendar line appears only in the remaining case — no backend and no bundled file for that exchange — where the card falls back to plain weekdays and says so, the same as any other card would.

---
*See also: [[built-in-widgets|Built-in Widgets]] · [[card-parameters|Card Parameters]] · [[dashboards-and-folders|Dashboards and Folders]] · [[openbq-docker-stack|The openbq-docker Stack]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v5.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
