# Clean v6 regression run, 2026-10-08

Candidate: codex/clean-v6 HEAD 5435650, `BDOBB Clean v6.app` exe sha256 7b752cfa…1b67, bundle tree 08add536…671f (manifests/candidate.md). Services: manifests/services.md. Fixtures: 26/26 hashes match (manifests/fixtures.tsv).

**Result: not certified.** After run 2 (GUI retest, see run2/NOTES.md), mandatory cases (109; V6-012 is the optional deferred gate): 11 PASS, 5 FAIL, 11 PARTIAL, 72 BLOCKED, 9 NOT_RUN, 1 NOT_APPLICABLE. Run-1 results of retested cases are kept as non-mandatory history rows `<ID> (run 1)`. Full ledger: ledger/ledger.md (results.json follows result-template.json). Blocker codes: ledger/blockers.md. Defects: defects.md.

Why so much is BLOCKED: the native app could only be driven with background clicks and screenshots. Text entry, dropdowns and hover UI are impossible in that mode, full-screen control was requested twice and timed out, app_batch was refused every time, and the user was actively using the machine. OPENBQ_API degraded mid-run (D-004, likely aggravated by this run's backend sweep) and EXAMPLE_DATA is not served anywhere.

Layout: manifests/, services/ (served catalogs), backend-sweep/ (HTTP-only widget results, separate from renderer), protocol/ (V6-002 Rita/MCP probes), import-compare/ (served vs saved first display), coverage/ (per-card ledger), restart/, migration/, checks/ (repo gates), screenshots/, profile-snapshots/, profile-restore.md.

Not produced: sanitized Rita chat transcripts (no native Rita turn was possible) and independently parsed exports (no export could be triggered).
