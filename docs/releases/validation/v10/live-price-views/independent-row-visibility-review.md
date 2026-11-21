# Independent review of the v10 refusal row-visibility correction

**Spec compliance passes. Code quality is approved for stacked publication.** The correction closes the prior row-visibility Minor at `docs/releases/validation/v10/live-price-views/independent-stacked-review.md:30`. One documentation improvement concerns reproducing the local run from a fresh checkout.

## Scope and strengths

I reviewed the plan, implementation report and all five changed files from `4048adb9be2d33497edf31e133986f41860a975b` through `1268d5bdf041773fd8586f59ae35109cb2ddf578`. The diff section of the retained review package matched Git's ten-line-context diff byte for byte. The retained original spec matched the baseline blob. The reviewed range passed `git diff --check`.

- The only executable addition at `e2e/live-price-views.spec.ts:186` locates an accessible data cell named exactly `AAPL.US` within the named source card. Multiple dates can yield matching cells, so checking the first matches the representative-cell requirement. All three cases share this assertion. They retain their header, chart status, missing plot, opted-in disabled Apply and repair guidance, and exact query checks. The separate executor assertion at `src/lib/tableExecution/rust/dailyPriceEvidence.test.ts:181` checks all 58 rows for the root and linked child.
- The retained diagnostic patch sets CSS visibility on the source card's table body. In the old Chromium/TypeScript HTML report all three cases execute the body mutation, pass the header assertion and complete the query checks. The corresponding RED report reaches the header and then fails at the exact listing cell in each case. The failures appear at lines 13, 50 and 87 of `red-hidden.log`. The committed spec contains only the new assertion from that patch.
- I decoded every runtime attachment in `green-typescript.json` and `green-rust.json`. Each engine ran the three cases on Chromium 151.0.7922.34 and WebKit 26.5. All twelve passed on their sole attempt, retry index zero, with zero skips or flakes. Each Rust case recorded one successful WASM response and each TypeScript case recorded zero. The shared fixture checks HTTP success and the WASM content type at `e2e/fixtures/return-summary.ts:15`. The recorded unit run passed 10,387 with 47 skips. The gate records show typecheck and lint exit zero, and the scrub log records clean scrub and header checks.
- The release notes identify the historical stacked review revision, distinguish the controlled rendering mutation from a product failure, and limit the new coverage to representative rendered data. They identify the earlier installed replay as inherited evidence. This review used the retained run outputs.

## Findings

**Critical and Important findings** — None.

**Minor documentation finding** — Both examples at `docs/releases/validation/v10/live-price-views/row-visibility.md:19` and line 22 reference the local config in the ignored `.superpowers/` directory. The local commands accurately record the run. A reader following them in a clean checkout will lack that file. Add a clean-checkout equivalent using `--config playwright.live-price-views.config.ts e2e/live-price-views.spec.ts --grep 'synthetic transport: refuses' --retries=0` with the same engine and port settings. The checked-in config already selects both browsers and requires a fresh server.

## Publication boundary

The local merge base with the tracked v9 feature ref is `bf67cf72eb9c926627e30ac6ab166ee5361714bd`. The initial PR snapshots show all four PRs open, with v10 #90 based on the v9 feature, v9 client #89 at that exact merge base, provider #6 at `75a902664054b3afbd23c5b6328efe7eedcf429c`, and Docker #33 at `3a9fc20e4b2257e98a0a4cb15ed8e924f2d6fe1d`. Exact published-head CI, browser retries in hosted jobs and final verification of all four open, unmerged PRs and unchanged v9 heads belong to the controller after publication. Fresh vendor acquisition and image builds fall outside this synthetic browser correction.

## Final documentation follow-up at `66540fc4`

**Spec compliance passes. Code quality approved for stacked publication. All review findings closed.** I reviewed the complete delta from `1268d5bd` through `66540fc45cdce83860d27f2b2335369ef2d175f3`. It updates three lines in the row-visibility evidence note. The examples at lines 19 and 22 now use the tracked Playwright config and the explicit spec path. They preserve the engine choices, ports, WASM verification setting and zero retries. The surrounding note records which wrapper generated the original evidence. The retained `portable-command-list.log` lists exactly the ordinary-row, missing-receipt and legacy-snapshot cases for both Chromium and WebKit, six in one file. This closes the documentation Minor. The delta passed `git diff --check` and leaves the reviewed executable test identical. The 12 previously verified executions support the final source verdict. Hosted CI and the final four-PR state check remain publication steps.
