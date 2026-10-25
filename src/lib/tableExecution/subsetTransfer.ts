// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from '../widgetData/types';
import type { Revision, SubsetBatch } from './types';
import { validateExecutionResponse } from './validation';
export type PendingInput = {
  transferId: string;
  upstream: Revision;
  requestId?: string;
  sequence: number;
  final: boolean;
  committed: boolean;
  data?: WidgetDataset;
};
export function beginSubset(transferId: string, upstream: Revision): PendingInput {
  if (!transferId)
    throw new Error('Missing transfer ID');
  return { transferId, upstream: structuredClone(upstream), sequence: 0, final: false, committed: false };
}
export function appendSubset(input: PendingInput, batch: SubsetBatch): void {
  validateExecutionResponse(batch, input.upstream, input.requestId ?? batch.requestId);
  if (input.final || input.committed || batch.transferId !== input.transferId || batch.sequence !== input.sequence)
    throw new Error('Invalid subset sequence or transfer');
  if (input.sequence === 0) {
    if (!batch.columns || !batch.provenance || !batch.freshness)
      throw new Error('Missing subset metadata');
    input.requestId = batch.requestId;
    input.data = structuredClone({ columns: batch.columns, rows: [], resultRevision: input.upstream.model, outputRevision: input.upstream.output,
      provenance: { ...batch.provenance, lineage: [...(batch.provenance.lineage ?? []), { widgetId: input.upstream.widgetId, resultRevision: input.upstream.model, outputRevision: input.upstream.output }] }, completeness: batch.completeness, freshness: batch.freshness, diagnostics: batch.diagnostics, modelWarnings: batch.modelWarnings, modelWarningCount: batch.modelWarningCount });
  }
  input.data!.rows.push(...structuredClone(batch.rows));
  input.sequence++;
  input.final = batch.final;
}
export function commitSubset(input: PendingInput): WidgetDataset {
  if (!input.final || !input.data || input.committed)
    throw new Error('Incomplete or already committed subset');
  input.committed = true;
  const data = input.data;
  input.data = undefined;
  return data;
}
