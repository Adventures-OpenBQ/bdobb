// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type DrawerSection = 'statement'|'arrange'|'categories'|'measures'|'pages'|'formulas'|'checklists'|'resultFilters'|'inspect';
export type DrawerState = { open: boolean; active: DrawerSection; returnFocus: 'toolbar'|'table'|null };
export type DrawerAction = { kind: 'toggle'|'close'|'done'|'escape'|'outside'|'showTable' } | { kind: 'select'; section: DrawerSection };
export const DRAWER_SECTIONS: readonly DrawerSection[] = ['arrange', 'categories', 'measures', 'pages', 'formulas', 'checklists', 'resultFilters', 'inspect', 'statement'];
export const INITIAL_DRAWER_STATE: DrawerState = Object.freeze({ open: false, active: 'arrange', returnFocus: null });
export function drawerReducer(s: DrawerState, a: DrawerAction, opts: { dismissOnOutside: boolean }): DrawerState {
  let next: DrawerState;
  if (a.kind === 'select') next = { open: true, active: a.section, returnFocus: null };
  else if (a.kind === 'toggle' && !s.open) next = { open: true, active: 'arrange', returnFocus: null };
  else if (!s.open || (a.kind === 'outside' && !opts.dismissOnOutside)) return s;
  else if (a.kind === 'escape' && s.active !== 'arrange') next = { open: true, active: 'arrange', returnFocus: null };
  else next = { ...s, open: false, returnFocus: a.kind === 'outside' || a.kind === 'showTable' ? 'table' : 'toolbar' };
  return next.open === s.open && next.active === s.active && next.returnFocus === s.returnFocus ? s : next;
}
