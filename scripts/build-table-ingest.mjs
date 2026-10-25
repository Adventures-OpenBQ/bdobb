// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('../server/table-ingest/child.ts',import.meta.url))],outfile:fileURLToPath(new URL('../server/table-ingest/dist/child.mjs',import.meta.url)),bundle:true,platform:'node',format:'esm',target:'node26',packages:'external',sourcemap:false});
