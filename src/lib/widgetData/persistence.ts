// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DashboardCard } from '../types';

const DROP = Symbol('drop');

/**
 * A detached copy of JSON data: own enumerable data properties of plain objects
 * and arrays, in their order, and primitives JSON can carry. A function, symbol,
 * undefined, accessor, cycle or non-plain object is left out (null in an array,
 * as JSON writes it), so an accessor is never invoked and runtime state never reaches disk.
 */
function plainData(value: unknown, ancestors: object[]): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || ancestors.includes(value)) return DROP;
  const isArray = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (!isArray && proto !== Object.prototype && proto !== null) return DROP;
  const inner = [...ancestors, value];
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  if (isArray) {
    return Array.from({ length: (value as unknown[]).length }, (_, i) => {
      const d = descriptors[i];
      const item = d && 'value' in d ? plainData(d.value, inner) : DROP;
      return item === DROP ? null : item;
    });
  }
  const out: Record<string, unknown> = {};
  for (const [key, d] of Object.entries(descriptors)) {
    if (!d.enumerable || !('value' in d)) continue;
    const item = plainData(d.value, inner);
    if (item !== DROP) out[key] = item;
  }
  return out;
}

/**
 * A card's server state (extensions.workspace: the original widget record, grid
 * entry and mapped params) and any sibling key BDOBB does not know, kept whole
 * so the next upload is the server's own record. Only a plain object is kept.
 */
function persistedExtensions(extensions: unknown): DashboardCard['extensions'] {
  if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions)) return undefined;
  const copy = plainData(extensions, []);
  return copy === DROP ? undefined : (copy as DashboardCard['extensions']);
}

/** Persist card intent only. Calculated rows, revisions and worker caches are ephemeral. */
export function persistedCard(card: DashboardCard): DashboardCard {
  const { id, widgetId, backendId, params, layout, title, view, minimized, bindings, table, tableDefinition, tableSelection, linkedSource, linkedChart, fiscalYearEnd, hideTitleParams, paramsOpen, calendar, statement } = card;
  const source=card.managedSource;
  const managedSource=source&&source.version===1&&typeof source.sourceId==='string'&&(source.kind==='upload'||source.kind==='backend')?{sourceId:source.sourceId,kind:source.kind,version:1 as const}:undefined;
  const extensions = persistedExtensions(card.extensions);
  return { id, widgetId, backendId, params, layout, title, view, minimized, bindings, table, tableDefinition, tableSelection, linkedSource, linkedChart, fiscalYearEnd, hideTitleParams, paramsOpen, calendar, statement, extensions, managedSource };
}

/** Dashboard-scoped ownership remap: preserve unknown references for later validation. */
export function remapWidgetReferences(card: DashboardCard, owners: ReadonlyMap<string, string>): DashboardCard {
  const copy = structuredClone(persistedCard(card));
  copy.id = owners.get(card.id) ?? card.id;
  if (copy.linkedSource) copy.linkedSource.sourceWidgetId = owners.get(copy.linkedSource.sourceWidgetId) ?? copy.linkedSource.sourceWidgetId;
  return copy;
}
