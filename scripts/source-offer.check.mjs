// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSourceOffer } from '../src/lib/sourceOfferManifest.mjs';
const offer = {
  schemaVersion: 1, release: 'v3.0.0', baseCommit: 'a'.repeat(40),
  sourceId: 'b'.repeat(64), archiveFilename: 'bdobb-v3.0.0-agpl-bbbbbbbbbbbb-source.tar.gz',
  archiveUrl: 'https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-v3.0.0-bbbbbbbbbbbb/bdobb-v3.0.0-agpl-bbbbbbbbbbbb-source.tar.gz',
  license: 'AGPL-3.0-only', status: 'prepared',
};
test('preserves exact revision-specific archive URL', () => {
  assert.equal(validateSourceOffer(offer).archiveUrl, offer.archiveUrl);
});
for (const [name, change] of Object.entries({
  'wrong source identity': { sourceId: 'c'.repeat(64) },
  'malformed base commit': { baseCommit: 'main' },
  'malformed source identity': { sourceId: 'b'.repeat(63) },
  'moving main URL': { archiveUrl: 'https://github.com/Adventures-OpenBQ/bdobb/archive/refs/heads/main.tar.gz' },
  'wrong release': { release: 'v4.0.0' },
  'insecure URL': { archiveUrl: offer.archiveUrl.replace('https:', 'http:') },
  'path traversal filename': { archiveFilename: '../source.tar.gz' },
  'unsupported schema': { schemaVersion: 2 },
  'wrong license': { license: 'Apache-2.0' },
  'false publication claim': { status: 'published' },
  'embedded archive hash': { archiveSha256: 'd'.repeat(64) },
})) test(`rejects ${name}`, () => assert.throws(() => validateSourceOffer({ ...offer, ...change })));
test('rejects missing metadata', () => assert.throws(() => validateSourceOffer(null)));

for (const release of ['v3.0.1', 'v12.0.0', 'v12.0.0-rc.1', 'v12.0.0+build.001']) test(`accepts ${release}`, () => {
  const archiveFilename = `bdobb-${release}-agpl-bbbbbbbbbbbb-source.tar.gz`;
  const archiveUrl = `https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-${release}-bbbbbbbbbbbb/${archiveFilename}`;
  assert.equal(validateSourceOffer({ ...offer, release, archiveFilename, archiveUrl }).release, release);
});
for (const release of ['v2.9.9', 'v03.0.0', 'v3.01.0', 'v3.0.01', 'main', 'latest', 'v3.0.0-01', 'v3.0.0-', 'v3.0.0+']) test(`rejects noncanonical or old release ${release}`, () => {
  const archiveFilename = `bdobb-${release}-agpl-bbbbbbbbbbbb-source.tar.gz`;
  const archiveUrl = `https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-${release}-bbbbbbbbbbbb/${archiveFilename}`;
  assert.throws(() => validateSourceOffer({ ...offer, release, archiveFilename, archiveUrl }));
});
