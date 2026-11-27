// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from '../types';
import { readChartSource, readChartSourceProjection } from './chartSourceContracts';
import { parseOwnershipSource, type OwnershipSource } from './ownershipEvidence';

export const ownershipPartitionRepair = 'Independent measures can overlap. Acquire a certified partition with exclusive, exhaustive buckets for waffle.';

const unsafeIssues = {
  identity_conflict: 'issuer or share class conflict',
  unit_conflict: 'unit conflict',
  date_conflict: 'measurement date conflict',
  partition_conflict: 'partition conflict',
} satisfies Record<keyof OwnershipSource['unsafe'], string>;

export function inspectOwnershipSource(dataset: WidgetDataset) {
  const source = readChartSource(dataset.provenance, 'ownership', parseOwnershipSource);
  const projection = readChartSourceProjection(dataset.provenance, 'ownership');
  if (!source || !projection) return {
    ok: false, refused: true, message: 'Acquire an ownership snapshot with verified field and issuer evidence.',
  } as const;
  const hazards = Object.entries(unsafeIssues).flatMap(([fact, message]) => source.unsafe[fact] ? [message] : []);
  if (hazards.length) return {
    ok: false, refused: true, message: `The ownership acquisition reports ${hazards.join(', ')}. Repair the source.`,
  } as const;
  return { ok: true, value: { source, projection } } as const;
}
