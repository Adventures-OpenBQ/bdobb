// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { dataIds, moveValue } from './layoutValues';
import type { TableModelV1 } from './types';
const model=():TableModelV1=>({schemaVersion: 1, params: { promotePage: true, filters: [] },enabled:true,categories:[],measures:[{id:'rev',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}});
it('projects mixed authored order without cleaning raw intent or placing unlisted formulas', () => {
 const raw=model(); raw.layout.values=['b','rev2','unknown','rev','b'];
 raw.measures.push({id:'rev2',sourceFieldId:'revenue',aggregation:'sum'},{id:'rev3',sourceFieldId:'revenue',aggregation:'mean'});
 raw.formulas=[{id:'b',name:'B',scope:'aggregate',expression:'',ast:{kind:'literal',value:1}},{id:'hidden',name:'Hidden',scope:'aggregate',expression:'',ast:{kind:'literal',value:2}}];
 expect(dataIds(raw)).toEqual(['b','rev2','rev','rev3']);
 expect(raw.layout.values).toEqual(['b','rev2','unknown','rev','b']);
 const next=moveValue(raw,'rev',-100);
 expect(dataIds(next)).toEqual(['rev','b','rev2','rev3']);
 expect(next.layout.values).toContain('unknown');
 expect(next.measures).toBe(raw.measures);
 expect(moveValue(raw,'unknown',0)).toBe(raw);
 expect(dataIds(moveValue(raw,'hidden',100))).toEqual(['b','rev2','rev','rev3','hidden']);
});
