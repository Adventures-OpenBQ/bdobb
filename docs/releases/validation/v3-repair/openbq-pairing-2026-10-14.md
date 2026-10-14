# v3: pair with openbq-docker v3, one combined examples file (2026-10-14)

User rulings of 2026-10-14: every BDOBB release vN pairs with Adventures-OpenBQ/openbq-docker vN (not bdobb-dev/openbb-docker), and openbq-docker vN serves one combined `examples/bdobb/apps.json` of every BDOBB example from v3 through vN. Fixed here on the lowest line, then merged up v3 → v10.

**Pairing.** `package.json` gains `"openbqDocker": "v3.0.0"` (the tag exists: `git ls-remote --tags` on openbq-docker lists `v3.0.0` → `9174fc3`). `"openbbDocker": "v3.0.1"` stays: `web/security.test.mjs` pins the vendored gateway policy to it, and openbq-docker has no gateway before v8. No test pins the package.json key set.

**Demo providers** (`docs/examples/v3.1.0-demo-providers.apps.json`; app name unchanged). Widget ids checked against openbq-docker's `/widgets.json` as captured in BDOBB's `docs/releases/validation/v6/regression/run5/services/OPENBQ_API-widgets.json` (v6+ lines):

| Card | Was | Now | Params check |
|---|---|---|---|
| EIA | `commodity_short_term_energy_outlook_eia_obb` | `eia_short_term_energy_outlook_eia_obb` | card sends `{}`; every widget param is optional (`table` defaults `01`, `frequency` `month`) |
| BLS | `economy_survey_bls_search_bls_obb` | `bls_search_bls_obb` | `category=cpi` is one of the widget's options; `query` is free text |
| Alpha Vantage → Nasdaq | `equity_fundamental_historical_eps_alpha_vantage_obb` | `nasdaq_equity_fundamental_historical_eps_nasdaq_obb` (keyless) | `symbol` is the one required param; `IBM` kept |
| Congress.gov, CFTC | unchanged | unchanged | present in the capture |
| EconDB, Videos | unchanged | unchanged | not in the capture; the extensions openbq-docker v3 adds |

The description now names openbq-docker v3, the keyless providers (BLS, CFTC, EconDB, Nasdaq, Videos), the demo-key providers (EIA, Congress.gov, from `credentials.demo.env`) and Nasdaq in place of Alpha Vantage; the openbb-docker v3.0.1 narrative is gone. The Video Library's description says openbq-docker serves its extension from v3 on; its MIT attribution is kept.

**`scripts/apps-sync.mjs`.** Rewritten from openbb-docker's per-backend `OWNER` to the openbq-docker form the v4+ lines use (`OPENBQ_DOCKER_DIR`, `examples/bdobb/apps.json`, the `/openbq/bdobb-logo.svg` logo plus embedded SVGs). Every example is `SERVED`. The scan walks `docs/examples` for every file ending in `apps.json` (a `<dir>/apps.json` routes by its directory) and throws on one `SERVED` does not name, and on a `SERVED` entry with no file. The episode is the name's leading `vN`. Dry run into a scratch directory (nothing written to openbq-docker): `EPISODE=3` and no `EPISODE` both write 3 apps — Built-in widgets, Demo providers, Video Library — each with the logo; a stray `docs/examples/zz/apps.json` or `stray-apps.json` fails the sync.

**Help.** Example Dashboards: the openbq-docker v3 pairing, the one combined file from v3 on, Video Library and EconDB served at v3, `credentials.demo.env`'s public demo keys overridden by `credentials.env`, the logo served by openbq-docker's lanes hook without auth, `EPISODE=3 pnpm apps:sync`, every example listed, and one sentence on the `v3.1.0-`/`v3.2.0-` file names. The stack page (slug kept, `openbb-docker-stack`) opens with the openbq-docker v3.0.0 pairing and what it serves to BDOBB, and says why `openbbDocker` stays. PROVISIONAL: the rest of that page and the other v3 stack pages (backends, provider keys, Tailscale, infrastructure troubleshooting) still describe openbb-docker's topology; the 4.0.0 guide (85139add) is where they were rewritten for openbq-docker.

**REVIEW, `src/lib/appsJson.examples.test.ts`: "ships at least the three known examples" is now "ships every known example file, and no file the list does not name".** The `arrayContaining` assertion is kept over the same names, now held in `KNOWN`; a second assertion requires the sorted file list to equal `KNOWN`. Stronger, not weaker. Added: "v3.1.0-demo-providers: openbq-docker's widget ids, Nasdaq EPS in place of Alpha Vantage" (the seven ids in order, the IBM and BLS params, the description names openbq-docker v3 and `credentials.demo.env` and not openbb-docker). No assertion removed or loosened.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| header-check | clean |
| scrub-check | clean |
| `vitest run src/lib/appsJson.examples.test.ts src/help scripts/help-shots.test.mjs` | 7 files, 61 tests passed |
| `node --test web/*.test.mjs` | 31 passed |

Provisional on openbq-docker's side (another agent, not yet on its release/v3 at 9174fc3): the `openbb-videos` and EconDB extensions, `credentials.demo.env`, `examples/bdobb/apps.json` and the `/openbq/bdobb-logo.svg` route.

**Follow-up, same day.** The non-ASCII escape in `apps-sync.mjs` had been written with a literal U+FFFF as the range end (`/[\u007f-<U+FFFF>]/g`); the regex matched the same characters, but the source now spells it `\uffff` again, as the v4+ script did. Dry run unchanged (3 apps; no non-ASCII in the v3 examples).
