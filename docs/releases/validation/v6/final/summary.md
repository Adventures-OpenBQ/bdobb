# v6 final gate summary

HEAD 084e0eff5fda26ff6d49e66ffef87ceba67a6c03. Single clean run of every gate; no reruns, no COMPOSITE evidence needed. Playwright used BDOBB_BROWSER_PORT=4373 BDOBB_MOCK_PORT=4374 (stale vite on 4173 from another session).

| gate | exit | duration | load (1/5/15m) | counts |
|---|---|---|---|---|
| typecheck | 0 | 18s | 52.65 49.17 63.79 | clean |
| lint | 0 | 19s | 68.45 52.97 64.81 | clean |
| unit | 0 | 257s | 112.48 63.42 68.33 | 380 files passed, 5 skipped files; 6576 tests passed, 28 skipped |
| build | 0 | 15s | 67.86 119.11 98.21 | vite build ok |
| e2e | 0 | 591s | 57.93 114.40 96.89 | 259 passed, 1 skipped |
| web | 0 | 6s | 167.28 107.61 97.63 | 31 tests, 0 skipped |
| cargo | 0 | 2s | 174.22 110.04 98.55 | cargo check --locked --offline ok |
| scrub | 0 | 8s | 180.77 112.46 99.47 | clean |
| help | 0 | 18s | 185.34 115.68 100.76 | 6 files, 63 tests passed |

Unit skips: reference-backend and real-endpoint suites skip without Docker/endpoints (e.g. src/test/integration/real-endpoints.test.ts, 5 tests); see unit.log for the full list.

Native QA bundle: see ../native/bundle.txt (ad-hoc signed, identifier com.artcashin.bdobb.clean.v6, version 6.0.0, build exit 0).
