// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { drawerReducer, INITIAL_DRAWER_STATE, type DrawerAction, type DrawerState } from '../components/renderers/pivot-drawer/drawerState';
type Entry = { state: DrawerState; dismissOnOutside: boolean };
// Transient only: header and renderer share these snapshots through useSyncExternalStore.
const dashboards = new Map<string, Map<string, Entry>>();
const listeners = new Map<string, Map<string, Set<() => void>>>();
function entry(dashboardId: string, widgetId: string): Entry {
  let dashboard = dashboards.get(dashboardId);
  if (!dashboard) { dashboard = new Map(); dashboards.set(dashboardId, dashboard); }
  let value = dashboard.get(widgetId);
  if (!value) { value = { state: INITIAL_DRAWER_STATE, dismissOnOutside: true }; dashboard.set(widgetId, value); }
  return value;
}
function emit(dashboardId: string, widgetId: string): void {
  for (const listener of [...(listeners.get(dashboardId)?.get(widgetId) ?? [])]) listener();
}
export function getDrawerState(dashboardId: string, widgetId: string): DrawerState {
  return dashboards.get(dashboardId)?.get(widgetId)?.state ?? INITIAL_DRAWER_STATE;
}
export function subscribeDrawer(dashboardId: string, widgetId: string, listener: () => void): () => void {
  let dashboard = listeners.get(dashboardId);
  if (!dashboard) { dashboard = new Map(); listeners.set(dashboardId, dashboard); }
  let keyListeners = dashboard.get(widgetId);
  if (!keyListeners) { keyListeners = new Set(); dashboard.set(widgetId, keyListeners); }
  keyListeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    keyListeners.delete(listener);
    if (!keyListeners.size) dashboard.delete(widgetId);
    if (!dashboard.size) listeners.delete(dashboardId);
  };
}
export function dispatchDrawer(dashboardId: string, widgetId: string, action: DrawerAction): void {
  const current = entry(dashboardId, widgetId);
  const next = drawerReducer(current.state, action, { dismissOnOutside: current.dismissOnOutside });
  if (next === current.state) return;
  current.state = next;
  emit(dashboardId, widgetId);
}
export function getDismissOnOutside(dashboardId: string, widgetId: string): boolean {
  return dashboards.get(dashboardId)?.get(widgetId)?.dismissOnOutside ?? true;
}
export function setDismissOnOutside(dashboardId: string, widgetId: string, value: boolean): void {
  const current = entry(dashboardId, widgetId);
  if (current.dismissOnOutside === value) return;
  current.dismissOnOutside = value;
  emit(dashboardId, widgetId);
}
export function clearDrawerDashboard(dashboardId: string): void {
  const dashboard = dashboards.get(dashboardId);
  if (!dashboard) return;
  dashboards.delete(dashboardId);
  for (const [widgetId, value] of dashboard) {
    if (value.state !== INITIAL_DRAWER_STATE || !value.dismissOnOutside) emit(dashboardId, widgetId);
  }
}
