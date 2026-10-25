// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
// node scripts/update-source-offer.mjs <release> <baseCommit> <sourceId> <archiveFilename>
import { writeFileSync } from 'node:fs';
import { validateSourceOffer } from '../src/lib/sourceOfferManifest.mjs';
const [release, baseCommit, sourceId, archiveFilename, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Expected release, baseCommit, sourceId, archiveFilename');
const offer = validateSourceOffer({
  schemaVersion: 1, release, baseCommit, sourceId, archiveFilename,
  archiveUrl: `https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-${release}-${sourceId?.slice(0, 12)}/${archiveFilename}`,
  license: 'AGPL-3.0-only', status: 'prepared',
});
writeFileSync(new URL('../source-offer.json', import.meta.url), JSON.stringify(offer, null, 2) + '\n', { flag: 'wx' });
