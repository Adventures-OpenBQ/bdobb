# Run-5 service identities (2026-10-09, read-only)

Hostnames are bound in the operator shell only. Container identity is from a read-only `docker inspect` on the NAS. Catalog SHA-256 values are in `services.sha256`, and raw catalogs are in `../services/`. Catalog capture time is in `../services/captured-at.txt`.

| Logical | Bound to | Image | Image id | Revision label | StartedAt (UTC) | Catalog |
|---|---|---|---|---|---|---|
| OPENBQ_API | `https://<openbq-node>` | ghcr.io/adventures-openbq/openbq-local:3.0.0 | 3c72a542d2e5 | 35011a55b8421b9c08fbadac73b603f60a3d513a | 2026-10-09T13:59:08Z | 995 widgets, 38 apps / 223 tabs / 630 cards |
| REFERENCE_CURATED | `https://<openbq-node>:8443` | ghcr.io/adventures-openbq/openbq-reference:sha-1978c19 | ff518abd2b60 | 1978c191dad54d84c800c47cde107e4bb7b578c3 | 2026-10-08T19:37:57Z | 72 widgets, 2 apps / 18 tabs / 74 cards |
| REFERENCE_BASELINE | `https://<openbq-node>:9443` | ghcr.io/adventures-openbq/openbq-reference-baseline:a6293707 | 44875bca5308 | a6293707576e16edda8305adda95b07b6a4b968b (= recorded upstream pin) | 2026-10-07T16:15:37Z | 70 widgets, 1 app / 14 tabs / 70 cards |
| EXAMPLE_DATA | `http://127.0.0.1:16950` | none: `python3 -m http.server` (PID started 2026-10-09 12:14 local) over `<home>/QA-fixtures-v6/market-kit-serve` (88 files) | n/a | n/a | n/a | 43 widgets, 2 apps / 24 tabs / 120 cards |

## Notes

- **Auth.** The brief said OPENBQ_API uses Basic auth. Every service answered unauthenticated with 200 and no `WWW-Authenticate` challenge. The app's `backends.json` holds no credential values (all five entries are `authLocation: header`). No credentials were read, sent or written.
- **OPENBQ_API image changed since run 4** (was a3109f6598b4 / revision 4b3ee437, same tag 3.0.0). Its `widgets.json` and `apps.json` are byte-identical to run 4's captures.
- **REFERENCE_CURATED and REFERENCE_BASELINE are unchanged since run 4.** Curated catalogs equal run 4's `*.after-restart.json`.
- **EXAMPLE_DATA catalog identity.** `widgets.json` equals inventory fixture `reference-manual/v6/market-kit/demo/widgets.json` (379f5b88…). The root `apps.json` (78c52591…) is exactly the inventory's `market-kit/apps.json` (3d30323a…) followed by `rita-runner-apps.json` (62faeeee…). The practice/prices manifest (`reference-manual/v6/demos`) is **not served**: `/practice.json` and `/prices.json` return 404.
- **OPENBQ_API wedge during this run.** At 3 concurrent workers, the CFTC swap/positioning routes took 40–60 s. All requests then timed out, and `apps.json` timed out from about 12:35 to 12:48 local. The service recovered without a restart (same StartedAt, RestartCount 0). The rest of the sweep ran serially (1 worker). Nothing was restarted.
