# Coverage totals

Per-card rows: baseline-cards.tsv (REFERENCE_BASELINE Onboarding, 70 placements): renderer PASS 64, PARTIAL 2, NOT_RUN 4; interaction PASS 5, BLOCKED 22, NOT_APPLICABLE 2 (no-exec Omni), NOT_RUN 41.

Backend-only (no renderer): REFERENCE_BASELINE 70/70 widgets probed (60×200, 5 POST-only 405 not exercisable by GET, 1 intentional 500, 3 transient/upstream 500, 1 404 on a non-UDF path); REFERENCE_CURATED 71/71 (62×200); OPENBQ_API 265/995 before the service degraded (backend-sweep/openbq.jsonl).

Not covered natively: REFERENCE_CURATED apps (2 apps, 18 tabs, 73 cards), OPENBQ_API apps (38 apps, 249 tabs, 660 cards; apps.json unreadable), all file fixtures (v3.1/v4 builtins, parameters, v5 financial demo, research-desk, reference-roundtrip, v6 demos, Market Kit, Rita runner).

## Run 2 additions
- REFERENCE_CURATED (sha-1978c19): Onboarding (14 tabs/70 cards) and Pivot examples (4 tabs/4 cards) imported natively; Pivot-example cards render raw rows (D-007); curated Onboarding cards bind to the baseline backend (design D3).
- OPENBQ_API: 38/38 apps discovered natively; 6 imported (U.S. Bureau of Labor Statistics 5 tabs/21 cards, BLS Employment Situation 6/31, BLS CPI 4/16, BLS PPI 5/14, BLS Productivity & Costs 6/29, Cboe Market Data 4/20 = 30 tabs/131 cards) with file-level first-display comparison and first-tab render; 32 apps (219 tabs/529 cards) not imported.
- Backend: OPENBQ_API sweep 284/995 widgets.
