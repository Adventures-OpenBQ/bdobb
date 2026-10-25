// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
/** Validate the metadata before exposing a source download in Help. */
export function validateSourceOffer(value) {
  const keys = ['schemaVersion', 'release', 'baseCommit', 'sourceId', 'archiveFilename', 'archiveUrl', 'license', 'status'];
  const fail = () => { throw new Error('Invalid revision-specific source offer'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  if (value.schemaVersion !== 1 || value.license !== 'AGPL-3.0-only' || value.status !== 'prepared') fail();
  const release = typeof value.release === 'string' && /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value.release);
  if (!release || BigInt(release[1]) < 3n) fail();
  if (typeof value.baseCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.baseCommit)) fail();
  if (typeof value.sourceId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceId)) fail();
  if (value.archiveFilename !== `bdobb-${value.release}-agpl-${value.sourceId.slice(0, 12)}-source.tar.gz`) fail();
  const canonical = `https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-${value.release}-${value.sourceId.slice(0, 12)}/${value.archiveFilename}`;
  if (value.archiveUrl !== canonical) fail();
  return Object.freeze({ ...value });
}
