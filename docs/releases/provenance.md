# Fresh release provenance

## Local assembly

No remote configured. All builds and tags remain local until v3, v4 and v5 qualify. Cron deferred by the user. Existing repositories and tags preserved.

## v3 candidate

- Maintained pre-model tree: bdobb-dev/bdobb-v2 local v3.3.3, 94f98be47d4b60fa8809995b424622d481570b35. Exported tracked files without source Git objects.
- Apps source donor: maintained bdobb-v2 v4.0.5, 58f9985e4db0fdeb6dbfb11ff3dc68088494f56b.
- Apps discovery: PR32 c035aa47692148cec1f6391e3ecdc470c196a7c8, adapted from maintained v4.0.5 contracts/components to preserve import conflicts and dark/light v3 boundary. Original work credits retained in source; PR https://github.com/bdobb-dev/bdobb-v2/pull/32.
- Apps conflict fix donor: 1a3608efd28b0e1355e835e397cec6d54573f39f; modal/latency fixes included in maintained v4.0.5 donor. No System theme, advanced library or model scope copied.
- Modern compatibility donor: published Adventures-OpenBQ/bdobb v3.0.0, 23a776383f447a58d9975a66214a589d86a3b8ef; ordinary-state PR339 scope adapted; analytical runtime excluded.

## Verification ledger

- Original exported donor: typecheck, lint, production build pass.
- Initial sandbox unit run aborted after real loopback-server tests timed out. No product change made.
- Isolated unrestricted retry: ParamControls and discovery, 43 tests pass.
- Full unrestricted baseline: 2741 passed; one subprocess timeout passed on isolated retry (all 6 release-script tests).
- Apps focused suite: 301 passed; existing app/rail regression: 107 passed; new Apps real-store integration: 11 passed.
- Compatible export/account suite: 323 passed, 5 account-placement failures; corrected General placement and all 64 settings tests then passed.
- Analytical layout-overlay no-write regression: failed before fix, then 114 import/export tests passed.
- Reference conformance: 6 passed against OpenBQ reference on loopback port 7780, source a6293707576e16edda8305adda95b07b6a4b968b, image sha256:70f9290e99bfa3a32b10f3c47eeb57c53f325b5f38484adc97ecf6d4128c516f. This advertises 71 widgets and includes a later Pivot example; v3 refuses that analytical app.
- Web/security: 31 passed. Native check interrupted to reduce concurrent compilation load; resume with two jobs.
- Initial cumulative unit run: 2896 passed; six subprocess test timeouts under concurrent build/native load. Final post-fix run limits worker concurrency.
- No release qualified; no local tag yet.

Original source copyright and Apache-2.0 licensing retained. Carried source PRs include contributions credited to Claude in their original commits; the new repository records source provenance rather than retaining historical Git objects.

## Reference qualification procedure

Ruling: use the October 6 earlier-session curated reference pin a6293707576e16edda8305adda95b07b6a4b968b rather than the historical baseline pin named in the initial plan. This preserves the already repaired PDF fixtures and measures this fresh client against the same reference used earlier today. Cost if wrong: repeat qualification against the older baseline separately.

Use new per-widget render receipts, interactive PDF and Omni checks, Apps import/group controls, export round trips, screenshots and browser error capture. Browser requests use a test-only CORS adapter with unchanged reference responses, matching the earlier rehearsal; native transport does not use that adapter. Never reuse earlier passing widget results for this source tree.

- Post-guard unit run with default five-second timeout: 2,898 passed, five mocked release-script timeouts, six opt-in skips. All six release-script tests passed on isolated retry. Repeating the full gate with the earlier session's two workers and fifteen-second test timeout.
- Browser regression: 90 passed, one stale repository-link expectation failed; all three Help tests passed after updating the expected final repository URL.
- Initial reference Apps browser check failed because browser CORS blocked discovery. Repeated with the earlier rehearsal adapter; no product change made for this transport restriction.

- Fresh reference rendering: 71/71 passed with zero captured page errors. Interactive multi-PDF Open, SQL Omni submit, Live Grid, Highcharts and Vega-Lite included. Cron examples qualify rendering only.
- Reference contracts plus real onboarding import/export: seven tests passed, preserving 14 tabs, all source cards and three groups. Analytical app refusal verified.
- Reference browser Apps/grouping: passed with linked Toyota→Tesla requests and no-write analytical refusal.
- Reference live numeric refresh/Run: passed after startup discovery settled. Numeric 5,000 ms widget refreshed; Run widget did not poll and one click issued one additional request.
- OpenBQ Docker smoke: nine of nine passed against image sha256:f88fe41f131878ebb08508084dc34afb359cdac9443b99f0dd28f10aefd852c8, catalogue 995 widgets. Includes eight representative live tables and historical chart view; not whole-catalogue certification.
- Typecheck, lint, production build, cargo check --locked --offline -j 2 and scrub passed.
- Ruling: serial full regression with a sixty-second per-test bound after repeated subprocess startup timeouts at five/fifteen seconds; no assertion was removed or changed. Cost if wrong: slow tests remain slow, requiring separate performance investigation.

- User documentation updated: Quick Help, 31-page in-app Reference Manual, standalone v3 manual and user guide. Apps discovery, conflict choices, compatible/plain exports, optional account preferences and deferred cron documented. Legacy analytical/manual recipes labeled as historical source checkpoints assigned to clean v4/v5.
- Refreshed light/dark rail and General screenshots, plus blank-credential Workspace account screenshots (superseded 2026-10-08: the Workspace account panel moved to Connections, so `workspace-account-*.png` now show the Workspace connections group and the General shots show User Settings). Visually checked; help/index/search/image/generator checks passed (46 tests), standalone relative links verified.
- Final Chromium regression: 91 passed, one opt-in reference skip; reference Apps browser acceptance separately passed.

- Actual onboarding saved chart views: categorical and time-series views both rendered with SVG evidence and zero page errors; separate fresh receipt preserved.

- Native macOS app bundle built successfully; Info.plist reports version/build 3.0.0. No signing submission or native profile launch performed.
- Final serial unit run: 2,900 passed, seven opt-in reference skips, three release-fixture launch timeouts. Launcher isolation measured env/Bash at 4–10 seconds versus direct Bash at 0.07–0.53 seconds; fixture stubs now invoke /bin/bash with all guard assertions unchanged. Retry pending.

- Final release-fixture retry passed all six assertions (155 seconds total, each under 60 seconds), using direct Bash launchers. Cumulative unit coverage: 2,903 passing assertions and seven opt-in reference skips; final fixture-only change lint passed. Qualification uses the full run plus isolated corrected fixture rerun, not a claimed single all-green run.
