// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { beginSubset, appendSubset, commitSubset } from './subsetTransfer';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { input, revision } from './fixtures';
it('commits complete metadata and rejects partial, reordered and foreign revision input', () => {
  const batches = [...createResultStore(calculateView(input, { table: {}, search: '' }, { kind: 'none' }), revision).presented('req', revision, 'transfer', 2)];
  const pending = beginSubset('transfer', revision);
  expect(() => commitSubset(pending)).toThrow();
  expect(() => appendSubset(pending, batches[1])).toThrow();
  expect(() => appendSubset(pending, { ...batches[0], revision: { ...revision, output: 2 } })).toThrow();
  appendSubset(pending, batches[0]);
  expect(() => commitSubset(pending)).toThrow();
  appendSubset(pending, batches[1]);
  const result = commitSubset(pending);
  expect(result.rows.map(r => r.id)).toEqual(['r0', 'r1', 'r2']);
  expect(result.provenance.lineage).toEqual([{ widgetId: 'source', resultRevision: 1, outputRevision: 1 }]);
  expect(result.completeness).toEqual(input.completeness);
  expect(result.freshness).toEqual(input.freshness);
});
it('rejects mismatched request identity within one transfer', () => {
 const batches=[...createResultStore(calculateView(input,{table:{},search:''},{kind:'none'}),revision).presented('request',revision,'transfer',2)];
 const pending=beginSubset('transfer',revision);appendSubset(pending,batches[0]);
 expect(()=>appendSubset(pending,{...batches[1],requestId:'different'})).toThrow();
});
