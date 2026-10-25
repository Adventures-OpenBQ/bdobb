<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# Episodes 9 and 10 — morning report

## Release (2026-10-14)

The user authorized delivery on 2026-10-14: v9 goes to `main` and `release/v9`, then v10 on the new `main` to `release/v10`, each tagged. `main` only fast-forwards and nothing is force-pushed. The 2026-10-12 report below is kept as written; its SHAs predate the rebases.

**User rulings (2026-10-14).** openbq-docker v9 carries the EODHD extension as `Adventures-OpenBQ/openbq-eodhd`, and v10 carries the kdb tier as `Adventures-OpenBQ/openbq-kdb`. Both are new repositories. openbq-docker vendors each one as openbq-yfinance is vendored: a `source/` copy plus a `source.json` with repository, tag, commit and donor.

| Was | Now | Repository | Head | Tag | Vendored at |
|---|---|---|---|---|---|
| `openbb-eodhd` (donor v9.6.3, fixes to v9.6.6) | `openbq-eodhd` 9.0.0, module `openbq_eodhd` | Adventures-OpenBQ/openbq-eodhd | `8da2435` | `v9.0.0` | openbq-docker `v9/eodhd/source` |
| `kdb-store/` + `kdb-ws/` | `openbq-kdb` 10.0.0, module `openbq_kdb`, `q/` | Adventures-OpenBQ/openbq-kdb | `c249571` (merges GitHub's LICENSE commit into `9519bbc`) | `v10.0.0` at `9519bbc` | openbq-docker `v10/kdb/source` |

In openbq-docker v10, the compose service `kdb` is now `openbq-kdb` and mounts `/opt/openbq-kdb`. `KDB_BIND_HOST` and `KDB_HOST` are `openbq-kdb`. live-grid depends on `openbq-kdb`. The `kdb-data` volume, the `KDB_*` variable names and the kdb-x image are kept, as provisional choices. The entry-point key `eodhd`, the `obb.eodhd.*` routes and the widget ids are unchanged.

| Repo | Branch | Head | Pairs with |
|---|---|---|---|
| openbq-docker | `claude/openbq-docker-v9` | `d66e4d0`, which merges tag v8.0.0 `ebd3b85` | openbq-eodhd `8da2435` |
| openbq-docker | `claude/openbq-docker-v10` | `e6cb490`, which merges `v9.0.0` `e6826b1` (a receipt doc) into `45c6ae1`, the pinned commit, which merges v9 | openbq-kdb `9519bbc`, openbq-eodhd `8da2435` |
| bdobb | `claude/clean-v9` | `1116390` FREEZE, pushed to `main` and `release/v9` | openbq-docker `d66e4d0` |
| bdobb | `main` = `release/v9` = tag `v9.0.0` (the user, from the Mac) | `be4dec6`: `1116390` re-pinned to openbq-docker's `v9.0.0` tag, with receipts | openbq-docker `v9.0.0` = `e6826b1` (`d66e4d0` plus its release receipt) |
| bdobb | `claude/clean-v10` = `release/v10` = `main` | the FREEZE that adds `../validation/v10/v10-release-2026-10-14/` | openbq-docker `45c6ae1` |

**Rebases.** v9 was rebased onto `main` `c0fb324`, which is `d92a863` (backend tables on the worker) plus v8's commit that closes Connections. Then `4f000d1` pairs it with openbq-docker v9: `openbqDocker` = `d66e4d0…`, and the policy is re-vendored as `v9.0.0`, byte-identical to v8.0.0's. v10 was rebased onto the v9 freeze `1116390` with no conflicts, and then onto v9.0.0 `be4dec6`. That second rebase hit four conflicts (the pin, the policy record, the stack page and `web/README.md`); each was resolved to v10's own text. The tree that results equals the gated one, apart from the v9.0.0 receipts. Then `170ba22` pairs it with openbq-docker v10: `openbqDocker` = `45c6ae1…`, the policy is re-vendored as `v10.0.0`, and RB-3 is ruled. Each rebase has a ledger section in its version's assembly ledger.

**v9 gates** (`docs/releases/validation/v9/v9-release-2026-10-14/`, at `4f000d1`, cloud: Linux, Chromium 1194)

| Gate | Result |
|---|---|
| pivot-build, typecheck, lint | pass |
| unit | 438 files; 7967 passed, 29 skipped |
| revision | 54 passed |
| build, smoke | pass; smoke clean |
| e2e (Chromium) | 286 passed, 8 skipped |
| web, build-web, web-browser | 42 pass; pass; PASS |
| scrub, notices-check | clean; up to date |
| help | 98 passed |
| pivot-test, pivot-verify, pivot-packaging, pivot-browser | 163 passed; pass; 3 pass; 8 passed |
| diff-check from `c0fb324` | clean |

**v10 gates** (`docs/releases/validation/v10/v10-release-2026-10-14/`, the same script, at `170ba22`; diff-check and scrub rerun clean after the rebase onto `be4dec6`)

| Gate | Result |
|---|---|
| pivot-build, typecheck, lint | pass |
| unit | 439 files; 8022 passed, 29 skipped |
| revision | 54 passed |
| build, smoke | pass; smoke clean |
| e2e (Chromium) | 288 passed, 8 skipped |
| web, build-web, web-browser | 52 pass; pass; PASS |
| scrub, notices-check | clean; up to date |
| help | 104 passed |
| pivot-test, pivot-verify, pivot-packaging, pivot-browser | 163 passed; pass; 3 pass; 8 passed |
| diff-check from `c0fb324` | clean |

**Server suites.**
- openbq-docker v9 `d66e4d0`: tests 11, v3 68, lanes 22, workspace 12, eodhd 9, provider-fixes 42, gateway 47; check-public PASS.
- openbq-docker v10 `45c6ae1`: tests 38, live-grid 454, openbq-kdb 143, q 9, deltalake 95, scripts 13, v3 68, lanes 22, workspace 12, eodhd 9, provider-fixes 42, gateway 88; check-public and layouts pass.
- openbq-eodhd: 314 passed, plus 6 environmental failures (the EODHD SDK archive cannot be fetched here), the same as before the rename.

**Provisional (stand until ruled).**
- RB-1: the EODHD help names `openbq-api`.
- RB-2: the v10 example syncs into `live-grid/apps.json`.
- RB-4: openbq-eodhd is version 9.0.0, not 9.6.3.
- On the server: `kdb-data` and `KDB_*` keep their names, and openbq-kdb is version 10.0.0.
- The earlier V9/V10 provisionals below still stand.
- Connections (open question 1 below) was closed by v8.

**EODHD calls: 0.**

**Tags.** This session's git proxy refuses tag pushes (HTTP 403), while branch pushes work. Create and push the tags from the Mac:

```sh
cd ~/Developer/bdobb && git fetch origin
git tag -a v10.0.0 origin/release/v10 -m "BDOBB 10.0.0" && git push origin v10.0.0
cd ~/Developer && git clone https://github.com/Adventures-OpenBQ/openbq-eodhd && git clone https://github.com/Adventures-OpenBQ/openbq-kdb
git -C openbq-eodhd tag -a v9.0.0  8da2435 -m "openbq-eodhd 9.0.0"  && git -C openbq-eodhd push origin v9.0.0
git -C openbq-kdb   tag -a v10.0.0 9519bbc -m "openbq-kdb 10.0.0"   && git -C openbq-kdb   push origin v10.0.0
```

BDOBB `v9.0.0` is already tagged at `be4dec6`, by the user.

openbq-docker gets branches only from this session (user, 2026-10-14). The user cut its `release/v9` and `v9.0.0` (`e6826b1`) from the Mac. The user then had openbq-docker `release/v10` and `v10.0.0` cut at `c19106a` (`e6cb490` plus its release receipt), and BDOBB re-pinned to that tag, as for v9 (see `../validation/v10/v10-stack-pin-2026-10-14/`).

**Mac-pending.** Everything in the two Mac-pending lists below, plus:
- the `Dockerfile.v3` build installing `openbq_eodhd-9.0.0` and `verify.py`;
- the `live` profile built with the `openbq-kdb` service;
- on the NAS, which runs openbq-docker `2ab8df2`: stop the old stack with the old script, then move to v10 `45c6ae1`. The updated `nas-capture.sh` accepts both `kdb` and `openbq-kdb`, and `kdb-data` keeps the ticks.

## The overnight freeze (2026-10-12), as reported then

Both versions are frozen **locally** with green cloud gates. Nothing was pushed, tagged, built into an image, deployed or published.

The Mac half of v8, v9 and v10 is still outstanding: WebKit, native/iPad, cargo, dashsync, live Docker, licensed kdb and RustFS. These are Mac-pending, not failures.

**EODHD calls used: 0 of 5,000.** `EODHD_API_KEY` was not set in this environment, so every live EODHD check is NOT_RUN and all tests ran on fixtures. The counter file stayed empty.

### v9.0.0 — EODHD migration

| Repo | Branch | Head |
|---|---|---|
| bdobb | `claude/clean-v9` (from v8 FREEZE de951a1d) | **62d1aae** FREEZE |
| openbq-docker | `claude/openbq-docker-v9` (from a95969e) | **69c907e** |

**Client commits (de951a1..62d1aae)**

| SHA | Subject |
|---|---|
| cfd63d7 | handoff before Episode 9 |
| fd2081d | v9 delta manifest, 105 paths (87 EXCLUDE, 10 MERGE, 7 PROVENANCE, 1 ADD) |
| 686891a | widgets.json keeps a column's provider aggregation hint (a385fdef, 16d3ead3) |
| 70adcb8 | donor Calendar view card and store cases on clean's card |
| a0ddc85 | Episode 9 example `docs/examples/v9.0.0-calendars.apps.json` |
| 7b17b7f | scrub-safe handoff paths |
| 2ebad48 | EODHD help topic and guide page |
| 1378c53 | version 9.0.0 everywhere |
| ee21164 | 9.0.0 release notes and README |
| 91caa66 | v9 assembly ledger and provenance |
| b80688e | example widget ids checked against openbq-docker v9 (V9-P4 resolved) |
| 62d1aae | chore(v9): version 9.0.0 — gate receipts — FREEZE |

Most of the donor's v9 delta was already in clean from v8: the News strip, the settings bundle, apps-sync EPISODE routing and the a11y fixes. Ours was kept for the Calendar and the Pivot.

**Server commits (a95969e..69c907e)**

| SHA | Subject |
|---|---|
| b4426ee | port openbb-eodhd at v9.6.3 |
| 433f16f | aggregation metadata and widget hints (v9.6.4) |
| c460504 | obb.eodhd.* namespace and the EODHD app (v9.6.5) |
| 0e7198b | openbb-core 2 (v9.6.6) |
| 53aac7c | install openbb-eodhd in the v3 image; tests |
| 12aea38 | port ledger `docs/v9/eodhd-port.md` |
| 69c907e | sync v9 BDOBB examples: 9 kept, Demo providers and Video Library dropped as at v8 |

The donor's `patch_openbb_core_auth.py` was rejected: our provider-fixes overlay already makes both of its edits, and a test proves it.

**Gate receipts** (`docs/releases/validation/v9/v9-freeze-2026-10-12/`, at b80688e)

| Gate | Result |
|---|---|
| typecheck, lint | pass |
| unit | 7463 passed, 29 skipped |
| revision | 54 passed |
| build | pass |
| e2e (Chromium) | 280 passed, 8 skipped |
| web, build-web, web-browser | pass |
| scrub | clean |
| help | 98 passed |
| diff-check | clean |
| notices-check | exit 1, environmental: no offline cargo registry here |

Server suites: tests 8, v3 68, workspace 12, lanes 22, provider-fixes 42, funnel-gateway 47, eodhd 9. The extension's own suite: 465 passed, 5 failed because the EODHD SDK could not be fetched (GitHub archive download refused with 403).

**Mac-pending:**
- WebKit e2e, native macOS and iPad builds, cargo, notices-check (the Cargo.lock entry was edited by hand), dashsync;
- the `Dockerfile.v3` build with the EODHD SDK and `verify.py`;
- the 5 SDK tests;
- rendering against a keyed stack.

### v10.0.0 — live grid and kdb

| Repo | Branch | Head |
|---|---|---|
| bdobb | `claude/clean-v10` (from 62d1aae) | **995554f** FREEZE |
| openbq-docker | `claude/openbq-docker-v10` (from 69c907e) | **9299afe** (f18c459 at the freeze) |

**Client commits (62d1aae..995554f)**

| SHA | Subject |
|---|---|
| 6082e33 | handoff before Episode 10 |
| 6189d44 | v10 delta manifest, 99 paths (52 EXCLUDE, 40 MERGE, 3 ADD, 4 PROVENANCE) |
| 8111599 | live grid merged onto the v3 reference-compatibility renderer |
| c42f267 | /symbol_meta logos and range bars |
| 28596b4 | web preview relays the /grid family, socket included (c183f880) |
| e990841 | Episode 10 example `v10.0.0-live-grid.apps.json` (+1621cee1 chart cards) |
| dab2192 | symbol_meta adds only the fields the columns read |
| cde0d9b | live grid help (7876c86a, written for clean) |
| e791de5 | version 10.0.0 everywhere |
| 0f50dc5 | 10.0.0 release notes and README |
| 1025a6c | e2e proof of v3 reference compatibility; snapshot no longer overwrites newer ticks (bug found and fixed) |
| 1531b20 | v10 assembly ledger |
| c6d53f6 | gateway policy re-vendored from openbq-docker ebd1622; `openbbDocker` pin moved |
| 5544aa9 | docs: /grid served |
| 3e92d06 | /series envelope with lake read-back keys reaches the card |
| d96a356 | integration ledger, REVIEW notes, your Episode 10 rulings |
| 995554f | chore(v10): version 10.0.0 — gate receipts — FREEZE |

**Server commits (69c907e..f18c459)**

| SHA | Subject |
|---|---|
| c6936fd | kdb+ tick tier: kdb-store, kdb-ws |
| 645b49f | live-grid FastAPI sidecar and apps.json |
| e24ed9c | kdb and live-grid behind the opt-in `live` profile |
| 7853cec | gateway /grid family: Bearer-gated, per-symbol metering, 60-frame cap (d32966d, 7212a1d, d7ec9d1, 995e06a, b9545f5, dc61be8, e8c1239) |
| 1c9f3c4 | port ledger `docs/v10/live-grid-kdb-port.md` |
| a5e146b | kdb crash recovery always on (your ruling) |
| 724739e | S3 tier on RustFS 1.0.1: bucket init, eod-dump, lake read-back (your ruling) |
| ebd1622 | crash-recovery and S3 ledger, Mac steps |
| f18c459 | sync v10 examples: the live-grid example goes to `live-grid/apps.json` |
| 9299afe | after the freeze, your ruling: RustFS persistent on the host (`${RUSTFS_DATA_DIR:-./rustfs-data}`, `rustfs-perms` one-shot); kdb-x build recipe + `compose.kdb-build.yml` |

**Gate receipts** (`docs/releases/validation/v10/v10-freeze-2026-10-12/`, at d96a356)

| Gate | Result |
|---|---|
| typecheck, lint | pass |
| unit | 7515 passed, 29 skipped, 1 failed: `PivotParamRow.viewer`, the known intermittent; its single rerun passed 16/16 (`pivot-rerun.log`) |
| revision | 54 passed |
| build | pass |
| e2e (Chromium) | 282 passed, 8 skipped |
| web | 50 passed |
| build-web, web-browser | pass |
| scrub | clean |
| help | 104 passed |
| diff-check | clean |
| notices-check | environmental |

Server suites: kdb-ws persist 9, kdb-store 130, live-grid 430 (14 network tests deselected), openbb-deltalake 95, scripts 13 (moto S3), tests 27, gateway 75, v3 68, lanes 22, workspace 12, episode3 6, provider-fixes 42, eodhd 9. check-public and verify-app-layouts pass.

**Mac-pending:**
- WebKit, native and iPad builds, cargo, dashsync;
- the crash-recovery drill: SIGKILL kdb, then live-grid, then the whole `live` profile, and check the replay keeps the tick count;
- RustFS init and the eod-dump flush plus read-back;
- the **two-writer delta-rs race on RustFS (one writer must get 412)**;
- the preview's /grid socket against a live gateway;
- the gateway preflight against an API with no standard routers;
- the licensed kdb-x.

Full steps are in openbq-docker `docs/v10/live-grid-kdb-port.md`.

### Your rulings during the session (recorded as rulings, not provisional)

- v10 includes the S3 tick store and always-on kdb crash recovery. The tick log is spooled to a persistent volume and replayed on restart. These are donor Episode 11 items moved into v10.
- RustFS replaces MinIO because of MinIO's licence change. No MinIO or `mc` remains, and a test enforces that.
- Delta Lake stays for ticks. DuckLake is recorded as a future decision: bring it in with a PostgreSQL catalog for fundamentals, holdings and transactions when the first bitemporal tables land, with explicit effective-time and knowledge-time columns.

### Provisional decisions (taken by default; each stands until you rule)

- **V9-P1:** the Pivot provider suggestion is kept in data but not shown. No surface mounts that panel.
- **V9-P2:** Rita does not read the aggregation hint (the table-model tools have no suggestion field).
- **V9 server:** openbb-eodhd is taken at v9.6.6. There are no standard routers, so EODHD is served only under `/api/v1/eodhd`. The SDK's extra dependencies need locking on the first Mac build. The ArcticDB tier is self-disabling. The EODHD app ships in the extension. The SDK's MIT licence needs confirming.
- **V10-P1:** the web preview authenticates the /grid socket with a single-use ticket. The desktop sends no header credential on the socket, so it holds its snapshot against an authenticated live-grid. The donor's credential-in-URL change 1171fe15 was not carried.
- **V10-P2:** a range bar's `valueKey` defaults to `price`.
- **V10-P4:** the example's `live_chart` card opens as raw JSON, because neither the donor nor clean draws that card type.
- **V10-P5:** the Subscriptions card appears only when `LIVE_GRID_PUBLIC_URL` is set, and openbq-docker v10 leaves it empty.
- **Server v10, P1–P7:**
  - kdb tier subset: openbb-kdb, `kdb/` and `kdb-x/` are not ported;
  - live-grid history comes from EODHD via `OPENBB_HISTORY_NAMESPACE`, so **every chart call is an EODHD call**;
  - no host port for kdb or live-grid;
  - gateway `liveGrid` flag, off by default (/grid answers 503);
  - live-grid uses `credentials.env`;
  - the watchlist is on a named volume;
  - the gateway is version 10.0.0.
- **Server v10, C1–C8:**
  - **C1:** kdb's `/data` is the `kdb-data` named volume.
  - **C2: RustFS put-if-absent is unverified** (Mac race test).
  - **C3:** a separate `openbq-lake` image.
  - **C4:** the lake read-back is this line's own design.
  - **C5:** the S3 tier's env files are optional, and the tier fails closed.
  - **C6:** live-grid holds the store's root credentials.
  - **C7:** the hot and cold tiers are off.
  - **C8:** finding: `DeltaTable.is_deltatable` hangs against S3 here, and openbb-deltalake's `store.read()` still calls it.

### Open questions for you

1. Connections export/import (`backendsJson`), open since v7.
2. V9-P1: surface the Pivot suggestion in the drawer, or retire the unmounted panel?
3. V9-P2: add the hint to Rita's table-model description?
4. V10-P1: should live-grid accept a ticket or query credential, or should the desktop open the socket natively with headers?
5. V10-P5: set `LIVE_GRID_PUBLIC_URL` by default, or drop the card from the example?
6. C6: should live-grid get a read-only S3 key instead of the root credentials?
7. C8: replace `is_deltatable` in openbb-deltalake before the S3 tier is used for reads?
8. Should a live-grid history cache sit in front of EODHD, given that every chart call is metered?

### Delivery commands as written then (superseded by the release above)

```sh
# bdobb (origin = Adventures-OpenBQ/bdobb)
cd ~/bdobb
git push -u origin claude/clean-v9 claude/clean-v10
# optional tags, if you want them this time (v8 froze without one):
git tag -a v9.0.0  62d1aae -m "BDOBB 9.0.0"
git tag -a v10.0.0 995554f -m "BDOBB 10.0.0"
git push origin v9.0.0 v10.0.0

# openbq-docker (origin = Adventures-OpenBQ/openbq-docker)
cd ~/openbq-docker
git push -u origin claude/openbq-docker-v9 claude/openbq-docker-v10
```

Release branches and main were not created or moved. Promote them only after the Mac half reports.
