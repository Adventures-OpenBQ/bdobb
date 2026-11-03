# Timestamp interchange implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Normalize the existing v11 bar/study wire boundary to explicit UTC, preserving daily dates and legacy-naive UTC readers.

**Architecture:** Keep internal tick/study clocks naive UTC where currently required. Normalize offsets before internal comparisons; serialize at the external boundary. Do not import later-release hooks into v11.

**Tech Stack:** Existing Python datetime/Polars/FastAPI and TypeScript/Vitest; no new runtime dependencies.

**Spec:** TemporalDB `docs/superpowers/specs/2026-11-03-market-calendar-temporal-integration-design.md`, approved November 3, 2026; first timestamp slice only.

## Global constraints

- Existing isolated client/host `codex/v11-platform-20261103` worktrees; preserve other pending work.
- No display-zone, session-membership, fallback, auction, receipt-schema or portfolio policy changes.
- Daily market dates remain dates. Only known internal/legacy-naive UTC boundaries may assume UTC.
- No deployment, image/source-offer qualification or main merge in this slice.

## Review focus

- Explicit nonzero offsets and UTC must identify the same instant in winter and summer.
- Date-only rows must not become a previous-day market date in a viewer's zone.
- Invalid dates must not silently become valid rollover dates or poison study frames.
- Study figure and delta x values must use the same representation.
- Serialization must not mutate cached/internal bar rows or reinterpret UTC as local time.

### Task 1: Host timestamp boundary

**Files:** create `host/live-grid/app/market_time.py`, tests `live-grid/tests/test_market_time.py`; modify `app/figure.py`, `app/main.py`, `app/series.py`, `app/static/demo.html`, `app/ta/payload.py`, `app/ta/figure.py` and affected tests.

**Interfaces:** `naive_utc(value) -> datetime` normalizes explicit offsets and known legacy-naive UTC, rejecting malformed values. `wire_time(value, *, date_only=False) -> str | None` preserves dates, emits explicit UTC instants, rejects malformed timestamps. Serializers receive interval/date intent from existing route parameters.

- [x] Add failing tests for offset-equivalent winter/summer times, daily dates, malformed input, immutable source rows, study frame normalization and figure/delta consistency.
- [x] Run the new tests and confirm failures identify absent/incorrect timestamp behavior.
- [x] Implement shared helpers and use them at `/series`, `/chart`, study figure/delta boundaries; normalize study frame input and seam comparisons without changing engine/session calculations.
- [x] Run affected host suites; distinguish intentional wire expectation changes from behavioral regressions.
- [x] Commit scoped host changes.

### Task 2: Client compatibility and shared conformance

**Files:** modify `bdobb/src/lib/liveChart.ts`, `liveChart.test.ts`; add `src/lib/marketTime.ts`, `marketTime.test.ts` only if current parser requires extraction for shared tests.

**Interfaces:** existing `seriesBars(payload)` and `rowTick(row,symbol,nowMs)` remain unchanged. Shared reader accepts date-only, explicit UTC/offset and documented legacy-naive UTC; malformed dates remain rejected. Numeric epochs are not newly admitted without a unit-tagged contract.

- [x] Add tests consuming equivalent offset/UTC/legacy rows, zero-crossing date boundaries, daily dates and malformed input under multiple viewer TZ settings. Reuse a source-controlled conformance fixture shared with host tests if practical.
- [x] Observe red for any newly discovered parser defect; retain working offset support rather than rewriting it gratuitously.
- [x] Implement only required validation/extraction; run liveChart and renderer regressions, TypeScript and cross-language fixture checks.
- [x] Document source mappings, UTC wire compatibility and remaining reporting/calendar audit in `host/v11/` and the TemporalDB tutorial.
- [x] Commit scoped client/documentation changes; independent final review of this slice, address findings, report verification and unqualified installed-artifact limits.


## Completion evidence

- Host: 155 targeted tests passed; 14 existing opt-in parity cases deselected.
- Static demo reader: 16 Node conformance checks passed.
- Client: 67 tests passed in each of Pacific/Honolulu and Asia/Tokyo; TypeScript passed.
- Shared fixture copies matched SHA-256 `24d7687f7edb360460a5d58eda461e69cfece8a20b24a1002516110d2ea4e138`.
- Independent final review found one daily positive-offset issue; route regression
  reproduced Jan15 -> Jan14 before fix. Interval-aware frame construction fixed
  it; reviewer independently reran 43 host checks and confirmed no further finding.
- Existing v11 source/artifact separation remains explicit: installed images and
  desktop/source-offer artifacts were not rebuilt, main was not merged.
