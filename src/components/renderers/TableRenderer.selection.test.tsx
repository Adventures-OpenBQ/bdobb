// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TableRenderer, type ExecutionTableView } from './TableRenderer';
import { calculateView } from '../../lib/tableExecution/engine';
import { createResultStore } from '../../lib/tableExecution/resultStore';
import { input, revision, definition } from '../../lib/tableExecution/fixtures';
import type { SelectionSpec, TableDefinition } from '../../lib/tableExecution/types';
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 5) }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
function Harness({ def = { table: {}, search: '' }, groupPath = [] }: { def?: TableDefinition; groupPath?: string[] }) {
  const [selection, setSelection] = useState<SelectionSpec>({ kind: 'none' });
  const store = createResultStore(calculateView(input, def, selection), revision);
  const block = store.rows('one', revision, { groupPath, offset: 0, limit: 1 });
  const execution: ExecutionTableView = {
    columns: [{ field: 'revenue', header: 'Revenue', cellDataType: 'number', renderFn: [], colorRules: [], hiddenByDefault: false }],
    count: 1, rowIds: block.rows.map(r => r.id), slot: () => ({ rowId: block.rows[0]?.id, groupPath, offset: 0 }), requestRange: () => {}, toggle: () => {}, totals: { revenue: 40 },
    selection: block.selection, onSelection: action => setSelection(store.selection('action', revision, action, []).selection),
  };
  return <><TableRenderer data={block.rows.map(r => r.values)} execution={execution} /><output data-testid="selection">{JSON.stringify(selection)}</output></>;
}
it('header selects the complete view with one loaded row; unchecking adds exclusion and Clear restores default', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
  expect(screen.getByTestId('selection')).toHaveTextContent('{"kind":"allMatching","excludedIds":[]}');
  expect(screen.getByText('3 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
  expect(screen.getByTestId('selection')).toHaveTextContent('{"kind":"allMatching","excludedIds":["r0"]}');
  expect(screen.getByText('2 selected')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBePartiallyChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByTestId('selection')).toHaveTextContent('{"kind":"none"}');
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});
it('explicitly unchecking the last row remains intentionally empty', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
  expect(screen.getByTestId('selection')).toHaveTextContent('{"kind":"explicit","ids":[]}');
});
it('raw leaves under pivot groups and pinned totals have no selectable checkbox', () => {
  const view = calculateView(input, definition, { kind: 'none' });
  render(<Harness def={definition} groupPath={view.groups[0].children[0].path} />);
  expect(screen.queryByRole('checkbox', { name: 'Select row 1' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});
