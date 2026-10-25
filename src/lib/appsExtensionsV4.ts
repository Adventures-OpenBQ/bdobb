// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { validateStatementIntent } from './statementModel/validation';
import { AppExtensionError, decodeV3AppExtension, extensionError, unwrapExtension } from './appsExtensionsV3';
import type { ExtensionResult, V3AppExtension } from './appsExtensionsV3';
import type { App, ImportResult } from './appsJson';
import { isRecord } from './isRecord';
import { reservedPivotName } from './paramGroups';
import { AGG_NAMES, BUCKETS } from './types';
import type { Dashboard, DashboardCard, PivotConfig } from './types';

type Extras = Partial<Pick<DashboardCard, 'managedSource' | 'tableDefinition' | 'tableSelection' | 'linkedChart' | 'fiscalYearEnd' | 'hideTitleParams' | 'paramsOpen' | 'calendar'>> & {
  view?: 'calendar';
  pivot?: PivotConfig;
  sourceRef?: string;
  pivotBindings?: Array<{ group: string; paramName: string }>;
};
type PortableCard = { ref: string; tab: string; index: number; extras: Extras };
export type V4AppExtension = { schemaVersion: 1; profile: 'v4'; base: V3AppExtension; cards: PortableCard[] };
export const EXTRA_FIELDS = ['managedSource', 'tableDefinition', 'tableSelection', 'linkedChart', 'fiscalYearEnd', 'hideTitleParams', 'paramsOpen', 'calendar'] as const;
const BASE_FIELDS = ['id', 'widgetId', 'backendId', 'params', 'layout', 'title', 'view', 'minimized', 'bindings', 'table', 'groupIds', 'extensions'];
export function keys(value: Record<string, unknown>, allowed: readonly string[], path: string, profile = 'v4') {
  if (Object.keys(value).some(key => !allowed.includes(key))) extensionError(path, `Unknown ${profile} extension field.`);
}
/** No caches, executable values, prototypes or non-finite numbers cross this boundary. */
function checkedJson(value: unknown, path: string, depth = 0, seen = new Set<object>()): void {
  if (depth > 64) extensionError(path, 'Extension nesting exceeds 64 levels.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null || seen.has(value)) extensionError(path, 'Expected finite acyclic JSON.');
  if (!Array.isArray(value) && (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) extensionError(path, 'Expected plain JSON.');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) extensionError(path, 'Unsafe extension key.');
    if (child === undefined && !Array.isArray(value)) continue; // JSON omits optional object fields.
    checkedJson(child, `${path}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string'); }
function pivot(value: unknown, path: string): PivotConfig {
  if (!isRecord(value)) extensionError(path, 'Expected Pivot configuration.');
  keys(value, ['enabled', 'grouping', 'split', 'expanded', 'keyEncoding', 'legacyExpanded', 'measures', 'aggregationFns', 'buckets'], path);
  if (typeof value.enabled !== 'boolean' || !strings(value.grouping) || !strings(value.split)) extensionError(path, 'Invalid Pivot axes.');
  if (value.aggregationFns !== undefined && (!isRecord(value.aggregationFns) || Object.values(value.aggregationFns).some(v => !AGG_NAMES.includes(v as never)))) extensionError(path, 'Invalid aggregation.');
  if (value.buckets !== undefined && (!isRecord(value.buckets) || Object.values(value.buckets).some(v => !BUCKETS.includes(v as never)))) extensionError(path, 'Invalid bucket.');
  if (value.measures !== undefined && (!Array.isArray(value.measures) || value.measures.some(m => !isRecord(m) || typeof m.id !== 'string' || typeof m.sourceFieldId !== 'string' || (m.aggregation !== undefined && !AGG_NAMES.includes(m.aggregation as never))))) extensionError(path, 'Invalid independent measure.');
  checkedJson(value, path);
  return structuredClone(value) as PivotConfig;
}
export function extras(value: unknown, path: string): Extras {
  if (!isRecord(value)) extensionError(path, 'Expected card state.');
  keys(value, [...EXTRA_FIELDS, 'view', 'pivot', 'sourceRef', 'pivotBindings'], path);
  checkedJson(value, path);
  for (const field of ['hideTitleParams', 'paramsOpen']) if (value[field] !== undefined && typeof value[field] !== 'boolean') extensionError(path, 'Invalid parameter-panel choice.');
  if (value.fiscalYearEnd !== undefined && (!Number.isInteger(value.fiscalYearEnd) || (value.fiscalYearEnd as number) < 1 || (value.fiscalYearEnd as number) > 12)) extensionError(path, 'Invalid fiscal-year month.');
  if (value.view !== undefined && value.view !== 'calendar') extensionError(path, 'Invalid additional view.');
  if (value.sourceRef !== undefined && typeof value.sourceRef !== 'string') extensionError(path, 'Invalid source reference.');
  if (value.managedSource !== undefined) {
    const source = value.managedSource;
    if (!isRecord(source)) extensionError(path, 'Invalid managed source reference.');
    keys(source, ['sourceId', 'kind', 'version'], `${path}.managedSource`);
    if (source.version !== 1 || !['upload', 'backend'].includes(source.kind as string) || typeof source.sourceId !== 'string' || !source.sourceId)
      extensionError(path, 'Invalid managed source reference.');
  }
  if (value.tableDefinition !== undefined && (!isRecord(value.tableDefinition) || !isRecord(value.tableDefinition.table) || typeof value.tableDefinition.search !== 'string')) extensionError(path, 'Invalid table definition.');
  if (isRecord(value.tableDefinition)) keys(value.tableDefinition, ['table', 'search', 'analytical'], `${path}.tableDefinition`);
  if (isRecord(value.tableDefinition) && value.tableDefinition.analytical !== undefined) {
    const model = value.tableDefinition.analytical;
    if (isRecord(model) && model.schemaVersion === 2) {
      const validated = validateStatementIntent(model);
      if (!validated.value) extensionError(path, validated.diagnostics.map(d => d.message).join('; '));
    } else {
    if (!isRecord(model) || model.schemaVersion !== 1) extensionError(path, 'Unsupported analytical schema.', 'UNSUPPORTED_EXTENSION');
    keys(model, ['schemaVersion', 'enabled', 'params', 'categories', 'measures', 'formulas', 'layout', 'checklists', 'resultFilters', 'subtotals', 'legacyPivot'], `${path}.analytical`);
    if (typeof model.enabled !== 'boolean' || !isRecord(model.params) || !isRecord(model.layout) || !isRecord(model.subtotals) || ['categories', 'measures', 'formulas', 'checklists', 'resultFilters'].some(k => !Array.isArray(model[k]))) extensionError(path, 'Invalid analytical definition.');
    }
  }
  if (value.tableSelection !== undefined) {
    const s = value.tableSelection;
    if (isRecord(s)) keys(s, ['kind', 'ids', 'excludedIds'], `${path}.tableSelection`);
    if (!isRecord(s) || !['none', 'explicit', 'allMatching'].includes(s.kind as string) || (s.kind === 'explicit' && !strings(s.ids)) || (s.kind === 'allMatching' && !strings(s.excludedIds))) extensionError(path, 'Invalid symbolic selection.');
  }
  if (value.linkedChart !== undefined) {
    const c = value.linkedChart;
    if (!isRecord(c) || !['bar', 'column', 'line'].includes(c.type as string) || (c.category !== undefined && typeof c.category !== 'string') || !strings(c.measures) || !['grouped', 'stacked'].includes(c.display as string)) extensionError(path, 'Invalid linked chart.');
  }
  if (value.calendar !== undefined) {
    const c = value.calendar;
    if (!isRecord(c)) extensionError(path, 'Invalid calendar state.');
    keys(c, ['mode', 'rowUnit', 'unit', 'businessDays', 'cellMode', 'evenRows', 'cursor', 'dateField', 'titleField', 'seriesField', 'series', 'exclude', 'include'], `${path}.calendar`);
    for (const [key, allowed] of Object.entries({ mode: ['static', 'vertical', 'horizontal', 'paged'], rowUnit: ['day', 'week'], unit: ['day', 'week', 'month', 'continuous'], cellMode: ['list', 'timeline'] })) if (c[key] !== undefined && !allowed.includes(c[key] as string)) extensionError(path, 'Invalid calendar mode.');
    if (c.evenRows !== undefined && typeof c.evenRows !== 'boolean') extensionError(path, 'Invalid calendar rows.');
    if (c.businessDays !== undefined && (!Array.isArray(c.businessDays) || c.businessDays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) extensionError(path, 'Invalid calendar weekdays.');
    for (const key of ['dateField', 'titleField', 'seriesField']) if (c[key] !== undefined && typeof c[key] !== 'string') extensionError(path, 'Invalid calendar field.');
    if (c.cursor !== undefined && (typeof c.cursor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.cursor) || !Number.isFinite(Date.parse(c.cursor)) || new Date(c.cursor).toISOString().slice(0, 10) !== c.cursor)) extensionError(path, 'Invalid calendar date.');
    if (c.series !== undefined && !strings(c.series)) extensionError(path, 'Invalid calendar series.');
    for (const key of ['include', 'exclude']) if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].some(p => !strings(p) || p.length < 1 || p.length > 3))) extensionError(path, 'Invalid calendar filter.');
  }
  if (value.pivot !== undefined) pivot(value.pivot, `${path}.pivot`);
  if (value.pivotBindings !== undefined && (!Array.isArray(value.pivotBindings) || value.pivotBindings.some(b => !isRecord(b) || typeof b.group !== 'string' || typeof b.paramName !== 'string' || !reservedPivotName(b.paramName)))) extensionError(path, 'Invalid Pivot binding.');
  return structuredClone(value) as Extras;
}
export function needsV4(dashboard: Dashboard): boolean {
  return dashboard.tabs.some(tab => tab.cards.some(card => EXTRA_FIELDS.some(k => card[k] !== undefined) || card.linkedSource !== undefined || card.view === 'calendar' || card.table?.pivot !== undefined || card.bindings?.some(b => reservedPivotName(b.paramName))));
}
export function exportV4(dashboard: Dashboard, baseExport: (dashboard: Dashboard) => ExtensionResult<App>): ExtensionResult<App> {
  try {
    const allCards = dashboard.tabs.flatMap(t => t.cards);
    const refs = new Map(allCards.map((c, i) => [c.id, `c${i}`]));
    if (refs.size !== allCards.length) extensionError('$.cards', 'Duplicate card identity.');
    const portable: PortableCard[] = [];
    const base: Dashboard = { ...dashboard, tabs: dashboard.tabs.map(tab => ({ ...tab, cards: tab.cards.map((card, index) => {
      for (const [key, value] of Object.entries(card)) if (value !== undefined && ![...BASE_FIELDS, ...EXTRA_FIELDS, 'linkedSource'].includes(key)) extensionError('$.cards', 'Unsupported card state.');
      const extra: Extras = {};
      for (const field of EXTRA_FIELDS) if (card[field] !== undefined) Object.assign(extra, { [field]: card[field] });
      if (card.linkedSource) {
        const ref = refs.get(card.linkedSource.sourceWidgetId);
        if (!ref) extensionError('$.cards', 'Linked source is outside this dashboard.');
        extra.sourceRef = ref;
      }
      if (card.view === 'calendar') extra.view = 'calendar';
      if (card.table?.pivot) extra.pivot = card.table.pivot;
      const pivotBindings = (card.bindings ?? []).filter(b => reservedPivotName(b.paramName));
      if (pivotBindings.length) extra.pivotBindings = pivotBindings.map(b => {
        const group = dashboard.groups?.find(g => g.id === b.groupId);
        if (!group) extensionError('$.cards', 'Missing Pivot group.');
        return { group: String(dashboard.groups!.indexOf(group)), paramName: b.paramName };
      });
      portable.push({ ref: refs.get(card.id)!, tab: tab.id, index, extras: extras(extra, '$.cards.extras') });
      const clean = { ...card } as DashboardCard;
      for (const field of EXTRA_FIELDS) delete clean[field];
      delete clean.linkedSource;
      if (clean.view === 'calendar') delete clean.view;
      if (clean.table?.pivot) { clean.table = { ...clean.table }; delete clean.table.pivot; }
      clean.bindings = clean.bindings?.filter(b => !reservedPivotName(b.paramName));
      return clean;
    }) })) };
    const result = baseExport(base);
    if (!result.ok) return result;
    const app = result.value;
    const baseExtension = unwrapExtension(decodeV3AppExtension(app.extensions!.bdobb, '$.extensions.bdobb'))!;
    for (const item of portable) for (const binding of item.extras.pivotBindings ?? []) binding.group = app.groups[Number(binding.group)].name;
    app.extensions = { bdobb: { schemaVersion: 1, profile: 'v4', base: baseExtension, cards: portable } };
    return { ok: true, value: app };
  } catch (err) { if (err instanceof AppExtensionError) return { ok: false, issue: err.issue }; throw err; }
}
/** Validate the whole batch before legacy import allocates a dashboard or a caller writes it. */
export function prepareV4(json: unknown): { plain: unknown; restore: (result: ImportResult) => ImportResult } {
  if (!Array.isArray(json)) return { plain: json, restore: result => result };
  const pending: Array<{ app: number; items: PortableCard[]; tabOrder: string[]; groupNames: string[] }> = [];
  const plain = json.map((raw, ai) => {
    if (!isRecord(raw) || !isRecord(raw.tabs)) return raw;
    const native = isRecord(raw.extensions) ? raw.extensions.bdobb : undefined;
    const isV4 = isRecord(native) && native.profile === 'v4';
    const legacySlots: Array<{ tab: string; index: number; extras: Extras }> = [];
    for (const [tab, t] of Object.entries(raw.tabs)) if (isRecord(t) && Array.isArray(t.layout)) t.layout.forEach((item, index) => {
      if (!isRecord(item) || !isRecord(item.extensions) || !Object.hasOwn(item.extensions, 'bdobb')) return;
      const overlay = item.extensions.bdobb;
      if (!isRecord(overlay) || overlay.version !== 1 || overlay.profile !== 'pivot-v1') extensionError('$.layout.extensions.bdobb', 'Unsupported analytical profile.', 'UNSUPPORTED_EXTENSION');
      keys(overlay, ['version', 'profile', 'pivot'], '$.layout.extensions.bdobb');
      const recipe = pivot(overlay.pivot, '$.layout.extensions.bdobb.pivot');
      // The overlay belongs to a backend table and is stored as card.table.pivot,
      // which the client table worker reads (v6 moved backend tables onto it,
      // reversing the 2026-10-08 ruling); past the worker ceiling TableRenderer
      // pivots it in-thread (D-007).
      legacySlots.push({ tab, index, extras: { pivot: recipe } });
    });
    if (!isV4 && !legacySlots.length) return raw;
    checkedJson(raw, `$[${ai}]`);
    const copy = structuredClone(raw);
    let items: PortableCard[] = [];
    let tabOrder = Object.keys(raw.tabs);
    if (isV4) {
      keys(native, ['schemaVersion', 'profile', 'base', 'cards'], '$.extensions.bdobb');
      if (native.schemaVersion !== 1 || !Array.isArray(native.cards)) extensionError('$.extensions.bdobb', 'Unsupported v4 schema.', 'UNSUPPORTED_EXTENSION');
      const base = unwrapExtension(decodeV3AppExtension(native.base, '$.extensions.bdobb.base'));
      if (!base) extensionError('$.extensions.bdobb.base', 'Missing base profile.');
      tabOrder = base.tabOrder;
      copy.extensions = { ...copy.extensions as object, bdobb: base };
      const refs = new Set<string>(); const slots = new Set<string>();
      items = native.cards.map((item, i) => {
        const path = `$.extensions.bdobb.cards[${i}]`;
        if (!isRecord(item)) extensionError(path, 'Invalid portable card.');
        keys(item, ['ref', 'tab', 'index', 'extras'], path);
        const tab = typeof item.tab === 'string' && Object.hasOwn(raw.tabs as object, item.tab) ? (raw.tabs as Record<string, unknown>)[item.tab] : undefined;
        if (typeof item.ref !== 'string' || refs.has(item.ref) || !Number.isSafeInteger(item.index) || (item.index as number) < 0 || !isRecord(tab) || !Array.isArray(tab.layout) || (item.index as number) >= tab.layout.length) extensionError(path, 'Invalid or duplicate card reference.');
        const slot = JSON.stringify([item.tab, item.index]);
        if (slots.has(slot)) extensionError(path, 'Duplicate card slot.');
        refs.add(item.ref); slots.add(slot);
        return { ref: item.ref, tab: item.tab as string, index: item.index as number, extras: extras(item.extras, path) };
      });
      const count = Object.values(raw.tabs).reduce((n: number, t) => n + (isRecord(t) && Array.isArray(t.layout) ? t.layout.length : 0), 0);
      if (items.length !== count) extensionError('$.extensions.bdobb.cards', 'Every card must have one portable identity.');
      for (const item of items) if (item.extras.sourceRef !== undefined && !refs.has(item.extras.sourceRef)) extensionError('$.extensions.bdobb.cards', 'Missing linked source.');
    }
    if (isV4 && legacySlots.length) extensionError('$.layout', 'Conflicting analytical overlays.');
    for (const slot of legacySlots) {
      const tab = (copy.tabs as Record<string, { layout: Array<Record<string, unknown>> }>)[slot.tab];
      const extensions = tab.layout[slot.index].extensions as Record<string, unknown>;
      delete extensions.bdobb;
      if (Object.keys(extensions).length === 0) delete tab.layout[slot.index].extensions;
      items.push({ ...slot, ref: `legacy-${items.length}` });
    }
    const groupNames = Array.isArray(raw.groups) ? raw.groups.map(g => isRecord(g) ? g.name as string : '') : [];
    for (const item of items) for (const binding of item.extras.pivotBindings ?? []) if (!groupNames.includes(binding.group)) extensionError('$.cards', 'Missing Pivot group.');
    pending.push({ app: ai, items, tabOrder, groupNames });
    return copy;
  });
  return { plain, restore: result => {
    for (const batch of pending) {
      const dashboard = result.dashboards[batch.app];
      const refIds = new Map(batch.items.map(item => [item.ref, dashboard.tabs[batch.tabOrder.indexOf(item.tab)].cards[item.index].id]));
      for (const item of batch.items) {
        const card = dashboard.tabs[batch.tabOrder.indexOf(item.tab)].cards[item.index];
        const { sourceRef, pivotBindings, pivot: legacyPivot, ...state } = item.extras;
        Object.assign(card, structuredClone(state));
        if (legacyPivot) card.table = { ...card.table, pivot: legacyPivot };
        if (sourceRef !== undefined) card.linkedSource = { kind: 'widget', sourceWidgetId: refIds.get(sourceRef)! };
        for (const binding of pivotBindings ?? []) {
          const group = dashboard.groups?.[batch.groupNames.indexOf(binding.group)];
          if (!group) extensionError('$.cards', 'Missing imported Pivot group.');
          card.bindings = [...card.bindings ?? [], { groupId: group.id, paramName: binding.paramName }];
        }
      }
    }
    return result;
  } };
}
