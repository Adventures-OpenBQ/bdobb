# Repo checks rerun at HEAD 5435650

Part C receipts (validation/v6/final) were taken at 084e0eff, not HEAD, so every declared gate was rerun here (package.json scripts). Raw lines: gates.tsv, live-gates.tsv. Failed receipts are preserved with `-FAILED` / `-run1` names.

| Gate (script) | Result | Notes |
|---|---|---|
| typecheck (`pnpm typecheck`) | PASS | exit 0, 19 s |
| lint (`pnpm lint`) | PASS | exit 0 |
| unit (`pnpm test:run`) | PASS | 381 files passed / 5 skipped; 6579 tests passed / 28 skipped (the skips are the env-gated live/reference files, run separately below) |
| build (`pnpm build`) | PASS | vite build |
| e2e (`pnpm e2e`, ports 4383/4384) | PASSED ON RERUN | run 1 FAIL 258 passed/1 failed (`workspaces.spec.ts:491`, 30 s timeout waiting for `nav.left-rail`) at load 313; one labelled rerun 259 passed/1 skipped at load 83. Not a clean pass. |
| web (`pnpm test:web`) | PASS | |
| browser (`pnpm test:web:browser`) | FAIL | two runs (the second after `pnpm build:web`, load 28): timeout waiting for the AAPL quote cell, browser-smoke.mjs:219. D-002. Not part of Parts A–C gate sets. |
| native (`cargo check --locked --offline`) | PASS | Bundle not rebuilt; tested binary hash equals the Part C native receipt. |
| privacy/scrub (`pnpm scrub`) | PASS | "scrub-check: clean" |
| reference (`pnpm test:reference`, OPENBB_REFERENCE=1) | PASS | REFERENCE_BASELINE 6/6, REFERENCE_CURATED 6/6 |
| live (`pnpm test:live`, explicit OPENBB_LIVE=1; unreachable fails) | FAIL | run 1: 16/17 + real-endpoints failed to load (operator env: MCP URL not in id=url form). Run 2 (labelled rerun, env corrected): 20/22: rita-authoring-live 12/12 (incl. #322 and #326 cases), rita-live 3/3, real-endpoints 3/4 (only "is set" check failed: OPENBB_NAS_AUTH empty, backend needs none), rita-table-model-live 1/2. Real-endpoints alone with a dummy OPENBB_NAS_AUTH (as Part C): 5/5. rita-table-model test 2 failed in both runs at its setup turn (Rita did not call arrange_table for "Show total Amount by Region"), the same model-conduct failure as Part C run 1 and Part B runs 02/04. |
