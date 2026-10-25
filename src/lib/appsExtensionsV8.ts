// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { AppExtensionError, extensionError, type ExtensionResult, type V3AppExtension } from './appsExtensionsV3';
import { keys as checkKeys, type V4AppExtension } from './appsExtensionsV4';
import { json as checkJson, ownValue, prepareV5, type V5AppExtension } from './appsExtensionsV5';
import type { App, ImportResult } from './appsJson';
import { DOCKS_ID, clampDockRows, isDocks, makeDefaultDocks } from './dashboardsFile';
import { isRecord } from './isRecord';
import { safeUrl } from './safeUrl';
import { PIN_EDGES } from './types';
import type { Dashboard, DashboardCard, NewsCardState, PinEdge } from './types';

/**
 * A card's v8 state (ruling R1): the pinned edge and a News card's feeds.
 * Each is a strict key with its own validator; nothing else is read.
 */
type V8CardState = { pinned?: PinEdge; news?: NewsCardState };
type Overlay = V8CardState & { tab: string; index: number };
/**
 * App-level v8 state beside `cards`, as strict: `docks` marks the app that IS
 * the locked-widgets docks and carries the rows each edge reserves (v8
 * locked widgets, ruling R1 -- never the donor's plain `dock: true` /
 * `dockRows` fields). Its tabs are keyed by edge ("top", "bottom").
 */
type V8Docks = { rows: Record<PinEdge, number> };
export type V8AppExtension = { schemaVersion: 1; profile: 'v8'; base: V3AppExtension | V4AppExtension | V5AppExtension; cards: Overlay[]; docks?: V8Docks };
const CARD_STATE = ['pinned', 'news'] as const;

const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => checkKeys(value, allowed, path, 'v8');
const json = (value: unknown, path: string) => checkJson(value, path, 'v8');
/** The v8 keys of one card, each validated; `extra` names the carrier's own keys (a slot, a base). */
function v8CardState(value: Record<string, unknown>, path: string, extra: readonly string[] = []): V8CardState {
  keys(value, [...extra, ...CARD_STATE], path);
  const out: V8CardState = {};
  if (value.pinned !== undefined) {
    if (!(PIN_EDGES as readonly unknown[]).includes(value.pinned)) extensionError(path, 'Invalid pinned edge.');
    out.pinned = value.pinned as PinEdge;
  }
  if (value.news !== undefined) out.news = newsState(value.news, `${path}.news`);
  return out;
}
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
/**
 * A News card's state, strictly: feeds of { url, name, tab } strings with an
 * http(s) url -- the same rule the feed manager and rss-agg.json apply --
 * and optional highlight and tab-order string lists.
 */
function newsState(value: unknown, path: string): NewsCardState {
  if (!isRecord(value)) extensionError(path, 'Invalid News state.');
  keys(value, ['feeds', 'highlights', 'tabOrder'], path);
  if (!Array.isArray(value.feeds)) extensionError(path, 'Invalid News feeds.');
  const feeds = value.feeds.map((feed, i) => {
    if (!isRecord(feed)) extensionError(`${path}.feeds[${i}]`, 'Invalid News feed.');
    keys(feed, ['url', 'name', 'tab'], `${path}.feeds[${i}]`);
    if (typeof feed.url !== 'string' || safeUrl(feed.url) === null || typeof feed.name !== 'string' || typeof feed.tab !== 'string') extensionError(`${path}.feeds[${i}]`, 'Invalid News feed.');
    return { url: feed.url, name: feed.name, tab: feed.tab };
  });
  const out: NewsCardState = { feeds };
  for (const field of ['highlights', 'tabOrder'] as const) {
    if (value[field] === undefined) continue;
    if (!isStrings(value[field])) extensionError(path, `Invalid News ${field}.`);
    out[field] = [...value[field]];
  }
  return out;
}
/** A card's v8 state as it stands, or undefined when it has none. */
function cardV8State(card: DashboardCard): V8CardState | undefined {
  const state: V8CardState = {};
  if (card.pinned !== undefined) state.pinned = card.pinned;
  if (card.news !== undefined) state.news = structuredClone(card.news);
  return Object.keys(state).length > 0 ? state : undefined;
}
/** The card without its v8 state: what the v3-v5 profiles, which stay strict, are handed. */
export function withoutV8State(card: DashboardCard): DashboardCard {
  const copy = { ...card };
  for (const field of CARD_STATE) delete copy[field];
  return copy;
}
/**
 * The Workspace sync's v8 record (ruling R2): a server widget's
 * `extensions.bdobbV8`, a sibling of the v3 card state in `extensions.bdobb`.
 * A sibling and not a wrapper, so a v7 client -- whose strict v3 decoder reads
 * only `extensions.bdobb` and copies every other key back on upload -- syncs
 * normally and simply does not see the pin (user ruling 2026-10-12).
 */
export const V8_SYNC_KEY = 'bdobbV8';
type V8CardRecord = V8CardState & { schemaVersion: 1; profile: 'v8' };
/**
 * The sync's reading of a v8 record (user ruling 2026-10-12, Q3: degrade): its
 * v8 state, or undefined when it is invalid or written by a newer schema. An
 * unreadable record is skipped for that widget -- the plain v3 card still
 * syncs -- and carried back to the server unchanged (workspaceDashboards.ts).
 */
export function readV8CardRecord(value: unknown, path: string): V8CardState | undefined {
  try {
    if (!isRecord(value)) extensionError(path, 'Expected a v8 card record.');
    json(value, path);
    if (value.schemaVersion !== 1 || value.profile !== 'v8') extensionError(path, 'Expected schemaVersion 1 and profile v8.', 'UNSUPPORTED_EXTENSION');
    return v8CardState(value, path, ['schemaVersion', 'profile']);
  } catch (err) { if (err instanceof AppExtensionError) return undefined; throw err; }
}
/** The card's v8 record for the sync, or undefined when it has no v8 state. */
export function encodeV8CardRecord(card: DashboardCard, path: string): V8CardRecord | undefined {
  const state = cardV8State(card);
  return state ? { schemaVersion: 1, profile: 'v8', ...v8CardState(state as Record<string, unknown>, path) } : undefined;
}
export function needsV8(dashboard: Dashboard): boolean {
  return isDocks(dashboard) || dashboard.tabs.some(tab => tab.cards.some(card => cardV8State(card) !== undefined));
}
/**
 * The docks member, strictly: `rows` alone, both edges, integers. An integer
 * outside the band's range is clamped into it (clampDockRows), not refused --
 * the Help's promise, and the bands are still the docks (review C4).
 */
function docksMember(value: unknown, path: string): V8Docks {
  if (!isRecord(value)) extensionError(path, 'Invalid v8 docks.');
  keys(value, ['rows'], path);
  if (!isRecord(value.rows)) extensionError(`${path}.rows`, 'Invalid v8 docks rows.');
  keys(value.rows, PIN_EDGES, `${path}.rows`);
  const rows = {} as Record<PinEdge, number>;
  for (const edge of PIN_EDGES) {
    const n = value.rows[edge];
    if (!Number.isSafeInteger(n)) extensionError(`${path}.rows`, 'Invalid v8 docks rows.');
    rows[edge] = n as number;
  }
  return { rows: clampDockRows(rows) };
}
export function exportV8(dashboard: Dashboard, baseExport: (dashboard: Dashboard) => ExtensionResult<App>): ExtensionResult<App> {
  try {
    const overlays: Overlay[] = [];
    const clean: Dashboard = { ...dashboard, tabs: dashboard.tabs.map(tab => ({ ...tab, cards: tab.cards.map((card, index) => {
      const state = cardV8State(card);
      if (state) overlays.push({ tab: tab.id, index, ...v8CardState(state as Record<string, unknown>, '$.cards') });
      return withoutV8State(card);
    }) })) };
    const result = baseExport(clean); if (!result.ok) return result;
    const base = result.value.extensions!.bdobb as V3AppExtension | V4AppExtension | V5AppExtension;
    const docks = isDocks(dashboard) ? { docks: { rows: clampDockRows(dashboard.dockRows) } } : {};
    result.value.extensions = { bdobb: { schemaVersion: 1, profile: 'v8', base, cards: overlays, ...docks } };
    return result;
  } catch (error) { if (error instanceof AppExtensionError) return { ok: false, issue: error.issue }; throw error; }
}
/** The tab order a base profile declares, through a v4 or v5 wrapper. */
function baseTabOrder(base: Record<string, unknown>): unknown {
  if (base.profile === 'v3') return base.tabOrder;
  const inner = base.base;
  if (!isRecord(inner)) return undefined;
  if (base.profile === 'v5' && inner.profile === 'v4') return isRecord(inner.base) ? inner.base.tabOrder : undefined;
  return inner.tabOrder;
}
/**
 * What an apps.json import skipped of a dashboard's v8 data (user ruling
 * 2026-10-12, mirroring the sync's Q3 degrade): `all` when the envelope itself
 * could not be read (unknown fields, a newer schemaVersion), else the number
 * of cards whose v8 state (pin, News) could not be read.
 */
export type V8Skipped = { dashboardId: string; all: boolean; cards: number; docks?: true };
const ENVELOPE_KEYS = ['schemaVersion', 'profile', 'base', 'cards', 'docks'];
/** One overlay entry, validated against the app's tabs; throws AppExtensionError when it cannot be read. */
function overlay(entry: unknown, path: string, tabs: Record<string, unknown>, order: unknown[], seen: Set<string>): Overlay {
  if (!isRecord(entry)) extensionError(path, 'Invalid v8 card overlay.');
  const state = v8CardState(entry, path, ['tab', 'index']);
  const tab = typeof entry.tab === 'string' && Object.hasOwn(tabs, entry.tab) ? tabs[entry.tab] : undefined;
  const slot = JSON.stringify([entry.tab, entry.index]);
  if (!isRecord(tab) || !Array.isArray(tab.layout) || !order.includes(entry.tab) || !Number.isSafeInteger(entry.index) || (entry.index as number) < 0 || (entry.index as number) >= tab.layout.length || seen.has(slot)) extensionError(path, 'Invalid or duplicate v8 card slot.');
  seen.add(slot);
  return { tab: entry.tab as string, index: entry.index as number, ...state };
}
/**
 * Unwrap v8 only after every portable slot is valid; v5 and older keep their own decoders.
 *
 * The base profile, the tabs it orders and the JSON itself are still refused
 * when they cannot be read: they are the dashboard. What is v8's own -- the
 * envelope's fields and each card's overlay -- degrades instead (user ruling
 * 2026-10-12, as the sync's Q3): an envelope with unknown fields or a newer
 * schemaVersion imports without any v8 state, and a card overlay that cannot
 * be read (unknown field, bad pin, bad News state, a foreign or duplicate
 * slot) is skipped for that card alone. `restore` reports what was skipped.
 */
export function prepareV8(input: unknown): { plain: unknown; restore: (result: ImportResult) => ImportResult } {
  if (!Array.isArray(input)) return prepareV5(input);
  const pending: Array<{ app: number; tabOrder: string[]; cards: Overlay[]; docks?: V8Docks }> = [];
  const skips: Array<{ app: number; all: boolean; cards: number; docks?: true }> = [];
  const unwrapped = input.map((raw, app) => {
    const extensions = ownValue(raw, 'extensions');
    const envelope = ownValue(extensions, 'bdobb');
    if (!isRecord(raw) || !isRecord(envelope) || ownValue(envelope, 'profile') !== 'v8') return raw;
    json(raw, `$[${app}]`);
    if (!isRecord(envelope.base) || !['v3', 'v4', 'v5'].includes(envelope.base.profile as string)) extensionError('$.extensions.bdobb.base', 'Unsupported v8 base profile.', 'UNSUPPORTED_EXTENSION');
    if (!isRecord(raw.tabs)) extensionError('$.tabs', 'Invalid v8 tabs.');
    const order = baseTabOrder(envelope.base);
    if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) extensionError('$.extensions.bdobb.base', 'Invalid base tab order.');
    const plain = { ...raw, extensions: { ...(extensions as Record<string, unknown>), bdobb: envelope.base } };
    if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.cards) || Object.keys(envelope).some(key => !ENVELOPE_KEYS.includes(key))) {
      skips.push({ app, all: true, cards: 0 });
      return plain;
    }
    const seen = new Set<string>();
    const cards: Overlay[] = [];
    let unreadable = 0;
    envelope.cards.forEach((entry, i) => {
      try { cards.push(overlay(entry, `$.extensions.bdobb.cards[${i}]`, raw.tabs as Record<string, unknown>, order, seen)); }
      catch (error) { if (!(error instanceof AppExtensionError)) throw error; unreadable++; }
    });
    // The docks member: what cannot be read is skipped like the rest, and the
    // app then comes in as the ordinary dashboard it also is.
    let docks: V8Docks | undefined;
    let docksUnreadable = false;
    if (envelope.docks !== undefined) {
      try { docks = docksMember(envelope.docks, '$.extensions.bdobb.docks'); }
      catch (error) { if (!(error instanceof AppExtensionError)) throw error; docksUnreadable = true; }
    }
    if (unreadable > 0 || docksUnreadable) skips.push({ app, all: false, cards: unreadable, ...(docksUnreadable ? { docks: true as const } : {}) });
    pending.push({ app, tabOrder: order as string[], cards, ...(docks ? { docks } : {}) });
    return plain;
  });
  const base = prepareV5(unwrapped);
  return { plain: base.plain, restore: result => {
    const restored = base.restore(result);
    for (const batch of pending) for (const { tab, index, ...state } of batch.cards) {
      const card = restored.dashboards[batch.app]?.tabs[batch.tabOrder.indexOf(tab)]?.cards[index];
      if (!card) extensionError('$.cards', 'v8 card slot did not import.');
      Object.assign(card, state);
    }
    const v8Skipped = skips.flatMap(({ app, ...skip }) => {
      const dashboard = restored.dashboards[app];
      return dashboard ? [{ dashboardId: dashboard.id, ...skip }] : [];
    });
    // An app marked as the docks becomes THE docks, never a rail dashboard:
    // its tabs (keyed by edge) map onto the two bands, and the rows come from
    // the member. An empty one is not a docks at all (donor f5f4664a): it
    // neither replaces the docks nor prompts. The first docks wins; another
    // is dropped too.
    let docks: Dashboard | undefined;
    const docksApps = new Set<number>();
    for (const batch of pending) {
      if (!batch.docks) continue;
      docksApps.add(batch.app);
      const source = restored.dashboards[batch.app];
      if (!source || docks) continue;
      const base = makeDefaultDocks();
      const byEdge = new Map(source.tabs.map((tab, i) => [batch.tabOrder[i], tab]));
      const tabs = base.tabs.map(edgeTab => ({ ...edgeTab, cards: byEdge.get(edgeTab.id)?.cards ?? [] }));
      if (tabs.every(tab => tab.cards.length === 0)) continue;
      docks = { ...source, id: DOCKS_ID, name: base.name, hidden: true, tabs, dockRows: batch.docks.rows };
    }
    const dashboards = restored.dashboards.filter((_, i) => !docksApps.has(i));
    const out: ImportResult = { ...restored, dashboards, ...(docks ? { docks } : {}) };
    return v8Skipped.length > 0 ? { ...out, v8Skipped } : out;
  } };
}
