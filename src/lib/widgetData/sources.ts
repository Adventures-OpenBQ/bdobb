// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Dashboard, DashboardCard } from '../types';
import { BUILTIN_BACKEND_ID } from '../builtins';
import { effectiveParams } from '../paramGroups';
import { queryParams } from '../params';
import { useWidgetRegistryStore } from '../../stores/widgetRegistryStore';
import { isWorkerTableProducer } from '../tableExecution/eligibility';
import { validateGraph } from './graph';

export type SourceGroups = Pick<Dashboard, 'groups' | 'groupsDisabled'>;
/** A backend table's GET uses bound parameters and omits unsubmitted form fields. */
export function acquisitionParams(card: DashboardCard, scope?: SourceGroups) {
  if (card.linkedSource || card.backendId === BUILTIN_BACKEND_ID) return card.params;
  const widget = useWidgetRegistryStore.getState().find(card.backendId, card.widgetId);
  if (widget?.type !== 'table') return card.params;
  return queryParams(widget, effectiveParams(card, scope?.groups, widget, scope?.groupsDisabled));
}

/** Persisted inputs that identify the acquisition. Refresh and visual settings do not change ownership. */
export function acquisitionConfiguration(card: DashboardCard, scope?: SourceGroups) {
  return [card.widgetId, card.backendId, acquisitionParams(card, scope), card.linkedSource, card.managedSource, card.view];
}

/** Validate the proposed ancestry without preventing repair of unrelated invalid cards. */
export function linkedSourceAncestry(dashboard: Dashboard, targetId: string, sourceId: string): string[] | undefined {
  const cards = new Map(dashboard.tabs.flatMap(t => t.cards).map(c => [c.id, c]));
  const source = cards.get(sourceId);
  if (!source) return;
  const nodes: { id: string; source?: string; producer: boolean }[] = [{ id: targetId, source: sourceId, producer: true }];
  const seen = new Set<string>([targetId]);
  let current: DashboardCard | undefined = source;
  while (current && !seen.has(current.id)) {
    if (!isWorkerTableProducer(current)) return;
    seen.add(current.id);
    nodes.push({ id: current.id, source: current.linkedSource?.sourceWidgetId, producer: true });
    current = current.linkedSource ? cards.get(current.linkedSource.sourceWidgetId) : undefined;
  }
  try {
    validateGraph(nodes);
    return nodes.slice(1).map(node => node.id);
  } catch { return; }
}

export function canUseLinkedSource(dashboard: Dashboard, targetId: string, sourceId: string): boolean {
  return linkedSourceAncestry(dashboard, targetId, sourceId) !== undefined;
}
