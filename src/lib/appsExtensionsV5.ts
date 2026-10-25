// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { AppExtensionError, extensionError, type ExtensionResult, type V3AppExtension } from './appsExtensionsV3';
import { keys as checkKeys, prepareV4, type V4AppExtension } from './appsExtensionsV4';
import type { App, ImportResult } from './appsJson';
import type { Dashboard, DashboardCard } from './types';
import { isRecord } from './isRecord';
type Overlay = { tab: string; index: number; view?: 'statement'; statement?: NonNullable<DashboardCard['statement']> };
export type V5AppExtension = { schemaVersion: 1; profile: 'v5'; base: V3AppExtension | V4AppExtension; cards: Overlay[] };
const keys = (value: Record<string, unknown>, allowed: string[], path: string) => checkKeys(value, allowed, path, 'v5');
function folds(value: unknown, path: string): NonNullable<DashboardCard['statement']> {
  if (!isRecord(value)) extensionError(path, 'Invalid Statement state.');
  keys(value, ['collapsed'], path);
  const list = value.collapsed;
  if (list !== undefined && (!Array.isArray(list) || list.some(name => typeof name !== 'string' || !name) || new Set(list).size !== list.length)) extensionError(path, 'Invalid Statement folds.');
  return structuredClone(value) as NonNullable<DashboardCard['statement']>;
}
/** Validate descriptors before cloning or reading a user-supplied extension object. */
function json(value: unknown, path: string, depth = 0, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || depth > 64 || seen.has(value)) extensionError(path, 'Invalid v5 JSON value.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) extensionError(path, 'Invalid v5 object prototype.');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set) extensionError(path, 'Invalid v5 accessor.');
    if (!descriptor.enumerable) continue;
    if (descriptor.value === undefined && !Array.isArray(value)) continue;
    json(descriptor.value, `${path}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}
/** Detect a declared profile without executing optional legacy accessors. */
function ownValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
export function needsV5(dashboard: Dashboard) {
  return dashboard.tabs.some(tab => tab.cards.some(card => card.statement !== undefined || card.view === 'statement'));
}
export function exportV5(dashboard: Dashboard, baseExport: (dashboard: Dashboard) => ExtensionResult<App>): ExtensionResult<App> {
  try {
    const overlays: Overlay[] = [];
    const clean: Dashboard = { ...dashboard, tabs: dashboard.tabs.map(tab => ({ ...tab, cards: tab.cards.map((card, index) => {
      const copy = { ...card };
      if (card.statement !== undefined || card.view === 'statement') overlays.push({ tab: tab.id, index, ...(card.view === 'statement' ? { view: 'statement' as const } : {}), ...(card.statement !== undefined ? { statement: folds(card.statement, '$.cards.statement') } : {}) });
      delete copy.statement;
      if (copy.view === 'statement') delete copy.view;
      return copy;
    }) })) };
    const result = baseExport(clean); if (!result.ok) return result;
    const base = result.value.extensions!.bdobb as V3AppExtension | V4AppExtension;
    result.value.extensions = { bdobb: { schemaVersion: 1, profile: 'v5', base, cards: overlays } };
    return result;
  } catch (error) { if (error instanceof AppExtensionError) return { ok: false, issue: error.issue }; throw error; }
}
/** Unwrap v5 only after every portable Statement slot is valid; v4 keeps its own decoder. */
export function prepareV5(input: unknown): { plain: unknown; restore: (result: ImportResult) => ImportResult } {
  if (!Array.isArray(input)) return prepareV4(input);
  const pending: Array<{ app: number; tabOrder: string[]; cards: Overlay[] }> = [];
  const unwrapped = input.map((raw, app) => {
    const extensions = ownValue(raw, 'extensions');
    const envelope = ownValue(extensions, 'bdobb');
    if (!isRecord(raw) || !isRecord(envelope) || ownValue(envelope, 'profile') !== 'v5') return raw;
    json(raw, `$[${app}]`);
    keys(envelope, ['schemaVersion', 'profile', 'base', 'cards'], '$.extensions.bdobb');
    if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.cards)) extensionError('$.extensions.bdobb', 'Unsupported v5 schema.', 'UNSUPPORTED_EXTENSION');
    if (!isRecord(envelope.base) || !['v3', 'v4'].includes(envelope.base.profile as string)) extensionError('$.extensions.bdobb.base', 'Unsupported v5 base profile.', 'UNSUPPORTED_EXTENSION');
    if (!isRecord(raw.tabs)) extensionError('$.tabs', 'Invalid v5 tabs.');
    const baseOrder = envelope.base.profile === 'v4' && isRecord(envelope.base.base) ? envelope.base.base.tabOrder : envelope.base.tabOrder;
    if (!Array.isArray(baseOrder) || baseOrder.some(id => typeof id !== 'string')) extensionError('$.extensions.bdobb.base', 'Invalid base tab order.');
    const seen = new Set<string>();
    const cards = envelope.cards.map((entry, i): Overlay => {
      const path = `$.extensions.bdobb.cards[${i}]`;
      if (!isRecord(entry)) extensionError(path, 'Invalid v5 card overlay.');
      keys(entry, ['tab', 'index', 'view', 'statement'], path);
      const tab = typeof entry.tab === 'string' && Object.hasOwn(raw.tabs as object, entry.tab) ? (raw.tabs as Record<string, unknown>)[entry.tab] : undefined;
      const slot = JSON.stringify([entry.tab, entry.index]);
      if (!isRecord(tab) || !Array.isArray(tab.layout) || !baseOrder.includes(entry.tab) || !Number.isSafeInteger(entry.index) || (entry.index as number) < 0 || (entry.index as number) >= tab.layout.length || seen.has(slot)) extensionError(path, 'Invalid or duplicate Statement slot.');
      seen.add(slot);
      if (entry.view !== undefined && entry.view !== 'statement') extensionError(path, 'Invalid Statement view.');
      return { tab: entry.tab as string, index: entry.index as number, ...(entry.view !== undefined ? { view: 'statement' } : {}), ...(entry.statement !== undefined ? { statement: folds(entry.statement, path) } : {}) };
    });
    pending.push({ app, tabOrder: baseOrder as string[], cards });
    return { ...raw, extensions: { ...(extensions as Record<string, unknown>), bdobb: envelope.base } };
  });
  const base = prepareV4(unwrapped);
  return { plain: base.plain, restore: result => {
    const restored = base.restore(result);
    for (const batch of pending) for (const entry of batch.cards) {
      const card = restored.dashboards[batch.app]?.tabs[batch.tabOrder.indexOf(entry.tab)]?.cards[entry.index];
      if (!card) extensionError('$.cards', 'Statement slot did not import.');
      if (entry.view !== undefined) card.view = entry.view;
      if (entry.statement !== undefined) card.statement = structuredClone(entry.statement);
    }
    return restored;
  } };
}
