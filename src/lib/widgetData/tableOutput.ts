// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CalculatedView, SelectionSpec } from '../tableExecution/types';
import type { DatasetRow } from './types';
export function eligiblePresentedRows(view: CalculatedView): DatasetRow[] { return view.selectionEligibleRows; }
/** hierarchy maps an ancestor ID to all descendant IDs; select can specify the desired filtered checkbox state. */
export function toggleGroupSelection(selection: SelectionSpec, target: DatasetRow, hierarchy: ReadonlyMap<string, string[]>, select?: boolean): SelectionSpec {
  if (selection.kind === 'allMatching') {
    const excluded = new Set(selection.excludedIds);
    const ids = [target.id, ...(hierarchy.get(target.id) ?? [])];
    const ancestors = [...excluded].filter(id => hierarchy.get(id)?.includes(target.id));
    if (select ?? (ids.some(id => excluded.has(id)) || ancestors.length > 0)) {
      const targetBranch = new Set(ids);
      // Replace covering ancestor exclusions with the branches outside the
      // reselected subtree, including siblings that were never enumerated.
      for (const ancestor of ancestors) {
        excluded.delete(ancestor);
        for (const descendant of hierarchy.get(ancestor) ?? []) {
          if (!targetBranch.has(descendant) && !hierarchy.get(descendant)?.includes(target.id)) {
            excluded.add(descendant);
          }
        }
      }
      for (const id of ids) excluded.delete(id);
    } else {
      for (const id of ids) excluded.add(id);
    }
    return { kind: 'allMatching', excludedIds: [...excluded] };
  }
  const ids = new Set(selection.kind === 'explicit' ? selection.ids : []);
  if (ids.has(target.id))
    ids.delete(target.id);
  else {
    for (const id of ids)
      if (hierarchy.get(id)?.includes(target.id) || hierarchy.get(target.id)?.includes(id))
        ids.delete(id);
    ids.add(target.id);
  }
  return { kind: 'explicit', ids: [...ids] };
}
