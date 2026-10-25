# BDOBB — Adventures in OpenBQ

This repository reconstructs a clean release sequence. Version 3.0.0 provides the reference-build desktop: ordinary tables and charts, documents, grouped controls, Run and numeric refresh, backend Apps discovery, and compatible JSON interchange.

Cron refetch is deferred. Analytical Pivot, workspaces and Statement are not part of v3.

Read the [user guide](docs/user-guide.md) and [v3 reference manual](docs/reference-manual/v3/README.md), also available through the app’s Help menu.

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm e2e
```

The local reference backend must be started separately for `pnpm test:reference`; set `OPENBB_REFERENCE_URL` when using a different port. See [source provenance](docs/releases/provenance.md) and [test environment](docs/test-environment.md).

AGPL-3.0-only for the application and first-party source changes. Copyright 2026 SecretoftheUniverse.com LLC. See [licensing and source availability](LICENSING.md). Earlier Apache grants and third-party notices remain in force.

Managed server tables and registered standard SSRM providers are described in the
in-app Tables help and [native deployment guide](deploy/table-service/README.md).

## Documentation copyright and permitted use

Copyright © 2026 SecretoftheUniverse.com LLC. The original reference and help materials identified in [DOCUMENTATION_TERMS.md](DOCUMENTATION_TERMS.md) are licensed separately from the software. Reading and personal or internal operational use are permitted; republication and use to reconstruct a product are restricted, subject to applicable law and existing license rights. The full terms are available offline in Quick Help’s Getting started and the Reference Manual’s home page. These terms do not change AGPL-3.0-only software rights, third-party licenses, or previously granted permissions.
