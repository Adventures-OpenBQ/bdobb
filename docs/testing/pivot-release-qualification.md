# Pivot release qualification

Current decision: **INCOMPLETE**. Target platform: **macOS arm64**. Linux CI supplies portable/browser evidence only. Other operating systems remain unqualified; their absence does not prevent a specifically scoped macOS decision. Never infer native acceptance from browser test counts or historical unit totals.

The matrix uses stable per-requirement IDs, mirrored in `pivot-requirements.json`. Add new IDs without renumbering existing requirements. That inventory is consumed by `scripts/pivot-qualification/release-report.mjs`; all required items must pass. Native checklist subitems have separate `PIVOT-N-*` IDs so partial lifecycle evidence cannot pass an umbrella item. `PIVOT-G-04` asserts accurate device classification, not successful execution on every possible OS. Performance `PIVOT-F-*` remains advisory.

PR CI preserves all existing coverage and adds fixture/report Node suites (`*.node.mjs`, explicitly invoked outside Vitest), 20 fixed generated traces plus financial/parity assertions, and a short linked Statement Chromium smoke using both real engines. No SEC download is required. Existing full unit and browser checks remain present.

The extended workflow runs a bounded 201-seed/200-action parity suite and the complete portable Chromium/WebKit qualification suite sequentially. Weekly Monday 06:17 UTC cadence, one Ubuntu job, 45-minute timeout, one concurrency group, read-only contents permission, 7-day trace/seed retention; no heap/production resource-limit increases. Failure seeds include reduced replay JSON under `src/test/fixtures/sec-statements/failing-traces/`; browser evidence is in `e2e-results/qualification/`. Workflow dispatch accepts a full SHA and bounded integer seed through environment variables; shell code never interpolates raw input expressions. Checkout verifies that SHA. The scheduled candidate SHA is deliberately pinned to the Task8 implementation candidate `1a0246678f036e40acc905c2cffd4284d10769c0`; advance it in a reviewed change when the final candidate is selected.

Activation prerequisite: this new workflow exists only on the candidate branch until publication. GitHub schedules run only workflows on the default branch. Workflow dispatch UI also requires default-branch workflow presence; API/CLI dispatch of another ref requires the workflow to have run first. This change does not alter the default branch and does not claim an active schedule. See [GitHub trigger documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Explicit operator tasks stay outside CI: acquired-data benchmarks (`pivot-performance.md`), isolated native device checklist (`pivot-native-acceptance.md`), and real server sync with configured environment. Run benchmarks sequentially with existing limits and separate fresh build/output directories. Rust conservative admission refusal, including the small Statement control, is neither numeric performance evidence nor proof that the product cannot support that workload. Old tick reports without the policy binding remain archived under their original source contract; do not rewrite them or validate them as new-source runs.

To aggregate a reviewed evidence bundle:

```sh
node scripts/pivot-qualification/release-report.mjs /absolute/path/evidence.json > /absolute/path/release-report.json
```

Exit 0 means QUALIFIED for the named target; 1 means failed correctness or invalid evidence; 2 means INCOMPLETE. Report JSON contains each inventory item's passed/failed/not-run/unsupported status. Any required failure wins over later passing evidence. Missing evidence, environment failure recorded as `not-run`, or unsupported required computation prevents qualification. A documented negative-capability item can pass only its explicit refusal assertion; it does not pass a supported computation requirement. Performance observations and slowdown advisories never change the correctness decision.

Bundle contract (version 1):

- `candidate`: full 40-hex `commit`, 64-hex source-content checksum `source`, and reviewed allowlists `artifacts`, `datasets`, `environments` of SHA256 identities. Keep the source algorithm and environment manifest with the evidence; a hash does not prove its own provenance.
- `evidence`: one or more records per `requirementId`. Non-unrun records include `status`, explicit `platform` (native must equal `macos-arm64`), named exact `assertion`, `identity` containing candidate commit/source and approved artifact/dataset/environment hashes, and `proof: {path, sha256}`. Paths resolve from the bundle directory. Raw proof bytes are hashed before acceptance. Refusal-only records additionally set `refusalAssertion: true`. Unrun records need a `reason`, with no invented artifact/proof.
- `performance`: optional `{path, sha256}` Task7 report files. Each is byte-checked and passed through `validateRun`/`summarizeRun`, with matching candidate source/artifact/dataset/environment identity. Missing tick-policy bindings fail validation; refused compute never contributes timing.
- `advisories`: optional observations, such as slowdowns; never override missing correctness.

Attestations require review of the referenced proof's exact assertion coverage; the aggregator checks identity and decision semantics, not the truth of arbitrary prose. Do not mark broad matrix items passed based solely on an unrelated test log. Keep screenshots, app data, contact/profile details, credentials and large datasets outside Git.

Release checklist:

- [ ] Select final reviewed commit and immutable artifact/source/dataset/environment identities; record dirty diff if any.
- [ ] Review every required matrix assertion and supply attributable per-ID evidence for both engines where required.
- [ ] Complete native worker recovery, exact cross-window revision chain, native UI export/import and remaining device/input checks. Current partial disk restart/viewer reset/visible cross-window/missing-source observations do not pass these remaining items.
- [ ] Run real server sync; missing `.env` is NOT RUN.
- [ ] Aggregate evidence and resolve all required failed/not-run/unsupported statuses; retain advisory performance separately.
- [ ] Root/controller publishes reviewed TS/test-infrastructure separately from inherited Rust production changes, targeting `release/v4`, requests review and reports CI before any merge decision. Never merge automatically.

This checkout inherits the optimization stack in open Rust PR (`25e858d619`); it is not merged. The final TS/test-infrastructure PR must depend on or exclude those inherited production commits deliberately. Do not cherry-pick remote updates or accidentally republish the Rust stack in the TS PR. Publication belongs to the root/controller after whole-branch review.
