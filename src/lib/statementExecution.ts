// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { TableExecutor, Revision } from './tableExecution/types';
import { beginSubset, appendSubset, commitSubset, type PendingInput } from './tableExecution/subsetTransfer';
import type { StatementRows } from './statementRows';
import type { TableSpec } from './types';
import type { DatasetCompleteness, DatasetFreshness } from './widgetData/types';
import { projectGenericStatementDataset, projectStatementDataset, readStatementPresentation } from './statementPresentation';
export type StatementSnapshot = { revision: Revision; statement: StatementRows | null; completeness: DatasetCompleteness; freshness: DatasetFreshness };
/** Consume a complete, revision-qualified worker transfer, never a viewport block. */
export async function loadStatementSnapshot(executor: TableExecutor, revision: Revision, signal: AbortSignal, spec?: TableSpec): Promise<StatementSnapshot> {
  const cancelled = () => { if (signal.aborted) throw new DOMException('Statement read cancelled', 'AbortError'); };
  cancelled();
  let pending: PendingInput | undefined;
  for await (const batch of executor.presented(revision, signal)) {
    cancelled();
    pending ??= beginSubset(batch.transferId, revision);
    appendSubset(pending, batch);
  }
  cancelled();
  if (!pending) throw new Error('Statement source returned no transfer');
  const data = commitSubset(pending);
  const descriptor = data.provenance.metadata?.statementPresentation;
  const statement = descriptor === undefined ? projectGenericStatementDataset(data, spec)
    : projectStatementDataset(data, readStatementPresentation(descriptor));
  return { revision: structuredClone(revision), statement, completeness: data.completeness, freshness: data.freshness };
}
