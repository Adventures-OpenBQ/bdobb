// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export const acquiredOwnershipPartition = {
  version: 1, kind: 'ownership', origin: 'acquired-snapshot', issuer: 'EXAMPLE.US', share_class: 'Class-A',
  retrieved_at: '2026-11-20T04:16:46Z', raw_count: 2, normalized_count: 2, delivered_count: 2,
  diagnostics: [], unsafe: { identity_conflict: false, unit_conflict: false, date_conflict: false, partition_conflict: false },
  measures: {},
  field_origins: { bucket: 'bucket_id', share: 'reported_share' },
  partition: { status: 'verified', as_of: '2026-09-30', denominator: 'outstanding-shares',
    exclusive: true, exhaustive: true, rounding_bound_percent: 0.002, reference: 'example:ownership-register' },
  bucket_keys: ['control', 'other'],
};
export const acquiredOwnershipRows = [
  { symbol: 'EXAMPLE.US', share_class: 'Class-A', bucket_id: 'control', reported_share: 23.456, as_of: '2026-09-30',
    denominator: 'outstanding-shares', description: 'keep this' },
  { symbol: 'EXAMPLE.US', share_class: 'Class-A', bucket_id: 'other', reported_share: 76.544, as_of: '2026-09-30',
    denominator: 'outstanding-shares', description: 'filter this out' },
];
export const unsafeOwnershipPartition = {
  ...acquiredOwnershipPartition, raw_count: 3, diagnostics: ['identity_conflict', 'date_conflict', 'partition_conflict'],
  unsafe: { ...acquiredOwnershipPartition.unsafe, identity_conflict: true, date_conflict: true, partition_conflict: true },
};
