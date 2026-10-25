# Calendar-Qualified Date Expressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any date or datetime parameter resolve on one of nine exchange calendars chosen by the expression's `(MIC)`, the card's symbol, or the card and dashboard settings, with the `@` time-of-day production ported from bdobb-v2, and fix every finding of the 2026-10-23 review of PR #67 (bdobb) and PR #14 (openbq-docker).

**Architecture:** One resolver: every `wireParams` caller (preview, forms, echo, SSRM, table provider, Run check, GET) resolves synchronously through `resolveValue` against a per-card `calendars` map. On an opted-in card (`calendarBinding`) that map holds bundle-backed calendars from one shared, credential-scoped cache; on a legacy card it holds the existing backend/bundled/weekday calendars. A new `calendarOf` replaces `exchangeOf` and implements the six-step precedence; each atom's `(MIC)` overrides it. Calendar failures never become literals: `resolveValue` reports them, display callers show them, and `sendParams` refuses to send. The provider qualifies all nine calendars with conformance fixtures, aligns bundles to whole years under a byte-bounded cache, and builds capabilities once off the event loop.

**Tech Stack:** TypeScript, React 18, Vitest, `@internationalized/date`, Tauri (client); Python 3.12+, FastAPI/Starlette, pydantic 2, exchange_calendars 4.13.2, pytest (provider).

**Spec:** `docs/superpowers/specs/2026-10-23-calendar-qualified-expressions-design.md` (binding). Also read `docs/calendars/2026-10-23-pr67-pr14-review.md` (every finding must be fixed) and the parent design `2026-10-22-exchange-calendar-date-shifts-design.md` (in the series articles repo)`. Port reference: `git -C <bdobb-v2 checkout> show f8fcfdc16` and `873992135` (port behaviour only, no v12 chart code).

## Repositories and shell variables

Every task names the repo it runs in. Set these once per shell; every command below uses them, never a bare `cd` followed by a relative path (the shell can revert to another checkout).

```bash
SCRATCH=<the scratch directory holding both worktrees>
BDOBB="$SCRATCH/cal-bdobb-v4"   # branch claude/v4-calendar-qualifier (on PR #67)
OD="$SCRATCH/cal-od-v4"         # branch claude/v4-calendar-provider (on PR #14)
```

Before every commit, confirm the branch: `git -C "$BDOBB" branch --show-current` must print `claude/v4-calendar-qualifier`; `git -C "$OD" branch --show-current` must print `claude/v4-calendar-provider`. Do not push. Commit messages end with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Order: Tasks 1–3 (openbq-docker) finish the provider and its conformance fixtures; Tasks 4–13 (bdobb) vendor those fixtures and build the client; Task 14 (both) pins the client to the final provider commit and runs every gate.

## Global Constraints

- License header first, before any import: `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.` then `// SPDX-License-Identifier: Apache-2.0` (Python: same text with `#`). `pnpm scrub` runs `scripts/header-check.sh`.
- TypeScript style: formatted as the surrounding code (2-space indent, double quotes, semicolons, trailing commas, width 120), every exported symbol with an explanatory doc comment, `import type` at the top of the file — no inline `import("…")` types.
- Python style: 4-space PEP 8, `python3 -m ruff format --line-length 120`, one statement per line.
- No new runtime dependencies in either repo.
- Grammar (spec): `atom := anchor ( sign offset )* at? cal?`, `at := "@" ( HH ":" MM | "open" | "close" )`, `cal := "(" MIC ")"`.
- `(MIC)` never reaches the wire; the client resolves the atom to an ISO literal.
- "An atom with `(…)` that is not a known MIC is a visible error on the card, never a literal and never XNYS: `T(XNYZ)` reads "Unknown calendar XNYZ"."
- Precedence (spec, first wins): 1 the expression's `(MIC)`; 2 the card's `symbol` parameter by suffix; 3 the parameter's `exchange`; 4 the widget's `calendarBinding`, else its `exchange`; 5 the dashboard's Exchange menu; 6 XNYS, shown as "Default (XNYS)".
- The nine calendars: XNYS, XLON, XTSE, XETR, XTKS, XHKG, XASX, XTAE, XTAI. "A MIC outside the nine is unknown. It is never run on XNYS hours."
- Symbol suffixes (last dot-suffix, case-insensitive): XNYS `.US`; XLON `.LSE`, `.L`; XTSE `.TO`; XETR `.XETRA`, `.DE`; XTKS `.TSE`, `.T`; XHKG `.HK`; XASX `.AU`, `.AX`; XTAE `.TA`; XTAI `.TW`. Unsuffixed, crypto (`BTC-USD`, `.CC`), FX (`EURUSD=X`, `.FOREX`) and any other suffix infer nothing.
- Evidence ruling (2026-10-23): "Under `operational-v1`, a day whose evidence is `provisional` or `conflict` blocks the date. `library_baseline`, `authority_confirmed`, `market_final` and `operator_final` resolve. `planning-v1` also accepts `provisional`, and the card shows a Provisional badge."
- Out of scope: joint calendars in expression syntax (`fxCalendarSet` stays manifest-level); replacing the dashboard's six-MIC menu; TemporalDB bindings.
- The dashboard Exchange menu and `parseExchange` stay at the six MICs; `EXCHANGE_HOURS` gains XASX, XTAE, XTAI.

## Review Focus

1. A `symbol` value that is a list (`AAPL,VOD.L`) or a share class (`BRK.B`) infers no calendar and falls through to the parameter, widget and dashboard steps — pinned in Task 8.
2. A widget or parameter `exchange` outside the nine (`XNAS`): a calendar-dependent value (`T-1bd`) shows "Unknown calendar XNAS" and is not sent, a calendar-free one (`T-7d`) still sends, and the legacy hook never requests XNAS — pinned in Tasks 9 and 11.
3. `@open` / `@close` on a closed date (`T@close` on a Saturday, `FQ0@open(XHKG)` on Hong Kong's National Day) take the next session's hours, never a nominal time on a closed day — pinned in Task 9.
4. A credential edit while a bundle is in flight: the late response never lands in the new scope, the card reloads under the new credential, and nothing is shared across credentials — pinned in Tasks 10 and 11.
5. Lower case and whitespace in the suffixes (`t-1bd @ CLOSE ( xlon )`) mean the canonical form, and the Relative tab's Apply/presets never strip `@` or `(MIC)` (the rows cannot show them, so the value stays read-only) — pinned in Task 7.

---

### Task 1 [openbq-docker]: Provider style and host-runnable route tests

**Files:**
- Modify (format only): `$OD/calendar-core/openbq_calendar/*.py`, `$OD/calendar-core/tests/test_calendar_core.py`, `$OD/v4/routes/openbq_routes/calendar_v1.py`
- Modify: `$OD/calendar-core/openbq_calendar/legacy.py` (stale comment)
- Rewrite: `$OD/v4/routes/tests/test_calendar_v1.py`

**Interfaces:**
- Consumes: `openbq_routes.calendar_v1.register(router)` (uses only `router.api_router`), `openbq_calendar.legacy.build(mic, year)`.
- Produces: route tests that import nothing from `openbb_core`, so `pytest` collects them on the host (review: "the full host pytest does not collect").

- [ ] **Step 1: Show the route tests do not collect on the host**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"`
Expected: `1 error during collection` (`openbq_routes.calendar` pulls in openbb-core's provider registry, which fails on `openbb_deltalake`).

- [ ] **Step 2: Rewrite `v4/routes/tests/test_calendar_v1.py` to mount the v1 routes without openbb-core**

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""The v1 calendar routes, mounted on a bare FastAPI router.

`register` only ever touches `router.api_router`, so the routes are tested here without
openbb-core's provider registry, which refuses to load on a host carrying a stale OpenBB
extension. The legacy envelope is tested through `openbq_calendar.legacy`, where it lives.
"""
from types import SimpleNamespace

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from openbq_calendar.legacy import build
from openbq_routes.calendar_v1 import register

stub = SimpleNamespace(api_router=APIRouter())
register(stub)
app = FastAPI()
app.include_router(stub.api_router, prefix="/api/v1/calendar")
client = TestClient(app)
BUNDLE = "/api/v1/calendar/trading/v1/bundle"
CALENDARS_ROUTE = "/api/v1/calendar/trading/v1/calendars"


def test_v1_capabilities_and_per_day_boundaries():
    r = client.get(CALENDARS_ROUTE)
    assert r.status_code == 200
    assert "exchange:XHKG" in [c["calendarId"] for c in r.json()["calendars"]]
    r = client.get(BUNDLE, params={"calendar_id": "exchange:XHKG", "start": "2026-01-02", "end": "2026-01-02"})
    assert r.status_code == 200
    day = next(d for d in r.json()["days"] if d["date"] == "2026-01-02")
    assert len(day["segments"]) == 2


def test_invalid_calendar_and_ranges_fail_without_fallback():
    for params in [
        {"calendar_id": "constructor", "start": "2026-01-01", "end": "2026-01-02"},
        {"calendar_id": "exchange:XNYS", "start": "2026-02-02", "end": "2026-01-01"},
    ]:
        assert client.get(BUNDLE, params=params).status_code == 422


def test_legacy_envelope_retains_early_close_and_holiday_names():
    body = build("XNYS", 2026)["data"]
    assert body["ExchangeHolidays"]["2026-07-03"]["Holiday"] == "July 4th"
    assert body["ExchangeHolidays"]["2026-11-27"]["EarlyClose"] == "13:00:00"
```

(The fourth PR test, the Tokyo literal, is replaced in Task 2 by one that reads the supplier's bound.)

- [ ] **Step 3: Fix the stale comment in `legacy.py`**

Replace `@lru_cache(maxsize=512)  # six client MICs x 51 years = 306 keys` with:

```python
@lru_cache(maxsize=512)  # nine calendars x 51 years = 459 keys
```

- [ ] **Step 4: Format and lint the provider package**

Run:
```bash
python3 -m ruff format --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
```
Expected: format rewrites the one-space and semicolon-chained files; check prints `All checks passed!`. Fix any remaining finding by hand (wrap a long literal, drop an unused import such as `json` in `artifact.py` if F401 flags it).

- [ ] **Step 5: Run the provider tests**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"`
Expected: `18 passed`.

- [ ] **Step 6: Commit**

```bash
git -C "$OD" add calendar-core v4/routes/openbq_routes/calendar_v1.py v4/routes/tests/test_calendar_v1.py
git -C "$OD" commit -m "style(v4): PEP 8 calendar packages; route tests run without openbb-core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 [openbq-docker]: Qualify the nine calendars and report the supplier's real bounds

**Files:**
- Create: `$OD/calendar-core/openbq_calendar/resources/conformance/{XLON,XTSE,XETR,XTKS,XASX,XTAE,XNYS-2026-12}.json` (generated)
- Create: `$OD/calendar-core/tests/test_qualification.py`
- Modify: `$OD/calendar-core/openbq_calendar/registry.py`, `$OD/calendar-core/openbq_calendar/supplier.py`, `$OD/v4/routes/openbq_routes/calendar_v1.py`, `$OD/calendar-core/tests/test_calendar_core.py`, `$OD/v4/routes/tests/test_calendar_v1.py`

**Interfaces:**
- Consumes: `generate_bundle(calendar_id, start, end, *, generated_at)`, `canonical_bytes`, `validate_bundle`.
- Produces: `registry.bounds(name: str) -> tuple[date, date]`; `registry.QUALIFIED_FROM: dict[str, date]`; conformance fixtures Task 5 vendors into the client (`XLON.json` and `XNYS-2026-12.json` cover 2026-12-21..2027-01-08).

- [ ] **Step 1: Generate the six new fixtures and the XNYS year-end fixture**

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
    "XLON.json": ("XLON", *year_end),
    "XTSE.json": ("XTSE", *year_end),
    "XETR.json": ("XETR", *year_end),
    "XTKS.json": ("XTKS", *year_end),
    "XASX.json": ("XASX", *year_end),
    "XNYS-2026-12.json": ("XNYS", *year_end),
    "XTAE.json": ("XTAE", date(2026, 1, 2), date(2026, 1, 9)),
}
for filename, (name, start, end) in windows.items():
    bundle = generate_bundle("exchange:" + name, start, end, generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    (out / filename).write_bytes(canonical_bytes(bundle))
    print(filename, bundle["digest"])
EOF
```
Expected: seven lines, one digest each.

- [ ] **Step 2: Write the failing qualification test**

`$OD/calendar-core/tests/test_qualification.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Every advertised calendar is qualified (review I6).

Qualified means a retained conformance bundle that states facts taken from the exchange's
own published holiday schedule: a closure, an early close or a changed trading week. The
library agreeing with itself is not qualification, so each fact is written out here.
"""
import json
from pathlib import Path

import pytest

import openbq_calendar
from openbq_calendar.contracts import validate_bundle
from openbq_calendar.registry import CALENDARS

CONFORMANCE = Path(openbq_calendar.__file__).parent / "resources" / "conformance"

# fixture -> {date: "closed" or (open UTC, close UTC)}
FACTS = {
    "XNYS.json": {"2026-11-26": "closed", "2026-11-27": ("2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z")},
    "XNYS-2026-12.json": {
        "2026-12-24": ("2026-12-24T14:30:00Z", "2026-12-24T18:00:00Z"),  # 13:00 early close
        "2026-12-25": "closed",
        "2026-12-28": ("2026-12-28T14:30:00Z", "2026-12-28T21:00:00Z"),
        "2027-01-01": "closed",
    },
    "XLON.json": {
        "2026-12-24": ("2026-12-24T08:00:00Z", "2026-12-24T12:30:00Z"),  # Christmas Eve half day
        "2026-12-25": "closed",
        "2026-12-28": "closed",  # Boxing Day falls on a Saturday; the holiday is the Monday
        "2026-12-31": ("2026-12-31T08:00:00Z", "2026-12-31T12:30:00Z"),
        "2027-01-01": "closed",
    },
    "XTSE.json": {"2026-12-25": "closed", "2026-12-28": "closed", "2027-01-01": "closed"},
    "XETR.json": {"2026-12-24": "closed", "2026-12-25": "closed", "2026-12-31": "closed"},
    "XTKS.json": {"2026-12-30": ("2026-12-30T00:00:00Z", "2026-12-30T06:30:00Z"), "2026-12-31": "closed"},
    "XASX.json": {
        "2026-12-24": ("2026-12-23T23:00:00Z", "2026-12-24T03:10:00Z"),  # 14:10 early close
        "2026-12-25": "closed",
        "2026-12-28": "closed",
    },
    "XTAE.json": {
        "2026-01-02": "closed",  # the last Friday before TASE moved to Monday-Friday
        "2026-01-05": ("2026-01-05T07:59:00Z", "2026-01-05T15:15:00Z"),
        "2026-01-09": ("2026-01-09T07:59:00Z", "2026-01-09T11:50:00Z"),  # the short Friday session
    },
    "XHKG.json": {"2026-01-02": ("2026-01-02T01:30:00Z", "2026-01-02T08:00:00Z")},
    "XTAI.json": {"2025-02-08": "closed", "2025-02-09": "closed", "2025-02-10": ("2025-02-10T01:00:00Z", "2025-02-10T05:30:00Z")},
}


def load(filename):
    return validate_bundle(json.loads((CONFORMANCE / filename).read_text()))


def test_every_advertised_calendar_has_a_fixture_with_facts():
    covered = {load(filename)["calendarId"] for filename in FACTS}
    assert covered == {"exchange:" + name for name in CALENDARS}


@pytest.mark.parametrize("filename", sorted(FACTS))
def test_fixture_states_the_published_facts(filename):
    days = {d["date"]: d for d in load(filename)["days"]}
    for day, expected in FACTS[filename].items():
        if expected == "closed":
            assert days[day]["state"] == "closed", day
        else:
            assert (days[day]["open"], days[day]["close"]) == expected, day
```

- [ ] **Step 3: Run it — the six new fixtures must already pass; confirm**

Run: `PYTHONPATH="$OD/calendar-core" python3 -m pytest -q "$OD/calendar-core/tests/test_qualification.py"`
Expected: `11 passed`. If any fact fails, stop: the supplier disagrees with the published schedule and that calendar is not qualified — report it rather than editing the fact.

- [ ] **Step 4: Write the failing bounds tests**

Append to `$OD/calendar-core/tests/test_calendar_core.py` (and delete the PR's `test_complete_closed_only_day_and_unknown_coverage`, whose name promised a coverage test it never ran):

```python
def test_complete_closed_only_day():
    b = generate_bundle("exchange:XNYS", date(2026, 1, 1), date(2026, 1, 1), generated_at=datetime.now(timezone.utc))
    assert b["days"][0]["state"] == "closed" and b["coverage"]["complete"]


def test_range_before_the_supplier_bound_is_refused():
    # exchange_calendars builds Tokyo from 1997 only; asking earlier is an error, never a guess.
    with pytest.raises(ValueError, match="before 1997-01-01"):
        generate_bundle("exchange:XTKS", date(1996, 12, 30), date(1997, 1, 6), generated_at=datetime.now(timezone.utc))


def test_bounds_come_from_the_supplier_inside_the_route_window():
    from openbq_calendar.registry import bounds

    assert bounds("XTKS") == (date(1997, 1, 1), date(2040, 12, 31))
    assert bounds("XHKG") == (date(1990, 1, 1), date(2040, 12, 31))  # supplier 1960-2049, clipped
    assert bounds("XTAI")[0] == date(2019, 1, 1)  # qualification, not supplier
```

Replace the PR's Tokyo test at the end of `$OD/v4/routes/tests/test_calendar_v1.py` with:

```python
def test_capabilities_report_supplier_bounds_for_exactly_the_qualified_set():
    import exchange_calendars as xc

    from openbq_calendar.registry import CALENDARS

    entries = {c["calendarId"]: c for c in client.get(CALENDARS_ROUTE).json()["calendars"]}
    assert set(entries) == {"exchange:" + name for name in CALENDARS}
    tokyo = type(xc.get_calendar("XTKS")).bound_min().date().isoformat()
    assert entries["exchange:XTKS"]["start"] == tokyo
    assert entries["exchange:XTAI"]["start"] == "2019-01-01"
    assert entries["exchange:XHKG"]["end"] == "2040-12-31"
```

- [ ] **Step 5: Run them to see them fail**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"`
Expected: FAIL — `ImportError: cannot import name 'bounds'` and the 1996 request does not raise.

- [ ] **Step 6: Implement `bounds` in `registry.py`**

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Explicit qualified trading calendars. A MIC is resolved, never guessed.

Each name here has a conformance fixture whose facts tests/test_qualification.py checks
against the exchange's published schedule (review I6).
"""
from datetime import date

CALENDARS = ("XNYS", "XLON", "XHKG", "XTKS", "XASX", "XTAE", "XTSE", "XETR", "XTAI")
# The window the routes serve at all, as the legacy envelope always has.
FLOOR, CEILING = date(1990, 1, 1), date(2040, 12, 31)
# Limits the supplier cannot know: Taiwan's pre-2019 weekend make-up sessions are unverified.
QUALIFIED_FROM = {"XTAI": date(2019, 1, 1)}


def resolve_calendar(identifier):
    if not isinstance(identifier, str):
        raise ValueError("unknown calendar")
    name = identifier.removeprefix("exchange:")
    if name not in CALENDARS:
        raise ValueError("unknown or unqualified calendar")
    return name


def bounds(name):
    """The dates a calendar is served for: the supplier's own bounds, inside FLOOR..CEILING."""
    import exchange_calendars as xc

    supplier = type(xc.get_calendar(name))
    low, high = supplier.bound_min(), supplier.bound_max()
    start = max(FLOOR, QUALIFIED_FROM.get(name, FLOOR), low.date() if low is not None else FLOOR)
    end = min(CEILING, high.date() if high is not None else CEILING)
    return start, end
```

- [ ] **Step 7: Check bounds in `supplier.generate_bundle` and in capabilities**

In `supplier.py`, import `bounds` and replace the XTAI special case:

```python
from .registry import bounds, resolve_calendar
...
    name = resolve_calendar(calendar_id)
    low, high = bounds(name)
    if start < low:
        raise ValueError(f"historical {name} sessions before {low.isoformat()} are unqualified")
    if end > high:
        raise ValueError(f"{name} is served to {high.isoformat()}")
```

(The existing Taiwan test `match="historical"` still matches.) In `calendar_v1.py` replace the hard-coded `start`/`end` in `capabilities()`:

```python
from openbq_calendar.registry import CALENDARS, bounds
...
def _entry(name):
    import exchange_calendars as xc

    start, end = bounds(name)
    return {
        "calendarId": "exchange:" + name,
        "name": name,
        "timezone": str(xc.get_calendar(name).tz),
        "kind": "exchange_trading",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "policies": ["operational-v1", "planning-v1"],
        "aliases": [{"alias": name, "calendarId": "exchange:" + name}],
    }


async def capabilities():
    return {
        "schemaVersion": 1,
        "providerId": "openbq-calendar/0.1.0",
        "calendars": [_entry(name) for name in CALENDARS],
        "limits": {"members": 8, "days": 366 * 20, "steps": 10000, "expressions": 100, "bytes": MAX_BYTES},
    }
```

(Task 3 moves this off the event loop.)

- [ ] **Step 8: Run the provider tests**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"`
Expected: all pass (`32 passed`).

- [ ] **Step 9: Commit**

```bash
git -C "$OD" add calendar-core v4/routes
git -C "$OD" commit -m "feat(v4): qualify all nine calendars with fixtures; report the supplier's bounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 [openbq-docker]: Whole-year bundles under a byte budget; capabilities off the event loop

**Files:**
- Modify: `$OD/v4/routes/openbq_routes/calendar_v1.py`
- Test: `$OD/v4/routes/tests/test_calendar_v1.py`

**Interfaces:**
- Consumes: `generate_bundle`, `bounds`, `_entry` (Task 2).
- Produces: `build_bundle(calendar_id: str, start_year: int, end_year: int) -> bytes`; `clear_cache() -> None`; `CACHE_BYTES`; the bundle route always answers with whole-year coverage (`YYYY-01-01..YYYY-12-31`) containing the request — the client (Task 10) accepts a bundle that covers more than it asked.

- [ ] **Step 1: Write the failing tests**

Append to `$OD/v4/routes/tests/test_calendar_v1.py`:

```python
import asyncio

from openbq_routes import calendar_v1


def test_requests_inside_one_year_share_one_whole_year_build(monkeypatch):
    calendar_v1.clear_cache()
    calls = []
    real = calendar_v1.generate_bundle

    def counting(*args, **kwargs):
        calls.append(args)
        return real(*args, **kwargs)

    monkeypatch.setattr(calendar_v1, "generate_bundle", counting)
    for start in ("2026-01-02", "2026-03-01"):
        r = client.get(BUNDLE, params={"calendar_id": "exchange:XNYS", "start": start, "end": "2026-06-30"})
        assert r.status_code == 200
        assert r.json()["coverage"] == {"start": "2026-01-01", "end": "2026-12-31", "complete": True}
    # "XNYS" and "exchange:XNYS" are one calendar, so one cache key.
    assert client.get(BUNDLE, params={"calendar_id": "XNYS", "start": "2026-05-05", "end": "2026-05-05"}).status_code == 200
    assert len(calls) == 1


def test_the_cache_stays_inside_its_byte_budget(monkeypatch):
    monkeypatch.setattr(calendar_v1, "CACHE_BYTES", 300_000)
    calendar_v1.clear_cache()
    for year in range(2020, 2027):
        calendar_v1.build_bundle("exchange:XNYS", year, year)
    assert calendar_v1.cached_bytes() <= 300_000
    assert calendar_v1.cached_entries() < 7


def test_capabilities_are_built_once_and_off_the_event_loop(monkeypatch):
    calendar_v1._capabilities.cache_clear()
    on_loop = []
    real = calendar_v1.bounds

    def watching(name):
        try:
            asyncio.get_running_loop()
            on_loop.append(True)
        except RuntimeError:
            on_loop.append(False)
        return real(name)

    monkeypatch.setattr(calendar_v1, "bounds", watching)
    client.get(CALENDARS_ROUTE)
    client.get(CALENDARS_ROUTE)
    assert len(on_loop) == len(calendar_v1.CALENDARS) and not any(on_loop)
```

- [ ] **Step 2: Run to see them fail**

Run: `PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/v4/routes/tests"`
Expected: FAIL — `AttributeError: module 'openbq_routes.calendar_v1' has no attribute 'clear_cache'`.

- [ ] **Step 3: Implement the bounded cache, whole-year alignment and threaded capabilities**

Replace the body of `calendar_v1.py` below its imports (keep `register`):

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Bounded schedule interchange, also consumable by future retained providers.

Bundles are built for whole calendar years and cached as JSON bytes under one byte budget
(review I5): a request whose `start` moves by a day reuses the year it falls in instead of
generating and holding another multi-year bundle. The answer can therefore cover more than
was asked; the client accepts that, since a bundle's own coverage is what its operations
check. Capabilities need exchange_calendars to build every calendar once, which is slow, so
they are built once, in a worker thread, never on the event loop.
"""
import asyncio
import json
import threading
from collections import OrderedDict
from datetime import date, datetime, timezone
from functools import lru_cache

from starlette.responses import JSONResponse, Response

from openbq_calendar.registry import CALENDARS, bounds, resolve_calendar
from openbq_calendar.supplier import generate_bundle

MAX_BYTES = 16 * 1024 * 1024
# ponytail: one process-wide budget (about four 20-year bundles); per-calendar budgets if a deployment needs more.
CACHE_BYTES = 64 * 1024 * 1024
_cache: OrderedDict = OrderedDict()
_cache_bytes = 0
_lock = threading.Lock()


def clear_cache():
    global _cache_bytes
    with _lock:
        _cache.clear()
        _cache_bytes = 0


def cached_bytes():
    return _cache_bytes


def cached_entries():
    return len(_cache)


def build_bundle(calendar_id, start_year, end_year):
    """One whole-year bundle as JSON bytes, from the cache when it holds it."""
    global _cache_bytes
    key = ("exchange:" + resolve_calendar(calendar_id), start_year, end_year)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    body = generate_bundle(
        key[0], date(start_year, 1, 1), date(end_year, 12, 31), generated_at=datetime.now(timezone.utc)
    )
    raw = json.dumps(body, separators=(",", ":")).encode()
    with _lock:
        if key not in _cache and len(raw) <= CACHE_BYTES:
            _cache[key] = raw
            _cache_bytes += len(raw)
            while _cache_bytes > CACHE_BYTES:
                _, old = _cache.popitem(last=False)
                _cache_bytes -= len(old)
    return raw


def _entry(name):
    import exchange_calendars as xc

    start, end = bounds(name)
    return {
        "calendarId": "exchange:" + name,
        "name": name,
        "timezone": str(xc.get_calendar(name).tz),
        "kind": "exchange_trading",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "policies": ["operational-v1", "planning-v1"],
        "aliases": [{"alias": name, "calendarId": "exchange:" + name}],
    }


@lru_cache(maxsize=1)
def _capabilities():
    return {
        "schemaVersion": 1,
        "providerId": "openbq-calendar/0.1.0",
        "calendars": [_entry(name) for name in CALENDARS],
        "limits": {"members": 8, "days": 366 * 20, "steps": 10000, "expressions": 100, "bytes": MAX_BYTES},
    }


async def capabilities():
    return await asyncio.to_thread(_capabilities)


async def bundle(calendar_id: str, start: str, end: str):
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
        if first > last:
            raise ValueError("start must not follow end")
        raw = await asyncio.to_thread(build_bundle, calendar_id, first.year, last.year)
    except (ValueError, KeyError, OverflowError) as e:
        return JSONResponse({"error": {"code": "CALENDAR_UNAVAILABLE", "message": str(e)[:256]}}, status_code=422)
    if len(raw) > MAX_BYTES:
        return JSONResponse({"error": {"code": "RESOURCE_LIMIT"}}, status_code=413)
    return Response(raw, media_type="application/json")
```

`_entry` is Task 2's function unchanged; it must read `bounds` as this module's global so the test's monkeypatch reaches it. The old `@lru_cache(maxsize=256) build_bundle` keyed on raw strings is gone.

- [ ] **Step 4: Run all provider tests and the public check**

Run:
```bash
PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"
python3 -m ruff check --select E,W,F --line-length 120 "$OD/calendar-core" "$OD/v4/routes/openbq_routes/calendar_v1.py" "$OD/v4/routes/tests"
(cd "$OD" && python3 scripts/check-public.py)
```
Expected: `35 passed`; `All checks passed!`; check-public exits 0.

- [ ] **Step 5: Commit**

```bash
git -C "$OD" add v4/routes
git -C "$OD" commit -m "fix(v4): whole-year bundle cache under a byte budget; capabilities off the event loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 [bdobb]: Install, format PR #67's TypeScript, headers first, top-level type imports

**Files:**
- Modify (format + doc comments): `$BDOBB/src/lib/calendars/*.ts`, `$BDOBB/scripts/vendor-calendar-contract.mjs`, `$BDOBB/scripts/vendor-calendar-contract.test.mjs`
- Modify: `$BDOBB/src/lib/dataClient.ts:1-2`, `$BDOBB/src/lib/dateExpressions.ts:1-2`, `$BDOBB/src/lib/types.ts`, `$BDOBB/src/lib/params.ts`, `$BDOBB/src/hooks/useWidgetData.ts:127`, `$BDOBB/src/lib/calendars/widget.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no behaviour change; later tasks' snippets assume this formatting.

- [ ] **Step 1: Install dependencies (the worktree has no node_modules)**

Run: `pnpm -C "$BDOBB" install --frozen-lockfile`
Expected: completes without lockfile changes (`git -C "$BDOBB" status --short` shows nothing).

- [ ] **Step 2: Format the PR's dense files**

Run: `pnpm -C "$BDOBB" dlx prettier@3.3.3 --print-width 120 --write src/lib/calendars/*.ts scripts/vendor-calendar-contract.mjs scripts/vendor-calendar-contract.test.mjs`
Expected: each file rewritten to 2-space, double-quoted, one statement per line.

- [ ] **Step 3: Put the license header first**

In `src/lib/dataClient.ts` move `import {createBundleProvider} …` and `import {prepareWidgetCalendar} …` below the two header lines into the import block. In `src/lib/dateExpressions.ts` move `import {lastCompleted} …` and `import {calendarValue} …` below the header, into the existing import groups (`calendarValue` joins the `./calendar` import list). In `scripts/vendor-calendar-contract.test.mjs` swap the first two lines so the Copyright line comes first.

- [ ] **Step 4: Replace inline `import()` types with top-level `import type`**

- `src/lib/types.ts`: add `import type { CalendarBinding, Policy } from "./calendars/contracts";` and write `calendarBinding?: CalendarBinding; calendarResolutionPolicy?: Policy;`.
- `src/lib/params.ts`: add `import type { ResolutionResult } from "./calendars/resolver";` and use it in `onCalendarResolution`.
- `src/hooks/useWidgetData.ts`: add `import type { ResolutionResult } from "../lib/calendars/resolver";` and write `useState<ResolutionResult[]>([])`.
- `src/lib/calendars/widget.ts`: import `PeriodType` with the other `../dateExpressions` names and cast `p.type as PeriodType`.

- [ ] **Step 5: Add a doc comment to every exported symbol that has none**

Use exactly these (each above its export):

| File | Symbol | Doc comment |
|---|---|---|
| artifact.ts | `canonical` | `/** RFC 8785-style canonical JSON: sorted keys, no whitespace; refuses numbers JSON cannot carry exactly. */` |
| artifact.ts | `sha256` | `/** Lower-case hex SHA-256 of a string's UTF-8 bytes, via WebCrypto. */` |
| artifact.ts | `verifyBundle` | `/** A bundle that passes the vendored schema AND whose content digest matches; anything else throws. */` |
| contracts.ts | `Policy` | `/** Resolution strictness: legacy-v1 is v3 behaviour; operational-v1 blocks provisional/conflict days; planning-v1 accepts provisional. */` |
| contracts.ts | `LIMITS` | `/** The calendar contract's resource ceilings, shared with openbq-docker's capabilities. */` |
| contracts.ts | `CalendarError` | `/** A calendar failure with a stable code; \`message\` is what a card shows. */` |
| contracts.ts | `isoDay`, `utcInstant` | `/** A real calendar day as YYYY-MM-DD. */` / `/** A UTC instant as the bundle writes it: seconds, optional fraction, Z. */` |
| contracts.ts | `freeze` | `/** Deep-freezes a value in place so a retained bundle cannot be mutated after verification. */` |
| contracts.ts | `validateBundle` | `/** Schema plus the invariants the schema cannot state: coverage, ordered sessions, authority evidence, branches. */` |
| contracts.ts | `parseBinding` | `/** A manifest calendarBinding, validated and normalised (joint members sorted); throws INVALID_BINDING. */` |
| operations.ts | `CalendarIndex`, `Outcome` | `/** A bundle with its days by date and its open session labels in order. */` / `/** An operation's answer with the range it consulted, or why it has none. */` |
| operations.ts | `createIndex` | `/** Indexes a verified bundle for the operations below. */` |
| operations.ts | `dayState`, `shiftSessionDate`, `rollSessionDate`, `sessionBounds`, `lastCompleted`, `jointDates` | `/** One day's record. */`, `/** \`n\` sessions from \`date\`, strictly past a closed anchor; 0 is the date itself. */`, `/** The date rolled to a session by a business-day convention. */`, `/** That session's real open and close (early closes kept). */`, `/** The latest session whose close is at or before \`instant\`. */`, `/** Dates open on all, or any, of several calendars; every member must cover the range. */` |
| program.ts | `ResolutionProgram`, `compileProgram` | `/** An expression compiled once for a batch: its AST, output type and limits. */` / `/** Parses and bounds an expression for the resolution service; throws on anything it cannot run. */` |
| provider.ts | `createBundleProvider`, `prepareCalendarBatch` | `/** A CalendarProvider over a fetch function, verifying and caching what it loads. */` / `/** Loads every calendar a batch names and freezes one reference instant and bundle vector for it. */` |
| resolver.ts | `calendarForContext`, `evaluateProgram`, `localResolutionService` | `/** The ExchangeCalendar a run context selects, after checking its vector against the bundles. */` / `/** One compiled program resolved under its run context; never throws, returns a typed unavailable instead. */` / `/** The in-process resolution service (a server one can replace it with the same interface). */` |
| schema.ts | `matchesJsonSchema` | `/** The subset of JSON Schema the vendored calendar schema uses; false on any mismatch or malformed schema. */` |

- [ ] **Step 6: Verify nothing changed in behaviour**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/lib/calendars src/lib/calendar.test.ts src/lib/dateExpressions.test.ts
pnpm -C "$BDOBB" typecheck
pnpm -C "$BDOBB" exec eslint src/lib/calendars src/lib/dataClient.ts src/lib/dateExpressions.ts src/lib/params.ts src/lib/types.ts src/hooks/useWidgetData.ts
pnpm -C "$BDOBB" scrub
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" add -A src/lib scripts/vendor-calendar-contract.mjs scripts/vendor-calendar-contract.test.mjs src/hooks/useWidgetData.ts
git -C "$BDOBB" commit -m "style(v4): format the calendar modules, headers first, top-level type imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 [bdobb]: Vendor the qualified contract; make the vendoring test run

**Files:**
- Modify (generated): `$BDOBB/src/lib/calendars/vendor/**`
- Modify: `$BDOBB/package.json` (`test:web` script)

**Interfaces:**
- Consumes: Task 2's fixtures; `export_contract` (`python3 -m openbq_calendar.artifact <dir>`); `vendorCalendarContract(source, target)`.
- Produces: `src/lib/calendars/vendor/conformance/{XLON,XTSE,XETR,XTKS,XASX,XTAE,XNYS-2026-12}.json` for Tasks 6–11.

- [ ] **Step 1: Export from the provider and vendor**

```bash
rm -rf "$SCRATCH/calendar-contract"
PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.artifact "$SCRATCH/calendar-contract"
node "$BDOBB/scripts/vendor-calendar-contract.mjs" "$SCRATCH/calendar-contract"
git -C "$BDOBB" status --short src/lib/calendars/vendor
```
Expected: seven new conformance files and a changed `manifest.json`. If `calendar-v1.schema.json` also changed, that is the host's pydantic version writing the schema; keep it, and record it in Task 14's evidence note.

- [ ] **Step 2: Run the vendoring test (it ran nowhere before)**

In `package.json` change `"test:web": "node --test web/*.test.mjs"` to:

```json
"test:web": "node --test web/*.test.mjs scripts/vendor-calendar-contract.test.mjs",
```

Run: `pnpm -C "$BDOBB" test:web`
Expected: all pass, including `verifies bytes before replacing the old artifact`.

- [ ] **Step 3: Run the calendar tests against the new vendor set**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C "$BDOBB" add package.json src/lib/calendars/vendor
git -C "$BDOBB" commit -m "chore(v4): vendor the nine-calendar contract; test:web runs the vendoring test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 [bdobb]: Evidence ruling, revision identity, composite maps, bundle calendars

**Files:**
- Modify: `$BDOBB/src/lib/calendars/operations.ts` (`check`), `$BDOBB/src/lib/calendars/resolver.ts` (`composite`, `calendarForContext`, new `bundleCalendar`), `$BDOBB/src/lib/calendars/contracts.ts` (new `bundleRevision`), `$BDOBB/src/lib/calendars/provider.ts` (vector revision, `load` revision check), `$BDOBB/src/lib/calendar.ts` (`CalendarTrace`, `calendarValue`, `sessionOpen`, `sessionClose`, `isOpen`/`nextOpen`/`prevOpen`/`addBusinessDays` pass `trace`)
- Modify: `$BDOBB/src/lib/dateExpressions.ts` (`resolveAnchor` passes `trace` to `sessionOpen`/`sessionClose`)
- Test: `$BDOBB/src/lib/calendars/operations.test.ts`, `$BDOBB/src/lib/calendars/resolver.test.ts`, `$BDOBB/src/lib/calendars/fx.test.ts`, `$BDOBB/src/lib/calendars/provider.test.ts`

**Interfaces:**
- Produces:
  - `bundleRevision(b: CalendarBundle): string` — `${definitionRevision}@${source.ruleDigest}` (contracts.ts).
  - `bundleCalendar(bundles: CalendarBundle[], binding: CalendarBinding, policy: Policy): ExchangeCalendar` (resolver.ts) — no `calendarUse`, so a cached calendar never accumulates state.
  - `CalendarTrace.provisional?: boolean`.
  - `calendarValue<T>(cal: ExchangeCalendar, result: Outcome<T>, trace?: CalendarTrace): T` — throws `CalendarError(reason, "<code> <reason> (revision <r>, coverage <start> to <end>)")`.
  - `sessionOpen(cal, date, trace?)`, `sessionClose(cal, date, trace?)`.

- [ ] **Step 1: Replace the test that locked in the inverted strictness**

In `operations.test.ts` replace `it('rejects unresolved authority and incomplete history rather than guess', …)` with:

```ts
it("blocks provisional and conflict days under operational-v1 and resolves confirmed ones (ruling 2026-10-23)", () => {
  for (const status of ["library_baseline", "authority_confirmed", "market_final", "operator_final"] as const) {
    const b = bundle();
    b.days[3].evidenceStatus = status;
    expect(shiftSessionDate(createIndex(b), "2026-01-03", 1)).toMatchObject({ status: "resolved", value: "2026-01-05" });
  }
  const provisional = bundle();
  provisional.days[3].evidenceStatus = "provisional";
  expect(shiftSessionDate(createIndex(provisional), "2026-01-03", 1)).toMatchObject({
    status: "unavailable",
    reason: "PROVISIONAL_CALENDAR",
  });
  expect(shiftSessionDate(createIndex(provisional), "2026-01-03", 1, "planning-v1")).toMatchObject({
    status: "provisional",
    value: "2026-01-05",
  });
  const conflict = bundle();
  conflict.days[3].evidenceStatus = "conflict";
  expect(shiftSessionDate(createIndex(conflict), "2026-01-03", 1, "planning-v1")).toMatchObject({
    status: "unavailable",
    reason: "AMBIGUOUS_CALENDAR",
  });
});
```

- [ ] **Step 2: Add the resolver tests (revision, steps, XHKG/XTAI fixtures, failure detail)**

Append to `resolver.test.ts` (add imports `bundleCalendar`, `bundleRevision`, `resolveValue`, `newTrace`, and the XHKG/XTAI fixtures):

```ts
import xhkg from "./vendor/conformance/XHKG.json";
import xtai from "./vendor/conformance/XTAI.json";
import { bundleRevision } from "./contracts";
import { bundleCalendar } from "./resolver";
import { resolveValue } from "../dateExpressions";
import { newTrace } from "../calendar";

const single = (mic: string) => ({ schemaVersion: 1 as const, kind: "single" as const, calendarId: `exchange:${mic}` });

it("keeps a bundle's revision distinct from its content digest", () => {
  expect(bundleRevision(b)).toBe(`${b.definitionRevision}@${b.source.ruleDigest}`);
  expect(bundleRevision(b)).not.toBe(b.digest);
});

it("caps the business-day steps of both directions together", () => {
  // Offset keeps its sign apart from its amount, so the sum is already absolute; this pins it.
  expect(() => compileProgram("T+5000bd-5001bd", "date")).toThrow("RESOURCE_LIMIT");
});

it("reads the XHKG and XTAI fixtures through bundleCalendar", () => {
  const hk = bundleCalendar([xhkg as CalendarBundle], single("XHKG"), "operational-v1");
  // The lunch break splits the session; the close is the last segment's end.
  expect(resolveValue("datetime", "session_close", { now: new Date("2026-01-02T02:00:00Z"), zone: "Asia/Hong_Kong", calendar: hk, exchange: "XHKG" })).toBe(
    "2026-01-02T16:00:00+08:00",
  );
  const tw = bundleCalendar([xtai as CalendarBundle], single("XTAI"), "operational-v1");
  // 2025-02-08 is a government make-up workday, not an exchange session.
  expect(resolveValue("date", "T-1bd", { now: new Date("2025-02-10T06:00:00Z"), zone: "Asia/Taipei", calendar: tw, exchange: "XTAI" })).toBe("2025-02-07");
});

it("marks the trace provisional under planning-v1", () => {
  const p = structuredClone(b) as CalendarBundle;
  p.days[0].evidenceStatus = "provisional";
  const trace = newTrace();
  const cal = bundleCalendar([p], single("XNYS"), "planning-v1");
  expect(resolveValue("date", "T-1bd", { now: new Date("2026-11-27T19:00:00Z"), zone: "America/New_York", calendar: cal, exchange: "XNYS", trace })).toBe("2026-11-25");
  expect(trace.provisional).toBe(true);
});
```

(The failure-detail test for `calendarValue`'s message needs `onError`, so it is written in Task 9.) In `resolver.test.ts`, `fx.test.ts` and `provider.test.ts` change every `revision: b.digest` / `revision: fixture.digest` to `revision: bundleRevision(b)` / `bundleRevision(fixture as CalendarBundle)`.

- [ ] **Step 3: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars`
Expected: FAIL — operational accepts nothing confirmed; `bundleCalendar`/`bundleRevision` not exported.

- [ ] **Step 4: Implement**

`contracts.ts`, after `CalendarRevisionRef`:

```ts
/**
 * The calendar definition a bundle was cut from: the same for every date range cut from it, unlike the content digest
 * (parent design: "delivery, fact key, and immutable revision identity remain distinct"; review minor: they were equal).
 */
export const bundleRevision = (b: CalendarBundle): string => `${b.definitionRevision}@${b.source.ruleDigest}`;
```

`operations.ts`, inside `check` replace the two evidence lines with:

```ts
    if (day.state === "unresolved" || day.evidenceStatus === "conflict" || (day.candidates.length && !day.selectedBranch))
      return unavailable("AMBIGUOUS_CALENDAR");
    // Ruling 2026-10-23: only `provisional` is planning-grade. A confirmed, final or library day resolves.
    if (day.evidenceStatus === "provisional") {
      if (policy !== "planning-v1") return unavailable("PROVISIONAL_CALENDAR");
      provisional = true;
    }
```

`resolver.ts`, `composite` (maps instead of `days.find`, and the ruling's status):

```ts
function composite(bundles: CalendarBundle[], context: RunContext): CalendarIndex {
  const index = createIndex(bundles[0]);
  if (context.binding.kind === "single") return index;
  const mode = context.binding.mode;
  // One map per member: each day is a lookup, not a scan (review minor: was O(n²·k)).
  const members = bundles.map((b) => new Map(b.days.map((d) => [d.date, d])));
  const days = new Map<string, CalendarDay>();
  for (const d of bundles[0].days) {
    const found = members.map((m) => m.get(d.date));
    if (found.some((x) => !x)) continue;
    const actual = found as CalendarDay[];
    const ambiguous = actual.some(
      (x) => x.state === "unresolved" || (x.candidates.length && !x.selectedBranch) || x.evidenceStatus === "conflict",
    );
    const open = mode === "all_open" ? actual.every((x) => x.state === "open") : actual.some((x) => x.state === "open");
    const evidenceStatus = ambiguous
      ? "conflict"
      : actual.some((x) => x.evidenceStatus === "provisional")
        ? "provisional"
        : "library_baseline";
    days.set(d.date, { ...d, state: ambiguous ? "unresolved" : open ? "open" : "closed", evidenceStatus });
  }
  return {
    bundle: {
      ...bundles[0],
      coverage: {
        start: bundles.map((b) => b.coverage.start).sort().at(-1)!,
        end: bundles.map((b) => b.coverage.end).sort()[0],
        complete: bundles.every((b) => b.coverage.complete),
      },
    },
    days,
    labels: [...days.values()].filter((x) => x.state === "open").map((x) => x.date),
  };
}
```

`calendarForContext`: change the revision check to `if (!b || ref?.revision !== bundleRevision(b)) throw new CalendarError("INVALID_VECTOR");`. `provider.ts`: in `prepareCalendarBatch` write `revision: bundleRevision(b)`; in `load` compare `r.revision !== bundleRevision(b)`.

Add to `resolver.ts`:

```ts
/**
 * Verified bundles as the ExchangeCalendar every resolver helper reads, for one binding and policy: the same calendar
 * the batch service builds, without its per-run `calendarUse` record, so a calendar shared by every card on a
 * dashboard holds no state. The reference instant is irrelevant to building it and is fixed.
 */
export function bundleCalendar(bundles: CalendarBundle[], binding: CalendarBinding, policy: Policy): ExchangeCalendar {
  const ids = binding.kind === "single" ? [binding.calendarId] : binding.members;
  const vector = ids.map((id) => {
    const b = bundles.find((x) => x.calendarId === id);
    if (!b) throw new CalendarError("COVERAGE_UNAVAILABLE", `No bundle for ${id}`);
    return { calendarId: id, revision: bundleRevision(b), digest: b.digest };
  });
  const context: RunContext = {
    schemaVersion: 1,
    referenceInstant: "1970-01-01T00:00:00Z",
    binding,
    policy,
    vector,
    resolverVersion: "calendar-v1",
  };
  return { ...calendarForContext(context, bundles), calendarUse: undefined };
}
```

`calendar.ts`:

```ts
export type CalendarTrace = { years: Set<number>; fallback: boolean; reason?: string; provisional?: boolean };

/**
 * One retained-bundle operation's answer (PR #67), or a CalendarError that names the calendar, its revision and its
 * coverage, so the card can say why it has none (review I7). A provisional answer -- planning-v1 only -- marks the
 * trace; that flag is what the card's Provisional badge reads.
 */
export function calendarValue<T>(cal: ExchangeCalendar, result: Outcome<T>, trace?: CalendarTrace): T {
  if (result.status === "unavailable") {
    const bundle = cal.sessionIndex?.bundle;
    const detail = bundle
      ? ` (revision ${bundleRevision(bundle)}, coverage ${bundle.coverage.start} to ${bundle.coverage.end})`
      : "";
    throw new CalendarError(result.reason, `${cal.code} ${result.reason}${detail}`);
  }
  if (cal.calendarUse) {
    cal.calendarUse.ranges.push(result.consulted);
    if (result.status === "provisional") cal.calendarUse.provisional = true;
  }
  if (result.status === "provisional" && trace) trace.provisional = true;
  return result.value;
}
```

Import `bundleRevision` from `./calendars/contracts`. Give `sessionOpen` and `sessionClose` a trailing `trace?: CalendarTrace` and pass it to `calendarValue`; pass the existing `trace` to `calendarValue` in `isOpen`, `nextOpen`, `prevOpen` and `addBusinessDays`. In `dateExpressions.ts` `resolveAnchor`, pass `trace` as the third argument of every `sessionOpen`/`sessionClose` call, and in `tradeDate` pass `trace` to `calendarValue`.

- [ ] **Step 5: Run the tests**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars src/lib/calendar.test.ts src/lib/dateExpressions.test.ts && pnpm -C "$BDOBB" typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "$BDOBB" add src/lib
git -C "$BDOBB" commit -m "fix(v4): evidence ruling, distinct revisions, composite maps, bundleCalendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 [bdobb]: The `@` production and the `(MIC)` suffix in the grammar

**Files:**
- Modify: `$BDOBB/src/lib/dateExpressions.ts` (types, `parseAtom`, `stringifyAtom`, `openbbAtom`, `applyAt`, `resolveExpression`, `atFits`, `resolveValue`, `isExpression`, grammar comment), `$BDOBB/src/lib/calendar.ts` (export `consult`), `$BDOBB/src/lib/presets.ts` (`rowsFromExpression`)
- Test: `$BDOBB/src/lib/dateExpressions.test.ts`, `$BDOBB/src/lib/presets.test.ts`

**Interfaces:**
- Produces:
  - `type AtTime = { kind: "clock"; hour: number; minute: number } | { kind: "open" } | { kind: "close" }`
  - `type Atom = { anchor: Anchor; offsets: Offset[]; at?: AtTime; calendar?: string }` — `calendar` is the upper-cased text inside `(…)`, unvalidated (Task 9 refuses unknown ones).
  - `consult(cal, date, trace)` exported from calendar.ts.
  - `applyAt(instant: ZonedDateTime, at: AtTime, cal: ExchangeCalendar, clockZone: string, trace?: CalendarTrace): ZonedDateTime` (module-private).

- [ ] **Step 1: Write the failing tests**

Append to `dateExpressions.test.ts` (imports: `parseExpression, stringifyExpression, serializeExpression, resolveValue, isExpression, previewExpression`, `bundledCalendar, newTrace` from `./calendar`, `parseZonedDateTime` from `@internationalized/date`):

```ts
describe("the @ production (port of bdobb-v2 f8fcfdc16) and the (MIC) suffix", () => {
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  const ny = (s: string) => parseZonedDateTime(`${s}[America/New_York]`).toDate();
  const on = (type: "date" | "datetime", expr: string, now: Date) => resolveValue(type, expr, { now, zone: NY, calendar: cal });
  const T = { kind: "named", name: "T" } as const;
  const back1bd = [{ sign: -1, amount: 1, unit: "bd" }];

  it("parses every example in the spec", () => {
    expect(parseExpression("T-1bd(XLON)")).toEqual({ start: { anchor: T, offsets: back1bd, calendar: "XLON" } });
    expect(parseExpression("T-1bd@close(XNYS)")).toEqual({
      start: { anchor: T, offsets: back1bd, at: { kind: "close" }, calendar: "XNYS" },
    });
    expect(parseExpression("T@09:30(XTKS)")).toEqual({
      start: { anchor: T, offsets: [], at: { kind: "clock", hour: 9, minute: 30 }, calendar: "XTKS" },
    });
    expect(parseExpression("FQ0@open(XHKG)")?.start).toEqual({
      anchor: { kind: "period", period: "FQ", n: 0 },
      offsets: [],
      at: { kind: "open" },
      calendar: "XHKG",
    });
    expect(parseExpression("T-5bd(XLON)..T(XLON)")).toMatchObject({ start: { calendar: "XLON" }, end: { calendar: "XLON" } });
    // Mixed calendars in one range are allowed; an atom without a suffix is the object it always was.
    expect(parseExpression("T-5bd(XLON)..T")?.end).toEqual({ anchor: T, offsets: [] });
  });

  it("keeps @ strict: two digits each side, a real time, an anchor in front", () => {
    for (const v of ["T@9:5", "T@25:00", "T@14:60", "@14:00", "T@noon"]) expect(parseExpression(v), v).toBeNull();
    expect(on("datetime", "T@9:5", ny("2026-09-14T09:30:00"))).toBe("T@9:5");
  });

  it("reads (MIC) with and without @, and on range atoms", () => {
    expect(parseExpression("T(XNYS)")?.start).toEqual({ anchor: T, offsets: [], calendar: "XNYS" });
    expect(parseExpression("T@close(XNYS)")?.start.at).toEqual({ kind: "close" });
    expect(parseExpression("T-1bd/T(XTKS)")?.end?.calendar).toBe("XTKS");
  });

  it("keeps an unknown MIC for the resolver to refuse, and rejects an unclosed or empty one", () => {
    expect(parseExpression("T(XNYZ)")?.start.calendar).toBe("XNYZ");
    expect(parseExpression("T(XNYS")).toBeNull();
    expect(parseExpression("T()")).toBeNull();
  });

  it("folds case and whitespace in both suffixes (review focus 5)", () => {
    expect(stringifyExpression(parseExpression("t-1bd @ CLOSE ( xlon )")!)).toBe("T-1bd@close(XLON)");
  });

  it("round-trips the suffixes and never writes OpenBB's spelling for an atom that has one", () => {
    for (const v of ["T@14:00", "T@00:05", "FQ0@open", "T-1bd@close(XNYS)", "T-5bd(XLON)/T", "T@09:30/T@16:00"]) {
      expect(serializeExpression(parseExpression(v)!)).toBe(v);
    }
    expect(serializeExpression(parseExpression("T-3mo")!)).toBe("$currentDate-3M");
    expect(serializeExpression(parseExpression("T(XNYS)")!)).toBe("T(XNYS)");
  });

  it("T@14:00 is that date at 14:00 on the exchange's clock, whatever the viewer's zone", () => {
    expect(on("datetime", "T@14:00", ny("2026-09-14T09:30:00"))).toBe("2026-09-14T14:00:00-04:00");
    const tokyoMorning = parseZonedDateTime("2026-09-15T08:00:00[Asia/Tokyo]").toDate();
    expect(resolveValue("datetime", "T@14:00", { now: tokyoMorning, zone: "Asia/Tokyo", calendar: cal })).toBe("2026-09-14T14:00:00-04:00");
    expect(on("datetime", "T-1w@09:30", ny("2026-09-14T16:05:00"))).toBe("2026-09-07T09:30:00-04:00");
  });

  it("FQ0@open is the quarter's first session open, and the weekday table answers with a fallback", () => {
    expect(on("datetime", "FQ0@open", ny("2026-09-14T09:30:00"))).toBe("2026-07-01T09:30:00-04:00");
    const trace = newTrace();
    expect(resolveValue("datetime", "T@open", { now: ny("2026-09-14T09:30:00"), zone: NY, exchange: "XLON", trace })).toBe(
      "2026-09-14T08:00:00+01:00",
    );
    expect(trace.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
  });

  it("T-1bd@close from a Monday is Friday's close, early closes honoured", () => {
    expect(on("datetime", "T-1bd@close", ny("2026-09-14T09:30:00"))).toBe("2026-09-11T16:00:00-04:00");
    expect(on("datetime", "T-1bd@close", ny("2026-11-30T09:30:00"))).toBe("2026-11-27T13:00:00-05:00");
  });

  it("@ off a datetime param is a literal; (MIC) is an expression on any period type", () => {
    const now = ny("2026-09-14T09:30:00");
    expect(on("date", "T@14:00", now)).toBe("T@14:00");
    expect(isExpression("date", "T@14:00")).toBe(false);
    expect(isExpression("date_range", "T@09:30/T@16:00")).toBe(false);
    expect(isExpression("datetime", "T@14:00")).toBe(true);
    expect(isExpression("date", "T-1bd(XLON)")).toBe(true);
    expect(isExpression("date_range", "T-5bd(XLON)..T")).toBe(true);
    expect(previewExpression("date", "T@14:00", { now, zone: NY, calendar: cal })).toBeNull();
  });

  it("leaves T, TSLA and T(XLON) literals in a symbol field", () => {
    for (const v of ["T", "TSLA", "T(XLON)"]) expect(resolveValue("text", v, {})).toBe(v);
  });
});
```

Append to `presets.test.ts`:

```ts
it("refuses rows for an atom with @ or (MIC), so Apply cannot strip it", () => {
  expect(rowsFromExpression("datetime", "T@14:00")).toBeNull();
  expect(rowsFromExpression("date", "T-1bd(XLON)")).toBeNull();
  expect(rowsFromExpression("date_range", "T-5bd(XLON)/T")).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/dateExpressions.test.ts src/lib/presets.test.ts`
Expected: FAIL — `T-1bd(XLON)` parses as null.

- [ ] **Step 3: Implement the parser**

In `dateExpressions.ts`: extend the grammar comment with

```
 *   atom       := anchor ( sign offset )* at? cal?
 *   at         := "@" ( HH ":" MM | "open" | "close" )   -- port of bdobb-v2 v12.3.0
 *   cal        := "(" MIC ")"                              -- v4 calendar qualifier (2026-10-23)
```

Add after `Expression`'s neighbours:

```ts
/**
 * The `@` production (bdobb-v2 v12.3.0, f8fcfdc16): a time of day pinned onto whatever date the anchor and its
 * offsets land on. `clock` is a wall time on the calendar's clock; `open` and `close` are that date's session
 * hours, so an early close shortens `@close` by itself. Only a `datetime` param carries one (atFits).
 */
export type AtTime = { kind: "clock"; hour: number; minute: number } | { kind: "open" } | { kind: "close" };
/**
 * `calendar` (v4, spec 2026-10-23) is the text of a closing `(MIC)`, upper-cased and NOT validated here: an unknown
 * one must be a visible error, never a literal, so only the resolver may refuse it.
 */
export type Atom = { anchor: Anchor; offsets: Offset[]; at?: AtTime; calendar?: string };
```

Add the two suffix regexes beside `OFFSET`:

```ts
// v4 calendar qualifier: `(MIC)` closes the atom and names the calendar for all of it. Whatever is between the
// parentheses is kept for the resolver to judge. An unclosed `T(XNYS` or an empty `T()` is no suffix at all, and the
// value stays a literal like any other text this grammar cannot read.
const CAL = /\(([^()]+)\)$/;
// The `@` suffix, taken off the end before the offsets are read so the sticky OFFSET loop still has to consume
// every character before it. Two digits each side of the colon; `i` like the rest of the grammar (v5.3.4).
const AT = /@(?:(\d{2}):(\d{2})|(open)|(close))$/i;

/** The `@` suffix as an AtTime, or null when it matched but names no time (`@25:00`). */
function atOf(m: RegExpExecArray): AtTime | null {
  if (m[3]) return { kind: "open" };
  if (m[4]) return { kind: "close" };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : { kind: "clock", hour, minute };
}
```

Rename the existing `function parseAtom(text: string): Atom | null` to `parseCore` (body unchanged) and add:

```ts
/** One atom: its `(MIC)` and `@` suffixes come off the end first, then the anchor and offsets are read as before. */
function parseAtom(input: string): Atom | null {
  const cal = CAL.exec(input);
  const rest = cal ? input.slice(0, cal.index) : input;
  const suffix = AT.exec(rest);
  const at = suffix ? atOf(suffix) : undefined;
  if (suffix && !at) return null;
  const core = parseCore(suffix ? rest.slice(0, suffix.index) : rest);
  if (!core) return null;
  // The keys are left off entirely when absent: an atom without a suffix is the object it has always been.
  return { ...core, ...(at ? { at } : {}), ...(cal ? { calendar: cal[1].toUpperCase() } : {}) };
}
```

`stringifyAtom` appends the suffixes:

```ts
  return (
    head +
    atom.offsets.map((o) => `${o.sign < 0 ? "-" : "+"}${o.amount}${o.unit}`).join("") +
    stringifyAt(atom.at) +
    (atom.calendar === undefined ? "" : `(${atom.calendar})`)
  );
}

/** The `@` suffix, written back two-digit as the parser reads it. */
function stringifyAt(at: AtTime | undefined): string {
  if (at === undefined) return "";
  if (at.kind !== "clock") return `@${at.kind}`;
  return `@${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`;
}
```

`openbbAtom`: add `|| atom.at !== undefined || atom.calendar !== undefined` to its first `return null` condition, with the comment `// OpenBB's dialect has neither suffix; writing $currentDate would drop it silently.`

- [ ] **Step 4: Implement `@` resolution (exchange clock; Task 9 adds the viewer clock and per-atom calendars)**

In `calendar.ts` change `function consult(` to `export function consult(` with the comment `// Exported for the @open / @close production, which reads a date's session hours outside the helpers below.`

In `dateExpressions.ts` import `consult` and add:

```ts
/**
 * The `@` production, applied LAST -- after every offset -- onto the instant's date on `clockZone`'s clock. `@open`
 * and `@close` read that date's session from the calendar, and a closed date takes the NEXT session's (the spec's
 * "FQ0@open(XHKG): the first Hong Kong session open of the fiscal quarter"), as `session_open` already does.
 */
function applyAt(instant: ZonedDateTime, at: AtTime, cal: ExchangeCalendar, clockZone: string, trace?: CalendarTrace): ZonedDateTime {
  if (at.kind === "clock") {
    const local = fromDate(instant.toDate(), clockZone);
    const date = new CalendarDate(local.year, local.month, local.day);
    return toZoned(toCalendarDateTime(date, new Time(at.hour, at.minute)), clockZone);
  }
  const local = fromDate(instant.toDate(), cal.timezone);
  const date = new CalendarDate(local.year, local.month, local.day);
  consult(cal, date, trace);
  const session = nextOpen(cal, date, trace);
  return at.kind === "open" ? sessionOpen(cal, session, trace) : sessionClose(cal, session, trace);
}

/**
 * `@` names a time of day, and only a `datetime` param carries one on the wire; anywhere else the suffix would be
 * silently meaningless, so the value is a literal instead (no preview, sent as stored).
 */
function atFits(type: PeriodType, expr: Expression): boolean {
  return type === "datetime" || (expr.start.at === undefined && expr.end?.at === undefined);
}
```

In `resolveExpression`, after the offsets loop:

```ts
  if (expr.start.at) at = applyAt(at, expr.start.at, cal, cal.timezone, ctx.trace);
```

In `resolveValue`'s `one`, gate on `atFits`:

```ts
    const expr = parseExpression(v);
    const at = expr !== null && atFits(k, expr) ? resolveExpression(v, now, zone, ctx) : null;
```

In `isExpression`, port f8fcfdc16's version:

```ts
export function isExpression(type: string | undefined, value: string): boolean {
  if (!isPeriodType(type)) return false;
  // An atom with `@` is an expression on `datetime` only (atFits); anywhere else the stored value is a literal.
  const half = (v: string): boolean => {
    const expr = parseExpression(v);
    return expr !== null && atFits(type, expr);
  };
  if (isRangeType(type)) {
    const [start, end] = splitRange(value);
    return half(start) || (end !== "" && half(end));
  }
  const expr = parseExpression(value);
  return expr !== null && expr.end === undefined && atFits(type, expr);
}
```

In `presets.ts` `rowsFromExpression`, after `if (!expr) return null;`:

```ts
  // The rows have no `@` or calendar control, so an expression carrying either cannot be shown by them: null, and the
  // tab shows its read-only preview. Without this, Apply would write the atom back with the suffix gone.
  if ([expr.start, expr.end].some((a) => a !== undefined && (a.at !== undefined || a.calendar !== undefined))) return null;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/dateExpressions.test.ts src/lib/presets.test.ts src/components/pickers && pnpm -C "$BDOBB" typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "$BDOBB" add src/lib/dateExpressions.ts src/lib/dateExpressions.test.ts src/lib/calendar.ts src/lib/presets.ts src/lib/presets.test.ts
git -C "$BDOBB" commit -m "feat(v4): the @ production (ported) and the (MIC) suffix in the date grammar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 [bdobb]: Nine calendars, the symbol map and `calendarOf`

**Files:**
- Modify: `$BDOBB/src/lib/calendar.ts` (`EXCHANGE_HOURS`, new `DASHBOARD_EXCHANGES`, `parseExchange`, new `isKnownCalendar`, `symbolCalendar`, `calendarOf`, `describeCalendar`, `calendarName`, `bindingKey`), `$BDOBB/src/components/railMenu.ts`
- Test: `$BDOBB/src/lib/calendar.test.ts`

**Interfaces:**
- Produces:
  - `DASHBOARD_EXCHANGES: readonly ["XNYS","XLON","XTSE","XETR","XTKS","XHKG"]`
  - `isKnownCalendar(mic: string): boolean` (the nine)
  - `symbolCalendar(symbol: string): string | undefined`
  - `type CalendarFrom = "expression" | "symbol" | "param" | "widget" | "dashboard" | "default"`
  - `type CalendarChoice = { mic: string; from: CalendarFrom; symbol?: string }`
  - `calendarOf(widget: { exchange?: string; calendarBinding?: CalendarBinding; params?: readonly { paramName: string }[] } | undefined, param: { exchange?: string } | undefined, dashboard: string | undefined, values?: Record<string, string>): CalendarChoice` — steps 2–6; step 1 is per atom (Task 9).
  - `bindingKey(binding: CalendarBinding): string` — a single `exchange:` binding is its MIC; anything else `binding:<JSON>`.
  - `calendarName(id: string): string`, `describeCalendar(choice: CalendarChoice): string`.
  - `exchangeOf` stays until Task 12 removes its last caller.

- [ ] **Step 1: Write the failing tests**

In `calendar.test.ts` replace `names hours and a zone for the six MICs` with:

```ts
  it("names hours and a zone for the nine calendars", () => {
    expect(Object.keys(EXCHANGE_HOURS).sort()).toEqual(["XASX", "XETR", "XHKG", "XLON", "XNYS", "XTAE", "XTAI", "XTKS", "XTSE"]);
    expect(weekdayCalendar("XASX")).toMatchObject({ timezone: "Australia/Sydney", session: { open: "10:00:00", close: "16:00:00" } });
    expect(weekdayCalendar("XTAE")).toMatchObject({ timezone: "Asia/Jerusalem", session: { open: "09:59:00", close: "17:15:00" } });
    expect(weekdayCalendar("XTAI")).toMatchObject({ timezone: "Asia/Taipei", session: { open: "09:00:00", close: "13:30:00" } });
    const london = weekdayCalendar("XLON");
    expect(london).toMatchObject({ code: "XLON", timezone: "Europe/London", source: "weekdays", years: [], holidays: {} });
    expect(london.session).toEqual({ open: "08:00:00", close: "16:30:00", workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
  });
```

Append:

```ts
describe("symbol calendars (spec table)", () => {
  it("maps every suffix, case-insensitive, on the last dot", () => {
    const cases: Record<string, string> = {
      "AAPL.US": "XNYS", "VOD.LSE": "XLON", "VOD.L": "XLON", "RY.TO": "XTSE", "SAP.XETRA": "XETR", "SAP.DE": "XETR",
      "7203.TSE": "XTKS", "7203.T": "XTKS", "0700.HK": "XHKG", "BHP.AU": "XASX", "BHP.AX": "XASX", "TEVA.TA": "XTAE",
      "2330.TW": "XTAI", "vod.l": "XLON", "7203.t": "XTKS",
    };
    for (const [symbol, mic] of Object.entries(cases)) expect(symbolCalendar(symbol), symbol).toBe(mic);
  });

  it("tells .T from .TO", () => {
    expect(symbolCalendar("7203.T")).toBe("XTKS");
    expect(symbolCalendar("RY.TO")).toBe("XTSE");
  });

  it("infers nothing for unsuffixed, crypto, FX, unknown, share-class and list symbols (review focus 1)", () => {
    for (const s of ["AAPL", "T", "BTC-USD", "BTC-USD.CC", "EURUSD=X", "EUR.FOREX", "BRK.B", "AAPL,VOD.L", "", " "]) {
      expect(symbolCalendar(s), s).toBeUndefined();
    }
  });
});

describe("calendarOf: spec precedence steps 2-6", () => {
  const w = (over: object = {}) => ({ params: [{ paramName: "symbol" }, { paramName: "d" }], ...over });
  const xtks = { schemaVersion: 1 as const, kind: "single" as const, calendarId: "exchange:XTKS" };

  it("lets each step beat the next", () => {
    expect(calendarOf(w({ exchange: "XHKG" }), { exchange: "XTSE" }, "XETR", { symbol: "VOD.L" })).toEqual({ mic: "XLON", from: "symbol", symbol: "VOD.L" });
    expect(calendarOf(w({ exchange: "XHKG" }), { exchange: "XTSE" }, "XETR", { symbol: "AAPL" })).toEqual({ mic: "XTSE", from: "param" });
    expect(calendarOf(w({ calendarBinding: xtks, exchange: "XHKG" }), {}, "XETR")).toEqual({ mic: "XTKS", from: "widget" });
    expect(calendarOf(w({ exchange: "XHKG" }), {}, "XETR")).toEqual({ mic: "XHKG", from: "widget" });
    expect(calendarOf(w(), {}, "XETR")).toEqual({ mic: "XETR", from: "dashboard" });
    expect(calendarOf(w(), {}, undefined)).toEqual({ mic: "XNYS", from: "default" });
  });

  it("reads a symbol only when the card has a symbol parameter", () => {
    expect(calendarOf({ params: [{ paramName: "d" }] }, {}, undefined, { symbol: "VOD.L" }).from).toBe("default");
  });

  it("keys a non-exchange or joint binding by its JSON, and names it by its members", () => {
    const joint = { schemaVersion: 1 as const, kind: "joint" as const, members: ["payment:BOJ", "payment:T2"], mode: "all_open" as const, referenceTimezone: "UTC" };
    const { mic } = calendarOf(w({ calendarBinding: joint }), {}, undefined);
    expect(mic).toBe(`binding:${JSON.stringify(joint)}`);
    expect(calendarName(mic)).toBe("payment:BOJ+payment:T2");
  });

  it("describes where the calendar came from, as the Date expression footer shows it", () => {
    expect(describeCalendar({ mic: "XLON", from: "expression" })).toBe("XLON (from the expression)");
    expect(describeCalendar({ mic: "XTKS", from: "symbol", symbol: "7203.T" })).toBe("XTKS (from symbol 7203.T)");
    expect(describeCalendar({ mic: "XTSE", from: "param" })).toBe("XTSE (from the parameter)");
    expect(describeCalendar({ mic: "XHKG", from: "widget" })).toBe("XHKG (from the widget)");
    expect(describeCalendar({ mic: "XETR", from: "dashboard" })).toBe("XETR (from the dashboard)");
    expect(describeCalendar({ mic: "XNYS", from: "default" })).toBe("Default (XNYS)");
  });

  it("keeps the dashboard menu and a stored exchange at six MICs", () => {
    expect(DASHBOARD_EXCHANGES).toEqual(["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG"]);
    expect(parseExchange("XASX")).toBeUndefined();
    expect(isKnownCalendar("XASX")).toBe(true);
    expect(isKnownCalendar("XNAS")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendar.test.ts`
Expected: FAIL — `symbolCalendar` is not exported.

- [ ] **Step 3: Implement in `calendar.ts`**

Replace the `EXCHANGE_HOURS` doc comment and add three rows (hours from exchange_calendars 4.13.2, checked 2026-10-23):

```ts
/**
 * The nine calendars openbq-docker serves (spec "Calendars available"), with their regular hours and zones. The
 * weekday fallback is built from this. A MIC outside it is unknown: refused at resolution, never run on XNYS hours.
 */
export const EXCHANGE_HOURS: Record<string, ExchangeHours> = {
  XNYS: { name: "New York Stock Exchange", timezone: "America/New_York", open: "09:30:00", close: "16:00:00" },
  XLON: { name: "London Stock Exchange", timezone: "Europe/London", open: "08:00:00", close: "16:30:00" },
  XTSE: { name: "Toronto Stock Exchange", timezone: "America/Toronto", open: "09:30:00", close: "16:00:00" },
  XETR: { name: "Xetra", timezone: "Europe/Berlin", open: "09:00:00", close: "17:30:00" },
  XTKS: { name: "Tokyo Stock Exchange", timezone: "Asia/Tokyo", open: "09:00:00", close: "15:30:00" },
  XHKG: { name: "Hong Kong Stock Exchange", timezone: "Asia/Hong_Kong", open: "09:30:00", close: "16:00:00" },
  XASX: { name: "Australian Securities Exchange", timezone: "Australia/Sydney", open: "10:00:00", close: "16:00:00" },
  XTAE: { name: "Tel Aviv Stock Exchange", timezone: "Asia/Jerusalem", open: "09:59:00", close: "17:15:00" },
  XTAI: { name: "Taiwan Stock Exchange", timezone: "Asia/Taipei", open: "09:00:00", close: "13:30:00" },
};

/** The six MICs the dashboard's Exchange menu offers (v5.4.0; replacing the menu is out of scope). */
export const DASHBOARD_EXCHANGES = ["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG"] as const;

/** One of the nine. `Object.hasOwn`, not `in`, so `constructor` is no calendar. */
export const isKnownCalendar = (mic: string): boolean => Object.hasOwn(EXCHANGE_HOURS, mic);
```

`parseExchange` becomes `return typeof value === "string" && (DASHBOARD_EXCHANGES as readonly string[]).includes(value) ? value : undefined;` (comment: "one of the six MICs the rail menu offers").

Add (import `type CalendarBinding` from `./calendars/contracts`):

```ts
/** Symbol suffix -> calendar, EODHD and Yahoo spellings (spec "Symbol to calendar"). */
const SYMBOL_CALENDARS: Record<string, string> = {
  US: "XNYS", LSE: "XLON", L: "XLON", TO: "XTSE", XETRA: "XETR", DE: "XETR", TSE: "XTKS", T: "XTKS",
  HK: "XHKG", AU: "XASX", AX: "XASX", TA: "XTAE", TW: "XTAI",
};

/**
 * The calendar a symbol's last dot-suffix names, or nothing. An unsuffixed symbol (`AAPL`, `T`), crypto, FX and any
 * other suffix infer nothing, and neither does a list (`AAPL,VOD.L`): the spec maps a symbol, not a basket.
 */
export function symbolCalendar(symbol: string): string | undefined {
  const s = symbol.trim();
  if (s === "" || /[,\s]/.test(s)) return undefined;
  const dot = s.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const suffix = s.slice(dot + 1).toUpperCase();
  return Object.hasOwn(SYMBOL_CALENDARS, suffix) ? SYMBOL_CALENDARS[suffix] : undefined;
}

/** Which precedence step chose a field's calendar (spec "Which calendar a field uses"). */
export type CalendarFrom = "expression" | "symbol" | "param" | "widget" | "dashboard" | "default";
/** A field's calendar key and where it came from; `symbol` is set when step 2 chose it. */
export type CalendarChoice = { mic: string; from: CalendarFrom; symbol?: string };

/** A single exchange binding is its MIC, so it shares the key every other path uses; any other binding is its JSON. */
export function bindingKey(binding: CalendarBinding): string {
  return binding.kind === "single" && binding.calendarId.startsWith("exchange:")
    ? binding.calendarId.slice("exchange:".length)
    : `binding:${JSON.stringify(binding)}`;
}

/** A calendar key as a person reads it: a MIC, or a binding's calendar or members. */
export function calendarName(id: string): string {
  if (!id.startsWith("binding:")) return id;
  try {
    const b = JSON.parse(id.slice("binding:".length)) as { calendarId?: string; members?: string[] };
    return b.members?.join("+") ?? b.calendarId ?? id;
  } catch {
    return id;
  }
}

/**
 * Spec precedence steps 2-6 for one field: the card's `symbol` parameter by suffix, the parameter's exchange, the
 * widget's calendarBinding then its exchange, the dashboard's exchange, XNYS. Step 1, an atom's own `(MIC)`, is the
 * resolver's (dateExpressions.ts), since one value's two atoms may name different calendars. This replaces
 * exchangeOf, so every path resolves one field the same way.
 */
export function calendarOf(
  widget: { exchange?: string; calendarBinding?: CalendarBinding; params?: readonly { paramName: string }[] } | undefined,
  param: { exchange?: string } | undefined,
  dashboard: string | undefined,
  values: Record<string, string> = {},
): CalendarChoice {
  if (widget?.params?.some((p) => p.paramName === "symbol")) {
    const symbol = (values.symbol ?? "").trim();
    const mic = symbolCalendar(symbol);
    if (mic) return { mic, from: "symbol", symbol };
  }
  if (param?.exchange) return { mic: param.exchange, from: "param" };
  if (widget?.calendarBinding) return { mic: bindingKey(widget.calendarBinding), from: "widget" };
  if (widget?.exchange) return { mic: widget.exchange, from: "widget" };
  if (dashboard) return { mic: dashboard, from: "dashboard" };
  return { mic: DEFAULT_EXCHANGE, from: "default" };
}

/** "XLON (from the expression)", "XTKS (from symbol 7203.T)", "Default (XNYS)": the Date expression footer's words. */
export function describeCalendar(choice: CalendarChoice): string {
  const name = calendarName(choice.mic);
  switch (choice.from) {
    case "expression":
      return `${name} (from the expression)`;
    case "symbol":
      return `${name} (from symbol ${choice.symbol})`;
    case "param":
      return `${name} (from the parameter)`;
    case "widget":
      return `${name} (from the widget)`;
    case "dashboard":
      return `${name} (from the dashboard)`;
    case "default":
      return `Default (${name})`;
  }
}
```

In `railMenu.ts` import `DASHBOARD_EXCHANGES` and replace the `Object.entries(EXCHANGE_HOURS).map(([mic, hours]) => …)` entry with:

```ts
        ...DASHBOARD_EXCHANGES.map((mic) => ({
          label: `${mic} · ${EXCHANGE_HOURS[mic].name}`,
          checked: target.exchange === mic,
          onSelect: () => on.setExchange(target.id, mic),
        })),
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendar.test.ts src/components && pnpm -C "$BDOBB" typecheck`
Expected: PASS (the rail menu tests still see six exchanges).

- [ ] **Step 5: Commit**

```bash
git -C "$BDOBB" add src/lib/calendar.ts src/lib/calendar.test.ts src/components/railMenu.ts
git -C "$BDOBB" commit -m "feat(v4): nine calendars, symbol suffix map and calendarOf precedence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 [bdobb]: Per-atom calendars, visible errors, one wire path

**Files:**
- Modify: `$BDOBB/src/lib/calendar.ts` (`ExchangeCalendar.unavailable`, `weekdayCalendar` refuses unknown), `$BDOBB/src/lib/dateExpressions.ts` (`ResolveContext`, `atomCalendar`, `needsCalendar`, `resolveExpression`, `resolveValue`, `Preview`, `previewExpression`), `$BDOBB/src/lib/params.ts` (`WireContext.errors`, `fieldContext`, `wireParams`, `sendParams`), `$BDOBB/src/lib/dataClient.ts` (`buildWidgetUrl`, `postForm`), `$BDOBB/src/lib/tableExecution/rust/providerFactory.ts`
- Test: create `$BDOBB/src/lib/calendarQualifier.test.ts`; modify `$BDOBB/src/lib/calendar.test.ts`, `$BDOBB/src/lib/calendars/resolver.test.ts`

**Interfaces:**
- Consumes: `calendarOf`, `isKnownCalendar`, `CalendarFrom`, `CalendarChoice` (Task 8); `bundleCalendar` (Task 6); `applyAt` (Task 7).
- Produces:
  - `ExchangeCalendar.unavailable?: string` — a placeholder: any atom that needs it throws `CalendarError("CALENDAR_UNAVAILABLE", unavailable)`.
  - `ResolveContext` gains `calendars?: Record<string, ExchangeCalendar>`, `from?: CalendarFrom`, `strict?: boolean`, `onError?: (message: string) => void`.
  - `Preview` gains `error?: string`, `provisional?: boolean`.
  - `WireContext.errors?: Record<string, string>`.
  - `fieldContext(widget: WidgetDef | undefined, param: WidgetParam | undefined, ctx: Pick<WireContext, "exchange" | "calendars">, values: Record<string, string>): Pick<ResolveContext, "exchange" | "calendar" | "calendars" | "from" | "strict"> & { choice: CalendarChoice }`.
  - `sendParams(widget, params, ctx?): Record<string, string>` — wireParams that throws `CalendarError("CALENDAR_UNAVAILABLE", "<key>: <message>; …")`.
  - `wireParams` never throws a CalendarError: a failed value is `""` and recorded in `ctx.errors`.

- [ ] **Step 1: Write the failing tests**

`$BDOBB/src/lib/calendarQualifier.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import xlon from "./calendars/vendor/conformance/XLON.json";
import xnysYearEnd from "./calendars/vendor/conformance/XNYS-2026-12.json";
import type { CalendarBundle } from "./calendars/contracts";
import { bundleCalendar } from "./calendars/resolver";
import { bundledCalendar, normalizeCalendar } from "./calendar";
import { previewExpression, resolveValue } from "./dateExpressions";
import { sendParams, wireParams } from "./params";
import { widget } from "../test/fixtures";

const single = (mic: string) => ({ schemaVersion: 1 as const, kind: "single" as const, calendarId: `exchange:${mic}` });
const calendars = {
  XNYS: bundleCalendar([xnysYearEnd as CalendarBundle], single("XNYS"), "operational-v1"),
  XLON: bundleCalendar([xlon as CalendarBundle], single("XLON"), "operational-v1"),
};
const now = new Date("2026-12-29T12:00:00Z");

describe("calendar-qualified resolution", () => {
  it("steps the same T-1bd on XNYS and on XLON across London's Boxing Day Monday", () => {
    expect(resolveValue("date", "T-1bd(XNYS)", { now, zone: "UTC", calendars })).toBe("2026-12-28");
    expect(resolveValue("date", "T-1bd(XLON)", { now, zone: "UTC", calendars })).toBe("2026-12-24");
  });

  it("gives each range atom its own calendar", () => {
    expect(resolveValue("date_range", "T-3bd(XLON)..T", { now, zone: "UTC", calendars, exchange: "XNYS", calendar: calendars.XNYS })).toBe(
      "2026-12-22/2026-12-29",
    );
  });

  it("closes @close on an NYSE early close", () => {
    const xnys = { XNYS: bundledCalendar("XNYS")! };
    expect(resolveValue("datetime", "T-1bd@close(XNYS)", { now: new Date("2026-11-30T14:30:00Z"), zone: "America/New_York", calendars: xnys })).toBe(
      "2026-11-27T13:00:00-05:00",
    );
  });

  it("takes the next session for @open/@close on a closed date (review focus 3)", () => {
    const hk = normalizeCalendar(
      { data: { Timezone: "Asia/Hong_Kong", TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon,Tue,Wed,Thu,Fri" }, ExchangeHolidays: { "2026-10-01": { Holiday: "National Day", Type: "Official" } } } },
      "XHKG",
      [2026],
      "backend",
    )!;
    expect(resolveValue("datetime", "FQ0@open(XHKG)", { now: new Date("2026-10-15T04:00:00Z"), zone: "Asia/Hong_Kong", calendars: { XHKG: hk } })).toBe(
      "2026-10-02T09:30:00+08:00",
    );
    expect(resolveValue("datetime", "T@close", { now: new Date("2026-09-19T15:00:00Z"), zone: "America/New_York", calendar: bundledCalendar("XNYS")!, exchange: "XNYS" })).toBe(
      "2026-09-21T16:00:00-04:00",
    );
  });

  it("puts a wall clock on the viewer's zone only when nothing names a calendar (port of 873992135)", () => {
    const at = new Date("2026-09-17T12:00:00Z");
    expect(resolveValue("datetime", "T@14:00", { now: at, zone: "Asia/Tokyo", exchange: "XNYS", from: "default" })).toBe("2026-09-17T14:00:00+09:00");
    expect(resolveValue("datetime", "T@14:00", { now: at, zone: "Asia/Tokyo", exchange: "XNYS", from: "dashboard" })).toBe("2026-09-17T14:00:00-04:00");
    expect(resolveValue("datetime", "T@14:00(XNYS)", { now: at, zone: "Asia/Tokyo", from: "default" })).toBe("2026-09-17T14:00:00-04:00");
  });

  it("makes an unknown (MIC) a visible error, never a literal and never XNYS", () => {
    const errors: string[] = [];
    expect(resolveValue("date", "T(XNYZ)", { now, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["Unknown calendar XNYZ"]);
    expect(previewExpression("date", "T(XNYZ)", { now })?.error).toBe("Unknown calendar XNYZ");
  });

  it("refuses an unloaded calendar on an opted-in card instead of using weekdays (review C1)", () => {
    const errors: string[] = [];
    expect(resolveValue("date", "T-1bd", { now, exchange: "XLON", strict: true, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["No XLON calendar loaded"]);
  });
});

describe("wireParams and sendParams", () => {
  const w = (over = {}) => widget({ params: [{ paramName: "symbol", type: "text" }, { paramName: "d", type: "date" }], ...over });

  it("follows the card's symbol, and lets the expression's (MIC) beat it (precedence step 1 over 2)", () => {
    expect(wireParams(w(), { symbol: "VOD.L", d: "T-1bd" }, { now, calendars })).toEqual({ symbol: "VOD.L", d: "2026-12-24" });
    expect(wireParams(w(), { symbol: "VOD.L", d: "T-1bd(XNYS)" }, { now, calendars })).toEqual({ symbol: "VOD.L", d: "2026-12-28" });
  });

  it("refuses an exchange outside the nine only where a calendar is needed (review focus 2)", () => {
    const xnas = w({ exchange: "XNAS" });
    const errors: Record<string, string> = {};
    expect(wireParams(xnas, { d: "T-1bd" }, { now, errors })).toEqual({ d: "" });
    expect(errors).toEqual({ d: "Unknown calendar XNAS" });
    expect(() => sendParams(xnas, { d: "T-1bd" }, { now })).toThrow("d: Unknown calendar XNAS");
    expect(sendParams(xnas, { d: "T-7d" }, { now: new Date("2026-12-29T12:00:00Z") }).d).toMatch(/^2026-12-2[12]$/);
    expect(sendParams(xnas, { d: "2026-12-01" }, { now })).toEqual({ d: "2026-12-01" });
  });
});
```

In `calendar.test.ts` replace `gives an unknown MIC New York's hours under its own code` (it locked in the behaviour the spec reverses) with:

```ts
  it("refuses an unknown MIC rather than run it on New York's hours (spec)", () => {
    expect(() => weekdayCalendar("XXXX")).toThrow("Unknown calendar XXXX");
  });
```

Append to `resolver.test.ts` (review I7: failures name source, revision and coverage):

```ts
it("names the calendar, revision and coverage when an operation has no answer", () => {
  const cal = bundleCalendar([b], single("XNYS"), "operational-v1");
  const errors: string[] = [];
  resolveValue("date", "T-10bd", {
    now: new Date("2026-11-27T19:00:00Z"),
    zone: "America/New_York",
    calendar: cal,
    exchange: "XNYS",
    onError: (m) => errors.push(m),
  });
  expect(errors).toEqual([`exchange:XNYS COVERAGE_UNAVAILABLE (revision ${bundleRevision(b)}, coverage 2026-11-25 to 2026-11-28)`]);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendarQualifier.test.ts src/lib/calendar.test.ts src/lib/calendars/resolver.test.ts`
Expected: FAIL — `T-1bd(XLON)` resolves on the field calendar; `sendParams` is not exported.

- [ ] **Step 3: Implement in `calendar.ts`**

Add to `ExchangeCalendar`:

```ts
  /**
   * A placeholder with no calendar behind it -- still loading, or refused -- and why. Any atom that needs a calendar
   * throws this message (dateExpressions.ts), so an opted-in card never falls back to weekdays (review C1).
   */
  unavailable?: string;
```

`weekdayCalendar` refuses unknown codes:

```ts
export function weekdayCalendar(code: string): ExchangeCalendar {
  // Spec: a MIC outside the nine is unknown and never runs on New York's hours.
  if (!isKnownCalendar(code)) throw new CalendarError("UNKNOWN_CALENDAR", `Unknown calendar ${code}`);
  const hours = EXCHANGE_HOURS[code];
  // ...rest unchanged...
```

- [ ] **Step 4: Implement in `dateExpressions.ts`**

Import `CalendarError` from `./calendars/contracts`, and add `isKnownCalendar` and `type CalendarFrom` to the existing `./calendar` import. Add to `ResolveContext`:

```ts
  /** Every loaded calendar by key, for an atom's own `(MIC)` (spec precedence step 1). */
  calendars?: Record<string, ExchangeCalendar>;
  /** Which step chose `exchange` (calendarOf). "default" puts a wall-clock `@HH:MM` on the viewer's clock (873992135). */
  from?: CalendarFrom;
  /** An opted-in (calendarBinding) card: a calendar that is not loaded is an error, never the weekday table. */
  strict?: boolean;
  /** Told why a value cannot resolve. The value is then "" -- never a literal, never XNYS -- and the caller shows why. */
  onError?: (message: string) => void;
```

Extend `CalendarContext` with `"calendars" | "from" | "strict"`. Add:

```ts
const TRADING_ANCHORS: ReadonlySet<string> = new Set(["trade_date", "prev_trade_date", "session_open", "session_close"]);

/** Whether an atom reads a calendar at all: a `bd` step, a trading or expiry anchor, or an `@`. */
function needsCalendar(atom: Atom): boolean {
  return (
    atom.at !== undefined ||
    atom.anchor.kind === "expiry" ||
    (atom.anchor.kind === "named" && TRADING_ANCHORS.has(atom.anchor.name)) ||
    atom.offsets.some((o) => o.unit === "bd")
  );
}

/**
 * The calendar one atom resolves on: its own `(MIC)` first (spec step 1), else the field's (calendarOf, steps 2-6).
 * An explicit unknown MIC is always an error (`T(XNYZ)`); a field-level unknown one only where the atom needs a
 * calendar, since `T-7d` on an XNAS widget runs on no exchange's hours. A widget's binding key ("binding:{...}")
 * is the one non-MIC key. On an opted-in card a calendar that is not loaded is an error, never the weekday table.
 */
function atomCalendar(atom: Atom, ctx: CalendarContext): ExchangeCalendar {
  const mic = atom.calendar ?? ctx.exchange ?? DEFAULT_EXCHANGE;
  const known = isKnownCalendar(mic) || mic.startsWith("binding:");
  if (!known && (atom.calendar !== undefined || needsCalendar(atom))) {
    throw new CalendarError("UNKNOWN_CALENDAR", `Unknown calendar ${mic}`);
  }
  const cal = atom.calendar === undefined ? (ctx.calendar ?? ctx.calendars?.[mic]) : ctx.calendars?.[mic];
  if (cal) {
    if (cal.unavailable && needsCalendar(atom)) throw new CalendarError("CALENDAR_UNAVAILABLE", cal.unavailable);
    return cal;
  }
  if (ctx.strict && needsCalendar(atom)) throw new CalendarError("CALENDAR_UNAVAILABLE", `No ${mic} calendar loaded`);
  // Calendar-free on an unknown key: a stand-in only its zone is read from, and then only by an `@`, which needs one.
  return known ? weekdayCalendar(mic) : weekdayCalendar(DEFAULT_EXCHANGE);
}
```

Replace the body of `resolveExpression` below `if (!expr || expr.end) return null;`:

```ts
  const atom = expr.start;
  const cal = atomCalendar(atom, ctx);
  let at = resolveAnchor(atom.anchor, now, zone, ctx.fiscalYearEnd ?? 12, cal, ctx.trace, ctx.symbol, ctx.bounds);
  if (at === null) return null;
  for (const offset of atom.offsets) at = applyOffset(at, offset, cal, ctx.trace);
  if (atom.at) {
    // 873992135: when nothing named a calendar (Default (XNYS)), a wall clock is the viewer's, the zone every other
    // control on such a card already reads. `@open`/`@close` still read the calendar.
    const clockZone = atom.calendar === undefined && ctx.from === "default" ? zone : cal.timezone;
    at = applyAt(at, atom.at, cal, clockZone, ctx.trace);
  }
  // Past year 1 the calendar wraps into era BC; past 9999 it clamps to 9999-12-31. Either is a literal, not a date.
  if (at.era !== "AD" || (at.year === 9999 && at.month === 12 && at.day === 31)) return null;
  return at;
```

In `resolveValue`'s `one`, wrap the resolution:

```ts
    const expr = parseExpression(v);
    let at: ZonedDateTime | null = null;
    if (expr !== null && atFits(k, expr)) {
      try {
        at = resolveExpression(v, now, zone, ctx);
      } catch (e) {
        if (!(e instanceof CalendarError)) throw e;
        // Spec: never a literal and never XNYS. Empty is "not set" to every caller; onError says why, and the
        // sending path (sendParams) refuses the request.
        ctx.onError?.(e.message);
        return "";
      }
    }
```

`Preview` and `previewExpression`:

```ts
export type Preview = { text: string; fallback: boolean; reason?: string; error?: string; provisional?: boolean };

export function previewExpression(type: PeriodType, value: string, ctx: Omit<ResolveContext, "trace"> = {}): Preview | null {
  if (!isExpression(type, value)) return null;
  const trace = newTrace();
  let error: string | undefined;
  const text = resolveValue(type, value, { ...ctx, trace, onError: (m) => (error ??= m) }).replace("/", " – ");
  return {
    text,
    fallback: trace.fallback,
    reason: trace.reason,
    ...(error === undefined ? {} : { error }),
    ...(trace.provisional ? { provisional: true } : {}),
  };
}
```

- [ ] **Step 5: Implement in `params.ts`, `dataClient.ts`, `providerFactory.ts`**

`params.ts` (imports: drop `exchangeOf`; add `calendarOf, type CalendarChoice` from `./calendar`; `CalendarError` from `./calendars/contracts`; `type ResolveContext` from `./dateExpressions`). Add to `WireContext`:

```ts
  /** Filled per storage key with the reason a value could not resolve; that value is "" (spec: never a literal). */
  errors?: Record<string, string>;
```

Add above `wireParams`:

```ts
/**
 * The calendar half of one field's ResolveContext: calendarOf's choice (spec steps 2-6), the loaded calendars for an
 * atom's own `(MIC)`, and strictness for an opted-in card. Every path that resolves a field builds it here -- the
 * wire, the control's display, the Relative tab's preview, the Date expression card -- so they cannot disagree.
 */
export function fieldContext(
  widget: WidgetDef | undefined,
  param: WidgetParam | undefined,
  ctx: Pick<WireContext, "exchange" | "calendars">,
  values: Record<string, string>,
): Pick<ResolveContext, "exchange" | "calendar" | "calendars" | "from" | "strict"> & { choice: CalendarChoice } {
  const choice = calendarOf(widget, param, ctx.exchange, values);
  return {
    choice,
    exchange: choice.mic,
    from: choice.from,
    calendar: ctx.calendars?.[choice.mic],
    calendars: ctx.calendars,
    strict: widget?.calendarBinding !== undefined,
  };
}
```

In `wireParams` replace the `const exchange = exchangeOf(…)` line and the `resolveValue(…)` context with:

```ts
    const trace = ctx.trace ? (ctx.trace[key] = newTrace()) : undefined;
    const resolved =
      (ctx.resolvedCalendarValues && Object.hasOwn(ctx.resolvedCalendarValues, key) ? ctx.resolvedCalendarValues[key] : undefined) ??
      resolveValue(param?.type, value, {
        bounds: ctx.bounds,
        now: ctx.now,
        fiscalYearEnd: ctx.fiscalYearEnd?.[key],
        trace,
        ...fieldContext(widget, param, ctx, params),
        onError: (message) => {
          if (ctx.errors) ctx.errors[key] = message;
        },
      });
```

(`resolvedCalendarValues` goes in Task 10.) Add below `wireParams`:

```ts
/**
 * wireParams for a request about to be SENT. A value that could not resolve refuses the whole request, naming each
 * field -- "Partial failure prevents submitting a dependent parameter set" (parent design). buildWidgetUrl, postForm
 * and the SSRM provider send through this; display paths call wireParams and show `errors` themselves.
 */
export function sendParams(widget: WidgetDef | undefined, params: Record<string, string>, ctx: WireContext = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  const out = wireParams(widget, params, { ...ctx, errors });
  const failed = Object.entries(errors);
  if (failed.length) throw new CalendarError("CALENDAR_UNAVAILABLE", failed.map(([key, m]) => `${key}: ${m}`).join("; "));
  return out;
}
```

`dataClient.ts`: in `buildWidgetUrl` and `postForm` call `sendParams` where they call `wireParams`. `providerFactory.ts`: `params: sendParams(widget, params, context)` (it runs inside SsrmTableRenderer's async block, whose `.catch` shows the message). Check no other sender remains: `grep -n "wireParams(" "$BDOBB/src/lib/dataClient.ts" "$BDOBB/src/lib/tableExecution/rust/providerFactory.ts"` prints nothing.

- [ ] **Step 6: Run the tests**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/lib src/components/renderers/ParamEchoRenderer.test.tsx src/components/renderers/DateProbeRenderer.test.tsx
pnpm -C "$BDOBB" typecheck
```
Expected: PASS. If an existing test fails because it fed an unknown MIC and expected XNYS hours, it locked in the reversed behaviour: change it to expect the error, and name it in the commit message.

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" add src/lib src/components
git -C "$BDOBB" commit -m "feat(v4): per-atom calendars; unknown or unloaded calendars are visible errors, never literals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10 [bdobb]: One shared bundle cache, an expression-sized window, one bundle path

**Files:**
- Rewrite: `$BDOBB/src/lib/calendars/cache.ts`
- Create: `$BDOBB/src/lib/calendars/window.ts`, `$BDOBB/src/lib/calendars/bundles.ts`, `$BDOBB/src/lib/calendars/bundles.test.ts`
- Modify: `$BDOBB/src/lib/calendars/provider.ts`, `$BDOBB/src/lib/params.ts` (`calendarIdsOf`, `paramCalendarIds`; delete `resolvedCalendarValues`, `calendarSignal`, `calendarRange`, `onCalendarResolution`), `$BDOBB/src/lib/dataClient.ts` (`fetchCalendarBundle`, bound branch), `$BDOBB/src/hooks/useWidgetData.ts` (delete `calendarResolution`, `calendarController`), `$BDOBB/src/stores/backendsStore.ts`
- Delete: `$BDOBB/src/lib/calendars/widget.ts`, `$BDOBB/src/lib/calendars/widget.test.ts`
- Test: `$BDOBB/src/lib/calendars/provider.test.ts`, `$BDOBB/src/lib/calendars/transport.test.ts`, `$BDOBB/src/lib/calendars/consumers.test.ts`, `$BDOBB/src/stores/backendsStore.test.ts`

**Interfaces:**
- Consumes: `bundleCalendar` (Task 6), `calendarOf`, `isKnownCalendar`, `calendarName` (Task 8), `isExpression`, `splitRange`, `parseExpression`, `PERIOD_UNIT`.
- Produces:
  - `type BundleWindow = { start: string; end: string }`; `bundleWindow(values: readonly string[], now: Date): BundleWindow` (window.ts).
  - `CalendarCache.peek(key, now?): { bundle?: CalendarBundle; refusal?: string }`; `load(key, fetcher, signal)` (no `revalidate`); `clear()`.
  - bundles.ts: `type FetchBundle = (calendarId: string, window: BundleWindow) => Promise<unknown>`; `bundleScope(backend)`; `clearCalendarBundles()`; `peekCalendarBundle(backend, calendarId, window)`; `loadCalendarBundle(backend, calendarId, window, fetchBundle, signal)`; `type WidgetCalendars = { calendars: Record<string, ExchangeCalendar>; pending: boolean; key: string }`; `peekWidgetCalendars(backend, widget, values, exchange, now)`; `loadWidgetCalendars(backend, widget, values, exchange, now, fetchBundle, signal): Promise<WidgetCalendars>`.
  - params.ts: `paramCalendarIds(widget, param, values, exchange?, value?): string[]`; `calendarIdsOf(widget, values, exchange?, expressionsOnly?): string[]`.
  - dataClient.ts: `fetchCalendarBundle(backend, calendarId, window): Promise<unknown>`.

- [ ] **Step 1: Write the failing tests**

`$BDOBB/src/lib/calendars/bundles.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import xlon from "./vendor/conformance/XLON.json";
import { LIMITS } from "./contracts";
import { clearCalendarBundles, loadCalendarBundle, loadWidgetCalendars, peekCalendarBundle, peekWidgetCalendars } from "./bundles";
import { bundleWindow } from "./window";
import { backend, widget } from "../../test/fixtures";

vi.stubGlobal("crypto", webcrypto);
beforeEach(() => clearCalendarBundles());

const bound = widget({ calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
const now = new Date("2026-12-29T12:00:00Z");
const signal = () => new AbortController().signal;

describe("bundleWindow (review I2)", () => {
  it("sizes whole years to the expressions' reach", () => {
    expect(bundleWindow(["T-1bd"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2024-01-01", end: "2028-12-31" });
    expect(bundleWindow(["T-5y"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2019-01-01", end: "2033-12-31" });
    expect(bundleWindow(["T-300bd"], new Date("2026-01-05T00:00:00Z"))).toEqual({ start: "2023-01-01", end: "2029-12-31" });
    expect(bundleWindow(["2026-01-01", "AAPL"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2025-01-01", end: "2027-12-31" });
  });

  it("stops inside the contract's 20-year limit", () => {
    expect(bundleWindow(["T-9999bd"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2017-01-01", end: "2035-12-31" });
  });
});

describe("the shared bundle cache (review I3)", () => {
  const window = { start: "2025-01-01", end: "2027-12-31" };

  it("fetches once per scope, and never shares across credentials", async () => {
    const fetch = vi.fn(async () => xlon);
    const a = backend({ headerName: "Authorization", headerValue: "a" });
    const b = backend({ headerName: "Authorization", headerValue: "b" });
    await loadCalendarBundle(a, "exchange:XLON", window, fetch, signal());
    await loadCalendarBundle(a, "exchange:XLON", window, fetch, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(peekCalendarBundle(b, "exchange:XLON", window).bundle).toBeUndefined();
    await loadCalendarBundle(b, "exchange:XLON", window, fetch, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("drops an in-flight answer when the scope is cleared (review focus 4)", async () => {
    let finish!: (v: unknown) => void;
    const pending = loadCalendarBundle(backend(), "exchange:XLON", window, () => new Promise((r) => (finish = r)), signal());
    clearCalendarBundles();
    finish(xlon);
    await expect(pending).rejects.toThrow("CALENDAR_SCOPE_CHANGED");
    expect(peekCalendarBundle(backend(), "exchange:XLON", window).bundle).toBeUndefined();
  });

  it("refuses a bundle past LIMITS.bytes, and remembers why", async () => {
    const huge = async () => ({ pad: "x".repeat(LIMITS.bytes) });
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, huge, signal())).rejects.toThrow("larger than");
    expect(peekCalendarBundle(backend(), "exchange:XLON", window).refusal).toMatch(/larger than/);
  });
});

describe("widget calendars", () => {
  it("serves a placeholder while loading, then the bundle calendar", async () => {
    const before = peekWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now);
    expect(before.pending).toBe(true);
    expect(before.calendars.XLON.unavailable).toBe("XLON calendar unavailable: still loading");
    const after = await loadWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now, async () => xlon, signal());
    expect(after.pending).toBe(false);
    expect(after.calendars.XLON.sessionIndex).toBeDefined();
  });

  it("never holds a card whose values are literal (PR #67 kept literal cards off the bundle path)", () => {
    expect(peekWidgetCalendars(backend(), bound, { d: "2026-12-01" }, undefined, now).pending).toBe(false);
  });

  it("names a refusal in the placeholder", async () => {
    const refused = await loadWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now, async () => {
      throw new Error("HTTP 422");
    }, signal());
    expect(refused.calendars.XLON.unavailable).toBe("XLON calendar unavailable: HTTP 422");
  });
});
```

In `provider.test.ts` replace `revalidates live requests but reuses immutable revision-pinned bundles` (it locked in a cache that never hit) with:

```ts
it("reuses a cached bundle instead of re-downloading it on every load", async () => {
  const fetch = vi.fn(async () => fixture);
  const provider = createBundleProvider("retained", fetch);
  const request = { calendarId: "exchange:XNYS", start: "2026-11-25", end: "2026-11-28" };
  await provider.load(request, new AbortController().signal);
  await provider.load(request, new AbortController().signal);
  await provider.load({ ...request, revision: bundleRevision(fixture as CalendarBundle) }, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(1);
});
```

Rewrite `transport.test.ts`'s two tests (no `calendarRange`, no `onCalendarResolution`; a specific error):

```ts
beforeEach(() => clearCalendarBundles());

it("submits the resolved literal through the real widget transport", async () => {
  const server = await startMockServer({ "/api/v1/calendar/trading/v1/bundle": () => fixture, "/prices": (url: URL) => [{ date: url.searchParams.get("d") }] });
  servers.push(server);
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, params: [{ paramName: "d", type: "date" }] });
  expect(await fetchWidgetData(backend({ baseUrl: server.url }), w, { d: "T-1bd" }, { now: new Date("2026-11-27T19:00:00Z") })).toEqual([{ date: "2026-11-25" }]);
});

it("does not submit a query when the calendar is unavailable, and says which field and calendar", async () => {
  const server = await startMockServer({ "/api/v1/calendar/trading/v1/bundle": () => ({ __status: 422 }), "/prices": () => [] });
  servers.push(server);
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, params: [{ paramName: "d", type: "date" }] });
  await expect(fetchWidgetData(backend({ baseUrl: server.url }), w, { d: "T-1bd" })).rejects.toThrow(/^d: XNYS calendar unavailable: /);
  expect(server.requests.filter((r) => r.path === "/prices")).toHaveLength(0);
});
```

In `consumers.test.ts` delete the final `wireParams(…resolvedCalendarValues…)` assertion of the first test (that WireContext field is deleted; the parity of the GET with preview is Task 11's test).

Append to `backendsStore.test.ts`'s `describe("updateBackend", …)`:

```ts
  it("clears the shared calendar bundles when a credential changes (review I3)", async () => {
    vi.stubGlobal("crypto", (await import("node:crypto")).webcrypto);
    const xnys = (await import("../lib/calendars/vendor/conformance/XNYS.json")).default;
    const { loadCalendarBundle, peekCalendarBundle } = await import("../lib/calendars/bundles");
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", headerName: "Authorization", headerValue: "old", validateWidgets: false });
    const before = useBackendsStore.getState().backends.find((b) => b.id === id)!;
    const window = { start: "2026-01-01", end: "2026-12-31" };
    await loadCalendarBundle(before, "exchange:XNYS", window, async () => xnys, new AbortController().signal);
    await useBackendsStore.getState().updateBackend(id, { headerValue: "new" });
    expect(peekCalendarBundle(before, "exchange:XNYS", window).bundle).toBeUndefined();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars src/stores/backendsStore.test.ts`
Expected: FAIL — `./bundles` and `./window` do not exist.

- [ ] **Step 3: Rewrite `cache.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { verifyBundle } from "./artifact";
import { CalendarError, type CalendarBundle } from "./contracts";

/** How long a refusal stands: a Retry a minute later asks the backend again. */
export const REFUSAL_MS = 60_000;
// ponytail: an entry cap, not a byte cap; a 20-year bundle is about 2 MB, so 32 entries stay near 64 MB.
const MAX_ENTRIES = 32;

/**
 * Verified bundles by key, shared by every card (review I3). One fetch per key is in flight and every caller joins it;
 * the fetch is never aborted, since another card may be waiting on it -- a caller's signal only stops that caller
 * waiting. `clear()` moves the epoch, so a response in flight for the old scope never lands in the new one. A
 * refusal is kept for REFUSAL_MS with its message, which is what the card shows.
 */
export class CalendarCache {
  private epoch = 0;
  private entries = new Map<string, CalendarBundle>();
  private refusals = new Map<string, { message: string; at: number }>();
  private inFlight = new Map<string, Promise<CalendarBundle>>();

  get size(): number {
    return this.entries.size;
  }

  /** What a render can use now: the bundle, a standing refusal, or neither (not asked, or in flight). */
  peek(key: string, now = Date.now()): { bundle?: CalendarBundle; refusal?: string } {
    const bundle = this.entries.get(key);
    if (bundle) return { bundle };
    const refused = this.refusals.get(key);
    return refused && now - refused.at < REFUSAL_MS ? { refusal: refused.message } : {};
  }

  clear(): void {
    this.epoch += 1;
    this.entries.clear();
    this.refusals.clear();
    this.inFlight.clear();
  }

  async load(key: string, fetcher: () => Promise<unknown>, signal: AbortSignal): Promise<CalendarBundle> {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const { bundle, refusal } = this.peek(key);
    if (bundle) return bundle;
    if (refusal) throw new CalendarError("CALENDAR_UNAVAILABLE", refusal);
    let pending = this.inFlight.get(key);
    if (!pending) {
      const epoch = this.epoch;
      pending = (async () => {
        try {
          const value = await verifyBundle(await fetcher());
          if (epoch !== this.epoch) throw new CalendarError("CALENDAR_SCOPE_CHANGED");
          if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
          this.entries.set(key, value);
          return value;
        } catch (e) {
          if (epoch === this.epoch) {
            this.refusals.set(key, { message: e instanceof Error ? e.message : String(e), at: Date.now() });
          }
          throw e;
        } finally {
          if (epoch === this.epoch) this.inFlight.delete(key);
        }
      })();
      this.inFlight.set(key, pending);
    }
    const value = await pending;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return value;
  }
}
```

In `provider.ts`: the default `cache` argument becomes the caller's choice as before, and `load` becomes `const b = await cache.load(JSON.stringify([providerId, r]), () => fetchBundle(r, signal), signal);` (no `revalidate`). In `prepareCalendarBatch` replace the fixed `[year−1, year+1]` window with `const requested = range ?? bundleWindow(input.fields.map((f) => f.program.expression), new Date(input.referenceInstant));` (import from `./window`).

- [ ] **Step 4: Create `window.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { PERIOD_UNIT, parseExpression, splitRange, type Atom } from "../dateExpressions";
import { LIMITS } from "./contracts";

/** A bundle request's inclusive date range. */
export type BundleWindow = { start: string; end: string };

/** Days one unit of each offset can move a date, rounded up. Weekday steps (MON..SUN) are a week each. */
const UNIT_DAYS: Record<string, number> = { s: 0, min: 0, h: 1, d: 1, w: 7, m: 31, q: 92, fq: 92, y: 366, fy: 366 };

/** How far from now one atom can land, in days, generously. */
function reach(atom: Atom): number {
  // A period anchor starts up to a year back (FY0) before its own count moves it.
  let days = atom.anchor.kind === "period" ? 366 + Math.abs(atom.anchor.n) * UNIT_DAYS[PERIOD_UNIT[atom.anchor.period]] : 0;
  if (atom.anchor.kind === "expiry") days += 31 * (Math.abs(atom.anchor.n) + 1);
  for (const o of atom.offsets) {
    // Business days: five in seven, plus two weeks for a holiday season.
    days += o.unit === "bd" ? Math.ceil((o.amount * 7) / 5) + 14 : o.amount * (UNIT_DAYS[o.unit] ?? 7);
  }
  return days;
}

/** Years either side of now: 2 × 9 + 1 = 19 whole years, inside LIMITS.days (20 years). */
const MAX_SIDE_YEARS = Math.floor((LIMITS.days / 366 - 1) / 2);

/**
 * The whole UTC years a card's expressions can reach from `now` (review I2: always one year either side, so `T-2y`
 * failed). Whole years because openbq-docker aligns to them, so a one-day change asks for the same bundle. A reach
 * past MAX_SIDE_YEARS is cut there, and resolving beyond it is a visible COVERAGE_UNAVAILABLE.
 */
export function bundleWindow(values: readonly string[], now: Date): BundleWindow {
  let days = 0;
  for (const value of values) {
    for (const half of splitRange(value)) {
      const expr = parseExpression(half);
      if (expr) for (const atom of expr.end ? [expr.start, expr.end] : [expr.start]) days = Math.max(days, reach(atom));
    }
  }
  const side = Math.min(MAX_SIDE_YEARS, Math.ceil(days / 365) + 1);
  const year = now.getUTCFullYear();
  return { start: `${year - side}-01-01`, end: `${year + side}-12-31` };
}
```

- [ ] **Step 5: Add `paramCalendarIds` / `calendarIdsOf` to `params.ts`**

(imports: `isKnownCalendar` from `./calendar`; `isExpression, isPeriodType, parseExpression` from `./dateExpressions`)

```ts
/** The known calendars a value's atoms name with `(MIC)`. */
function atomCalendars(value: string): string[] {
  const out: string[] = [];
  for (const half of splitRange(value)) {
    const expr = parseExpression(half);
    for (const atom of expr ? (expr.end ? [expr.start, expr.end] : [expr.start]) : []) {
      if (atom.calendar !== undefined && isKnownCalendar(atom.calendar)) out.push(atom.calendar);
    }
  }
  return out;
}

/** Every calendar one field resolves on: its own (calendarOf, steps 2-6) and each atom's `(MIC)` (step 1). */
export function paramCalendarIds(
  widget: WidgetDef,
  param: WidgetParam | undefined,
  values: Record<string, string>,
  exchange?: string,
  value: string = param ? (values[param.paramName] ?? "") : "",
): string[] {
  return [...new Set([calendarOf(widget, param, exchange, values).mic, ...atomCalendars(value)])];
}

/**
 * Every calendar a card's period params use, sorted. `expressionsOnly` leaves out a field holding a literal: those
 * are the calendars a request must WAIT for, which a literal never does. The Date expression card resolves out of
 * plain text params (#148), so its `expr` and `as_of` are read as well.
 */
export function calendarIdsOf(widget: WidgetDef, values: Record<string, string>, exchange?: string, expressionsOnly = false): string[] {
  const ids = new Set<string>();
  for (const p of widget.params) {
    if (!isPeriodType(p.type) || (expressionsOnly && !isExpression(p.type, values[p.paramName] ?? ""))) continue;
    for (const id of paramCalendarIds(widget, p, values, exchange)) ids.add(id);
  }
  if (widget.type === "date_probe") {
    for (const v of [values.expr ?? "", values.as_of ?? ""]) {
      if (expressionsOnly && !isExpression("datetime", v)) continue;
      for (const id of paramCalendarIds(widget, undefined, values, exchange, v)) ids.add(id);
    }
  }
  return [...ids].sort();
}
```

Delete from `WireContext`: `calendarSignal`, `calendarRange`, `onCalendarResolution`, `resolvedCalendarValues`; drop the `resolvedCalendarValues` branch in `wireParams` (the value is now just `resolveValue(…)`) and the `ResolutionResult` import.

- [ ] **Step 6: Create `bundles.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { calendarName, type ExchangeCalendar } from "../calendar";
import { calendarIdsOf } from "../params";
import type { BackendConfig, WidgetDef } from "../types";
import { CalendarCache } from "./cache";
import { CalendarError, LIMITS, parseBinding, type CalendarBinding, type CalendarBundle, type Policy } from "./contracts";
import { bundleCalendar } from "./resolver";
import { bundleWindow, type BundleWindow } from "./window";

/** How a bundle is fetched: dataClient.fetchCalendarBundle in the app, a stub in tests. */
export type FetchBundle = (calendarId: string, window: BundleWindow) => Promise<unknown>;

/** One cache for the whole app (review I3: a new one per fetch never hit). */
const cache = new CalendarCache();

/**
 * Whose bundles these are: the backend and its credential, so two logins never share a private bundle. Only ever a
 * Map key, never logged or sent.
 */
export function bundleScope(backend: BackendConfig): string {
  return JSON.stringify([backend.id, backend.baseUrl, backend.authLocation, backend.headerName ?? "", backend.headerValue ?? ""]);
}

/** Forgets every bundle and refusal, and orphans whatever is in flight; the backends store calls it on a credential change. */
export function clearCalendarBundles(): void {
  cache.clear();
}

const keyOf = (backend: BackendConfig, calendarId: string, window: BundleWindow) =>
  JSON.stringify([bundleScope(backend), calendarId, window.start, window.end]);

/** One bundle from the cache, or its standing refusal, without fetching. */
export function peekCalendarBundle(backend: BackendConfig, calendarId: string, window: BundleWindow) {
  return cache.peek(keyOf(backend, calendarId, window));
}

/**
 * One bundle, fetched at most once per scope, calendar and window. It may cover more than the window (openbq-docker
 * answers whole years); a bundle's own coverage is what its operations check, so a thinner one fails at resolution
 * with its coverage named, never silently.
 */
export async function loadCalendarBundle(
  backend: BackendConfig,
  calendarId: string,
  window: BundleWindow,
  fetchBundle: FetchBundle,
  signal: AbortSignal,
): Promise<CalendarBundle> {
  const bundle = await cache.load(
    keyOf(backend, calendarId, window),
    async () => {
      const payload = await fetchBundle(calendarId, window);
      // The contract's own ceiling (review minor: the client never enforced it).
      if (JSON.stringify(payload).length > LIMITS.bytes) {
        throw new CalendarError("RESOURCE_LIMIT", `${calendarId} bundle is larger than ${LIMITS.bytes} bytes`);
      }
      return payload;
    },
    signal,
  );
  if (bundle.calendarId !== calendarId) {
    throw new CalendarError("BUNDLE_REQUEST_MISMATCH", `Asked for ${calendarId}, served ${bundle.calendarId}`);
  }
  return bundle;
}

/** A calendar key (calendarOf's `mic`) as the binding that loads it. */
function bindingOf(id: string): CalendarBinding {
  return id.startsWith("binding:")
    ? parseBinding(JSON.parse(id.slice("binding:".length)))
    : parseBinding({ schemaVersion: 1, kind: "single", calendarId: `exchange:${id}` });
}

const membersOf = (b: CalendarBinding): string[] => (b.kind === "single" ? [b.calendarId] : b.members);

/** A stand-in that says why there is no calendar; any atom that needs one shows this (dateExpressions.ts). */
function unavailable(id: string, reason: string): ExchangeCalendar {
  return {
    code: id,
    name: calendarName(id),
    timezone: "UTC",
    session: { open: "00:00:00", close: "00:00:00", workingDays: [] },
    holidays: {},
    years: [],
    source: "backend",
    unavailable: `${calendarName(id)} calendar unavailable: ${reason}`,
  };
}

/** What an opted-in card resolves on, and whether it must wait; `key` moves exactly when the calendars do. */
export type WidgetCalendars = { calendars: Record<string, ExchangeCalendar>; pending: boolean; key: string };

/**
 * An opted-in card's calendars from the cache, synchronously, for render: a bundle calendar per key, else a
 * placeholder naming why ("still loading", or the refusal). `pending` is true only when a value that is an
 * EXPRESSION needs a calendar still loading, so a card of literal dates never waits.
 */
export function peekWidgetCalendars(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, string>,
  exchange: string | undefined,
  now: Date,
): WidgetCalendars {
  const window = bundleWindow(Object.values(values), now);
  const policy = (widget.calendarResolutionPolicy ?? "operational-v1") as Policy;
  const needed = new Set(calendarIdsOf(widget, values, exchange, true));
  const calendars: Record<string, ExchangeCalendar> = {};
  const parts: string[] = [];
  let pending = false;
  for (const id of calendarIdsOf(widget, values, exchange)) {
    try {
      if (policy !== "operational-v1" && policy !== "planning-v1") {
        throw new CalendarError("INVALID_POLICY", `calendarResolutionPolicy ${String(policy)} is not operational-v1 or planning-v1`);
      }
      const binding = bindingOf(id);
      const states = membersOf(binding).map((m) => peekCalendarBundle(backend, m, window));
      const refusal = states.find((s) => s.refusal !== undefined)?.refusal;
      if (refusal !== undefined) throw new CalendarError("CALENDAR_UNAVAILABLE", refusal);
      if (states.some((s) => !s.bundle)) {
        if (needed.has(id)) pending = true;
        calendars[id] = unavailable(id, "still loading");
        parts.push(`${id}:?`);
        continue;
      }
      const bundles = states.map((s) => s.bundle!);
      calendars[id] = bundleCalendar(bundles, binding, policy);
      parts.push(`${id}:${bundles.map((b) => b.digest).join("+")}`);
    } catch (e) {
      calendars[id] = unavailable(id, e instanceof Error ? e.message : String(e));
      parts.push(`${id}:!${calendars[id].unavailable}`);
    }
  }
  return { calendars, pending, key: `${window.start}..${window.end}|${parts.join("|")}${pending ? "|pending" : ""}` };
}

/** Loads every bundle an opted-in card names, then answers as peekWidgetCalendars does. One refusal hides no other answer. */
export async function loadWidgetCalendars(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, string>,
  exchange: string | undefined,
  now: Date,
  fetchBundle: FetchBundle,
  signal: AbortSignal,
): Promise<WidgetCalendars> {
  const window = bundleWindow(Object.values(values), now);
  const members = new Set<string>();
  for (const id of calendarIdsOf(widget, values, exchange)) {
    try {
      for (const m of membersOf(bindingOf(id))) members.add(m);
    } catch {
      // An invalid binding: peekWidgetCalendars puts its error on the placeholder.
    }
  }
  await Promise.allSettled([...members].map((m) => loadCalendarBundle(backend, m, window, fetchBundle, signal)));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return peekWidgetCalendars(backend, widget, values, exchange, now);
}
```

- [ ] **Step 7: Wire `dataClient.ts`, `useWidgetData.ts`, `backendsStore.ts`; delete `widget.ts`**

`dataClient.ts` — drop the `createBundleProvider` and `prepareWidgetCalendar` imports, import `loadWidgetCalendars` from `./calendars/bundles` and `type BundleWindow` from `./calendars/window`, add near `CALENDAR_PATH`:

```ts
/** One calendar bundle from openbq-docker's versioned route, with the connection's credential. */
export function fetchCalendarBundle(backend: BackendConfig, calendarId: string, window: BundleWindow): Promise<unknown> {
  return fetchEndpoint(backend, `${CALENDAR_PATH}/v1/bundle`, { calendar_id: calendarId, start: window.start, end: window.end });
}
```

and replace PR #67's bound branch in `fetchWidgetData` with:

```ts
  // An opted-in card resolves on bundles only. A caller without the card hooks (the keys panel, a store) hands no
  // calendars, so they are loaded here through the same shared cache the hooks read: one resolver, one cache.
  if (widget.calendarBinding && ctx?.calendars === undefined) {
    const now = ctx?.now ?? new Date();
    const loaded = await loadWidgetCalendars(
      backend,
      widget,
      params,
      ctx?.exchange,
      now,
      (id, window) => fetchCalendarBundle(backend, id, window),
      new AbortController().signal,
    );
    ctx = { ...ctx, now, calendars: loaded.calendars };
  }
```

`useWidgetData.ts` — delete the `calendarResolution` state, the `calendarController` and its `abort()`, the `setCalendarResolution([])` call, the `calendarSignal`/`onCalendarResolution` arguments, `calendarResolution` from the returned object, and the `ResolutionResult` import. Confirm nothing read it: `grep -rn "calendarResolution\b" "$BDOBB/src" | grep -v calendarResolutionPolicy` prints nothing.

`backendsStore.ts` — import `clearCalendarBundles` from `../lib/calendars/bundles`. In `updateBackend`, after `set({ backends, runtimeCredentials });`:

```ts
        // A changed address or credential is a new scope: no bundle fetched under the old one may be read under the
        // new one, and nothing in flight may land in it (review I3).
        if (PROBED_FIELDS.some((k) => k in patch && patch[k] !== before[k])) clearCalendarBundles();
```

Call `clearCalendarBundles()` at the end of `removeBackend` and of `setCredential` too.

Delete the second resolver: `git -C "$BDOBB" rm src/lib/calendars/widget.ts src/lib/calendars/widget.test.ts`. (Its three tests move: one clock and evidence → Task 11's parity test; literals never wait → `bundles.test.ts` above; data bounds → Task 11's parity test.)

- [ ] **Step 8: Run the tests**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/lib src/stores/backendsStore.test.ts src/hooks/useWidgetData.test.ts
pnpm -C "$BDOBB" typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -C "$BDOBB" add -A src/lib src/hooks src/stores
git -C "$BDOBB" commit -m "fix(v4): one credential-scoped bundle cache, expression-sized windows, one bundle path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11 [bdobb]: Card hooks serve bundle calendars; preview, Run and the GET agree

**Files:**
- Create: `$BDOBB/src/hooks/useBundleCalendars.ts`, `$BDOBB/src/hooks/useBundleCalendars.test.tsx`, `$BDOBB/src/lib/calendars/parity.test.ts`
- Modify: `$BDOBB/src/hooks/useCardRequest.ts`, `$BDOBB/src/hooks/useTradingCalendar.ts`
- Test: `$BDOBB/src/hooks/useTradingCalendar.test.tsx` (append)

**Interfaces:**
- Consumes: `peekWidgetCalendars`, `loadWidgetCalendars`, `bundleScope`, `clearCalendarBundles` (Task 10); `fetchCalendarBundle`; `calendarIdsOf`, `paramCalendarIds`, `fieldContext` (Tasks 9–10); `isKnownCalendar`.
- Produces: `useBundleCalendars(widget: WidgetDef | undefined, values: Record<string, string>, backend: BackendConfig | undefined, dashboardExchange?: string, now?: Date): TradingCalendars`; `useCardRequest(...).trading` is the bundle result for an opted-in widget, the legacy one otherwise.

- [ ] **Step 1: Write the failing tests**

`$BDOBB/src/lib/calendars/parity.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import xlon from "./vendor/conformance/XLON.json";
import { clearCalendarBundles, peekWidgetCalendars } from "./bundles";
import { fetchWidgetData } from "../dataClient";
import { previewExpression } from "../dateExpressions";
import { fieldContext, wireParams } from "../params";
import { backend, widget } from "../../test/fixtures";
import { startMockServer, type MockServer } from "../../test/mockServer";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.stubGlobal("crypto", webcrypto);
const servers: MockServer[] = [];
beforeEach(() => clearCalendarBundles());
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it("gives one field the same value in preview, the Run check and the bundle GET (spec Tests)", async () => {
  const server = await startMockServer({
    "/api/v1/calendar/trading/v1/bundle": () => xlon,
    "/prices": (url: URL) => [{ date: url.searchParams.get("d") }],
  });
  servers.push(server);
  const b = backend({ baseUrl: server.url });
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
  const values = { d: "T-1bd" };
  const now = new Date("2026-12-29T12:00:00Z");

  expect(await fetchWidgetData(b, w, values, { now })).toEqual([{ date: "2026-12-24" }]);
  const { calendars, pending } = peekWidgetCalendars(b, w, values, undefined, now);
  expect(pending).toBe(false);
  expect(wireParams(w, values, { now, calendars })).toEqual({ d: "2026-12-24" });
  expect(previewExpression("date", "T-1bd", { now, ...fieldContext(w, w.params[0], { calendars }, values) })?.text).toBe("2026-12-24");
  // Data bounds still answer earliest/latest on a bound card (moved from PR #67's widget.test).
  expect(wireParams(w, { d: "earliest" }, { now, calendars, bounds: { min: new Date("2026-12-22T09:00:00Z"), max: now } })).toEqual({ d: "2026-12-22" });
});
```

`$BDOBB/src/hooks/useBundleCalendars.test.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import xlon from "../lib/calendars/vendor/conformance/XLON.json";
import { clearCalendarBundles, peekCalendarBundle } from "../lib/calendars/bundles";
import { bundleWindow } from "../lib/calendars/window";
import { wireParams } from "../lib/params";
import { backend, widget } from "../test/fixtures";
import { startMockServer, type MockServer } from "../test/mockServer";
import { useBundleCalendars } from "./useBundleCalendars";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.stubGlobal("crypto", webcrypto);
const servers: MockServer[] = [];
beforeEach(() => clearCalendarBundles());
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const w = widget({ calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
const now = new Date("2026-12-29T12:00:00Z");
const BUNDLE = "/api/v1/calendar/trading/v1/bundle";

async function serve() {
  const server = await startMockServer({ [BUNDLE]: () => xlon });
  servers.push(server);
  return server;
}

it("holds the card on a placeholder, then serves the bundle calendar", async () => {
  const server = await serve();
  const { result } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url }), undefined, now));
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(wireParams(w, { d: "T-1bd" }, { now, calendars: result.current.calendars })).toEqual({ d: "2026-12-24" });
});

it("re-asks under a new credential (review focus 4)", async () => {
  const server = await serve();
  const { result, rerender } = renderHook(({ value }) => useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url, headerName: "Authorization", headerValue: value }), undefined, now), {
    initialProps: { value: "a" },
  });
  await waitFor(() => expect(result.current.pending).toBe(false));
  rerender({ value: "b" });
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(2);
});

it("lets the shared fetch finish after the card unmounts, without publishing to it", async () => {
  const server = await serve();
  const b = backend({ baseUrl: server.url });
  const { unmount } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, b, undefined, now));
  unmount();
  await waitFor(() => expect(peekCalendarBundle(b, "exchange:XLON", bundleWindow(["T-1bd"], now)).bundle).toBeDefined());
});
```

Append inside the top-level `describe` of `src/hooks/useTradingCalendar.test.tsx` (it uses that file's `serve`, `calendarRequests`, `makeWidget` and `NOW`; `calendarFor` answers 404 for anything but XNYS, which the hook remembers, so `pending` settles):

```tsx
  it("asks for the calendars a value names by (MIC) and by symbol, and never one outside the nine (review focus 2)", async () => {
    const { b, s } = await serve();
    const w = makeWidget({ exchange: "XNAS", params: [{ paramName: "symbol", type: "text" }, { paramName: "d", type: "date" }] });
    const { result } = renderHook(() => useTradingCalendar(w, { symbol: "VOD.L", d: "T-1bd(XTKS)" }, b, undefined, NOW));
    await waitFor(() => expect(result.current.pending).toBe(false));
    const asked = new Set(calendarRequests(s).map((search) => new URLSearchParams(search).get("exchange")));
    expect([...asked].sort()).toEqual(["XLON", "XTKS"]);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/lib/calendars/parity.test.ts src/hooks/useBundleCalendars.test.tsx src/hooks/useTradingCalendar.test.tsx`
Expected: FAIL — `./useBundleCalendars` does not exist; the legacy hook asks for XNAS.

- [ ] **Step 3: Implement `useBundleCalendars.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from "react";
import { bundleScope, loadWidgetCalendars, peekWidgetCalendars } from "../lib/calendars/bundles";
import { fetchCalendarBundle } from "../lib/dataClient";
import { paramsKey } from "../lib/params";
import type { BackendConfig, WidgetDef } from "../lib/types";
import type { TradingCalendars } from "./useTradingCalendar";

const NONE: TradingCalendars = { calendars: {}, pending: false, key: "" };

/**
 * An opted-in (calendarBinding) card's calendars, for every path that resolves its params -- the controls, the
 * Relative tab, the echo, SSRM, the Run check and the GET -- so none of them falls back to weekdays (review C1).
 * Render reads the shared cache synchronously; an effect loads what it lacks and re-renders when that lands. The
 * credential is in the scope, so an edit re-asks under the new one. A card that unmounts stops listening, but the
 * shared fetch finishes for whoever asks next.
 */
export function useBundleCalendars(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  dashboardExchange?: string,
  now: Date = new Date(),
): TradingCalendars {
  const [landed, setLanded] = useState(0);
  const bound = widget?.calendarBinding ? widget : undefined;
  const scope = backend ? bundleScope(backend) : "";
  // Value-derived stand-ins, as useTradingCalendar's are: callers rebuild `values` and `now` on every render.
  const valuesKey = paramsKey(values);
  const year = now.getUTCFullYear();
  const state = useMemo(
    () => (bound && backend ? peekWidgetCalendars(backend, bound, values, dashboardExchange, now) : NONE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bound, scope, valuesKey, dashboardExchange, year, landed],
  );
  useEffect(() => {
    if (!bound || !backend || !state.key.includes(":?")) return;
    let cancelled = false;
    const controller = new AbortController();
    void loadWidgetCalendars(backend, bound, values, dashboardExchange, now, (id, window) => fetchCalendarBundle(backend, id, window), controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLanded((n) => n + 1);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, state.key]);
  return useMemo(() => ({ calendars: state.calendars, pending: state.pending, key: state.key }), [state]);
}
```

(The effect runs while any calendar is still loading — `":?"` in the key — not only a needed one, so a literal card still has its calendars ready when an expression is typed.)

- [ ] **Step 4: Select it in `useCardRequest.ts`**

```ts
  const legacy = useTradingCalendar(widget, params, backend, fiscalYearEnd, undefined, exchange);
  // An opted-in card resolves on openbq-docker's versioned bundles only (spec "Calendars available").
  const bundled = useBundleCalendars(widget, params, backend, exchange);
  const trading = widget?.calendarBinding ? bundled : legacy;
```

- [ ] **Step 5: Gather the legacy hook's calendars with `calendarIdsOf`**

In `useTradingCalendar.ts` (imports: `isKnownCalendar` from `../lib/calendar`; `calendarIdsOf, paramCalendarIds` from `../lib/params`; drop `exchangeOf`), move `const valuesKey = paramsKey(values);` above the `exchanges` memo and replace it:

```ts
  const exchanges = useMemo(() => {
    if (!widget || widget.calendarBinding) return [];
    // Every calendar a value names -- the field's own (calendarOf: symbol, param, widget, dashboard, XNYS) and each
    // atom's `(MIC)` -- less any outside the nine, which resolution refuses and nothing ever fetches.
    return calendarIdsOf(widget, values, dashboardExchange).filter(isKnownCalendar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, valuesKey, dashboardExchange]);
```

and in the two-pass loop replace `const mic = exchangeOf(widget, p, dashboardExchange); for (const y of seen.years) {…}` with:

```ts
        // A field's consulted years are filed under every calendar it resolves on; an extra year for an atom's
        // calendar costs one cached request, a missing one would resolve on weekdays.
        for (const mic of paramCalendarIds(widget, p, values, dashboardExchange).filter(isKnownCalendar)) {
          for (const y of seen.years) {
            if (!inCalendarRange(y)) continue;
            wanted.get(mic)?.add(y);
            if (!consulted.has(mic)) consulted.set(mic, new Set());
            consulted.get(mic)?.add(y);
          }
        }
```

- [ ] **Step 6: Run the tests**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/hooks src/lib/calendars src/components/WidgetCard.test.tsx
pnpm -C "$BDOBB" typecheck
pnpm -C "$BDOBB" exec eslint src/hooks src/lib/calendars
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" add src/hooks src/lib/calendars/parity.test.ts
git -C "$BDOBB" commit -m "feat(v4): card hooks serve bundle calendars; preview, Run and the GET resolve alike

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12 [bdobb]: Show calendar errors and the Provisional badge on the card

**Files:**
- Modify: `$BDOBB/src/components/ParamControls.tsx`, `$BDOBB/src/components/pickers/RelativeTab.tsx`, `$BDOBB/src/components/renderers/ParamEchoRenderer.tsx`, `$BDOBB/src/components/WidgetCard.tsx`, `$BDOBB/src/styles.css`
- Test: `$BDOBB/src/components/ParamControls.test.tsx`, `$BDOBB/src/components/pickers/RelativeTab.test.tsx`, `$BDOBB/src/components/renderers/ParamEchoRenderer.test.tsx`

**Interfaces:**
- Consumes: `fieldContext`, `WireContext.errors` (Task 9); `Preview.error`, `Preview.provisional`; `CalendarTrace.provisional`; `calendarOf`; `bundleCalendar`.
- Produces: `.param-badge-provisional` (text "Provisional"); the ⚠ badge leads with `Calendar error: <message>`; no `exchangeOf` left in `src/components` except DateProbeRenderer (Task 13).

- [ ] **Step 1: Write the failing tests**

In `ParamControls.test.tsx`, inside `describe("expressions (v5.3.0)", …)` (imports: `xnysYearEnd` from `../lib/calendars/vendor/conformance/XNYS-2026-12.json`, `bundleCalendar`, `type CalendarBundle`):

```tsx
    it("puts an unknown calendar on the ⚠ badge, as an error, not a fallback", () => {
      renderPeriod({ effective: { ...periodCard.params, start: "T-1bd(XNYZ)" } });
      const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
      expect(start.querySelector(".param-badge-warn")).toHaveAttribute("aria-label", "Calendar error: Unknown calendar XNYZ");
    });

    it("shows a Provisional badge when planning-v1 accepted a provisional day", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-29T15:00:00Z"));
      try {
        const bundle = structuredClone(xnysYearEnd) as CalendarBundle;
        bundle.days.find((d) => d.date === "2026-12-28")!.evidenceStatus = "provisional";
        const xnys = bundleCalendar([bundle], { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, "planning-v1");
        renderPeriod({ calendars: { XNYS: xnys } });
        const start = screen.getByRole("group", { name: "Start" }).closest(".param-field")!;
        expect(start.querySelector(".param-badge-provisional")).toHaveTextContent("Provisional");
      } finally {
        vi.useRealTimers();
      }
    });
```

In `ParamEchoRenderer.test.tsx`:

```tsx
it("shows why a value could not resolve instead of an empty value", () => {
  render(<ParamEchoRenderer widget={widget({ params: [{ paramName: "d", type: "date" }] })} params={{ d: "T(XNYZ)" }} />);
  expect(screen.getByLabelText("d", { selector: "dd" })).toHaveTextContent("⚠ Unknown calendar XNYZ");
});
```

In `RelativeTab.test.tsx`, inside `describe("RelativeTab", …)`:

```tsx
  it("shows a calendar error in place of the preview and keeps Apply off", () => {
    const failing = (): Preview => ({ text: "", fallback: false, error: "Unknown calendar XNYZ" });
    render(
      <RelativeTab
        type="date"
        label="Date"
        value="T-1d"
        context={{ preview: failing, presets: [], onSavePreset: vi.fn(), onDeletePreset: vi.fn() }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("⚠ Unknown calendar XNYZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/components/ParamControls.test.tsx src/components/renderers/ParamEchoRenderer.test.tsx src/components/pickers/RelativeTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ParamControls.tsx`**

Replace `exchangeOf` with `fieldContext` (import from `../lib/params`). `displayed`:

```tsx
  const displayed = (name: string) => {
    const param = params.find((p) => p.paramName === name);
    const stored = effective[name] ?? "";
    let failed = false;
    // The type is the LAST declaration's, same as kindByName above.
    const resolved = resolveValue(params.filter((p) => p.paramName === name).at(-1)?.type, stored, {
      fiscalYearEnd: fiscalYearEnd[name],
      ...fieldContext(widget, param, { exchange, calendars }, effective),
      onError: () => {
        failed = true;
      },
    });
    // A value that cannot resolve shows as stored; the ⚠ badge says why.
    return failed ? stored : resolved;
  };
```

Trace pass:

```tsx
  const trace: Record<string, CalendarTrace> = {};
  const calendarErrors: Record<string, string> = {};
  wireParams(shownWidget, effective, { fiscalYearEnd, calendars, trace, exchange, errors: calendarErrors });
```

`relativeFor`'s `preview`:

```tsx
      preview: (expr) =>
        previewExpression(type, expr, { fiscalYearEnd: fiscalYearEnd[name], ...fieldContext(widget, param, { exchange, calendars }, effective) }),
```

Badges — the warnings list leads with the error, and a Provisional badge follows the ⚠ block:

```tsx
              const warnings = [
                calendarErrors[p.paramName] !== undefined ? `Calendar error: ${calendarErrors[p.paramName]}` : undefined,
                fallback ? `Fallback calendar: ${trace[p.paramName]?.reason}` : undefined,
                fiscalReasons[p.paramName],
              ].filter((w): w is string => w !== undefined);
```

```tsx
            {trace[p.paramName]?.provisional ? (
              // Spec ruling 2026-10-23: planning-v1 accepted a provisional day, and the card says so.
              <span className="param-badge-provisional" role="img" aria-label="Provisional calendar evidence (planning-v1)" title="Provisional calendar evidence (planning-v1)">
                Provisional
              </span>
            ) : null}
```

`styles.css`, beside `.param-badge-warn`:

```css
.param-entry > .param-badge-provisional { align-self: flex-start; padding-top: 4px; flex: none; }
.param-badge-provisional { cursor: default; font-size: var(--font-size-12); line-height: 1; color: var(--warning, var(--error)); }
```

(If `--warning` is not defined in `styles.css`, `grep -n "\-\-warning" "$BDOBB/src/styles.css"`, the fallback is used.)

- [ ] **Step 4: Implement `RelativeTab.tsx`, `ParamEchoRenderer.tsx`, `WidgetCard.tsx`**

`RelativeTab.tsx`:

```tsx
      <p className="relative-preview" aria-live="polite" title={preview?.error ?? preview?.reason}>
        {preview
          ? preview.error !== undefined
            ? `⚠ ${preview.error}`
            : `resolves now to ${preview.text}${preview.fallback ? " ⚠" : ""}${preview.provisional ? " (provisional)" : ""}`
          : "—"}
      </p>
```

and the Apply and Save-as `disabled` conditions gain `|| preview?.error !== undefined`.

`ParamEchoRenderer.tsx`:

```tsx
  const errors: Record<string, string> = {};
  const resolved = wireParams(widget, params, { fiscalYearEnd, calendars, exchange, errors });
  ...
          <dd aria-label={name}>{errors[name] !== undefined ? `⚠ ${errors[name]}` : resolved[name]}</dd>
```

`WidgetCard.tsx`: replace the `exchangeOf` import with `calendarOf`, and

```tsx
  const dateContext = useMemo(
    () => filterDateContext(calendarOf(widget, undefined, exchange, params).mic, trading.calendars),
    [widget, exchange, params, trading.calendars],
  );
```

- [ ] **Step 5: Run the tests**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/components
pnpm -C "$BDOBB" typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "$BDOBB" add src/components src/styles.css
git -C "$BDOBB" commit -m "feat(v4): calendar errors and a Provisional badge on the card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13 [bdobb]: The Date expression footer names calendar and source; Help documents `@` and `(MIC)`; `exchangeOf` goes

**Files:**
- Modify: `$BDOBB/src/components/renderers/DateProbeRenderer.tsx`, `$BDOBB/src/lib/calendar.ts` (delete `exchangeOf`), `$BDOBB/src/help/guide/date-expression.md`, `$BDOBB/src/help/guide/card-parameters.md`, `$BDOBB/src/help/topics/card-parameters.md`
- Test: `$BDOBB/src/components/renderers/DateProbeRenderer.test.tsx`, `$BDOBB/src/help/guide.test.ts`, `$BDOBB/src/lib/calendar.test.ts` (delete the `exchangeOf` cases)

**Interfaces:**
- Consumes: `fieldContext`, `describeCalendar`, `isKnownCalendar`, `parseExpression`, `splitRange`.
- Produces: footer text `Calendar: <describeCalendar> — <source>` per calendar used, joined with ` · `.

- [ ] **Step 1: Write the failing tests**

Append to `DateProbeRenderer.test.tsx` (imports: `xlon` fixture, `bundleCalendar`, `type CalendarBundle`):

```tsx
describe("the calendar footer (spec)", () => {
  const xlonCal = bundleCalendar([xlon as CalendarBundle], { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, "operational-v1");
  const at = new Date("2026-12-29T12:00:00Z");

  it("names the expression's own calendar and where it came from", () => {
    render(<DateProbeRenderer params={{ expr: "T-1bd(XLON)" }} now={at} zone="UTC" calendars={{ XLON: xlonCal, ...cal }} />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("Calendar: XLON (from the expression) — served by this card's backend");
    expect(screen.getByLabelText("date")).toHaveTextContent("2026-12-24");
  });

  it("says Default (XNYS) only when nothing else applies", () => {
    render(<DateProbeRenderer params={{ expr: "T" }} now={now} zone="America/New_York" calendars={cal} />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("Calendar: Default (XNYS)");
    render(probe("T"));
    expect(screen.getAllByTestId("probe-calendar")[1]).toHaveTextContent("Calendar: XNYS (from the dashboard)");
  });

  it("names both calendars of a mixed range", () => {
    render(<DateProbeRenderer params={{ expr: "T-3bd(XLON)..T" }} now={at} zone="UTC" calendars={{ XLON: xlonCal, ...cal }} exchange="XNYS" />);
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XNYS (from the dashboard)");
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XLON (from the expression)");
  });

  it("shows an unknown calendar as an error", () => {
    render(<DateProbeRenderer params={{ expr: "T(XNYZ)" }} now={now} zone="UTC" calendars={cal} />);
    expect(screen.getByTestId("probe-error")).toHaveTextContent("⚠ Unknown calendar XNYZ");
    expect(screen.getByTestId("probe-calendar")).toHaveTextContent("XNYZ (from the expression) — unknown calendar");
  });
});
```

Append to `src/help/guide.test.ts`:

```ts
  it("documents @ and (MIC) on the Date Expression page with the spec's examples", () => {
    const page = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}date-expression`)!;
    for (const example of ["T-1bd(XLON)", "T-1bd@close(XNYS)", "T@09:30(XTKS)", "FQ0@open(XHKG)", "T-5bd(XLON)..T(XLON)", "Unknown calendar XNYZ"]) {
      expect(page.body, example).toContain(example);
    }
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm -C "$BDOBB" exec vitest run src/components/renderers/DateProbeRenderer.test.tsx src/help`
Expected: FAIL.

- [ ] **Step 3: Implement the footer in `DateProbeRenderer.tsx`**

Imports: `describeCalendar, isKnownCalendar, newTrace, type CalendarChoice, type ExchangeCalendar` from `../../lib/calendar`; `isExpression, parseExpression, resolveValue, splitRange` from `../../lib/dateExpressions`; `fieldContext` from `../../lib/params`. Replace the `mic`/`calendar` lines and the resolutions:

```tsx
  // The card's own calendar, by the same precedence every field uses (calendarOf): widget, dashboard, XNYS.
  const field = fieldContext(widget, undefined, { exchange, calendars }, params);
  const errors: string[] = [];
  const onError = (m: string) => {
    if (!errors.includes(m)) errors.push(m);
  };
  ...
  const asOfText = resolveValue("datetime", (params.as_of ?? "").trim() || "T", { now, zone, fiscalYearEnd, ...field, onError });
  const asOf = new Date(asOfText);
  const ctx = { now: Number.isNaN(asOf.getTime()) ? now : asOf, zone, fiscalYearEnd, ...field, onError };
  const date = resolveValue("date", expr, { ...ctx, trace: asDate });
  const datetime = resolveValue("datetime", expr, { ...ctx, trace: asDatetime });

  // Every calendar the answer used: each atom's own `(MIC)`, and the card's for any atom without one.
  const atoms = splitRange(expr).flatMap((half) => {
    const e = parseExpression(half);
    return e ? (e.end ? [e.start, e.end] : [e.start]) : [];
  });
  const choices: CalendarChoice[] = [];
  const add = (c: CalendarChoice) => {
    if (!choices.some((x) => x.mic === c.mic && x.from === c.from)) choices.push(c);
  };
  if (atoms.length === 0 || atoms.some((a) => a.calendar === undefined)) add(field.choice);
  for (const a of atoms) if (a.calendar !== undefined) add({ mic: a.calendar, from: "expression" });
  const calendarFor = (c: CalendarChoice): ExchangeCalendar | undefined => (c.from === "expression" ? calendars?.[c.mic] : field.calendar);
  const sourceNote = (c: CalendarChoice): string => {
    if (!isKnownCalendar(c.mic) && !c.mic.startsWith("binding:")) return " — unknown calendar";
    const cal = calendarFor(c);
    if (cal === undefined) return " — none loaded";
    return cal.unavailable ? ` — ${cal.unavailable}` : ` — ${SOURCE_LABEL[cal.source]}`;
  };
  const degraded = choices.some((c) => isKnownCalendar(c.mic) && (calendarFor(c) === undefined || calendarFor(c)?.source === "weekdays"));
  const reason = asDate.reason ?? asDatetime.reason;
  const provisional = asDate.provisional === true || asDatetime.provisional === true;
```

JSX — the calendar line, an error line and a provisional line:

```tsx
      <p className="date-probe-note" data-testid="probe-calendar">
        Calendar: {choices.map((c) => `${describeCalendar(c)}${sourceNote(c)}`).join(" · ")}
      </p>

      {errors.length > 0 ? (
        <p className="date-probe-warn" data-testid="probe-error">⚠ {errors.join("; ")}</p>
      ) : null}

      {provisional ? (
        <p className="date-probe-note" data-testid="probe-provisional">Provisional — planning-v1 accepted a provisional calendar day.</p>
      ) : null}
```

The existing `degraded` warning keeps its markup; its fallback text names `field.choice.mic` where it named `mic`.

- [ ] **Step 4: Delete `exchangeOf`**

Remove `exchangeOf` from `calendar.ts` and its two test blocks in `calendar.test.ts` (`prefers the param's exchange over the widget's over XNYS` and `orders the param, the widget, the dashboard, then XNYS` — calendarOf's precedence test in Task 8 replaces both; keep the `parseExchange` test). Update the stale comment at `DateProbeRenderer.test.tsx:114` to say `calendarOf`. Verify: `grep -rn "exchangeOf" "$BDOBB/src"` prints nothing.

- [ ] **Step 5: Write the Help**

`src/help/guide/date-expression.md` — insert before `## What it tells you underneath`:

```markdown
## Times of day and calendars

Two suffixes can close an expression. **`@`** pins a time of day onto the date the anchor and its offsets land on: `@HH:MM` (two digits each side of the colon), `@open` or `@close` — that date's own session hours, so an early close shortens `@close`, and a closed date takes the next session's. **`(MIC)`** names the calendar for the whole of it — its `bd` steps, its trading anchors and its `@`:

- `T-1bd(XLON)` — the London trading day before today.
- `T-1bd@close(XNYS)` — the prior NYSE trading day's close; the day after Thanksgiving, that is 13:00.
- `T@09:30(XTKS)` — 09:30 today on Tokyo's clock.
- `FQ0@open(XHKG)` — the first Hong Kong session open of the fiscal quarter.
- `T-5bd(XLON)..T(XLON)` — in a range each half carries its own calendar, and mixing them (`T-5bd(XLON)..T`) is allowed.

`@` only means something where a time is sent, so it is an expression on a `datetime` parameter and a literal anywhere else. The calendars are `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`, `XHKG`, `XASX`, `XTAE` and `XTAI`. Anything else in the parentheses is an error on the card — `T(XNYZ)` reads *Unknown calendar XNYZ* — never a literal and never New York's hours. A wall-clock `@14:00` on a card where nothing names a calendar is on your own clock.
```

In the same file replace the paragraph that starts `**Which calendar is behind the answer.**` with:

```markdown
**Which calendar is behind the answer, and why.** The line always shows. It names each calendar the answer used and where it came from — *Calendar: XLON (from the expression)*, *XTKS (from symbol 7203.T)*, *XHKG (from the widget)*, *XETR (from the dashboard)*, or *Default (XNYS)* when nothing names one — and where that calendar's data came from: a backend, the bundled NYSE file, or a weekday table with no holidays in it. A `⚠` follows when, and only when, it is a weekday table, because the bundled file is real data and a permanent caveat on every `XNYS` card would be furniture rather than information. A calendar that cannot answer is an error line of its own. See [[dashboards-and-folders|Dashboards and Folders]].
```

`src/help/guide/card-parameters.md` — replace the first paragraph under `### Trading calendars` with:

```markdown
The trading anchors, the `bd` unit and `@open`/`@close` read an exchange calendar, and the first of six answers wins: the expression's own `(MIC)`; the card's **Symbol**, by its suffix (`.US` New York; `.LSE` or `.L` London; `.TO` Toronto; `.XETRA` or `.DE` Xetra; `.TSE` or `.T` Tokyo; `.HK` Hong Kong; `.AU` or `.AX` Sydney; `.TA` Tel Aviv; `.TW` Taipei — an unsuffixed, crypto or FX symbol names none); the parameter's own MIC; the widget's; **the dashboard's** — right-click its rail row and choose **Exchange**; then `XNYS`, shown as **Default (XNYS)**. The app knows nine calendars — `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`, `XHKG`, `XASX`, `XTAE` and `XTAI` — and the dashboard menu offers the first six. A MIC outside the nine is an error on the card. See [[date-expression|The Date Expression Card]] for `@` and `(MIC)`, and [[dashboards-and-folders|Dashboards and Folders]].
```

and in its third paragraph change `for the six exchanges above` to `for the nine exchanges above`.

`src/help/topics/card-parameters.md` — replace the first paragraph under `### Trading calendars` with:

```markdown
The trading anchors, the `bd` unit and `@open`/`@close` read an exchange
calendar. The first of six answers wins: the expression's own `(MIC)`, as in
`T-1bd(XLON)` or `T-1bd@close(XNYS)`; the card's symbol by its suffix (`.L`
London, `.T` Tokyo, `.TO` Toronto, and the rest of the table in the guide);
the parameter's MIC; the widget's; the dashboard's; then `XNYS`, shown as
**Default (XNYS)**. The calendars are `XNYS`, `XLON`, `XTSE`, `XETR`, `XTKS`,
`XHKG`, `XASX`, `XTAE` and `XTAI`; anything else is an error on the card. The
calendar comes from the card's own backend, one year at a time as the
expressions need them; when the backend serves none, the app uses its bundled
NYSE calendar for `XNYS` (2026–2028) and plain weekdays for the others, and
says so with a badge. Years outside 1990–2040 are never asked for.
```

- [ ] **Step 6: Run the tests**

Run:
```bash
pnpm -C "$BDOBB" exec vitest run src/components/renderers src/help src/lib/calendar.test.ts
pnpm -C "$BDOBB" typecheck
```
Expected: PASS (`src/help` checks every page's links still resolve).

- [ ] **Step 7: Commit**

```bash
git -C "$BDOBB" add src/components/renderers src/lib/calendar.ts src/lib/calendar.test.ts src/help
git -C "$BDOBB" commit -m "feat(v4): Date expression footer names calendar and source; Help for @ and (MIC)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14 [both]: Evidence notes, final pairing, full gates

**Files:**
- Modify: `$OD/docs/calendars/release-v4-evidence.md`, `$BDOBB/docs/calendars/release-v4-evidence.md`, `$BDOBB/package.json` (`openbqDocker`), `$BDOBB/web/policy.mjs`, `$BDOBB/web/policy.vendored.json`, `$BDOBB/web/ssrm-routes.vendored.json` (generated)

**Interfaces:**
- Consumes: the provider head after Step 1; `scripts/gateway-vendor.mjs <tag> <40-hex commit>` (present on this branch; reads `funnel-gateway/policy.mjs` and `lanes/ssrm_widgets.json` at that commit from `OPENBQ_DOCKER_DIR`); `web/security.test.mjs` holds `policy.vendored.json`'s commit equal to `package.json`'s `openbqDocker`.

- [ ] **Step 1: Record the provider evidence and fix its head**

Append to `$OD/docs/calendars/release-v4-evidence.md`:

```markdown
## 2026-10-23 review fixes

- All nine calendars carry conformance fixtures whose facts `calendar-core/tests/test_qualification.py` checks; the registry advertises exactly that set, and capabilities report the supplier's own bounds inside 1990–2040 (Taiwan from 2019 by qualification).
- Bundles are built for whole years and cached as bytes under a 64 MB budget; capabilities are built once in a worker thread.
- Route tests mount the v1 routes without openbb-core, so they collect on the host.
- Still open: `openbq_calendar/legacy.py` remains a second generator for the v3 envelope; Security Master is absent on v4; container (Python 3.12 image) qualification and a rollback note are not done.
```

Run the provider gates, then commit and capture the head:

```bash
PYTHONPATH="$OD/calendar-core:$OD/v4/routes" python3 -m pytest -q "$OD/calendar-core/tests" "$OD/v4/routes/tests"
(cd "$OD" && python3 scripts/check-public.py)
git -C "$OD" add docs/calendars/release-v4-evidence.md
git -C "$OD" commit -m "docs(v4): record the 2026-10-23 calendar review fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
OD_SHA=$(git -C "$OD" rev-parse HEAD); echo "$OD_SHA"
```
Expected: `35 passed`; check-public exits 0; a 40-hex SHA.

- [ ] **Step 2: Prove the vendored contract matches the final provider**

```bash
rm -rf "$SCRATCH/calendar-contract"
PYTHONPATH="$OD/calendar-core" python3 -m openbq_calendar.artifact "$SCRATCH/calendar-contract"
node "$BDOBB/scripts/vendor-calendar-contract.mjs" "$SCRATCH/calendar-contract"
git -C "$BDOBB" status --short src/lib/calendars/vendor
```
Expected: no output (Tasks 1–3 after Task 5 changed no resource). If anything changed, commit it with the pairing below.

- [ ] **Step 3: Pin and re-pair the client to the final provider commit**

Confirm the script exists: `ls "$BDOBB/scripts/gateway-vendor.mjs"`. Set `"openbqDocker": "<OD_SHA>"` in `$BDOBB/package.json`, then:

```bash
OPENBQ_DOCKER_DIR="$OD" node "$BDOBB/scripts/gateway-vendor.mjs" v4.0.0 "$OD_SHA"
git -C "$BDOBB" diff --stat web package.json
```
Expected: `web/policy.mjs <- openbq-docker <OD_SHA> funnel-gateway/policy.mjs as v4.0.0 (…)`; `policy.vendored.json` records `"commit": "<OD_SHA>"`.

- [ ] **Step 4: Record the client evidence**

Append to `$BDOBB/docs/calendars/release-v4-evidence.md`:

```markdown
## 2026-10-23 calendar-qualified expressions and review fixes

- `@` (ported from bdobb-v2 f8fcfdc16, with 873992135's viewer clock) and `(MIC)` in the date grammar; nine calendars; the symbol suffix map; `calendarOf` replaces `exchangeOf` with the spec's six-step precedence.
- One resolver: every wireParams caller resolves synchronously against the card's calendars; opted-in cards read bundle calendars from one credential-scoped cache cleared on a credential change. PR #67's `prepareWidgetCalendar`, `resolvedCalendarValues` and the unread `calendarResolution` evidence are removed; `consumers.ts`/`resolver.ts` stay as the TemporalDB seam.
- Evidence ruling applied: provisional and conflict block under operational-v1; planning-v1 accepts provisional with a Provisional badge.
- Bundle windows follow the expressions' reach in whole years (at most 19); failures name the field, calendar, revision and coverage.
- Paired provider: `<OD_SHA>`.
- Still open: packaged offline bundles (B3), a capability-backed exchange picker (B5), receipts UI beyond the card error (B6), container and browser qualification (gate 9).
```

(Write the real SHA in place of `<OD_SHA>`.)

- [ ] **Step 5: Run every client gate**

Check host load first (`uptime`; the unit suite times out under a load average far above the core count — wait or rerun if so). Then:

```bash
pnpm -C "$BDOBB" pivot:build
git -C "$BDOBB" status --short            # pivot:build must not leave tool symlinks or new files tracked
pnpm -C "$BDOBB" typecheck
pnpm -C "$BDOBB" lint
pnpm -C "$BDOBB" scrub
pnpm -C "$BDOBB" test:web
pnpm -C "$BDOBB" exec vitest run src/help
pnpm -C "$BDOBB" exec vitest run
```
Expected: every command exits 0; `test:web` includes `web/security.test.mjs` passing on the new pairing and the vendoring test; the full vitest run reports no failures.

- [ ] **Step 6: Commit the pairing**

```bash
git -C "$BDOBB" branch --show-current     # claude/v4-calendar-qualifier
git -C "$BDOBB" add package.json web docs/calendars/release-v4-evidence.md src/lib/calendars/vendor
git -C "$BDOBB" commit -m "chore(v4): pair openbq-docker $OD_SHA (calendar review fixes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do not push either repository.
