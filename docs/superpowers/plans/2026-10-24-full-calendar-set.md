# Full Calendar Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every calendar exchange_calendars 4.13.2 defines (71, up from 9) wherever a calendar is chosen — a date expression's `(MIC)`, a card's symbol suffix, the parameter and widget exchange, and the dashboard Exchange menu — from one catalogue openbq-docker generates and BDOBB vendors.

**Architecture:** openbq-docker gains `calendar-core/openbq_calendar/catalogue.py`, which builds `resources/calendar-catalogue.json` from the library plus a hand-curated name and suffix table (`curation.py`). The file is checked in, a test regenerates it byte for byte, and the provider's `CALENDARS`, capabilities and bounds read it. Each calendar gets a generated 2026 snapshot fixture; twelve major exchanges also get hand-checked facts. BDOBB vendors the catalogue with the existing contract vendoring and derives the known-calendar set, `EXCHANGE_HOURS`, the suffix map, the window clamp, the Help table and the dashboard menu from it. The five overnight calendars always resolve from provider bundles: on a legacy card the bundle hook supplies just those, layered over the per-year loader's map, and the resolver refuses to count them on weekdays.

**Tech Stack:** Python 3.12+, exchange_calendars 4.13.2, pydantic 2, FastAPI/Starlette, pytest, ruff (provider); TypeScript, React 18, Vitest, Testing Library, Tauri (client).

**Spec:** `docs/superpowers/specs/2026-10-24-full-calendar-set-design.md` (binding). It builds on `docs/superpowers/specs/2026-10-23-calendar-qualified-expressions-design.md`; the rulings recorded in `docs/calendars/release-v4-evidence.md` still bind (RF3: `XNAS` is an unknown calendar; R10a: deterministic 4xx refusals are cached; R10b/P11: bundle windows are clamped to the provider's bounds; P14: `(MIC)` is case-insensitive and trimmed).

## Repositories and shell variables

Every task names the repo it runs in. Set these once per shell. Every command below uses them. Never `cd` and then use a relative path: the shell can revert to another checkout.

```bash
SCRATCH=<the scratch directory holding both worktrees>
BDOBB="$SCRATCH/cal-bdobb-v4"   # branch claude/v4-full-calendar-set, from release/v4 a2d93b34
OD="$SCRATCH/cal-od-v4"         # branch claude/v4-full-calendar-set, from release/v4 8b442abb
```

Before every commit, confirm the branch. Both `git -C "$BDOBB" branch --show-current` and `git -C "$OD" branch --show-current` must print `claude/v4-full-calendar-set`. Do not push. Commit messages end with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Order:
- Tasks 1–3 (openbq-docker) build the catalogue, serve it and qualify it.
- Tasks 4–8 (bdobb) vendor it and build the client on it.
- Task 9 (both) records the evidence, pairs the client to the final provider commit and runs every gate.

The walk to v5–v10 is not part of this plan. It is done afterwards with the existing per-line brief.

## Global Constraints

- License header first, before any import: `# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.` then `# SPDX-License-Identifier: Apache-2.0` (TypeScript: the same text with `//`). `pnpm scrub` runs `scripts/header-check.sh`. `pnpm scrub` also rejects absolute home-directory and temp-directory paths, so never paste an absolute scratch path into a committed file; refer to the worktrees as `$BDOBB` and `$OD`.
- TypeScript style: format like the surrounding code (2-space indent, double quotes, semicolons, trailing commas, width 120). Give every exported symbol an explanatory doc comment. Put `import type` at the top of the file, never an inline `import("…")` type. `ManagedSourceForm.tsx` keeps its own compressed style.
- Python style: 4-space PEP 8, `python3 -m ruff format --line-length 120`, `python3 -m ruff check --select E,W,F --line-length 120`.
- No new runtime dependencies in either repo.
- The set is exactly what exchange_calendars 4.13.2 defines, excluding aliases: 71 calendars.
- Catalogue fields per spec: `calendarId` (`exchange:XPAR`) and the MIC; display name and IANA time zone; regular open and close, and the break if there is one; `overnight`; `bounds`; the library's aliases; `suffixes` (EODHD and Yahoo).
- "BDOBB vendors the catalogue with the existing contract vendoring (`scripts/vendor-calendar-contract.mjs`), pinned by the pairing. It is never fetched at runtime."
- Bounds: "Each calendar's bounds are the range the library actually covers when asked for 1990-01-01 to 2040-12-31." This includes the Taiwan qualification floor of 2019-01-01 (ruling R10b).
- Suffix rule unchanged: last dot-suffix, case-insensitive. "A suffix that maps to more than one calendar infers nothing and falls through, like an unsuffixed symbol. The table records every ambiguity it drops."
- Overnight calendars are `24/5`, `24/7`, `CMES`, `IEPA` and `us_futures`. A session is labelled as exchange_calendars labels it. "These five resolve only from provider bundles, on every card, bound or legacy. … If the bundle is not loaded, the card shows a visible error; it is never resolved on weekdays."
- The dashboard menu is "a searchable list of every catalogue calendar. The list shows the name and MIC, with 'Default (XNYS)' first. `parseExchange` accepts any catalogue calendar. Stored dashboards that use one of the six still load unchanged. A stored value outside the catalogue stays visible for repair."
- Qualification: a generated 2026 snapshot per calendar with the catalogue digest and evidence `library_baseline`. Hand checks cover XPAR, XETR, XSWX, XSHG, XKRX, XBOM, XSES, BVMF, XMEX, XJSE, XASX, and CMES, including a Sunday-evening open. "The evidence-strictness ruling is unchanged."
- Out of scope: joint and FX calendar sets in expression syntax; settlement or bank calendars; any calendar exchange_calendars does not define; the v5–v10 walk.

## Decisions this plan makes where the spec is silent or contradicted by the library

Each was measured on 2026-10-24 against exchange_calendars 4.13.2. Each is pinned by a test in the named task.

1. **Coverage is shorter than the spec lists.** The spec says every calendar runs to 2040-12-31. The library stops XBOM, XSES and XSHG at 2026-12-31 and XSAU at 2029-12-31. XBOM starts in 1997, and XSHG on 1990-12-03. The catalogue records what the library covers, as the spec's own rule says to. A date past those bounds is a visible COVERAGE_UNAVAILABLE on the atom (Tasks 1, 2 and 5).
2. **`calendarId` pattern.** Today the pattern is `[A-Z0-9_-]+`, which rejects `24/5`, `24/7` and `us_futures`. Both contracts widen it to `[A-Za-z0-9_/-]+` and keep the library's own names. The vendored schema changes with it (Tasks 2 and 4).
3. **Aliases are reference only.** `(NYSE)`, a stored `XNAS` and similar names stay unknown calendars, so ruling RF3 stands (Tasks 1 and 4).
4. **`workingDays` is added to each entry.** XSAU trades Sunday to Thursday, and the weekday fallback must not run it Monday to Friday (Tasks 1 and 5).
5. **Snapshots stay out of the vendored contract.** They live in `calendar-core/tests/snapshots/`, one compact file per calendar of about 25 KB, roughly 1.8 MB in all. The vendored contract stays under its 16 MB / 200-file cap. Only three small new bundle fixtures (XPAR, XKRX, CMES) are vendored, for client tests (Tasks 2 and 3).
6. **The searchable menu.** The repo has no searchable-list component. ParamInput's native `<datalist>` is an input, not a menu. `RowContextMenu` gains an optional `search` on a submenu item: a search box filters that flyout by label (Task 7).
7. **Suffix sources.**
   - The eodhd-api MCP `get_exchanges_list` answered 401, so EODHD codes come from EODHD's public list (eodhd.com/list-of-stock-markets, 63 rows, read 2026-10-24) plus the codes the 2026-10-23 spec ruled (US, LSE, TSE, HK, TA).
   - Yahoo suffixes come from help.yahoo.com/kb/SLN2310.html (read 2026-10-24).
   - EODHD codes not on the public list (JSE, SR, BSE, LU) are not mapped, and are recorded as unverified.
   - `.NX` (Euronext as one venue) is the one true cross-calendar ambiguity. It is dropped and recorded (Task 1).

## Library disagreements found while choosing hand checks (not asserted; report to the user)

- XKRX 2026-06-03, Korea's local-election day: KRX normally closes on national election days, but the library has an open session.
- XSES 2026-12-24 and 2026-12-31: SGX has historically traded half days on these eves, but the library has full sessions.

Neither date is used as a hand check. Task 9 records both in the evidence notes.

## Review Focus

1. **A calendar whose coverage has ended or not begun.** Example: XSES, XSHG and XBOM after 2026-12-31, on a bound card or as an overnight-style bundle. The request window is clamped into the calendar's bounds (never `start > end`, never a whole-card 422). An atom past the bounds shows COVERAGE_UNAVAILABLE. Pinned in Task 5.
2. **Non-MIC names and mixed case in `(…)`.** `(us_futures)`, `(US_FUTURES)`, `( xpar )` and `(24/7)` resolve to the catalogue's own spelling. `(NYSE)` and `(XNAS)` stay "Unknown calendar". Pinned in Task 5.
3. **A legacy card on an overnight calendar with no bundle.** Covers no backend, still loading, or a refusal. `T-1bd` and `@open` are a visible error and never counted on weekdays. A calendar-free `T-7d` still sends. Pinned in Task 6.
4. **A stored dashboard exchange outside the catalogue (`XNAS`, `US`).** It loads, shows as a checked "not a served calendar" row in the menu, and its cards show "Unknown calendar". A stored six-MIC dashboard loads unchanged. Pinned in Tasks 5 and 7.
5. **Searching the menu.** Matches by name or MIC, case-insensitively (`paris` gives XPAR, `cmes` gives CMES). Clearing the box restores Default plus all 71. ArrowDown from the box reaches the first match. Escape still closes the menu. Pinned in Task 7.

---

### Task 1 [openbq-docker]: Curated names and suffixes; the generated catalogue

**Files:**
- Create: `$OD/calendar-core/openbq_calendar/curation.py`
- Create: `$OD/calendar-core/openbq_calendar/catalogue.py`
- Create (generated): `$OD/calendar-core/openbq_calendar/resources/calendar-catalogue.json`
- Create: `$OD/calendar-core/tests/test_catalogue.py`

**Interfaces:**
- Consumes: `exchange_calendars` (`get_calendar_names`, `get_calendar`, `names_to_aliases`).
- Produces:
  - `catalogue.PATH: Path`;
  - `catalogue.build_catalogue() -> bytes`;
  - `catalogue.FLOOR`, `catalogue.CEILING`, `catalogue.QUALIFIED_FROM` (moved here from `registry.py` in Task 2);
  - `curation.NAMES`, `curation.SUFFIXES`, `curation.UNMAPPED_SUFFIXES`.
- The JSON shape every later task reads:

```json
{
  "calendars": [
    {
      "aliases": ["CBOT", "CME", "COMEX", "NYMEX"],
      "bounds": {"end": "2040-12-31", "start": "1990-01-01"},
      "break": null,
      "calendarId": "exchange:CMES",
      "close": "17:00:00",
      "mic": "CMES",
      "name": "Chicago Mercantile Exchange",
      "open": "17:00:00",
      "overnight": true,
      "suffixes": {"eodhd": [], "yahoo": ["CBT", "CME", "CMX", "NYM"]},
      "timezone": "America/Chicago",
      "workingDays": ["Mon", "Tue", "Wed", "Thu", "Fri"]
    }
  ],
  "schemaVersion": 1,
  "source": {"package": "exchange_calendars", "version": "4.13.2"},
  "unmappedSuffixes": {"NX": "Yahoo: Euronext as one venue; ambiguous across XAMS, XBRU, XDUB, XLIS and XPAR"}
}
```

`calendars` is in the library's order (`get_calendar_names`, sorted: `24/5`, `24/7`, `AIXK`, … `XZAG`, `us_futures`). Times are local `HH:MM:SS`. `break` is `{"start", "end"}` or `null`. Suffixes are upper case, without the dot, and sorted.

- [ ] **Step 1: Write the failing catalogue tests**

Create `$OD/calendar-core/tests/test_catalogue.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""The generated calendar catalogue (spec "One catalogue, generated by the provider")."""

import json

import exchange_calendars as xc
import pytest

from openbq_calendar.catalogue import PATH, build_catalogue
from openbq_calendar.curation import UNMAPPED_SUFFIXES

CATALOGUE = json.loads(PATH.read_text(encoding="utf8"))
ENTRIES = {e["mic"]: e for e in CATALOGUE["calendars"]}
FULL = {"start": "1990-01-01", "end": "2040-12-31"}


def forms(mic):
    return {*ENTRIES[mic]["suffixes"]["eodhd"], *ENTRIES[mic]["suffixes"]["yahoo"]}


def test_the_catalogue_regenerates_byte_identical():
    assert build_catalogue() == PATH.read_bytes()


def test_one_entry_per_library_calendar():
    assert list(ENTRIES) == xc.get_calendar_names(include_aliases=False)
    assert len(ENTRIES) == 71
    assert all(e["calendarId"] == "exchange:" + mic for mic, e in ENTRIES.items())
    assert ENTRIES["XNYS"]["aliases"] == ["ARCX", "BATS", "NASDAQ", "NYSE", "OOTC", "XASE", "XNAS"]


def test_the_overnight_calendars_follow_the_library():
    assert [m for m, e in ENTRIES.items() if e["overnight"]] == ["24/5", "24/7", "CMES", "IEPA", "us_futures"]
    cme = ENTRIES["CMES"]
    assert (cme["timezone"], cme["open"], cme["close"], cme["break"]) == (
        "America/Chicago",
        "17:00:00",
        "17:00:00",
        None,
    )
    assert ENTRIES["24/7"]["workingDays"] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def test_lunch_breaks():
    assert {m: e["break"] for m, e in ENTRIES.items() if e["break"]} == {
        "XHKG": {"start": "12:00:00", "end": "13:00:00"},
        "XSHG": {"start": "11:30:00", "end": "13:00:00"},
        "XTKS": {"start": "11:30:00", "end": "12:30:00"},
    }


def test_bounds_are_what_the_library_covers_inside_1990_to_2040():
    assert {m: e["bounds"] for m, e in ENTRIES.items() if e["bounds"] != FULL} == {
        "AIXK": {"start": "2017-01-01", "end": "2040-12-31"},
        "XBOM": {"start": "1997-01-01", "end": "2026-12-31"},
        "XSAU": {"start": "2021-01-01", "end": "2029-12-31"},
        "XSES": {"start": "1990-01-01", "end": "2026-12-31"},
        "XSHG": {"start": "1990-12-03", "end": "2026-12-31"},
        "XTAI": {"start": "2019-01-01", "end": "2040-12-31"},  # qualification, not the library
        "XTKS": {"start": "1997-01-01", "end": "2040-12-31"},
    }


def test_a_trading_week_that_is_not_monday_to_friday():
    assert ENTRIES["XSAU"]["workingDays"] == ["Mon", "Tue", "Wed", "Thu", "Sun"]


SPEC_EXAMPLES = {
    "XPAR": {"PA"},
    "XAMS": {"AS"},
    "XSWX": {"SW"},
    "XKRX": {"KS", "KQ", "KO"},
    "XSHG": {"SS", "SHG"},
    "XBOM": {"BO"},
    "XSES": {"SI"},
    "BVMF": {"SA"},
    "XMEX": {"MX"},
    "XJSE": {"JO"},
}


@pytest.mark.parametrize("mic", sorted(SPEC_EXAMPLES))
def test_the_spec_suffix_examples(mic):
    assert SPEC_EXAMPLES[mic] <= forms(mic)


def test_korea_covers_kospi_and_kosdaq_in_both_spellings():
    assert ENTRIES["XKRX"]["suffixes"] == {"eodhd": ["KO", "KQ"], "yahoo": ["KQ", "KS"]}


def test_the_nine_keep_their_2026_10_23_suffixes():
    prior = {
        "XNYS": {"US"},
        "XLON": {"LSE", "L"},
        "XTSE": {"TO"},
        "XETR": {"XETRA", "DE"},
        "XTKS": {"TSE", "T"},
        "XHKG": {"HK"},
        "XASX": {"AU", "AX"},
        "XTAE": {"TA"},
        "XTAI": {"TW"},
    }
    for mic, suffixes in prior.items():
        assert suffixes <= forms(mic), mic


def test_every_suffix_names_one_calendar_and_every_dropped_one_is_recorded():
    owner = {}
    for mic in ENTRIES:
        for suffix in forms(mic):
            assert owner.setdefault(suffix, mic) == mic, suffix
            assert suffix == suffix.upper() and not suffix.startswith("."), suffix
    assert CATALOGUE["unmappedSuffixes"] == UNMAPPED_SUFFIXES
    assert not set(owner) & set(UNMAPPED_SUFFIXES)
    assert "Euronext" in UNMAPPED_SUFFIXES["NX"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_catalogue.py"`
Expected: collection error, `ModuleNotFoundError: No module named 'openbq_calendar.catalogue'`.

- [ ] **Step 3: Write the curated table**

Create `$OD/calendar-core/openbq_calendar/curation.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Hand-curated facts the catalogue generator cannot read from exchange_calendars: display names and symbol suffixes.

Suffixes are written without the dot, upper case. EODHD codes come from EODHD's published exchange list
(eodhd.com/list-of-stock-markets, read 2026-10-24) or were ruled in the 2026-10-23 spec (US, LSE, TSE, HK, TA); Yahoo
suffixes from Yahoo's "Exchanges and data providers" help page (help.yahoo.com/kb/SLN2310.html, read 2026-10-24).
A suffix that would name more than one calendar, or names an exchange the library has no calendar for, is not mapped:
it is listed in UNMAPPED_SUFFIXES with the reason, and catalogue.build_catalogue() refuses a table that maps it.
"""

NAMES = {
    "24/5": "24/5 (around the clock, Monday to Friday)",
    "24/7": "24/7 (every minute of every day)",
    "AIXK": "Astana International Exchange",
    "ASEX": "Athens Stock Exchange",
    "BVMF": "B3 (Brasil Bolsa Balcão)",
    "CMES": "Chicago Mercantile Exchange",
    "IEPA": "ICE Futures US",
    "XAMS": "Euronext Amsterdam",
    "XASX": "Australian Securities Exchange",
    "XBDA": "Bermuda Stock Exchange",
    "XBEL": "Belgrade Stock Exchange",
    "XBKK": "Stock Exchange of Thailand",
    "XBOG": "Colombia Stock Exchange",
    "XBOM": "BSE (Bombay Stock Exchange)",
    "XBRA": "Bratislava Stock Exchange",
    "XBRU": "Euronext Brussels",
    "XBSE": "Bucharest Stock Exchange",
    "XBUD": "Budapest Stock Exchange",
    "XBUE": "Buenos Aires Stock Exchange",
    "XCBF": "Cboe Futures Exchange",
    "XCSE": "Nasdaq Copenhagen",
    "XCYS": "Cyprus Stock Exchange",
    "XDUB": "Euronext Dublin",
    "XDUS": "Börse Düsseldorf",
    "XEEE": "European Energy Exchange",
    "XETR": "Xetra",
    "XEUR": "Eurex",
    "XFRA": "Frankfurt Stock Exchange",
    "XHAM": "Börse Hamburg",
    "XHEL": "Nasdaq Helsinki",
    "XHKG": "Hong Kong Stock Exchange",
    "XICE": "Nasdaq Iceland",
    "XIDX": "Indonesia Stock Exchange",
    "XIST": "Borsa Istanbul",
    "XJSE": "Johannesburg Stock Exchange",
    "XKAR": "Pakistan Stock Exchange",
    "XKLS": "Bursa Malaysia",
    "XKRX": "Korea Exchange",
    "XLIM": "Lima Stock Exchange",
    "XLIS": "Euronext Lisbon",
    "XLIT": "Nasdaq Vilnius",
    "XLJU": "Ljubljana Stock Exchange",
    "XLON": "London Stock Exchange",
    "XLUX": "Luxembourg Stock Exchange",
    "XMAD": "Madrid Stock Exchange",
    "XMEX": "Mexican Stock Exchange",
    "XMIL": "Borsa Italiana",
    "XMOS": "Moscow Exchange",
    "XNYS": "New York Stock Exchange",
    "XNZE": "New Zealand Exchange",
    "XOSL": "Oslo Stock Exchange",
    "XPAR": "Euronext Paris",
    "XPHS": "Philippine Stock Exchange",
    "XPRA": "Prague Stock Exchange",
    "XRIS": "Nasdaq Riga",
    "XSAU": "Saudi Exchange",
    "XSES": "Singapore Exchange",
    "XSGO": "Santiago Stock Exchange",
    "XSHG": "Shanghai Stock Exchange",
    "XSTO": "Nasdaq Stockholm",
    "XSTU": "Börse Stuttgart",
    "XSWX": "SIX Swiss Exchange",
    "XTAE": "Tel Aviv Stock Exchange",
    "XTAI": "Taiwan Stock Exchange",
    "XTAL": "Nasdaq Tallinn",
    "XTKS": "Tokyo Stock Exchange",
    "XTSE": "Toronto Stock Exchange",
    "XWAR": "Warsaw Stock Exchange",
    "XWBO": "Wiener Börse",
    "XZAG": "Zagreb Stock Exchange",
    "us_futures": "US futures (synthetic)",
}

# calendar -> {"eodhd": [...], "yahoo": [...]}; a calendar not listed has no suffix.
SUFFIXES = {
    "ASEX": {"eodhd": ["AT"], "yahoo": ["AT"]},
    "BVMF": {"eodhd": ["SA"], "yahoo": ["SA"]},
    "CMES": {"eodhd": [], "yahoo": ["CBT", "CME", "CMX", "NYM"]},  # CBOT, CME, COMEX, NYMEX: library aliases of CMES
    "IEPA": {"eodhd": [], "yahoo": ["NYB"]},  # ICE Futures US
    "XAMS": {"eodhd": ["AS"], "yahoo": ["AS"]},
    "XASX": {"eodhd": ["AU"], "yahoo": ["AX"]},
    "XBKK": {"eodhd": ["BK"], "yahoo": ["BK"]},
    "XBOG": {"eodhd": [], "yahoo": ["CL"]},
    "XBOM": {"eodhd": [], "yahoo": ["BO"]},
    "XBRU": {"eodhd": ["BR"], "yahoo": ["BR"]},
    "XBSE": {"eodhd": ["RO"], "yahoo": ["RO"]},
    "XBUD": {"eodhd": ["BUD"], "yahoo": ["BD"]},
    "XBUE": {"eodhd": ["BA"], "yahoo": ["BA"]},
    "XCSE": {"eodhd": ["CO"], "yahoo": ["CO"]},
    "XDUB": {"eodhd": ["IR"], "yahoo": ["IR"]},
    "XDUS": {"eodhd": ["DU"], "yahoo": ["DU"]},
    "XETR": {"eodhd": ["XETRA"], "yahoo": ["DE"]},
    "XFRA": {"eodhd": ["F"], "yahoo": ["F"]},
    "XHAM": {"eodhd": ["HM"], "yahoo": ["HM"]},
    "XHEL": {"eodhd": ["HE"], "yahoo": ["HE"]},
    "XHKG": {"eodhd": ["HK"], "yahoo": ["HK"]},
    "XICE": {"eodhd": [], "yahoo": ["IC"]},
    "XIDX": {"eodhd": ["JK"], "yahoo": ["JK"]},
    "XIST": {"eodhd": [], "yahoo": ["IS"]},
    "XJSE": {"eodhd": [], "yahoo": ["JO"]},
    "XKAR": {"eodhd": ["KAR"], "yahoo": []},
    "XKLS": {"eodhd": ["KLSE"], "yahoo": ["KL"]},
    "XKRX": {"eodhd": ["KO", "KQ"], "yahoo": ["KQ", "KS"]},  # KOSPI and KOSDAQ share the KRX calendar
    "XLIM": {"eodhd": ["LIM"], "yahoo": []},
    "XLIS": {"eodhd": ["LS"], "yahoo": ["LS"]},
    "XLIT": {"eodhd": [], "yahoo": ["VS"]},
    "XLON": {"eodhd": ["LSE"], "yahoo": ["IL", "L"]},
    "XMAD": {"eodhd": ["MC"], "yahoo": ["MC"]},
    "XMEX": {"eodhd": ["MX"], "yahoo": ["MX"]},
    "XMIL": {"eodhd": [], "yahoo": ["MI"]},
    "XNYS": {"eodhd": ["US"], "yahoo": []},
    "XNZE": {"eodhd": [], "yahoo": ["NZ"]},
    "XOSL": {"eodhd": ["OL"], "yahoo": ["OL"]},
    "XPAR": {"eodhd": ["PA"], "yahoo": ["PA"]},
    "XPHS": {"eodhd": ["PSE"], "yahoo": ["PS"]},
    "XPRA": {"eodhd": ["PR"], "yahoo": ["PR"]},
    "XRIS": {"eodhd": [], "yahoo": ["RG"]},
    "XSAU": {"eodhd": [], "yahoo": ["SAU"]},
    "XSES": {"eodhd": [], "yahoo": ["SI"]},
    "XSGO": {"eodhd": ["SN"], "yahoo": ["SN"]},
    "XSHG": {"eodhd": ["SHG"], "yahoo": ["SS"]},
    "XSTO": {"eodhd": ["ST"], "yahoo": ["ST"]},
    "XSTU": {"eodhd": ["STU"], "yahoo": ["SG"]},  # Yahoo .SG is Stuttgart, not Singapore (.SI)
    "XSWX": {"eodhd": ["SW"], "yahoo": ["SW"]},
    "XTAE": {"eodhd": ["TA"], "yahoo": ["TA"]},
    "XTAI": {"eodhd": ["TW"], "yahoo": ["TW"]},
    "XTAL": {"eodhd": [], "yahoo": ["TL"]},
    "XTKS": {"eodhd": ["TSE"], "yahoo": ["T"]},
    "XTSE": {"eodhd": ["TO", "V"], "yahoo": ["TO", "V"]},  # TSX Venture (XTSX) is a library alias of XTSE
    "XWAR": {"eodhd": ["WAR"], "yahoo": ["WA"]},
    "XWBO": {"eodhd": ["VI"], "yahoo": ["VI"]},
    "XZAG": {"eodhd": ["ZSE"], "yahoo": []},
}

# Suffixes deliberately mapped to no calendar, with why. A symbol carrying one infers nothing, like an unsuffixed one.
UNMAPPED_SUFFIXES = {
    "AE": "Yahoo: Dubai Financial Market; no exchange_calendars calendar",
    "AQ": "Yahoo: Aquis Exchange; no calendar",
    "BE": "EODHD and Yahoo: Börse Berlin; no calendar",
    "BM": "Yahoo: Börse Bremen; no calendar",
    "BSE": "EODHD code for Bombay, not on EODHD's published list (2026-10-24), so unverified; Yahoo .BO maps XBOM",
    "CA": "Yahoo: Egyptian Exchange; no calendar",
    "CC": "EODHD: cryptocurrencies; no exchange calendar",
    "CM": "EODHD: Colombo Stock Exchange; no calendar",
    "CN": "Yahoo: Canadian Securities Exchange; no calendar",
    "CR": "Yahoo: Caracas Stock Exchange; no calendar",
    "DSE": "EODHD: Dar es Salaam Stock Exchange; no calendar",
    "EGX": "EODHD: Egyptian Exchange; no calendar",
    "EUFUND": "EODHD: virtual fund exchange; no calendar",
    "FOREX": "EODHD: currencies; no exchange calendar",
    "GBOND": "EODHD: government bonds; no exchange calendar",
    "GSE": "EODHD: Ghana Stock Exchange; no calendar",
    "HA": "EODHD and Yahoo: Börse Hannover; no calendar",
    "JSE": "EODHD code for Johannesburg, not on EODHD's published list (2026-10-24), so unverified; Yahoo .JO maps XJSE",
    "KW": "Yahoo: Boursa Kuwait; no calendar",
    "LU": "EODHD code for Luxembourg, not on EODHD's published list (2026-10-24), so unverified",
    "LUSE": "EODHD: Lusaka Stock Exchange; no calendar",
    "MONEY": "EODHD: money-market virtual exchange; no calendar",
    "MSE": "EODHD: Malawi Stock Exchange; no calendar",
    "MU": "EODHD and Yahoo: Börse München; no calendar",
    "NE": "Yahoo: Cboe Canada; no calendar",
    "NEO": "EODHD: Cboe Canada; no calendar",
    "NS": "Yahoo: National Stock Exchange of India; no calendar (XBOM is BSE's)",
    "NSE": "EODHD: National Stock Exchange of India; no calendar (XBOM is BSE's)",
    "NX": "Yahoo: Euronext as one venue; ambiguous across XAMS, XBRU, XDUB, XLIS and XPAR",
    "QA": "Yahoo: Qatar Stock Exchange; no calendar",
    "REGA": "Yahoo: collectable indices; no calendar",
    "RSE": "EODHD: Rwanda Stock Exchange; no calendar",
    "SEM": "EODHD: Stock Exchange of Mauritius; no calendar",
    "SHE": "EODHD: Shenzhen Stock Exchange; no calendar (XSHG is Shanghai's)",
    "SR": "EODHD code for Saudi, not on EODHD's published list (2026-10-24), so unverified; Yahoo .SAU maps XSAU",
    "SZ": "Yahoo: Shenzhen Stock Exchange; no calendar (XSHG is Shanghai's)",
    "TI": "Yahoo: EuroTLX; no calendar",
    "TWO": "EODHD and Yahoo: Taipei Exchange (OTC); no calendar (XTAI is TWSE's)",
    "USE": "EODHD: Uganda Securities Exchange; no calendar",
    "VN": "EODHD and Yahoo: Ho Chi Minh City Stock Exchange; no calendar",
    "XA": "Yahoo: Cboe Australia; not the ASX, no calendar",
    "XBOT": "EODHD: Botswana Stock Exchange; no calendar",
    "XC": "Yahoo: Cboe UK; no calendar",
    "XD": "Yahoo: Cboe Europe; no calendar",
    "XNSA": "EODHD: Nigerian Exchange; no calendar",
}
```

- [ ] **Step 4: Write the generator**

Create `$OD/calendar-core/openbq_calendar/catalogue.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""calendar-catalogue.json: one entry per exchange_calendars calendar (spec "One catalogue, generated by the provider").

`python3 -m openbq_calendar.catalogue` rewrites the checked-in file. tests/test_catalogue.py fails when the file differs
from what build_catalogue() makes now, so a library upgrade that moves a calendar's coverage or hours is a reviewable
diff, never a silent change.
"""

import json
from datetime import date
from importlib.metadata import version
from pathlib import Path

import exchange_calendars as xc

from .curation import NAMES, SUFFIXES, UNMAPPED_SUFFIXES

PATH = Path(__file__).parent / "resources" / "calendar-catalogue.json"
# The window the routes serve at all, as the legacy envelope always has.
FLOOR, CEILING = date(1990, 1, 1), date(2040, 12, 31)
# Limits the library cannot know: Taiwan's pre-2019 weekend make-up sessions are unverified.
QUALIFIED_FROM = {"XTAI": date(2019, 1, 1)}
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _latest(times):
    """The time in force last: exchange_calendars keeps (since, time) pairs oldest first. None when there is none."""
    value = times[-1][1] if times else None
    return value.strftime("%H:%M:%S") if value is not None else None


def _entry(name, aliases):
    cal = xc.get_calendar(name)
    low, high = cal.bound_min(), cal.bound_max()
    start = max(FLOOR, QUALIFIED_FROM.get(name, FLOOR), low.date() if low is not None else FLOOR)
    end = min(CEILING, high.date() if high is not None else CEILING)
    lunch = _latest(cal.break_start_times), _latest(cal.break_end_times)
    forms = SUFFIXES.get(name, {"eodhd": [], "yahoo": []})
    return {
        "calendarId": "exchange:" + name,
        "mic": name,
        "name": NAMES[name],
        "timezone": str(cal.tz),
        "open": _latest(cal.open_times),
        "close": _latest(cal.close_times),
        "break": {"start": lunch[0], "end": lunch[1]} if lunch[0] else None,
        # A session that opens the day before its label (CMES) or closes the day after (24/5) crosses local midnight.
        "overnight": cal.open_offset != 0 or cal.close_offset != 0,
        "bounds": {"start": start.isoformat(), "end": end.isoformat()},
        "aliases": sorted(aliases.get(name, [])),
        "suffixes": {"eodhd": sorted(forms["eodhd"]), "yahoo": sorted(forms["yahoo"])},
        "workingDays": [day for day, on in zip(WEEKDAYS, cal.weekmask) if on == "1"],
    }


def build_catalogue():
    """The catalogue as checked in: sorted keys, two-space indent, UTF-8, one trailing newline."""
    names = xc.get_calendar_names(include_aliases=False)
    stray = sorted((set(NAMES) ^ set(names)) | (set(SUFFIXES) - set(names)))
    if stray:
        raise ValueError(f"curation.py does not match exchange_calendars: {stray}")
    owner = {}
    for name, forms in SUFFIXES.items():
        for suffix in {*forms["eodhd"], *forms["yahoo"]}:
            if owner.setdefault(suffix, name) != name or suffix in UNMAPPED_SUFFIXES:
                raise ValueError(f"suffix {suffix} would name more than one calendar; list it in UNMAPPED_SUFFIXES")
    aliases = xc.names_to_aliases()
    body = {
        "schemaVersion": 1,
        "source": {"package": "exchange_calendars", "version": version("exchange_calendars")},
        "calendars": [_entry(name, aliases) for name in names],
        "unmappedSuffixes": UNMAPPED_SUFFIXES,
    }
    return (json.dumps(body, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf8")


if __name__ == "__main__":
    PATH.write_bytes(build_catalogue())
```

- [ ] **Step 5: Generate the catalogue**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.catalogue && wc -c "$OD/calendar-core/openbq_calendar/resources/calendar-catalogue.json"`
Expected: about 43,700 bytes (43,751 measured on 2026-10-24). The run takes about 10 s, because it constructs every calendar once.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_catalogue.py"`
Expected: `19 passed` (10 of them from the parametrized spec examples).

- [ ] **Step 7: Format, lint and commit**

```bash
python3 -m ruff format --line-length 120 "$OD/calendar-core/openbq_calendar/curation.py" "$OD/calendar-core/openbq_calendar/catalogue.py" "$OD/calendar-core/tests/test_catalogue.py"
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core/openbq_calendar" "$OD/calendar-core/tests"
git -C "$OD" branch --show-current
git -C "$OD" add calendar-core/openbq_calendar/curation.py calendar-core/openbq_calendar/catalogue.py calendar-core/openbq_calendar/resources/calendar-catalogue.json calendar-core/tests/test_catalogue.py
git -C "$OD" commit -m "feat(v4): generate the exchange calendar catalogue with curated suffixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If ruff reflows a line in a generator source, regenerate the catalogue (Step 5) and rerun Step 6 before committing.

---

### Task 2 [openbq-docker]: Serve every catalogue calendar

**Files:**
- Modify: `$OD/calendar-core/openbq_calendar/registry.py` (whole file)
- Modify: `$OD/calendar-core/openbq_calendar/supplier.py` (the `xc.get_calendar` line)
- Modify: `$OD/calendar-core/openbq_calendar/contracts.py` (the `calendarId` pattern)
- Modify: `$OD/calendar-core/openbq_calendar/legacy.py` (the `lru_cache` comment)
- Modify: `$OD/v4/routes/openbq_routes/calendar_v1.py` (`build_bundle`, `_entry`)
- Create (generated): `$OD/calendar-core/openbq_calendar/resources/conformance/{XPAR,XKRX,CMES-2026-01}.json`
- Modify tests: `$OD/calendar-core/tests/test_calendar_core.py`, `$OD/calendar-core/tests/test_qualification.py`, `$OD/v4/routes/tests/test_calendar_v1.py`

**Interfaces:**
- Consumes: `catalogue.PATH` and the JSON shape from Task 1.
- Produces:
  - `registry.ENTRIES: dict[str, dict]` (the catalogue entries by MIC);
  - `registry.CALENDARS: tuple[str, ...]` (all 71, in catalogue order);
  - `registry.bounds(name) -> tuple[date, date]` (the catalogue's bounds);
  - `generate_bundle` accepting any catalogue calendar, ids such as `exchange:24/7` and `exchange:us_futures`, and the clipped first and last years;
  - conformance fixtures that Task 4 vendors: `XPAR.json` and `XKRX.json` (2026-12-21..2027-01-08), and `CMES-2026-01.json` (2026-01-02..2026-01-09).

- [ ] **Step 1: Write the failing provider tests**

In `$OD/calendar-core/tests/test_calendar_core.py`, change the top import `from datetime import date, datetime, timezone` to `from datetime import date, datetime, timedelta, timezone`, add `from openbq_calendar.registry import CALENDARS, bounds` after the other `openbq_calendar` imports at the top, and append:

```python
@pytest.mark.parametrize("name", CALENDARS)
def test_every_catalogue_calendar_builds_inside_its_bounds_and_refuses_outside(name):
    low, high = bounds(name)
    now = datetime.now(timezone.utc)
    first = generate_bundle("exchange:" + name, low, low + timedelta(days=6), generated_at=now)
    last = generate_bundle("exchange:" + name, high - timedelta(days=6), high, generated_at=now)
    assert first["coverage"]["start"] == low.isoformat()
    assert last["coverage"]["end"] == high.isoformat()
    with pytest.raises(ValueError):
        generate_bundle("exchange:" + name, low - timedelta(days=1), low, generated_at=now)
    with pytest.raises(ValueError):
        generate_bundle("exchange:" + name, high, high + timedelta(days=1), generated_at=now)


def test_cme_monday_opens_on_sunday_evening_in_chicago():
    b = generate_bundle("exchange:CMES", date(2026, 1, 4), date(2026, 1, 5), generated_at=datetime.now(timezone.utc))
    assert [d["state"] for d in b["days"]] == ["closed", "open"]
    assert (b["days"][1]["open"], b["days"][1]["close"]) == ("2026-01-04T23:00:00Z", "2026-01-05T23:00:00Z")


def test_calendar_ids_allow_the_library_names_and_nothing_looser():
    b = generate_bundle("exchange:24/7", date(2026, 1, 3), date(2026, 1, 3), generated_at=datetime.now(timezone.utc))
    assert b["calendarId"] == "exchange:24/7" and b["days"][0]["state"] == "open"
    bad = make()
    bad["calendarId"] = "exchange:A B"
    bad["digest"] = bundle_digest(bad)
    with pytest.raises(ValueError):
        validate_bundle(bad)
```

In `$OD/v4/routes/tests/test_calendar_v1.py`, make two edits:

1. In `test_capabilities_report_supplier_bounds_for_exactly_the_qualified_set`, after `assert set(entries) == {"exchange:" + name for name in CALENDARS}`, add:

```python
    assert len(entries) == 71
    assert entries["exchange:24/7"]["timezone"] == "UTC"
    assert entries["exchange:XSES"]["end"] == "2026-12-31"
    assert entries["exchange:XSHG"]["start"] == "1990-12-03"
```

2. Append a new test:

```python
def test_bundles_for_library_names_and_clipped_years():
    calendar_v1.clear_cache()
    r = client.get(BUNDLE, params={"calendar_id": "exchange:24/7", "start": "2026-01-03", "end": "2026-01-03"})
    assert r.status_code == 200 and r.json()["calendarId"] == "exchange:24/7"
    r = client.get(BUNDLE, params={"calendar_id": "exchange:XSHG", "start": "1990-12-03", "end": "1990-12-31"})
    assert r.status_code == 200 and r.json()["coverage"]["start"] == "1990-12-03"
    r = client.get(BUNDLE, params={"calendar_id": "exchange:XSES", "start": "2026-12-01", "end": "2026-12-31"})
    assert r.status_code == 200 and r.json()["coverage"]["end"] == "2026-12-31"
    gone = {"calendar_id": "exchange:XSES", "start": "2027-01-04", "end": "2027-01-04"}
    assert client.get(BUNDLE, params=gone).status_code == 422
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests/test_calendar_core.py" "$OD/v4/routes/tests/test_calendar_v1.py"`
Expected: FAIL. The parametrized test collects only nine names. `test_cme_monday…` raises `unknown or unqualified calendar`. The capabilities test sees 9, not 71.

- [ ] **Step 3: Read the registry from the catalogue**

Replace the body of `$OD/calendar-core/openbq_calendar/registry.py` after the license header with:

```python
"""The calendars openbq-docker serves: exactly resources/calendar-catalogue.json, which catalogue.py generates.

A name is resolved, never guessed. The catalogue lists each calendar's library aliases (NYSE, XNAS, …) for reference
only; they are not served under those names (ruling RF3).
"""

import json
from datetime import date
from pathlib import Path

ENTRIES = {
    entry["mic"]: entry
    for entry in json.loads((Path(__file__).parent / "resources" / "calendar-catalogue.json").read_bytes())["calendars"]
}
CALENDARS = tuple(ENTRIES)


def resolve_calendar(identifier):
    if not isinstance(identifier, str):
        raise ValueError("unknown calendar")
    name = identifier.removeprefix("exchange:")
    if name not in CALENDARS:
        raise ValueError("unknown or unqualified calendar")
    return name


def bounds(name):
    """The first and last date served for a calendar, as the catalogue measured them inside 1990..2040."""
    served = ENTRIES[name]["bounds"]
    return date.fromisoformat(served["start"]), date.fromisoformat(served["end"])
```

- [ ] **Step 4: Clip the supplier's whole years to the bounds, and widen the id pattern**

In `$OD/calendar-core/openbq_calendar/supplier.py`, replace

```python
    # Construct full years: the supplier requires start < end and an open session,
    # while our public contract also supports one closed day or a closed-only range.
    cal = xc.get_calendar(name, start=f"{start.year}-01-01", end=f"{end.year}-12-31")
```

with

```python
    # Construct whole years, clipped to the served bounds: the library refuses a range past its own (XSHG starts
    # 1990-12-03, XSES ends 2026-12-31), and our public contract also supports one closed day or a closed-only range.
    first, last = max(date(start.year, 1, 1), low), min(date(end.year, 12, 31), high)
    cal = xc.get_calendar(name, start=first.isoformat(), end=last.isoformat())
```

In `$OD/calendar-core/openbq_calendar/contracts.py`, replace

```python
    calendarId: Annotated[str, Field(pattern=r"^(exchange|payment|settlement):[A-Z0-9_-]+$")]
```

with

```python
    # The library's own names include 24/5, 24/7 and us_futures (2026-10-24 full calendar set).
    calendarId: Annotated[str, Field(pattern=r"^(exchange|payment|settlement):[A-Za-z0-9_/-]+$")]
```

In `$OD/calendar-core/openbq_calendar/legacy.py`, replace

```python
@lru_cache(maxsize=512)  # nine calendars x 51 years = 459 keys
```

with

```python
@lru_cache(maxsize=512)  # the 512 most recent exchange-years (71 calendars x 51 years would be 3,621)
```

- [ ] **Step 5: Clip the route's whole years and read capabilities from the catalogue**

In `$OD/v4/routes/openbq_routes/calendar_v1.py`:

Replace the import line

```python
from openbq_calendar.registry import CALENDARS, bounds, resolve_calendar
```

with

```python
from openbq_calendar.registry import CALENDARS, ENTRIES, bounds, resolve_calendar
```

In `build_bundle`, replace

```python
    body = generate_bundle(
        key[0], date(start_year, 1, 1), date(end_year, 12, 31), generated_at=datetime.now(timezone.utc)
    )
```

with

```python
    # Whole years, clipped to the calendar's bounds: XSHG's first year starts 1990-12-03, XSES's last ends 2026-12-31.
    low, high = bounds(key[0].removeprefix("exchange:"))
    body = generate_bundle(
        key[0],
        max(date(start_year, 1, 1), low),
        min(date(end_year, 12, 31), high),
        generated_at=datetime.now(timezone.utc),
    )
```

Replace `_entry` with:

```python
def _entry(name):
    start, end = bounds(name)
    return {
        "calendarId": "exchange:" + name,
        "name": name,
        "timezone": ENTRIES[name]["timezone"],
        "kind": "exchange_trading",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "policies": ["operational-v1", "planning-v1"],
        "aliases": [{"alias": name, "calendarId": "exchange:" + name}],
    }
```

In the module docstring, replace `Capabilities need exchange_calendars to build every calendar once, which is slow, so they are built once, in a worker thread, never on the event loop.` with `Capabilities are read from the generated catalogue, once, in a worker thread, never on the event loop.`

- [ ] **Step 6: Generate the three client fixtures and give them facts**

```bash
OD="$OD" PYTHONPATH="$OD/calendar-core" python3 - <<'EOF'
import os
from datetime import date, datetime, timezone
from pathlib import Path

from openbq_calendar.canonical import canonical_bytes
from openbq_calendar.supplier import generate_bundle

out = Path(os.environ["OD"]) / "calendar-core/openbq_calendar/resources/conformance"
year_end = (date(2026, 12, 21), date(2027, 1, 8))
windows = {
    "XPAR.json": ("XPAR", *year_end),
    "XKRX.json": ("XKRX", *year_end),
    "CMES-2026-01.json": ("CMES", date(2026, 1, 2), date(2026, 1, 9)),
}
for filename, (name, start, end) in windows.items():
    bundle = generate_bundle("exchange:" + name, start, end, generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    (out / filename).write_bytes(canonical_bytes(bundle))
    print(filename, bundle["digest"])
EOF
```

Expected: three lines, one digest each.

In `$OD/calendar-core/tests/test_qualification.py`:

- Replace the module docstring's first line, `Every advertised calendar is qualified (review I6).`, with `The retained bundle fixtures state published facts (review I6); tests/test_snapshots.py qualifies the full set.`
- Add these three entries to `FACTS`:

```python
    "XPAR.json": {
        "2026-12-24": ("2026-12-24T08:00:00Z", "2026-12-24T13:05:00Z"),  # Euronext 14:05 CET Christmas Eve close
        "2026-12-25": "closed",
        "2026-12-31": ("2026-12-31T08:00:00Z", "2026-12-31T13:05:00Z"),  # and New Year's Eve
        "2027-01-01": "closed",
    },
    "XKRX.json": {
        "2026-12-25": "closed",
        "2026-12-31": "closed",  # KRX year-end closure
        "2027-01-04": ("2027-01-04T01:00:00Z", "2027-01-04T06:30:00Z"),  # the year's first session opens 10:00 KST
    },
    "CMES-2026-01.json": {
        "2026-01-04": "closed",  # a Sunday is no session label ...
        "2026-01-05": ("2026-01-04T23:00:00Z", "2026-01-05T23:00:00Z"),  # ... Monday's session opens Sunday 17:00 CT
    },
```

- Replace `test_every_advertised_calendar_has_a_fixture_with_facts` with:

```python
def test_every_fixture_is_a_served_calendar_and_the_first_nine_keep_theirs():
    covered = {load(filename)["calendarId"] for filename in FACTS}
    assert covered <= {"exchange:" + name for name in CALENDARS}
    nine = ("XNYS", "XLON", "XHKG", "XTKS", "XASX", "XTAE", "XTSE", "XETR", "XTAI")
    assert {"exchange:" + name for name in nine} <= covered
```

- [ ] **Step 7: Run the provider tests**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"`
Expected: every test passes. The 71-way parametrized bounds test takes roughly half a minute.

- [ ] **Step 8: Format, lint and commit**

```bash
python3 -m ruff format --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_catalogue.py"   # still byte-identical
git -C "$OD" branch --show-current
git -C "$OD" add calendar-core v4/routes/openbq_routes/calendar_v1.py v4/routes/tests/test_calendar_v1.py
git -C "$OD" commit -m "feat(v4): serve every catalogue calendar; library names as calendar ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 [openbq-docker]: Snapshot fixtures for all 71, and the hand checks

**Files:**
- Modify: `$OD/calendar-core/openbq_calendar/catalogue.py` (add `SNAPSHOT_YEAR`, `snapshot_path`, `snapshot_bytes` and the `snapshots` command)
- Create (generated): `$OD/calendar-core/tests/snapshots/*.json` (71 files)
- Create: `$OD/calendar-core/tests/test_snapshots.py`

**Interfaces:**
- Consumes: `registry.CALENDARS`, `supplier.generate_bundle`, `canonical.canonical_bytes`, `catalogue.PATH`.
- Produces:
  - `catalogue.snapshot_path(directory, name) -> Path` (`/` becomes `-`, so `24/7` → `24-7.json`);
  - `catalogue.snapshot_bytes(name) -> bytes`, a canonical JSON object `{"calendarId", "catalogueDigest", "evidence", "sessions", "year"}`. Each entry in `sessions` is `[date, openUTC, closeUTC, breakStartUTC|null, breakEndUTC|null]`.

- [ ] **Step 1: Write the failing snapshot and hand-check tests**

Create `$OD/calendar-core/tests/test_snapshots.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Qualification of the full set (spec "Qualification").

Every calendar has a generated snapshot of its 2026 sessions, tied to the catalogue it came from, with evidence
library_baseline: it pins the library's output against drift. The major exchanges also carry facts checked by hand
against their own published 2026 calendars. Each fact names its source. Where an exchange and the library disagree, the
fact is not edited to match: the disagreement is reported (see the plan's "Library disagreements").
"""

import json
from pathlib import Path

import pytest

from openbq_calendar.catalogue import snapshot_bytes, snapshot_path
from openbq_calendar.registry import CALENDARS

SNAPSHOTS = Path(__file__).parent / "snapshots"


@pytest.mark.parametrize("name", CALENDARS)
def test_the_snapshot_matches(name):
    assert json.loads(snapshot_bytes(name)) == json.loads(snapshot_path(SNAPSHOTS, name).read_bytes())


def test_one_snapshot_per_calendar_and_nothing_else():
    expected = sorted(snapshot_path(SNAPSHOTS, name).name for name in CALENDARS)
    assert sorted(p.name for p in SNAPSHOTS.glob("*.json")) == expected


def test_every_snapshot_is_library_baseline():
    for name in CALENDARS:
        assert json.loads(snapshot_path(SNAPSHOTS, name).read_bytes())["evidence"] == ["library_baseline"], name


# mic -> {date: "closed" | (open UTC, close UTC) | (open, close, break start, break end)}
SPOT = {
    # Euronext 2026 trading calendar: Good Friday, Easter Monday; 14:05 CET close on Christmas Eve.
    "XPAR": {"2026-04-03": "closed", "2026-04-06": "closed", "2026-12-24": ("2026-12-24T08:00:00Z", "2026-12-24T13:05:00Z")},
    # Deutsche Börse Xetra 2026 trading calendar: Good Friday, Labour Day closed; Whit Monday trades 09:00-17:30 CEST.
    "XETR": {"2026-04-03": "closed", "2026-05-01": "closed", "2026-05-25": ("2026-05-25T07:00:00Z", "2026-05-25T15:30:00Z")},
    # SIX Swiss Exchange 2026 trading calendar: Berchtoldstag, Ascension, Whit Monday.
    "XSWX": {"2026-01-02": "closed", "2026-05-14": "closed", "2026-05-25": "closed"},
    # SSE 2026 holiday notice: Spring Festival closure Feb 16-23, National Day Oct 1-7; SSE trading rules: 09:30-11:30 and
    # 13:00-15:00 CST.
    "XSHG": {
        "2026-02-16": "closed",
        "2026-02-23": "closed",
        "2026-02-24": ("2026-02-24T01:30:00Z", "2026-02-24T07:00:00Z", "2026-02-24T03:30:00Z", "2026-02-24T05:00:00Z"),
        "2026-10-01": "closed",
        "2026-10-08": ("2026-10-08T01:30:00Z", "2026-10-08T07:00:00Z", "2026-10-08T03:30:00Z", "2026-10-08T05:00:00Z"),
    },
    # KRX 2026 market holidays: the year's first session opens 10:00 KST; Seollal; Chuseok; year-end closure.
    "XKRX": {
        "2026-01-02": ("2026-01-02T01:00:00Z", "2026-01-02T06:30:00Z"),
        "2026-02-17": "closed",
        "2026-09-25": "closed",
        "2026-12-31": "closed",
    },
    # BSE 2026 trading holidays: Republic Day, Gandhi Jayanti; regular session 09:15-15:30 IST.
    "XBOM": {"2026-01-26": "closed", "2026-10-02": "closed", "2026-01-05": ("2026-01-05T03:45:00Z", "2026-01-05T10:00:00Z")},
    # SGX 2026 trading calendar: Chinese New Year (two days), National Day observed on the Monday.
    "XSES": {"2026-02-17": "closed", "2026-02-18": "closed", "2026-08-10": "closed"},
    # B3 2026 calendar: Carnival Monday and Tuesday, Tiradentes, Corpus Christi.
    "BVMF": {"2026-02-16": "closed", "2026-02-17": "closed", "2026-04-21": "closed", "2026-06-04": "closed"},
    # BMV 2026 calendar: Constitution Day, Juárez's birthday, Revolution Day (each a Monday observance).
    "XMEX": {"2026-02-02": "closed", "2026-03-16": "closed", "2026-11-16": "closed"},
    # JSE 2026 public holidays: Freedom Day, Youth Day, Women's Day observed on the Monday.
    "XJSE": {"2026-04-27": "closed", "2026-06-16": "closed", "2026-08-10": "closed"},
    # ASX 2026 trading calendar: Australia Day, King's Birthday; Anzac Day falls on a Saturday with no Monday holiday,
    # so 2026-04-27 trades 10:00-16:00 AEST.
    "XASX": {"2026-01-26": "closed", "2026-06-08": "closed", "2026-04-27": ("2026-04-27T00:00:00Z", "2026-04-27T06:00:00Z")},
    # CME Globex: the week opens Sunday 17:00 CT (CST in January, CDT after 2026-03-08); Christmas closed. The close is
    # the library's 17:00 convention with no maintenance break, which the spec adopts.
    "CMES": {
        "2026-01-05": ("2026-01-04T23:00:00Z", "2026-01-05T23:00:00Z"),
        "2026-03-09": ("2026-03-08T22:00:00Z", "2026-03-09T22:00:00Z"),
        "2026-12-25": "closed",
    },
}


@pytest.mark.parametrize("mic", sorted(SPOT))
def test_hand_checked_facts(mic):
    sessions = {row[0]: tuple(row[1:]) for row in json.loads(snapshot_path(SNAPSHOTS, mic).read_bytes())["sessions"]}
    for day, expected in SPOT[mic].items():
        if expected == "closed":
            assert day not in sessions, day
        else:
            assert sessions.get(day, ())[: len(expected)] == expected, day
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_snapshots.py"`
Expected: collection error, `ImportError: cannot import name 'snapshot_bytes'`.

- [ ] **Step 3: Add the snapshot builder to the generator**

In `$OD/calendar-core/openbq_calendar/catalogue.py`:

Add these imports (keep them sorted with the existing ones):

```python
import sys
from datetime import date, datetime, timezone
from hashlib import sha256

from .canonical import canonical_bytes
```

(Replace the existing `from datetime import date` line with the `datetime` line above.)

Add after `WEEKDAYS`:

```python
SNAPSHOT_YEAR = 2026
```

Add before `if __name__ == "__main__":`:

```python
def snapshot_path(directory, name):
    """Where a calendar's snapshot lives: its name, with the `/` of 24/5 and 24/7 as `-`."""
    return Path(directory) / (name.replace("/", "-") + ".json")


def snapshot_bytes(name):
    """One calendar's SNAPSHOT_YEAR sessions as the bundle route serves them, tied to the catalogue they came from."""
    from .supplier import generate_bundle  # the supplier reads the registry, which reads the checked-in catalogue

    bundle = generate_bundle(
        "exchange:" + name,
        date(SNAPSHOT_YEAR, 1, 1),
        date(SNAPSHOT_YEAR, 12, 31),
        generated_at=datetime(SNAPSHOT_YEAR, 1, 1, tzinfo=timezone.utc),
    )
    sessions = []
    for day in bundle["days"]:
        if day["state"] != "open":
            continue
        segments = day["segments"]
        lunch = [segments[0]["end"], segments[1]["start"]] if len(segments) == 2 else [None, None]
        sessions.append([day["date"], day["open"], day["close"], *lunch])
    return canonical_bytes(
        {
            "calendarId": bundle["calendarId"],
            "catalogueDigest": sha256(PATH.read_bytes()).hexdigest(),
            "evidence": sorted({day["evidenceStatus"] for day in bundle["days"]}),
            "sessions": sessions,
            "year": SNAPSHOT_YEAR,
        }
    )
```

Replace the `__main__` block with:

```python
if __name__ == "__main__":
    if sys.argv[1:2] == ["snapshots"]:
        from .registry import CALENDARS

        for name in CALENDARS:
            target = snapshot_path(sys.argv[2], name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(snapshot_bytes(name))
    else:
        PATH.write_bytes(build_catalogue())
```

Replace the module docstring with:

```python
"""calendar-catalogue.json: one entry per exchange_calendars calendar (spec "One catalogue, generated by the provider").

`python3 -m openbq_calendar.catalogue` rewrites the checked-in file. tests/test_catalogue.py fails when the file differs
from what build_catalogue() makes now, so a library upgrade that moves a calendar's coverage or hours is a reviewable
diff, never a silent change. `python3 -m openbq_calendar.catalogue snapshots DIR` writes the per-calendar
SNAPSHOT_YEAR fixtures that tests/test_snapshots.py checks.
"""
```

- [ ] **Step 4: Generate the snapshots**

```bash
PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.catalogue snapshots "$OD/calendar-core/tests/snapshots"
ls "$OD/calendar-core/tests/snapshots" | wc -l
du -sh "$OD/calendar-core/tests/snapshots"
```

Expected: `71`, and about 2 MB.

- [ ] **Step 5: Check the hand facts against the exchanges' own pages**

The facts in `SPOT` were chosen from the plan author's knowledge on 2026-10-24, and the library agrees with every one. Open each exchange's published 2026 holiday or trading calendar named in its comment and confirm each date. If an exchange's page contradicts a fact, do not edit the fact to match the library. Stop and report the date, the page and the library's value.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests"`
Expected: every test passes (the 71 snapshot tests plus 12 hand-check tests are new).

- [ ] **Step 7: Format, lint, check public, commit**

```bash
python3 -m ruff format --line-length 120 "$OD/calendar-core/openbq_calendar/catalogue.py" "$OD/calendar-core/tests/test_snapshots.py"
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core"
PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_catalogue.py"
(cd "$OD" && python3 scripts/check-public.py)
git -C "$OD" branch --show-current
git -C "$OD" add calendar-core/openbq_calendar/catalogue.py calendar-core/tests/test_snapshots.py calendar-core/tests/snapshots
git -C "$OD" commit -m "test(v4): snapshot all 71 calendars; hand-check twelve exchanges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 [bdobb]: Vendor the catalogue; the client catalogue module; library names as ids

**Files:**
- Modify (vendored): `$BDOBB/src/lib/calendars/vendor/` (adds `calendar-catalogue.json` and `conformance/{XPAR,XKRX,CMES-2026-01}.json`; updates `calendar-v1.schema.json` and `manifest.json`)
- Create: `$BDOBB/src/lib/calendars/catalogue.ts`
- Create: `$BDOBB/src/lib/calendars/catalogue.test.ts`
- Modify: `$BDOBB/src/lib/calendars/contracts.ts:185` (`parseBinding` id pattern)
- Modify: `$BDOBB/src/lib/calendars/contracts.test.ts`

**Interfaces:**
- Consumes: the provider head after Task 3, through `python3 -m openbq_calendar.artifact` and `scripts/vendor-calendar-contract.mjs`.
- Produces (`src/lib/calendars/catalogue.ts`):

```ts
export type CatalogueEntry = {
  calendarId: string; mic: string; name: string; timezone: string; open: string; close: string;
  break: { start: string; end: string } | null; overnight: boolean; bounds: { start: string; end: string };
  aliases: string[]; suffixes: { eodhd: string[]; yahoo: string[] }; workingDays: Weekday[];
};
export const CATALOGUE: readonly CatalogueEntry[];
export const UNMAPPED_SUFFIXES: Readonly<Record<string, string>>;
export function calendarEntry(mic: string): CatalogueEntry | undefined;        // exact spelling
export function canonicalCalendar(name: string): string | undefined;          // case-insensitive, trimmed; no aliases
export function isOvernight(mic: string): boolean;                             // exact spelling
```

- [ ] **Step 1: Vendor the contract**

```bash
rm -rf "$SCRATCH/calendar-contract"
PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.artifact "$SCRATCH/calendar-contract"
node "$BDOBB/scripts/vendor-calendar-contract.mjs" "$SCRATCH/calendar-contract"
git -C "$BDOBB" status --short src/lib/calendars/vendor
```

Expected:
- `calendar-catalogue.json` and the three new `conformance/` files are untracked;
- `calendar-v1.schema.json` (the widened `calendarId` pattern) and `manifest.json` are modified;
- `settlement-notes.json`, `legacy-v1.json` and the nine existing fixtures are unchanged.

- [ ] **Step 2: Write the failing client tests**

Create `$BDOBB/src/lib/calendars/catalogue.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CATALOGUE, UNMAPPED_SUFFIXES, calendarEntry, canonicalCalendar, isOvernight } from "./catalogue";

describe("the vendored catalogue", () => {
  it("holds every exchange_calendars calendar, once", () => {
    expect(CATALOGUE).toHaveLength(71);
    expect(new Set(CATALOGUE.map((e) => e.mic)).size).toBe(71);
    expect(CATALOGUE.every((e) => e.calendarId === `exchange:${e.mic}`)).toBe(true);
  });

  it("names zones the runtime can use", () => {
    for (const e of CATALOGUE) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: e.timezone }), e.mic).not.toThrow();
  });

  it("marks exactly the five overnight calendars", () => {
    expect(CATALOGUE.filter((e) => e.overnight).map((e) => e.mic)).toEqual(["24/5", "24/7", "CMES", "IEPA", "us_futures"]);
    expect(isOvernight("CMES")).toBe(true);
    expect(isOvernight("XNYS")).toBe(false);
    expect(isOvernight("XNAS")).toBe(false);
  });

  it("finds a calendar by its own name, case-insensitively, and never by an alias (ruling RF3)", () => {
    expect(canonicalCalendar("us_futures")).toBe("us_futures");
    expect(canonicalCalendar("US_FUTURES")).toBe("us_futures");
    expect(canonicalCalendar(" xpar ")).toBe("XPAR");
    expect(canonicalCalendar("24/7")).toBe("24/7");
    for (const name of ["NYSE", "XNAS", "constructor", ""]) expect(canonicalCalendar(name), name).toBeUndefined();
    expect(calendarEntry("XSES")?.bounds).toEqual({ start: "1990-01-01", end: "2026-12-31" });
    expect(calendarEntry("xses")).toBeUndefined();
  });

  it("records the suffixes it drops", () => {
    expect(UNMAPPED_SUFFIXES.NX).toMatch(/Euronext/);
  });
});
```

Append to `$BDOBB/src/lib/calendars/contracts.test.ts` (and add `parseBinding` to its `./contracts` import):

```ts
it("accepts the library's own calendar names as ids, and nothing looser", () => {
  for (const id of ["exchange:24/7", "exchange:us_futures", "exchange:XPAR"]) {
    expect(parseBinding({ schemaVersion: 1, kind: "single", calendarId: id }).calendarId).toBe(id);
  }
  for (const id of ["exchange:", "exchange:A B", "exchange:XNYS?x=1"]) {
    expect(() => parseBinding({ schemaVersion: 1, kind: "single", calendarId: id })).toThrow("INVALID_BINDING");
  }
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars/catalogue.test.ts src/lib/calendars/contracts.test.ts`
Expected: FAIL. `./catalogue` does not exist, and `exchange:24/7` throws `INVALID_BINDING`.

- [ ] **Step 4: Write the catalogue module and widen the binding pattern**

Create `$BDOBB/src/lib/calendars/catalogue.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import type { Weekday } from "../calendar";
import data from "./vendor/calendar-catalogue.json";

/**
 * One exchange_calendars calendar as openbq-docker's generated catalogue describes it (spec "One catalogue, generated
 * by the provider", 2026-10-24). Vendored with the contract and pinned by the pairing; never fetched at runtime. Times
 * are local `HH:MM:SS`; `bounds` are the first and last dates served; suffixes are upper case, without the dot.
 */
export type CatalogueEntry = {
  calendarId: string;
  mic: string;
  name: string;
  timezone: string;
  open: string;
  close: string;
  break: { start: string; end: string } | null;
  overnight: boolean;
  bounds: { start: string; end: string };
  aliases: string[];
  suffixes: { eodhd: string[]; yahoo: string[] };
  workingDays: Weekday[];
};

/** Every calendar the provider serves, in the catalogue's (the library's) order. */
export const CATALOGUE: readonly CatalogueEntry[] = data.calendars as unknown as CatalogueEntry[];

/** Suffixes deliberately mapped to no calendar, each with why: a symbol carrying one infers nothing. */
export const UNMAPPED_SUFFIXES: Readonly<Record<string, string>> = data.unmappedSuffixes;

const byMic = new Map(CATALOGUE.map((e) => [e.mic, e]));
const byUpper = new Map(CATALOGUE.map((e) => [e.mic.toUpperCase(), e.mic]));

/** A calendar's entry by its exact name (`XPAR`, `us_futures`), or undefined. */
export function calendarEntry(mic: string): CatalogueEntry | undefined {
  return byMic.get(mic);
}

/**
 * The catalogue's own spelling of a calendar name typed in any case, trimmed (ruling P14), or undefined. An alias
 * (`NYSE`, `XNAS`) is not a calendar here: the catalogue lists aliases for reference only (ruling RF3).
 */
export function canonicalCalendar(name: string): string | undefined {
  return byUpper.get(name.trim().toUpperCase());
}

/** One of the five calendars whose sessions cross local midnight: they resolve only from provider bundles. */
export function isOvernight(mic: string): boolean {
  return byMic.get(mic)?.overnight === true;
}
```

In `$BDOBB/src/lib/calendars/contracts.ts`, replace

```ts
    ids.some((id) => typeof id !== "string" || !/^(exchange|payment|settlement):[A-Z0-9_-]+$/.test(id))
```

with

```ts
    // The library's own names include 24/5, 24/7 and us_futures (2026-10-24), as the vendored schema now does.
    ids.some((id) => typeof id !== "string" || !/^(exchange|payment|settlement):[A-Za-z0-9_/-]+$/.test(id))
```

- [ ] **Step 5: Run the tests and the type check**

```bash
pnpm -C "$BDOBB" exec vitest run src/lib/calendars
pnpm -C "$BDOBB" typecheck
node --test "$BDOBB/scripts/vendor-calendar-contract.test.mjs"
```

Expected: all pass; the type check exits 0.

- [ ] **Step 6: Commit**

```bash
git -C "$BDOBB" branch --show-current
git -C "$BDOBB" add src/lib/calendars/vendor src/lib/calendars/catalogue.ts src/lib/calendars/catalogue.test.ts src/lib/calendars/contracts.ts src/lib/calendars/contracts.test.ts
git -C "$BDOBB" commit -m "feat(v4): vendor the calendar catalogue; library names as calendar ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 [bdobb]: Derive the known set, hours, suffixes, window clamp and stored exchange from the catalogue

**Files:**
- Modify: `$BDOBB/src/lib/calendar.ts`. This touches `ExchangeHours`, `EXCHANGE_HOURS`, the `isKnownCalendar` doc, `parseExchange`, `SYMBOL_CALENDARS`, `symbolCalendar` and `weekdayCalendar`. `DASHBOARD_EXCHANGES` stays until Task 7.
- Modify: `$BDOBB/src/lib/calendars/window.ts` (`FLOOR`, `CEILING`, `EARLIEST`, `calendarWindow`)
- Modify: `$BDOBB/src/lib/dateExpressions.ts` (`parseAtom`, and the `CAL` comment)
- Modify (comments only): `$BDOBB/src/lib/dashboardsFile.ts:108`, `$BDOBB/src/lib/appsJson.ts:805`
- Modify tests: `$BDOBB/src/lib/calendar.test.ts`, `$BDOBB/src/lib/calendars/bundles.test.ts`, `$BDOBB/src/lib/dateExpressions.test.ts`, `$BDOBB/src/lib/dashboardsFile.test.ts`

**Interfaces:**
- Consumes: `CATALOGUE`, `calendarEntry`, `canonicalCalendar` (Task 4).
- Produces:
  - `ExchangeHours` gains `workingDays: Weekday[]`.
  - `EXCHANGE_HOURS` holds all 71.
  - `isKnownCalendar(mic)` is true for exactly the catalogue's names.
  - `parseExchange(value)` returns a catalogue name, any other non-empty string of 32 characters or fewer kept as written, or `undefined`.
  - `symbolCalendar` reads the catalogue's suffixes.
  - `calendarWindow(calendarId, window)` clamps both ends into the catalogue bounds.
  - `parseExpression` stores `atom.calendar` in the catalogue's spelling when the name is known; any other name is upper-cased.

- [ ] **Step 1: Write the failing tests**

In `$BDOBB/src/lib/calendar.test.ts`:

- Drop `DASHBOARD_EXCHANGES` from the import list, and add `import { CATALOGUE, UNMAPPED_SUFFIXES } from "./calendars/catalogue";`.
- Replace the test `it("names hours and a zone for the nine calendars", …)` with:

```ts
  it("names hours, a zone and a trading week for every catalogue calendar", () => {
    expect(Object.keys(EXCHANGE_HOURS)).toEqual(CATALOGUE.map((e) => e.mic));
    expect(weekdayCalendar("XASX")).toMatchObject({ timezone: "Australia/Sydney", session: { open: "10:00:00", close: "16:00:00" } });
    expect(weekdayCalendar("XTAE")).toMatchObject({ timezone: "Asia/Tel_Aviv", session: { open: "09:59:00", close: "17:15:00" } });
    expect(weekdayCalendar("XPAR")).toMatchObject({ timezone: "Europe/Paris", session: { open: "09:00:00", close: "17:30:00" } });
    expect(weekdayCalendar("XSAU").session.workingDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Sun"]);
    const london = weekdayCalendar("XLON");
    expect(london).toMatchObject({ code: "XLON", timezone: "Europe/London", source: "weekdays", years: [], holidays: {} });
    expect(london.session).toEqual({ open: "08:00:00", close: "16:30:00", workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
  });
```

- Replace the `describe("the dashboard's exchange (v5.4.0)", …)` block with:

```ts
describe("the dashboard's exchange (2026-10-24)", () => {
  it("reads any catalogue calendar in its own spelling, and keeps any other name for repair", () => {
    for (const mic of ["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG", "XPAR", "CMES", "24/7", "us_futures"]) {
      expect(parseExchange(mic)).toBe(mic);
    }
    expect(parseExchange(" xlon ")).toBe("XLON");
    expect(parseExchange("US_FUTURES")).toBe("us_futures");
    expect(parseExchange("XNAS")).toBe("XNAS");
    expect(parseExchange("US")).toBe("US");
    for (const v of [7, null, "", "  ", "X".repeat(33)]) expect(parseExchange(v), String(v)).toBeUndefined();
  });
});
```

- In `describe("symbol calendars (spec table)", …)`, add:

```ts
  it("maps every catalogue suffix to its calendar", () => {
    for (const e of CATALOGUE) {
      for (const s of [...e.suffixes.eodhd, ...e.suffixes.yahoo]) expect(symbolCalendar(`X.${s.toLowerCase()}`), s).toBe(e.mic);
    }
    const cases: Record<string, string> = {
      "MC.PA": "XPAR", "ASML.AS": "XAMS", "NESN.SW": "XSWX", "005930.KS": "XKRX", "005930.KO": "XKRX", "035720.KQ": "XKRX",
      "600519.SS": "XSHG", "600519.SHG": "XSHG", "500325.BO": "XBOM", "D05.SI": "XSES", "PETR4.SA": "BVMF",
      "WALMEX.MX": "XMEX", "NPN.JO": "XJSE", "ES.CME": "CMES", "BMW.SG": "XSTU",
    };
    for (const [symbol, mic] of Object.entries(cases)) expect(symbolCalendar(symbol), symbol).toBe(mic);
  });

  it("infers nothing for a dropped or ambiguous suffix", () => {
    for (const s of Object.keys(UNMAPPED_SUFFIXES)) expect(symbolCalendar(`X.${s}`), s).toBeUndefined();
    for (const s of ["AIR.NX", "000001.SZ", "RELIANCE.NS", "6488.TWO"]) expect(symbolCalendar(s), s).toBeUndefined();
  });
```

- Replace `it("keeps the dashboard menu and a stored exchange at six MICs", …)` with:

```ts
  it("knows exactly the catalogue's calendars; an alias stays unknown (ruling RF3)", () => {
    expect(isKnownCalendar("XASX")).toBe(true);
    expect(isKnownCalendar("us_futures")).toBe(true);
    expect(isKnownCalendar("US_FUTURES")).toBe(false);
    expect(isKnownCalendar("XNAS")).toBe(false);
  });
```

In `$BDOBB/src/lib/calendars/bundles.test.ts`, import `calendarWindow` from `./window` and add:

```ts
describe("the catalogue's bounds (2026-10-24, review focus 1)", () => {
  it("clamps both ends into a calendar's served dates, never past them", () => {
    expect(calendarWindow("exchange:XSHG", { start: "1989-01-01", end: "1992-12-31" })).toEqual({ start: "1990-12-03", end: "1992-12-31" });
    expect(calendarWindow("exchange:XSES", { start: "2025-01-01", end: "2029-12-31" })).toEqual({ start: "2025-01-01", end: "2026-12-31" });
    expect(calendarWindow("exchange:XSES", { start: "2029-01-01", end: "2033-12-31" })).toEqual({ start: "2026-12-31", end: "2026-12-31" });
    expect(calendarWindow("exchange:XTAI", { start: "1993-01-01", end: "1997-12-31" })).toEqual({ start: "2019-01-01", end: "2019-01-01" });
    expect(calendarWindow("payment:T2", { start: "1980-01-01", end: "2050-12-31" })).toEqual({ start: "1990-01-01", end: "2040-12-31" });
  });
});
```

In `$BDOBB/src/lib/dateExpressions.test.ts`, inside the describe holding `it("parses every example in the spec", …)`, add:

```ts
  it("keeps a catalogue calendar's own spelling, in any case, and upper-cases anything else (review focus 2)", () => {
    expect(parseExpression("T-1bd(us_futures)")?.start.calendar).toBe("us_futures");
    expect(parseExpression("T-1bd(US_FUTURES)")?.start.calendar).toBe("us_futures");
    expect(parseExpression("T(24/7)")?.start.calendar).toBe("24/7");
    expect(parseExpression("t-1bd ( xpar )")?.start.calendar).toBe("XPAR");
    expect(parseExpression("T(nyse)")?.start.calendar).toBe("NYSE");
    expect(stringifyExpression(parseExpression("T@open(cmes)")!)).toBe("T@open(CMES)");
  });
```

In `$BDOBB/src/lib/dashboardsFile.test.ts`, replace the test `it("reads one of the six MICs and drops anything else", …)` with:

```ts
    it("loads a stored six-MIC exchange unchanged, any catalogue calendar, and keeps another name for repair", async () => {
      const six = ["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG"];
      six.forEach((mic, i) => __seed(`dashboards/s${i}.json`, JSON.stringify({ id: `s${i}`, name: mic, tabs: [], exchange: mic })));
      __seed("dashboards/x.json", JSON.stringify({ id: "x", name: "X", tabs: [], exchange: "XPAR" }));
      __seed("dashboards/y.json", JSON.stringify({ id: "y", name: "Y", tabs: [], exchange: "US" }));
      __seed("dashboards/z.json", JSON.stringify({ id: "z", name: "Z", tabs: [], exchange: 7 }));
      const byId = Object.fromEntries((await loadDashboards()).map((d) => [d.id, d.exchange]));
      six.forEach((mic, i) => expect(byId[`s${i}`]).toBe(mic));
      expect(byId.x).toBe("XPAR");
      expect(byId.y).toBe("US");
      expect(byId.z).toBeUndefined();
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendar.test.ts src/lib/calendars/bundles.test.ts src/lib/dateExpressions.test.ts src/lib/dashboardsFile.test.ts`
Expected: FAIL. `EXCHANGE_HOURS` has 9 keys, `parseExchange("XPAR")` is undefined, `symbolCalendar("MC.PA")` is undefined, XSES is not clamped, and `(us_futures)` parses as `US_FUTURES`.

- [ ] **Step 3: Derive the tables in `calendar.ts`**

In `$BDOBB/src/lib/calendar.ts`, add `import { CATALOGUE, canonicalCalendar } from "./calendars/catalogue";` after the `./calendars/operations` import.

Replace from `export type ExchangeHours = …` through the end of `isKnownCalendar` with:

```ts
export type ExchangeHours = { name: string; timezone: string; open: string; close: string; workingDays: Weekday[] };

/**
 * Every calendar openbq-docker serves (spec 2026-10-24: the full exchange_calendars set), with its regular hours, zone
 * and trading week, from the vendored catalogue. The weekday fallback is built from this. A name outside it is unknown:
 * refused at resolution, never run on XNYS hours.
 */
export const EXCHANGE_HOURS: Record<string, ExchangeHours> = Object.fromEntries(
  CATALOGUE.map((e) => [e.mic, { name: e.name, timezone: e.timezone, open: e.open, close: e.close, workingDays: e.workingDays }]),
);

/** A catalogue calendar, in its own spelling. `Object.hasOwn`, not `in`, so `constructor` is no calendar. */
export const isKnownCalendar = (mic: string): boolean => Object.hasOwn(EXCHANGE_HOURS, mic);
```

Replace `parseExchange` and its doc comment with:

```ts
/**
 * A dashboard's stored exchange, read leniently (spec "Dashboard Exchange menu"): a catalogue calendar in its own
 * spelling; any other short name kept as written, so the menu shows it and its cards say "Unknown calendar" until it is
 * repaired; anything else, nothing.
 */
export function parseExchange(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (name === "" || name.length > 32) return undefined;
  return canonicalCalendar(name) ?? name;
}
```

Replace the `SYMBOL_CALENDARS` constant and its comment with:

```ts
/** Symbol suffix -> calendar, EODHD and Yahoo spellings, from the catalogue (spec "Symbol suffixes"). */
const SYMBOL_CALENDARS = new Map(
  CATALOGUE.flatMap((e) => [...e.suffixes.eodhd, ...e.suffixes.yahoo].map((s) => [s, e.mic] as const)),
);
```

In `symbolCalendar`, replace

```ts
  return Object.hasOwn(SYMBOL_CALENDARS, suffix) ? SYMBOL_CALENDARS[suffix] : undefined;
```

with

```ts
  return SYMBOL_CALENDARS.get(suffix);
```

In `weekdayCalendar`:
- Replace the comment `// Spec: a MIC outside the nine is unknown and never runs on New York's hours.` with `// Spec: a name outside the catalogue is unknown and never runs on New York's hours.`
- Replace `session: { open: hours.open, close: hours.close, workingDays: [...MON_TO_FRI] },` with `session: { open: hours.open, close: hours.close, workingDays: [...hours.workingDays] },`.

- [ ] **Step 4: Clamp windows to the catalogue's bounds**

In `$BDOBB/src/lib/calendars/window.ts`, add `import { calendarEntry } from "./catalogue";` after the `./contracts` import, and replace everything from `// The days openbq-docker's registry.bounds() answers` to the end of the file with:

```ts
// What openbq-docker serves a binding outside the catalogue (a payment or settlement calendar): its route window.
const FLOOR = "1990-01-01";
const CEILING = "2040-12-31";

/**
 * `window` for one calendar, clamped into the dates the catalogue says it is served for (P11, R10b; 2026-10-24: XSHG
 * from 1990-12-03, XSES to 2026-12-31). Asking outside them is refused by openbq-docker, which would fail the whole card.
 * Both ends are clamped, so a window wholly past the bounds asks for the nearest served day and the atom that reaches
 * past it shows its own COVERAGE_UNAVAILABLE (review focus 1).
 */
export function calendarWindow(calendarId: string, window: BundleWindow): BundleWindow {
  const served = calendarId.startsWith("exchange:") ? calendarEntry(calendarId.slice("exchange:".length))?.bounds : undefined;
  const lo = served?.start ?? FLOOR;
  const hi = served?.end ?? CEILING;
  const clamp = (day: string) => (day < lo ? lo : day > hi ? hi : day);
  return { start: clamp(window.start), end: clamp(window.end) };
}
```

- [ ] **Step 5: Keep a catalogue calendar's spelling in the parser**

In `$BDOBB/src/lib/dateExpressions.ts`, add `import { canonicalCalendar } from "./calendars/catalogue";` with the other imports.

In `parseAtom`, replace

```ts
  return { ...core, ...(at ? { at } : {}), ...(cal ? { calendar: cal[1].toUpperCase() } : {}) };
```

with

```ts
  // A catalogue calendar keeps its own spelling (`us_futures`, `24/7`) in any case (ruling P14); anything else is
  // upper-cased for the resolver's "Unknown calendar" message.
  const calendar = cal ? (canonicalCalendar(cal[1]) ?? cal[1].toUpperCase()) : undefined;
  return { ...core, ...(at ? { at } : {}), ...(calendar ? { calendar } : {}) };
```

In the comment above `const CAL`, replace `Whatever is between the\n// parentheses is kept for the resolver to judge, upper-cased` with `Whatever is between the\n// parentheses is kept for the resolver to judge, in the catalogue's spelling when it names a calendar, else upper-cased`. Keep the rest of that comment.

- [ ] **Step 6: Update the two stale comments**

In `$BDOBB/src/lib/dashboardsFile.ts`, replace `// v5.4.0: lenient like presets — one of the six MICs, or nothing.` with `// Lenient like presets: a catalogue calendar, or another name kept for repair (2026-10-24).`

In `$BDOBB/src/lib/appsJson.ts`, replace `// Read leniently, like the dashboards file: one of the six MICs or nothing.` with `// Read leniently, like the dashboards file: a catalogue calendar, or another name kept for repair.`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendar.test.ts src/lib/calendars src/lib/dateExpressions.test.ts src/lib/dashboardsFile.test.ts src/lib/appsJson.test.ts src/lib/calendarQualifier.test.ts`
Expected: all pass. (`calendarQualifier.test.ts`'s "outside the nine" test still passes: XNAS stays unknown.)

- [ ] **Step 8: Type-check and commit**

```bash
pnpm -C "$BDOBB" typecheck
git -C "$BDOBB" branch --show-current
git -C "$BDOBB" add src/lib/calendar.ts src/lib/calendars/window.ts src/lib/dateExpressions.ts src/lib/dashboardsFile.ts src/lib/appsJson.ts src/lib/calendar.test.ts src/lib/calendars/bundles.test.ts src/lib/dateExpressions.test.ts src/lib/dashboardsFile.test.ts
git -C "$BDOBB" commit -m "feat(v4): derive calendars, hours, suffixes and bounds from the catalogue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 [bdobb]: Overnight calendars always resolve from bundles

**Files:**
- Modify: `$BDOBB/src/lib/dateExpressions.ts` (`atomCalendar`)
- Modify: `$BDOBB/src/hooks/useTradingCalendar.ts` (three `.filter(isKnownCalendar)` calls)
- Modify: `$BDOBB/src/lib/calendars/bundles.ts` (`bundleIdsOf` used by `peekWidgetCalendars` and `widgetMembers`)
- Modify: `$BDOBB/src/hooks/useBundleCalendars.ts` (`bound`, plus the new `withOvernight`)
- Modify: `$BDOBB/src/hooks/useCardRequest.ts:97`
- Modify: `$BDOBB/src/components/renderers/ManagedSourceForm.tsx:52`
- Modify tests: `$BDOBB/src/lib/calendarQualifier.test.ts`, `$BDOBB/src/hooks/useBundleCalendars.test.tsx`, `$BDOBB/src/hooks/useTradingCalendar.test.tsx`

**Interfaces:**
- Consumes: `isOvernight` (Task 4); the vendored `conformance/{XPAR,XKRX,CMES-2026-01}.json` (Task 4); `TradingCalendars` (useTradingCalendar.ts).
- Produces:
  - `withOvernight(legacy: TradingCalendars, overnight: TradingCalendars): TradingCalendars`, exported from `useBundleCalendars.ts`.
  - `useBundleCalendars` now serves every card: an opted-in card gets all its calendars, and any other card gets only its overnight ones.
  - On a card with no overnight calendar, `withOvernight` returns `legacy` itself.

- [ ] **Step 1: Write the failing resolver tests**

In `$BDOBB/src/lib/calendarQualifier.test.ts`, add these imports:

```ts
import cmes from "./calendars/vendor/conformance/CMES-2026-01.json";
import xkrx from "./calendars/vendor/conformance/XKRX.json";
import xpar from "./calendars/vendor/conformance/XPAR.json";
```

and append:

```ts
describe("the full calendar set (2026-10-24)", () => {
  const set = {
    XPAR: bundleCalendar([xpar as CalendarBundle], single("XPAR"), "operational-v1"),
    XKRX: bundleCalendar([xkrx as CalendarBundle], single("XKRX"), "operational-v1"),
    CMES: bundleCalendar([cmes as CalendarBundle], single("CMES"), "operational-v1"),
  };
  const monday = new Date("2026-01-05T15:00:00Z");

  it("resolves (XPAR) and (XKRX) on their own holidays and hours", () => {
    expect(resolveValue("date", "T-1bd(XPAR)", { now, zone: "UTC", calendars: set })).toBe("2026-12-28");
    expect(resolveValue("datetime", "T-2bd@close(XPAR)", { now, zone: "UTC", calendars: set })).toBe("2026-12-24T14:05:00+01:00");
    expect(resolveValue("date", "T+2bd(XKRX)", { now, zone: "UTC", calendars: set })).toBe("2027-01-04");
    expect(resolveValue("datetime", "T+2bd@open(xkrx)", { now, zone: "UTC", calendars: set })).toBe("2027-01-04T10:00:00+09:00");
  });

  it("opens CME's Monday session on Sunday evening, as exchange_calendars labels it", () => {
    expect(resolveValue("datetime", "T@open(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-04T17:00:00-06:00");
    expect(resolveValue("datetime", "T@close(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-05T17:00:00-06:00");
    expect(resolveValue("date", "trade_date(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-02");
    expect(resolveValue("date", "T-1bd(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-02");
    // Sunday 17:30 in Chicago: today is no session, so @open takes Monday's, which opened half an hour ago.
    const sunday = new Date("2026-01-04T23:30:00Z");
    expect(resolveValue("datetime", "T@open(CMES)", { now: sunday, zone: "UTC", calendars: set })).toBe("2026-01-04T17:00:00-06:00");
  });

  it("never works an overnight calendar out on weekdays, on a legacy card either (review focus 3)", () => {
    const legacy = widget({ exchange: "CMES", params: [{ paramName: "d", type: "date" }] });
    const errors: Record<string, string> = {};
    expect(wireParams(legacy, { d: "T-1bd" }, { now: monday, errors })).toEqual({ d: "" });
    expect(errors).toEqual({ d: "No CMES calendar loaded" });
    expect(() => sendParams(legacy, { d: "T-1bd(us_futures)" }, { now: monday })).toThrow("d: No us_futures calendar loaded");
    // Calendar-free: only the zone is read, so it still sends.
    expect(sendParams(legacy, { d: "T-7d" }, { now: monday }).d).toBe("2025-12-29");
  });
});
```

- [ ] **Step 2: Write the failing hook tests**

In `$BDOBB/src/hooks/useBundleCalendars.test.tsx`:
- add `import cmes from "../lib/calendars/vendor/conformance/CMES-2026-01.json";`;
- add `import { weekdayCalendar } from "../lib/calendar";`;
- add `sendParams` to the `../lib/params` import;
- change `import { useBundleCalendars } from "./useBundleCalendars";` to `import { useBundleCalendars, withOvernight } from "./useBundleCalendars";`;
- append:

```ts
const legacyCme = widget({ exchange: "CMES", params: [{ paramName: "d", type: "datetime" }] });
const monday = new Date("2026-01-05T15:00:00Z");

it("serves a legacy card's overnight calendar from the bundle route (spec: overnight calendars)", async () => {
  const server = await startMockServer({ [BUNDLE]: () => cmes });
  servers.push(server);
  const { result } = renderHook(() => useBundleCalendars(legacyCme, { d: "T@open" }, backend({ baseUrl: server.url }), undefined, monday));
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(1);
  expect(wireParams(legacyCme, { d: "T@open" }, { now: monday, calendars: result.current.calendars })).toEqual({
    d: "2026-01-04T17:00:00-06:00",
  });
});

it("shows a legacy overnight card's refused bundle as an error, never weekdays", async () => {
  const server = await startMockServer({
    [BUNDLE]: { __status: 422, __body: { error: { code: "CALENDAR_UNAVAILABLE", message: "refused" } } },
  });
  servers.push(server);
  const { result } = renderHook(() => useBundleCalendars(legacyCme, { d: "T@open" }, backend({ baseUrl: server.url }), undefined, monday));
  await waitFor(() => expect(result.current.calendars.CMES?.unavailable).toMatch(/^CMES calendar unavailable/));
  expect(() => sendParams(legacyCme, { d: "T@open" }, { now: monday, calendars: result.current.calendars })).toThrow(
    /CMES calendar unavailable/,
  );
});

it("asks nothing for a legacy card on an ordinary calendar, and leaves its calendars as they are", async () => {
  const server = await serve();
  const plain = widget({ exchange: "XLON", params: [{ paramName: "d", type: "date" }] });
  const { result } = renderHook(() => useBundleCalendars(plain, { d: "T-1bd" }, backend({ baseUrl: server.url }), undefined, now));
  expect(result.current).toMatchObject({ calendars: {}, pending: false });
  await new Promise((r) => setTimeout(r, 20));
  expect(server.requests).toHaveLength(0);
  const legacy = { calendars: { XLON: weekdayCalendar("XLON") }, pending: false, key: "k" };
  expect(withOvernight(legacy, result.current)).toBe(legacy);
});
```

In `$BDOBB/src/hooks/useTradingCalendar.test.tsx`, inside `describe("useTradingCalendar", …)`, add:

```ts
  it("never asks the per-year route for an overnight calendar: only bundles describe one (2026-10-24)", async () => {
    const { b, s } = await serve();
    const cme = makeWidget({ exchange: "CMES", params: [{ paramName: "d", type: "date" }] });
    const { result } = renderHook(() => useTradingCalendar(cme, { d: "T-1bd(XPAR)" }, b, undefined, NOW));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(calendarRequests(s).every((q) => q.startsWith("?exchange=XPAR&"))).toBe(true);
    expect(calendarRequests(s).length).toBeGreaterThan(0);
    expect(result.current.calendars.CMES).toBeUndefined();
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendarQualifier.test.ts src/hooks/useBundleCalendars.test.tsx src/hooks/useTradingCalendar.test.tsx`
Expected: FAIL.
- `T-1bd` on the legacy CMES widget resolves on weekdays to `2026-01-02` instead of erroring.
- `withOvernight` is not exported.
- The legacy CMES hook asks nothing.
- The per-year loader requests `exchange=CMES`.

- [ ] **Step 4: Refuse weekdays for an overnight calendar in the resolver**

In `$BDOBB/src/lib/dateExpressions.ts`, change the catalogue import to `import { canonicalCalendar, isOvernight } from "./calendars/catalogue";`, and in `atomCalendar` replace

```ts
  if (ctx.strict && needsCalendar(atom)) throw new CalendarError("CALENDAR_UNAVAILABLE", `No ${mic} calendar loaded`);
```

with

```ts
  // Spec "Overnight calendars": a session crossing midnight cannot be worked out on weekdays, on any card.
  if ((ctx.strict || isOvernight(mic)) && needsCalendar(atom)) {
    throw new CalendarError("CALENDAR_UNAVAILABLE", `No ${mic} calendar loaded`);
  }
```

Add to the doc comment above `atomCalendar`: `An overnight calendar (CMES, 24/7, …) is held to the same rule on every card.`

- [ ] **Step 5: Keep overnight calendars out of the per-year loader**

In `$BDOBB/src/hooks/useTradingCalendar.ts`, add `import { isOvernight } from "../lib/calendars/catalogue";` with the other imports. After the imports, add:

```ts
/** A calendar the per-year loader serves: any catalogue calendar but the overnight ones, which only bundles describe. */
const isLegacyCalendar = (mic: string): boolean => isKnownCalendar(mic) && !isOvernight(mic);
```

Replace all three occurrences of `.filter(isKnownCalendar)` with `.filter(isLegacyCalendar)`. In the comment above the first one, replace `less any outside the nine, which resolution refuses and nothing ever fetches.` with `less any outside the catalogue, which resolution refuses, and the overnight ones, which come from bundles.`

- [ ] **Step 6: Load a legacy card's overnight calendars as bundles**

In `$BDOBB/src/lib/calendars/bundles.ts`, add `import { isOvernight } from "./catalogue";` and add, after `membersOf`:

```ts
/**
 * The calendars a card resolves on openbq-docker's bundles: all of them on an opted-in card, and only the overnight
 * ones on any other (spec "Overnight calendars": the weekday table cannot describe a session crossing midnight).
 */
function bundleIdsOf(widget: WidgetDef, values: Record<string, string>, exchange: string | undefined, expressionsOnly = false): string[] {
  const ids = calendarIdsOf(widget, values, exchange, expressionsOnly);
  return widget.calendarBinding ? ids : ids.filter(isOvernight);
}
```

Then make three replacements:
- In `peekWidgetCalendars`, replace `const needed = new Set(calendarIdsOf(widget, values, exchange, true));` with `const needed = new Set(bundleIdsOf(widget, values, exchange, true));`.
- In `peekWidgetCalendars`, replace `for (const id of calendarIdsOf(widget, values, exchange)) {` with `for (const id of bundleIdsOf(widget, values, exchange)) {`.
- In `widgetMembers`, replace `for (const id of calendarIdsOf(widget, values, exchange)) {` with `for (const id of bundleIdsOf(widget, values, exchange)) {`.

In the doc comment of `peekWidgetCalendars`, replace `An opted-in card's calendars` with `A card's bundle calendars (every one on an opted-in card, the overnight ones on any other)`.

In `$BDOBB/src/hooks/useBundleCalendars.ts`:
- Replace `const bound = widget?.calendarBinding ? widget : undefined;` with:

```ts
  // Every card: bundleIdsOf (bundles.ts) picks which of its calendars come from bundles -- all on an opted-in card,
  // only the overnight ones on any other. A card with none peeks nothing and loads nothing.
  const bound = widget;
```

- Add, after `NONE`:

```ts
/**
 * A legacy card's calendars with its overnight ones from bundles (spec "Overnight calendars"): the per-year loader's
 * map with each overnight calendar -- loaded, still loading, or its refusal -- laid over it, and the card waits while
 * one an expression needs is loading. `legacy` itself when the card names none, so its identity and key never move.
 */
export function withOvernight(legacy: TradingCalendars, overnight: TradingCalendars): TradingCalendars {
  if (Object.keys(overnight.calendars).length === 0) return legacy;
  return {
    ...legacy,
    calendars: { ...legacy.calendars, ...overnight.calendars },
    pending: legacy.pending || overnight.pending,
    key: `${legacy.key}|${overnight.key}`,
    retry: overnight.retry,
  };
}
```

- In the hook's doc comment, replace `An opted-in (calendarBinding) card's calendars, for every path` with `A card's bundle calendars -- all of an opted-in (calendarBinding) card's, the overnight ones of any other -- for every path`.

In `$BDOBB/src/hooks/useCardRequest.ts`, change the import to `import { useBundleCalendars, withOvernight } from "./useBundleCalendars";` and replace

```ts
  // An opted-in card resolves on openbq-docker's versioned bundles only (spec "Calendars available").
  const bundled = useBundleCalendars(widget, params, backend, exchange);
  const trading = widget?.calendarBinding ? bundled : legacy;
```

with

```ts
  // An opted-in card resolves on openbq-docker's versioned bundles only (spec "Calendars available"); any other card
  // on the per-year loader, except its overnight calendars, which come from bundles too (2026-10-24).
  const bundled = useBundleCalendars(widget, params, backend, exchange);
  const binding = widget?.calendarBinding;
  const trading = useMemo(() => (binding ? bundled : withOvernight(legacy, bundled)), [binding, legacy, bundled]);
```

In `$BDOBB/src/components/renderers/ManagedSourceForm.tsx`, change `import {useBundleCalendars} from '../../hooks/useBundleCalendars';` to `import {useBundleCalendars,withOvernight} from '../../hooks/useBundleCalendars';` and replace

```tsx
 const trading=sourceWidget?.calendarBinding?bundled:legacy;
```

with

```tsx
 const sourceBinding=sourceWidget?.calendarBinding;
 const trading=useMemo(()=>sourceBinding?bundled:withOvernight(legacy,bundled),[sourceBinding,legacy,bundled]);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib src/hooks src/components/renderers/ManagedSourceForm.test.tsx src/components/renderers/DateProbeRenderer.test.tsx src/components/ParamControls.test.tsx`
Expected: all pass.

- [ ] **Step 8: Lint the touched files and commit**

```bash
pnpm -C "$BDOBB" exec eslint src/lib/dateExpressions.ts src/hooks/useTradingCalendar.ts src/lib/calendars/bundles.ts src/hooks/useBundleCalendars.ts src/hooks/useCardRequest.ts src/components/renderers/ManagedSourceForm.tsx
git -C "$BDOBB" branch --show-current
git -C "$BDOBB" add src/lib/dateExpressions.ts src/hooks/useTradingCalendar.ts src/lib/calendars/bundles.ts src/hooks/useBundleCalendars.ts src/hooks/useCardRequest.ts src/components/renderers/ManagedSourceForm.tsx src/lib/calendarQualifier.test.ts src/hooks/useBundleCalendars.test.tsx src/hooks/useTradingCalendar.test.tsx
git -C "$BDOBB" commit -m "feat(v4): overnight calendars resolve from bundles on every card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 [bdobb]: The searchable dashboard Exchange menu

**Files:**
- Modify: `$BDOBB/src/components/RowContextMenu.tsx` (`MenuItem.search`; a search box in that item's flyout)
- Modify: `$BDOBB/src/components/railMenu.ts` (the Exchange item)
- Modify: `$BDOBB/src/lib/calendar.ts` (delete `DASHBOARD_EXCHANGES`)
- Modify: `$BDOBB/src/styles.css` (after `.rail-submenu`)
- Modify tests: `$BDOBB/src/components/railMenu.test.tsx`

**Interfaces:**
- Consumes: `CATALOGUE` (Task 4); `isKnownCalendar` (Task 5).
- Produces:
  - `MenuItem.search?: string`. On an item with a `submenu`, the flyout opens with a `type="search"` box whose accessible name is this string. The box filters the flyout's items by label, case-insensitively, and takes focus when the flyout opens. ArrowDown moves focus to the first match.
  - `DASHBOARD_EXCHANGES` is deleted from `calendar.ts`; the menu was its last user.

- [ ] **Step 1: Write the failing menu tests**

In `$BDOBB/src/components/railMenu.test.tsx`, add `within` to the `@testing-library/react` import, and replace `it("offers the dashboard's exchange — Default (XNYS) and the six MICs, the current one checked (v5.4.0)", …)` with:

```ts
  const flyout = () => within(document.getElementById("row-context-submenu")!);

  it("offers Default (XNYS) first, then every catalogue calendar, the current one checked (2026-10-24)", async () => {
    const on = show({ kind: "dashboard", id: "d1", name: "Main", groupsDisabled: false, exchange: "XLON" });
    await userEvent.click(screen.getByRole("menuitem", { name: "Exchange" }));
    const rows = flyout().getAllByRole("menuitemcheckbox");
    expect(rows).toHaveLength(72);
    expect(rows[0]).toHaveTextContent("Default (XNYS)");
    expect(rows[0]).toHaveAttribute("aria-checked", "false");
    expect(flyout().getByRole("menuitemcheckbox", { name: /XLON · London Stock Exchange/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(flyout().getByRole("menuitemcheckbox", { name: /CMES · Chicago Mercantile Exchange/ }));
    expect(on.setExchange).toHaveBeenCalledWith("d1", "CMES");
  });

  it("filters the exchanges by name or MIC as you type (review focus 5)", async () => {
    show(DASHBOARD);
    await userEvent.click(screen.getByRole("menuitem", { name: "Exchange" }));
    const box = screen.getByRole("searchbox", { name: "Search exchanges" });
    expect(box).toHaveFocus();
    await userEvent.type(box, "paris");
    expect(flyout().getAllByRole("menuitemcheckbox").map((r) => r.textContent)).toEqual(["☐ XPAR · Euronext Paris"]);
    await userEvent.clear(box);
    await userEvent.type(box, "CmEs");
    expect(flyout().getAllByRole("menuitemcheckbox").map((r) => r.textContent)).toEqual(["☐ CMES · Chicago Mercantile Exchange"]);
    await userEvent.clear(box);
    expect(flyout().getAllByRole("menuitemcheckbox")).toHaveLength(72);
    await userEvent.keyboard("{ArrowDown}");
    expect(flyout().getAllByRole("menuitemcheckbox")[0]).toHaveFocus();
  });

  it("keeps a stored exchange outside the catalogue visible, checked, for repair (review focus 4)", async () => {
    show({ kind: "dashboard", id: "d1", name: "Main", groupsDisabled: false, exchange: "XNAS" });
    await userEvent.click(screen.getByRole("menuitem", { name: "Exchange" }));
    const row = flyout().getByRole("menuitemcheckbox", { name: /XNAS · not a served calendar/ });
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(row).toBeDisabled();
    expect(flyout().getAllByRole("menuitemcheckbox")).toHaveLength(73);
  });
```

Leave `it("clears the exchange from Default (XNYS) (v5.4.0)", …)` as it is.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/components/railMenu.test.tsx`
Expected: FAIL. The flyout lists 7 rows, not 72, and there is no search box.

- [ ] **Step 3: Add the search box to RowContextMenu**

In `$BDOBB/src/components/RowContextMenu.tsx`:

Add to `MenuItem`, after `depth`:

```ts
  /**
   * Present on an item with a `submenu` ⇒ its flyout opens with a search box of this name that filters the flyout's
   * items by label, case-insensitively (the dashboard's Exchange menu: 71 calendars, 2026-10-24).
   */
  search?: string;
```

Update the type's doc comment: replace `the rail's grouping row is a checkbox, its Move to\n * row owns a flyout, and the help menu's Canny row carries a tooltip.` with `the rail's grouping row is a checkbox, its Move to\n * row owns a flyout, its Exchange flyout is searchable, and the help menu's Canny row carries a tooltip.`

In `RowContextMenu`, after `const [openSub, setOpenSub] = useState<string | null>(null);`, add:

```ts
  /** The open flyout's search text, when it has a search box. Cleared whenever a flyout opens or closes. */
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // A searchable flyout takes the keyboard as it opens, so typing filters at once.
  useEffect(() => searchRef.current?.focus(), [openSub]);
```

In `renderItem`'s button `onClick`, replace

```ts
              setOpenSub((cur) => (cur === item.label ? null : item.label));
              return;
```

with

```ts
              setOpenSub((cur) => (cur === item.label ? null : item.label));
              setQuery("");
              return;
```

Replace the flyout block

```tsx
        {subOpen ? (
          <div id={SUBMENU_ID} role="menu" className="rail-submenu">
            {sub.map(renderItem)}
          </div>
        ) : null}
```

with

```tsx
        {subOpen ? (
          <div id={SUBMENU_ID} role="menu" className={item.search ? "rail-submenu rail-submenu-search" : "rail-submenu"}>
            {item.search ? (
              <input
                ref={searchRef}
                type="search"
                aria-label={item.search}
                placeholder={item.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown") return;
                  // Into the matches, not to the top of the whole menu as the panel's own ArrowDown would go.
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(FOCUSABLE_ITEMS)?.focus();
                }}
              />
            ) : null}
            {(item.search ? sub.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase())) : sub).map(
              renderItem,
            )}
          </div>
        ) : null}
```

`useRef` and `useEffect` are already imported in this file.

- [ ] **Step 4: List the catalogue in the rail menu**

In `$BDOBB/src/components/railMenu.ts`, replace `import { DASHBOARD_EXCHANGES, EXCHANGE_HOURS } from "../lib/calendar";` with:

```ts
import { isKnownCalendar } from "../lib/calendar";
import { CATALOGUE } from "../lib/calendars/catalogue";
```

Replace the whole Exchange item (from `{\n      // v5.4.0 (spec §5): Default clears the field;` to its closing `},`) with:

```ts
    {
      // Spec 2026-10-24: Default clears the field, then every catalogue calendar in the catalogue's order, the current
      // one checked, behind a search box. A stored name outside the catalogue stays listed, checked, for repair.
      label: "Exchange",
      search: "Search exchanges",
      submenu: [
        { label: "Default (XNYS)", checked: target.exchange === undefined, onSelect: () => on.setExchange(target.id, null) },
        ...(target.exchange !== undefined && !isKnownCalendar(target.exchange)
          ? [{ label: `${target.exchange} · not a served calendar`, checked: true, disabled: true }]
          : []),
        ...CATALOGUE.map((e) => ({
          label: `${e.mic} · ${e.name}`,
          checked: target.exchange === e.mic,
          onSelect: () => on.setExchange(target.id, e.mic),
        })),
      ],
    },
```

In `$BDOBB/src/lib/calendar.ts`, delete the `DASHBOARD_EXCHANGES` constant and its doc comment. `grep -rn DASHBOARD_EXCHANGES "$BDOBB/src"` must then print nothing.

- [ ] **Step 5: Keep the long flyout on screen**

In `$BDOBB/src/styles.css`, after the `.rail-submenu { … }` rule, add:

```css
/* The searchable Exchange flyout lists 71 calendars: it scrolls rather than run off the window. */
.rail-submenu-search {
  max-height: 50vh;
  overflow-y: auto;
}

.rail-submenu-search input[type="search"] {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 0 8px 4px;
}
```

- [ ] **Step 6: Run the tests, the type check and lint**

```bash
pnpm -C "$BDOBB" exec vitest run src/components/railMenu.test.tsx src/components/RowContextMenu.test.tsx src/components/LeftRail.test.tsx
pnpm -C "$BDOBB" typecheck
pnpm -C "$BDOBB" exec eslint src/components/RowContextMenu.tsx src/components/railMenu.ts
```

Expected: all pass; the type check exits 0.

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" branch --show-current
git -C "$BDOBB" add src/components/RowContextMenu.tsx src/components/railMenu.ts src/lib/calendar.ts src/styles.css src/components/railMenu.test.tsx
git -C "$BDOBB" commit -m "feat(v4): searchable dashboard Exchange menu listing every calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 [bdobb]: Help lists the catalogue

**Files:**
- Modify: `$BDOBB/src/help/guide/date-expression.md` (the calendars sentence; a new "Exchange calendars" section)
- Modify: `$BDOBB/src/help/guide/card-parameters.md` (the "Trading calendars" paragraphs)
- Modify: `$BDOBB/src/help/topics/card-parameters.md` (the "Trading calendars" paragraph)
- Create: `$BDOBB/src/help/calendars.test.ts`

**Interfaces:**
- Consumes: `CATALOGUE` (Task 4).
- Produces: a guide table whose rows the test derives from the catalogue. The row format is `` | `MIC` | Name | `.S1`, `.S2` | start to end | ``, with `—` when a calendar has no suffix.

- [ ] **Step 1: Write the failing Help test**

Create `$BDOBB/src/help/calendars.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CATALOGUE, type CatalogueEntry } from "../lib/calendars/catalogue";
import page from "./guide/date-expression.md?raw";

/** One row of the guide's calendar table, from one catalogue entry. */
function row(e: CatalogueEntry): string {
  const suffixes = [...new Set([...e.suffixes.eodhd, ...e.suffixes.yahoo])].sort().map((s) => "`." + s + "`");
  return `| \`${e.mic}\` | ${e.name} | ${suffixes.join(", ") || "—"} | ${e.bounds.start} to ${e.bounds.end} |`;
}

describe("the guide's calendar list (spec: the Help list matches the catalogue)", () => {
  it("is the catalogue, row for row", () => {
    expect(page.split("\n").filter((line) => line.startsWith("| `"))).toEqual(CATALOGUE.map(row));
  });

  it("no longer says there are nine", () => {
    expect(page).not.toMatch(/`XTAE` and `XTAI`/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C "$BDOBB" exec vitest run src/help/calendars.test.ts`
Expected: FAIL. The page has no table rows yet and still lists the nine.

- [ ] **Step 3: Print the table rows**

```bash
node -e '
const c = require(process.argv[1]);
for (const e of c.calendars) {
  const s = [...new Set([...e.suffixes.eodhd, ...e.suffixes.yahoo])].sort().map((x) => "`." + x + "`").join(", ") || "—";
  console.log(`| \`${e.mic}\` | ${e.name} | ${s} | ${e.bounds.start} to ${e.bounds.end} |`);
}' "$BDOBB/src/lib/calendars/vendor/calendar-catalogue.json" > "$SCRATCH/calendar-rows.md"
wc -l "$SCRATCH/calendar-rows.md"
```

Expected: `71`. The first row is `` | `24/5` | 24/5 (around the clock, Monday to Friday) | — | 1990-01-01 to 2040-12-31 | ``.

- [ ] **Step 4: Write the guide section**

In `$BDOBB/src/help/guide/date-expression.md`, replace

```
The calendars are `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`, `XHKG`, `XASX`, `XTAE` and `XTAI`, and the MIC is not case-sensitive.
```

with

```
The calendars are the 71 in the table below, and the name is not case-sensitive.
```

Insert immediately before the line `## What it tells you underneath`:

```markdown
## Exchange calendars

The app knows every calendar the exchange_calendars library defines. A symbol's last dot-suffix picks its calendar from the **Symbol suffixes** column, in EODHD's or Yahoo's spelling. A suffix that is not there names no calendar, and the card falls back to the parameter's, the widget's or the dashboard's. A calendar is served only between the dates in the **Served** column. Past them, a date that needs it is an error on the card.

Five calendars run overnight: `24/5`, `24/7`, `CMES`, `IEPA` and `us_futures`. Their sessions are labelled as the library labels them. CME's Monday session opens on Sunday at 17:00 Chicago time, so `T@open(CMES)` on a Monday is Sunday evening, and `T@close(CMES)` is Monday at 17:00. These five always come from the backend's calendar bundles, on every card. When a bundle cannot be had, the card shows the error. It never counts weekdays for them.

| Calendar | Name | Symbol suffixes | Served |
|---|---|---|---|
```

Then paste the 71 lines of `$SCRATCH/calendar-rows.md` directly under that header row, followed by one blank line.

- [ ] **Step 5: Update the card-parameters pages**

In `$BDOBB/src/help/guide/card-parameters.md` ("Trading calendars"):

- Replace `(`.US` New York; `.LSE` or `.L` London; `.TO` Toronto; `.XETRA` or `.DE` Xetra; `.TSE` or `.T` Tokyo; `.HK` Hong Kong; `.AU` or `.AX` Sydney; `.TA` Tel Aviv; `.TW` Taipei — an unsuffixed, crypto or FX symbol names none)` with `(`.L` London, `.T` Tokyo, `.PA` Paris, `.KS` Seoul and the rest of the table in [[date-expression|The Date Expression Card]] — an unsuffixed, crypto or FX symbol names none)`.
- Replace `The app knows nine calendars — `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`, `XHKG`, `XASX`, `XTAE` and `XTAI` — and the dashboard menu offers the first six. A MIC outside the nine is an error on the card.` with `The app knows every calendar exchange_calendars defines — 71, listed in [[date-expression|The Date Expression Card]] — and the dashboard menu lists them all, with a search box. A name outside them is an error on the card.`
- Replace `and plain weekdays — no holidays — for anything else, and says so with a badge.` with `and plain weekdays — no holidays — for anything else, and says so with a badge. The five overnight calendars (`24/5`, `24/7`, `CMES`, `IEPA` and `us_futures`) are the exception: they always come from the backend's calendar bundles, and when none can be had the card shows the error rather than counting weekdays.`
- Replace `On the openbq-docker stack the API serves this route for the nine exchanges above.` with `On the openbq-docker stack the API serves this route for every calendar except the five overnight ones.`

In `$BDOBB/src/help/topics/card-parameters.md`, replace

```
**Default (XNYS)**. The calendars are `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`,
`XHKG`, `XASX`, `XTAE` and `XTAI`; anything else is an error on the card. The
```

with

```
**Default (XNYS)**. The calendars are the 71 exchange_calendars defines, listed
in the guide; anything else is an error on the card. The
```

and replace

```
says so with a badge. Years outside 1990–2040 are never asked for.
```

with

```
says so with a badge. The five overnight calendars (`24/5`, `24/7`, `CMES`,
`IEPA`, `us_futures`) never fall back to weekdays: they come from the backend's
calendar bundles, or the card shows an error. Years outside 1990–2040 are never
asked for.
```

- [ ] **Step 6: Run the Help tests**

Run: `pnpm -C "$BDOBB" exec vitest run src/help`
Expected: all pass, including `calendars.test.ts` and the existing guide/topic/search tests.

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" branch --show-current
git -C "$BDOBB" add src/help/guide/date-expression.md src/help/guide/card-parameters.md src/help/topics/card-parameters.md src/help/calendars.test.ts
git -C "$BDOBB" commit -m "docs(v4): Help lists the full calendar set from the catalogue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 [both]: Evidence notes, final pairing, full gates

**Files:**
- Modify: `$OD/docs/calendars/release-v4-evidence.md`
- Modify: `$BDOBB/docs/calendars/release-v4-evidence.md`
- Modify: `$BDOBB/package.json` (`openbqDocker`)
- Modify (generated): `$BDOBB/web/policy.mjs`, `$BDOBB/web/policy.vendored.json`, `$BDOBB/web/ssrm-routes.vendored.json`

**Interfaces:**
- Consumes: the provider head after Step 2, and `scripts/gateway-vendor.mjs <tag> <40-hex commit>` (it reads the gateway policy and lane contract at that commit from `OPENBQ_DOCKER_DIR`).
- Produces: `web/security.test.mjs`, which holds `policy.vendored.json`'s commit equal to `package.json`'s `openbqDocker`.

- [ ] **Step 1: Run the provider gates**

```bash
PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests"
PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/v4/routes/tests"
(cd "$OD" && python3 -m pytest -q tests)
(cd "$OD" && python3 scripts/check-public.py)
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core" "$OD/v4/routes"
python3 -m ruff format --check --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
```

Expected: every command exits 0 with no failures.

- [ ] **Step 2: Record the provider evidence and fix its head**

Append to `$OD/docs/calendars/release-v4-evidence.md`:

```markdown
## 2026-10-24 full calendar set

- `calendar-core/openbq_calendar/catalogue.py` generates `resources/calendar-catalogue.json` from exchange_calendars 4.13.2 plus the curated names and suffixes in `curation.py`; a test regenerates it byte for byte. `CALENDARS`, capabilities and bounds read it: 71 calendars.
- Bounds are what the library covers inside 1990–2040: AIXK from 2017, XBOM 1997–2026, XSAU 2021–2029, XSES to 2026-12-31, XSHG 1990-12-03 to 2026-12-31, XTKS from 1997, XTAI from 2019 (qualification). XBOM, XSES and XSHG therefore stop at 2026-12-31 until a library upgrade extends them.
- `calendarId` admits the library's names (`exchange:24/7`, `exchange:us_futures`): pattern `[A-Za-z0-9_/-]+`. Bundles and routes clip whole years to each calendar's bounds.
- Qualification: a 2026 snapshot per calendar (`calendar-core/tests/snapshots/`, library_baseline, tied to the catalogue digest) and hand checks for XPAR, XETR, XSWX, XSHG, XKRX, XBOM, XSES, BVMF, XMEX, XJSE, XASX and CMES (Sunday-evening open).
- Suffix sources: EODHD's published list (63 rows, read 2026-10-24) plus the 2026-10-23 rulings; Yahoo's help page SLN2310. Dropped suffixes, with reasons, are in `UNMAPPED_SUFFIXES`; `.NX` (Euronext as one venue) is the one cross-calendar ambiguity. EODHD codes JSE, SR, BSE and LU are not on the published list and are left unmapped as unverified.
- Library disagreements found, not asserted: XKRX 2026-06-03 (local-election day, normally a KRX closure) is an open session; SGX's Christmas and New Year's Eve half days (2026-12-24, 2026-12-31) are full sessions.
```

Commit and capture the head:

```bash
git -C "$OD" branch --show-current
git -C "$OD" add docs/calendars/release-v4-evidence.md
git -C "$OD" commit -m "docs(v4): record the full calendar set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
OD_SHA=$(git -C "$OD" rev-parse HEAD); echo "$OD_SHA"
```

Expected: a 40-hex SHA.

- [ ] **Step 3: Prove the vendored contract matches the final provider**

```bash
rm -rf "$SCRATCH/calendar-contract"
PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.artifact "$SCRATCH/calendar-contract"
node "$BDOBB/scripts/vendor-calendar-contract.mjs" "$SCRATCH/calendar-contract"
git -C "$BDOBB" status --short src/lib/calendars/vendor
```

Expected: no output. If anything changed, the provider moved after Task 4. Rerun `pnpm -C "$BDOBB" exec vitest run src/lib/calendars src/help`. If the Help test now fails, regenerate the table rows (Task 8 Steps 3–4). Commit the vendor change with the pairing below.

- [ ] **Step 4: Pin and re-pair the client to the final provider commit**

Set `"openbqDocker": "<OD_SHA>"` in `$BDOBB/package.json`, writing the real SHA. Then:

```bash
OPENBQ_DOCKER_DIR="$OD" node "$BDOBB/scripts/gateway-vendor.mjs" v4.0.0 "$OD_SHA"
git -C "$BDOBB" diff --stat web package.json
```

Expected: `policy.vendored.json` records `"commit": "<OD_SHA>"`; `package.json` shows the new `openbqDocker`.

- [ ] **Step 5: Record the client evidence**

Append to `$BDOBB/docs/calendars/release-v4-evidence.md`:

```markdown
## 2026-10-24 full calendar set

- The client vendors openbq-docker's generated `calendar-catalogue.json` (71 calendars) and derives the known set, `EXCHANGE_HOURS` (with each calendar's trading week), the symbol suffix map, the bundle window clamp, the Help calendar table and the dashboard Exchange menu from it. `DASHBOARD_EXCHANGES` is gone.
- `(MIC)` takes any catalogue name in any case and keeps the catalogue's spelling (`(us_futures)`, `(24/7)`); library aliases (`NYSE`, `XNAS`) stay unknown calendars (ruling RF3).
- The five overnight calendars (`24/5`, `24/7`, `CMES`, `IEPA`, `us_futures`) resolve only from bundles: a legacy card loads just those as bundles, layered over the per-year loader; the resolver never counts them on weekdays, so a missing bundle is a visible error. `T@open(CMES)` on a Monday is Sunday 17:00 Chicago.
- The dashboard Exchange menu lists Default (XNYS) and every catalogue calendar behind a search box; a stored name outside the catalogue loads, stays checked as "not a served calendar", and its cards show "Unknown calendar". Release note (behaviour change): a stored exchange such as `US` used to be dropped on load; it is now kept for repair.
- Bundle windows are clamped at both ends to the catalogue's bounds; XBOM, XSES and XSHG end 2026-12-31 in exchange_calendars 4.13.2.
- Paired provider: `<OD_SHA>`.
- Still open: the v5–v10 walk (per-line brief); container and browser qualification (gate 9).
```

Write the real SHA in place of `<OD_SHA>`.

- [ ] **Step 6: Run every client gate**

First check host load (`uptime`). The unit suite times out when the load average is far above the core count; wait, or rerun, if so. Then:

```bash
pnpm -C "$BDOBB" pivot:build
git -C "$BDOBB" status --short            # pivot:build must not leave tool symlinks or new files tracked
pnpm -C "$BDOBB" typecheck
pnpm -C "$BDOBB" lint
pnpm -C "$BDOBB" scrub
pnpm -C "$BDOBB" test:web
pnpm -C "$BDOBB" exec vitest run src/help
pnpm -C "$BDOBB" exec vitest run --minWorkers=1 --maxWorkers=2
```

Expected: every command exits 0. `test:web` includes `web/security.test.mjs` passing on the new pairing, plus the vendoring test. The full vitest run reports no failures.

- [ ] **Step 7: Commit the pairing**

```bash
git -C "$BDOBB" branch --show-current     # claude/v4-full-calendar-set
git -C "$BDOBB" add package.json web docs/calendars/release-v4-evidence.md src/lib/calendars/vendor
git -C "$BDOBB" commit -m "chore(v4): pair openbq-docker $OD_SHA (full calendar set)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do not push either repository.
