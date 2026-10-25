# Release v4 calendar integration (draft)

This is the release/v4 implementation increment, before a forward walk through later releases. It does not change or merge release branches.

## Delivered

- Independent Apache-2.0 `openbq-calendar` 0.1.0 package with validated v1 bundles, content digests, an explicit exchange registry, actual per-day sessions and intraday segments.
- Legacy trading-calendar response remains available through a compatibility adapter. New routes are `/api/v1/calendar/trading/v1/calendars` and `/api/v1/calendar/trading/v1/bundle` (`calendar_id`, `start`, `end`). The Dockerfile builds/installs both calendar and route wheels with existing locked supplier dependencies.
- Client validates and hash-checks bundles, freezes a batch reference instant and bundle vector, and resolves the existing expression grammar over retained sessions. Joint date bindings support all-open/any-open. The FX helper composes explicitly supplied payment IDs; no payment calendar feed is supplied here.
- Manifest widgets may opt in with `calendarBinding` and `calendarResolutionPolicy`. Direct `fetchWidgetData` calls prepare all typed expression fields before issuing the widget request, pass literal values through `wireParams`, and expose client evidence via `WireContext.onCalendarResolution` and `useWidgetData.calendarResolution`. Cancellation aborts calendar transport and prevents late hook publication. Unavailable selected calendars block submission.

Example widget opt-in:

```json
{"calendarBinding":{"schemaVersion":1,"kind":"single","calendarId":"exchange:XNYS"},"calendarResolutionPolicy":"operational-v1"}
```

## Scope and limits

Only exchange schedules from exchange_calendars 4.13.2 are advertised. Their evidence is `library_baseline`, not exchange-certified final authority. Trading calendars do not imply bank holidays, payment eligibility, settlement conventions or FX value dates. No central-bank/payment feed, automatic cross-to-calendar mapping, settlement lag or cutoff rule is implemented. Taiwan v1 history before 2019 is refused; Tokyo capabilities begin in 1997. Legacy compatibility semantics stay distinct.

This draft is not a full completion of the approved Project 1 plan: discovery selection UI, parameter/dashboard binding precedence, native/apps export round trips, QueryBuilder/linked-table/TemporalDB-specific consumer wiring, attached dataset/export provenance, browser end-to-end qualification, rollback and Python3.12 image qualification remain pending. DateProbe uses its existing legacy path. Do not enable the opt-in broadly until those gates are complete. No TemporalDB code or migration is included.

## Evidence (2026-10-23)

Host PR base: `6db686f69657fcf61881af8609fe9a22a9f685e6` (stale local tracking base `af0c8a3` was corrected by merging the target into the feature branch before final delivery). Client base: `4fd41cd217e7b955e738aafcedc6e44008452359`.

- Host focused supplier/contract/FastAPI route tests: **19 passed**, including against wheels installed into an isolated temporary target.
- Built calendar wheel SHA-256: `97379e3a92ab827c414b67979122ddf59d96faadde7490f697652f56c225fac3`.
- Built route wheel SHA-256: `7620aed6c024d047dc40d33dc51b6b045dde342ca9482137885d6c7588cbf216`.
- Native qualification environment: Python3.13.0, exchange_calendars4.13.2, pandas2.3.3, pydantic2.13.4, tzdata2026.2, OpenBB core1.6.13. This differs from the Python3.12 Docker target and locked pandas3.0.6/pydantic2.13.5/tzdata2026.5/OpenBB core2.0.1. Container qualification is pending; native test results do not qualify that target.
- Full host `pytest` attempted: collection fails in `examples/episode3/test_reference.py`, `provider-fixes/tests/test_core.py`, `provider-fixes/tests/test_finra.py`, `provider-fixes/tests/test_warnings.py`, `v3/econdb/tests/test_econdb.py`, `v3/videos/source/tests/test_router.py`, and `workspace/tests/test_assembly.py` (missing legacy/provider modules, test-module collision and assembly prerequisite). These are outside the calendar-focused passing suite; the complete host suite is not green.
- Client focused core/legacy tests: 225 passed before transport additions. Real HTTP transport + existing data-client/calendar/widget hook suites: 188 passed. Further review regressions cover data bounds, mixed fractional timestamp precision and property-name field IDs.
- Contract artifacts were re-exported from this supplier and vendored with SHA-256 verification; the vendoring tamper/atomic replacement test passed.
- Correct release/v4 Pivot WASM built from its source using Rust1.98.1 and wasm-bindgen0.2.128; smoke test passed. Client typecheck, changed-file ESLint and production Vite build pass (existing chunk-size/dynamic-import warnings).
- A fresh reviewer checked both repositories; both identified issues received failing regression tests and fixes. Full-suite final result is recorded separately below.

Full client final run: **355 files passed, 2 skipped; 6,402 tests passed, 7 skipped**. No failing tests.

Paired provider feature commit: `e93c9d8bf9b10722a83e1c8580d8eb52c475cdd6` (package.json `openbqDocker`). Superseded by `8b442abb169fc606cdfc97dc2610303e1a133ee5` (see the 2026-10-23 section).

After correcting the provider target, calendar plus current image-assembly tests passed: **25 tests and 2 subtests**, with three upstream deprecation warnings.

## 2026-10-23 calendar-qualified expressions and review fixes

- `@` (ported from bdobb-v2 f8fcfdc16; `@HH:MM` runs on the field's calendar clock, Default (XNYS) included, and 873992135's viewer-zone branch is dropped, ruling P13) and `(MIC)` in the date grammar; nine calendars; the symbol suffix map; `calendarOf` replaces `exchangeOf` with the spec's six-step precedence.
- One resolver: every wireParams caller resolves synchronously against the card's calendars; opted-in cards read bundle calendars from one credential-scoped cache cleared on a credential change. PR #67's `prepareWidgetCalendar`, `resolvedCalendarValues` and the unread `calendarResolution` evidence are removed; `consumers.ts`/`resolver.ts` stay as the TemporalDB seam.
- Evidence ruling applied: provisional and conflict block under operational-v1; planning-v1 accepts provisional with a Provisional badge.
- Bundle windows follow the expressions' reach in whole years (at most 19); failures name the field, calendar, revision and coverage.
- Rulings: R7a an `@` on a non-datetime parameter is a visible error and is never sent; R9a a value that does not parse as an expression passes through as typed; R10a only deterministic provider 4xx refusals are cached, and Retry forgets the key; P11/R10b bundle windows are clamped to the provider's bounds (1990-01-01 to 2040-12-31, XTAI from 2019, XTKS from 1997; the 2040 end is superseded by Q6 for XBOM, XSES, XSHG and XSAU); P13 `@HH:MM` uses the calendar's clock; P14 `(MIC)` is case-insensitive and trimmed, so an unknown one is a visible "Unknown calendar"; R13a the Date Probe shows the date part of an `@` resolution.
- Release note (behaviour change, ruling RF3): a dashboard or widget exchange outside the nine calendars, for example `XNAS`, is now an unknown calendar. Calendar-dependent values such as `T-1bd` show "Unknown calendar XNAS" on the card and are not sent; calendar-free values such as `T-7d` still send.
- Final review fixes: Omni POSTs and form bodies resolve on the card's own exchange and calendars, as its preview and GET do (I-A); a bound card whose bundle the shared cache evicts refetches it instead of staying on "Loading…" (I-B); `createBundleProvider`, the unused-in-v4 TemporalDB seam, takes the shared cache as a required argument (RF1).
- Paired provider: `8b442abb169fc606cdfc97dc2610303e1a133ee5`.
- RW9/RW9b/RW9c: the managed server-source form resolves its values through wireParams on the source widget before `registerBackend`, on the calendars those values name, loaded from the source's own backend by the card's hooks (`useTradingCalendar`, or the bundle hooks for a bound source); the card's managed-native widget declares no params and loads none. `T-1bd(XLON)` registers London's date; a value stepped on weekdays is refused as "XLON calendar still loading" while it fetches and "XLON calendar not loaded" on a real failure (404, error); `T(XNYZ)` and a `(MIC)`/`@` value whose parameter type is unknown are refused; nothing is registered on a refusal, and unqualified values and literals still register. Release note: the date is resolved once, at bind time, so a relative binding such as `T-1bd` is stored and replayed as that date, not re-resolved.
- Still open: packaged offline bundles (B3), a capability-backed exchange picker (B5), receipts UI beyond the card error (B6), container and browser qualification (gate 9).

## 2026-10-24 full calendar set

- The client vendors openbq-docker's generated `calendar-catalogue.json` (71 calendars) and derives the known set, `EXCHANGE_HOURS` (with each calendar's trading week), the symbol suffix map, the bundle window clamp, the Help calendar table and the dashboard Exchange menu from it. `DASHBOARD_EXCHANGES` is gone.
- `(MIC)` takes any catalogue name in any case and keeps the catalogue's spelling (`(us_futures)`, `(24/7)`); library aliases (`NYSE`, `XNAS`) stay unknown calendars (ruling RF3).
- The five overnight calendars (`24/5`, `24/7`, `CMES`, `IEPA`, `us_futures`) resolve only from bundles: a legacy card loads just those as bundles, layered over the per-year loader; the resolver never counts them on weekdays, so a missing bundle is a visible error. `T@open(CMES)` on a Monday is Sunday 17:00 Chicago.
- The dashboard Exchange menu lists Default (XNYS) and every catalogue calendar behind a search box; a stored name outside the catalogue loads, stays checked as "not a served calendar", and its cards show "Unknown calendar". Release note (behaviour change): a stored exchange such as `US` used to be dropped on load; it is now kept for repair.
- Bundle windows are clamped at both ends to the catalogue's bounds. Coverage limits in exchange_calendars 4.13.2: XBOM, XSES and XSHG end 2026-12-31, XSAU ends 2029-12-31. From those dates session and bd values show coverage errors until exchange_calendars is upgraded; calendar-free values still send. Ruling RF6: this holds on every card, bound or legacy. The resolver refuses a legacy calendar's date outside the catalogue's bounds with COVERAGE_UNAVAILABLE; a year inside the bounds that the backend refused still resolves on weekdays with ⚠ (RW6).
- Library disagreements, not asserted (the client shows these days as the library has them, open or full): XKRX is open on 2026-06-03 (local-election day, normally a KRX closure); XSES has no half days on 2026-12-24 and 2026-12-31; XJSE is open on 2026-11-04 (South Africa's local-election public holiday).
- Hand-check status: 11 of 12 verified, some from secondary sources only; XKRX 2026-12-31 closure is still unverified.
- Rulings (the full list Q1–Q7 is in the openbq-docker evidence note): Q1 widget and param `exchange` keep catalogue ids (`canonicalCalendar(v) ?? v.toUpperCase()`; `us_futures` stays `us_futures`). Q2 Escape in the menu's search box closes the menu. Q6 the bounds follow the library's actual coverage, not the spec's "to 2040"; XBOM, XSES, XSHG and XSAU are shorter.
- Paired provider: `f9e3908155601108df957cf55e61b8c5b4e4f501`.
- Still open: the v5–v10 walk (per-line brief); container and browser qualification (gate 9).
