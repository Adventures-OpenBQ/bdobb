# V4 6c17 native Linux table qualification preparation

PREPARATION ONLY. No Docker/native build/runtime, workflow push/dispatch, shared stack, SDK/reference image, real key, private age identity, or source policy was changed or executed by this preparation. Root must review/integrate/commit this controller before dispatch. Default target is native hosted AMD64; ARM64 is optional, because root is independently building the exact ARM image locally.

## Immutable input boundary

- Product/source/auditor `6c17f0f31af8dedd8ecf903719f8c8953035e43a`
- Source tree `54b8f50e0a01c06f604919c7e104759ae273ae22`
- Exact Git archive SHA256 `46af7695bef5bbb8cc874e796b3ccca2fa22176efe98d5b83f3786c4f4710787`, 35184640 bytes
- Offer `a2520b860843e562ad9357ad3f7506ee216913f940aabe49875d024bfecce3ba`
- Backend `ff26495a9b43815605e1b8774f084f9d3b0388d6`
- Dockerfile `e3a9e2cd0cd5d96d8be057f2084f14566180b5f89f09ff913b6ffaa3784a2fe4`
- Existing recipe remains unchanged: Rust1.98.1, Node26.10.0, ICU78.3, pnpm10.34.4, SheetJS0.20.3 and source-pinned archives.

The controller fetches explicit public repositories by immutable commit, verifies tracked clean state and controller HEAD==GITHUB_SHA, then uses the unchanged backend prepare-source.mjs. Only production table and its toolchain are built. The native arch guard rejects emulated/local/self-hosted CI execution. Build source is never the controller or a different auditor checkout.

## Future execution assertions

- Exactly 80 service and 218 core tests; includes the new raw-field/strict-opaque-ID named regressions, chronological bound dates and scalar/auth tests.
- Nonroot10001:10001 production image, exact source/tree/toolchain labels and in-image source archive metadata.
- Owned fresh named catalog volume with volume-nocopy on initializer and runtime; initializer refuses any existing content, chmod0700 then chown10001:10001 (root only in isolated networknone/readonly initializer with CHOWN capability only); no shared volume/stack; networknone, readonly rootfs, capdropALL, no-new-privileges, no host ports, tmpfs scratch.
- Runtime real gateway→Node ingestion→Rust/native worker via HTTP; each observed worker RLIMIT_AS512MiB, at least two workers; process restart/durable source reopening and owner checks remain from original smoke.
- Exact synthetic 3×8 own-key payload containing empty string, __proto__, hasOwnProperty; numeric sorting/filtering yields empty-field101/301 and proto102/302; presented subset→derived child/chart retains values. Empty opaque request/widget/explicit measure IDs must return HTTP400 invalid_input.
- Raw logs and image privacy findings are private RUNNER_TEMP, not upload globs. Canonical saved-image gate uses unmodified source-owned policy. It must report passed with zero findings before plaintext image reaches success-only upload. Runtime assertions do not imply image privacy qualification.
- The prior b963 image's findings/allowlists are not applied here. A new candidate may remain BLOCKED. New explicit retention targets table-final-amd64 and table-final-arm64 bind 6c17/tree54b8/80/218 and exact candidate SHA/image ID. Historical b963 table-amd64 and historical Mac scopes are unchanged.
- Failure retention streams a fixed one-file tar directly to age, single existing reviewed public recipient, only ciphertext+safe JSON uploaded after canonical gate, retention one day. Original failed qualification remains failed. No private key is ever provided to CI.

## Review/integration

Integrate the eight source/test/workflow files listed in review/package.json plus this README into a new isolated controller commit (do not modify the old b963 controller). Keep action pins as supplied. Dispatch v4-table-final-qualification.yml with target=amd64 only after root review. ARM can use the same runtime probe via root's already-built exact image; the standalone command below does not alter build bytes.

For root's existing local ARM image, mount this prep deploy/table-service directory readonly at /qualification and backend/funnel-gateway readonly at /qualification-gateway; use a NEW owned named volume at /var/lib/table-service with volume-nocopy and the exact empty-directory initializer from the qualifier before the runtime command. Reuse the Docker invocation in scripts/qualify-v4-table-final-ci.py starting at PRODUCTION_RUNTIME with the exact already-built immutable image ID. Supply TABLE_SMOKE_DATA_ROOT=/var/lib/table-service and the four TABLE_SMOKE_* paths in that invocation. It executes no build, and root must remove only its owned container/volume afterward. The helper is Linux-only by process.platform inside the container, not a claim that the macOS Docker host is Linux.

## Local verification limits

Offline Python boundary tests, Node fixture/codec controls, Python AST, Node syntax and actionlint are meaningful preparation checks. Native Linux 80/218, Docker image/runtime, HTTP rejection behavior, actual age execution/encryption, and the new saved-image privacy gate are deliberately UNEXECUTED here. ARM age archive was downloaded from the official release and its official API digest verified; binary bytes were hashed without executing. See review/age-linux-arm64-pin.json. Root independently reviews and executes actual native steps.
