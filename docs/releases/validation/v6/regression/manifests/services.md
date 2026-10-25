# Service identities (captured 2026-10-08 ~14:55 EDT, read-only)

Hostnames are bound in the operator shell only. All on the NAS tailnet node `openbq`, no auth. Container inventory via read-only `docker ps`/`docker inspect`/`docker images --digests`.

| Logical | Port | Image | Image id | Repo digest | Revision label | Probe |
|---|---|---|---|---|---|---|
| OPENBQ_API | 443 | ghcr.io/adventures-openbq/openbq-local:3.0.0 | a3109f6598b4 | sha256:61d1ac0f0625892e1dd2282fa073642e03aa330f38c1e93bab04971a833b6e56 | 4b3ee43760f97afc776772e43aca29d94abee0f2 | widgets.json 200 (995 widgets), apps.json 200 (38 apps). Container "Up 33 minutes" at capture: restarted by someone else before this run. |
| REFERENCE_CURATED | 8443 | ghcr.io/adventures-openbq/openbq-reference:sha-998d08c | b8853eac775c | sha256:2d2368579185a2d392710749b28c2324c94ce1c5f479ea7f3310b5e6d8142476 | 998d08c80f04a607800e8d6e8962e10711597732 | 71 widgets, 2 apps (Onboarding 14 tabs/69 cards; Episode 3 Pivot examples 4 tabs/4 cards) |
| REFERENCE_BASELINE | 9443 | ghcr.io/adventures-openbq/openbq-reference-baseline:a6293707 | 44875bca5308 | sha256:22fa2f98a5680d88f90d336c8da36b7fd38d92b619b4c7800957418582e30562 | a6293707576e16edda8305adda95b07b6a4b968b | 70 widgets, 1 app (14 tabs/70 cards) |
| RITA | 10443 | ghcr.io/adventures-openbq/openbq-rita:6.0.0-candidate | f59bfc80be98 | sha256:ff90afeeea6c9da4e27e5d5719afaf4ab275e67b9a1c171c14698d63af0f1a99 | 744846f844374847c902b5e7fd59b4342a51ef99 (version label 1.4.2-slim) | agents.json 200: openbb_agent_rita, default model openai:qwen3.6-35b, query /v1/query |
| MCP | 11443/mcp | ghcr.io/adventures-openbq/openbq-mcp:6.0.0-candidate | 4ac1ae79fd60 | sha256:d76fbbac7392e58c71572195f1208c1ba03d4b959260c49e07a817c69851c8d2 | 518dcb19839eb965cb702a4c8254c662ad5c9acd (version label 3.0.0) | initialize: protocol 2025-06-18, serverInfo "OpenBB MCP" 4.0.11, mcp-session-id issued, SSE |
| MODEL | Spark `llm` service | vLLM | n/a | n/a | n/a | /v1/models: id qwen3.6-35b, root nvidia/Qwen3.6-35B-A3B-NVFP4, max_model_len 262144 |
| EXAMPLE_DATA | none | none | | | | BLOCKED: not served. RITA/MCP apps.json and widgets.json → 404; none of the three catalogs contain `practice`, `prices`, `market_*`, `fictional_portfolio`, `event_*`. |
| ARCHIVE | none | | | | | BLOCKED (deferred by ruling) |

Catalog snapshots and SHA-256: `../services/` (see services.sha256). Curated minus baseline: +openbq_demo_nulls, +openbq_demo_prices, −omni-python-widget.

## 2026-10-08 OPENBQ_API restart (user-approved; resolves D-004)
The user approved a restart of OPENBQ_API, performed by the top-level session (reported "about 15:55 EDT"). Read-only inspect at 16:38 EDT: container StartedAt 2026-10-08T20:34:17Z (16:34 EDT), "Up 4 minutes (healthy)", same image id a3109f6598b4 (openbq-local:3.0.0). Probes: apps.json 200 in 1.7 s, widgets.json 200 in 11.9 s. All OPENBQ_API results after this point are against the restarted container. Any further sweep is serial: one request at a time, 30 s timeout, ≥0.5 s spacing, stop on a >30 s request or 3 consecutive failures.

## 2026-10-08 REFERENCE_CURATED redeployed by someone else (not this run)
Read-only inspect at ~16:45 EDT: container `openbq-episode1-openbq-reference-1` now runs `ghcr.io/adventures-openbq/openbq-reference:sha-1978c19` (image id ff518abd2b60, repo digest sha256:0ec70027b46e434d01cd782ea99a3f4ecd503e2d0c07d1d2059cbf6adf78f9af, revision label 1978c191dad54d84c800c47cde107e4bb7b578c3), StartedAt 2026-10-08T19:37:57Z (15:37 EDT). The briefed identity sha-998d08c is no longer served. Catalog now 72 widgets (+omni-python-widget vs the 14:52 capture); apps.json also changed. Snapshots: services/REFERENCE_CURATED-*.after-restart.json. Run-2 curated results are against sha-1978c19 and labelled so.
