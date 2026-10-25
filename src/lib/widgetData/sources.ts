// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Dashboard, DashboardCard } from '../types';
import { isWorkerTableProducer } from '../tableExecution/eligibility';
import { validateGraph } from './graph';

/** Validate the proposed ancestry without preventing repair of unrelated invalid cards. */
export function canUseLinkedSource(dashboard: Dashboard, targetId: string, sourceId: string): boolean {
  const cards = new Map(dashboard.tabs.flatMap(t => t.cards).map(c => [c.id, c]));
  const source = cards.get(sourceId);
  if (!source || !isWorkerTableProducer(source)) return false;
  const nodes: { id: string; source?: string; producer: boolean }[] = [{ id: targetId, source: sourceId, producer: true }];
  const seen = new Set<string>([targetId]);
  let current: DashboardCard | undefined = source;
  while (current && !seen.has(current.id)) {
    if (!isWorkerTableProducer(current)) return false;
    seen.add(current.id);
    nodes.push({ id: current.id, source: current.linkedSource?.sourceWidgetId, producer: true });
    current = current.linkedSource ? cards.get(current.linkedSource.sourceWidgetId) : undefined;
  }
  try { validateGraph(nodes); return true; } catch { return false; }
}
