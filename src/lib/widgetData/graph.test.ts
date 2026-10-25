// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { validateGraph } from './graph';
it('rejects cycles and foreign sources before execution', () => {
  expect(() => validateGraph([{ id: 'a', source: 'b' }, { id: 'b', source: 'a' }])).toThrow('cycle');
  expect(() => validateGraph([{ id: 'a', source: 'foreign' }])).toThrow('foreign');
  expect(validateGraph([{ id: 'child', source: 'root' }, { id: 'root' }])).toEqual(['root', 'child']);
});
it('rejects a chart as a table producer', () => {
  expect(() => validateGraph([{ id: 'chart', producer: false }, { id: 'table', source: 'chart' }])).toThrow('table source');
});
