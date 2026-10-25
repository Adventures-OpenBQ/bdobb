// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { captureBaseline, compareOracle, encodeOracleValue, decodeOracleValue, oracleCases, type OracleCase, type OracleResult } from './oracle';

const fixture = (name: string) => oracleCases.find(c => c.name === name)!;
const capture = (name: string) => captureBaseline(fixture(name));

describe('reviewed Pivot baseline oracle', () => {
  // Catches paging over loaded rows and losing group identity when blocks arrive backwards.
  it('page_size_invariant', () => {
    for (const c of oracleCases) {
      const r = captureBaseline(c);
      if (r.error) continue;
      expect(r.deliveries.map(d => d.size)).toEqual([1, 2, 50]);
      expect(r.deliveries[1].tree).toEqual(r.deliveries[0].tree);
      expect(r.deliveries[2].tree).toEqual(r.deliveries[0].tree);
    }
    expect(capture('raw').deliveries[0].tree.rows.map(row => row.id)).toEqual(['r0', 'r1', 'r2']);
  });

  // Catches summing displayed ratios instead of evaluating their union of source identities.
  it('ratio_total_uses_source_scope', () => {
    const r = capture('ratio-source-scope');
    expect(r.chart!.rows.map(row => row.values.ratio)).toEqual([2, 0.5]);
    expect(r.totals!.values.ratio).toBe(1);
    expect(r.totals!.values.ratio).not.toBe(2.5);
  });

  // Catches JSON blank/nonfinite coercion, bigint truncation and omitted-property insertion.
  it('typed_blank_roundtrip', () => {
    const c = fixture('typed-blanks');
    const decoded = decodeOracleValue(JSON.parse(JSON.stringify(encodeOracleValue(c)))) as OracleCase;
    expect(decoded.dataset.rows.map(row => row.values.dimension)).toEqual([undefined, undefined, null, '', false, 0, '0', 9007199254740993n, NaN, Infinity, -Infinity, -0]);
    expect(Object.hasOwn(decoded.dataset.rows[0].values, 'dimension')).toBe(false);
    expect(Object.hasOwn(decoded.dataset.rows[1].values, 'dimension')).toBe(true);
    expect(compareOracle(captureBaseline(decoded), captureBaseline(c))).toEqual([]);
    expect(captureBaseline(c).ready!.columns.map(column => column.splitPath?.[0].memberKey)).toContain('["bigint","9007199254740993"]');
    expect(encodeOracleValue({ a: undefined, b: null, c: true, d: [NaN, Infinity, -Infinity, -0], e: 9007199254740993n })).toEqual({tag:'record',value:[['a',{tag:'missing'}],['b',{tag:'null'}],['c',{tag:'bool',value:true}],['d',{tag:'array',value:[{tag:'f64',value:'NaN'},{tag:'f64',value:'Infinity'},{tag:'f64',value:'-Infinity'},{tag:'f64',value:'-0'}]}],['e',{tag:'bigint-string',value:'9007199254740993'}]]});
  });

  // Catches unstable first/last tie order and counting missing values as numeric zero.
  it('same_date_tie_is_stable', () => {
    for (const name of ['legacy-all-operators', 'analytical-all-operators']) {
      expect(capture(name).totals!.values).toMatchObject({sum:42,min:10,max:20,mean:14,median:12,count:3,uniqueCount:3,first:10,last:20});
    }
  });

  // Catches deduplicating source rows merely because they share a source ID.
  it('duplicate_identity_matches_baseline', () => {
    const r = capture('duplicate-identity');
    expect(r.deliveries[0].tree.rows.map(row => [row.id, row.values.revenue])).toEqual([['duplicate',10],['duplicate',20],['other',90]]);
    expect(r.chart!.rows.map(row => row.values.revenue)).toEqual([10,20]);
    expect(r.selection!.eligibleCount).toBe(3);
    expect(r.selection!.selectedCount).toBe(1);
    expect(r.linked!.rows.map(row => row.values.revenue)).toEqual([10,20]);
    expect(r.export!.rows.map(row => row.values.revenue)).toEqual([10,20,90]);
  });

  // Catches collapsing known-excluded, absent, absent-context and missing-input diagnostics.
  it('member_errors_remain_distinct', () => {
    expect(capture('member-missing').totals!.cellErrors!.budget.code).toBe('missing-member');
    expect(capture('excluded-budget').totals!.cellErrors!.budget.code).toBe('excluded-member');
    expect(capture('member-no-counterpart').chart!.rows[0].cellErrors!.budget.code).toBe('no-counterpart');
    expect(capture('missing-input').totals!.cellErrors!.last.code).toBe('missing-input');
  });

  // Catches an unchosen aggregation surfacing as #ERROR instead of a blank cell.
  it('unset_measure_renders_blank', () => {
    const r = capture('unset-measure-blank');
    expect(r.totals!.values.unset).toBeNull();
    expect(r.totals!.cellErrors?.unset).toBeUndefined();
    expect(r.chart!.rows.map(row => row.values.unset)).toEqual([null, null]);
    expect(r.chart!.rows.some(row => row.cellErrors?.unset)).toBe(false);
  });

  it('preserves runtime group evidence, authoring bindings and linked/export scope through ordered operations', () => {
    const r = capture('runtime-authoring-linked');
    const op = (kind: string) => r.operations.find(o => o.kind === kind)!.value as Record<string, unknown>;
    expect(op('memberDomain')).toMatchObject({total:2,classificationComplete:true,rows:[{label:'A',observedCount:2,eligibleCount:2},{label:'B',observedCount:1,eligibleCount:1}]});
    expect(op('bindFormula')).toMatchObject({ast:{kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'revenue'}]},resolvedOperators:['sum'],bindingDiagnostics:[]});
    expect(op('apply')).toMatchObject({inspection:{paramMatches:[{source:'group',groupId:'region-group',matchedKeys:['["string","A"]'],unmatched:['missing'],status:'resolved'}]}});
    expect(op('preview')).toMatchObject({total:2});
    expect(op('linked')).toMatchObject({chart:{rows:[{id:'r0',values:{revenue:10}}]}});
    expect(r.linked!.rows.map(row => row.id)).toEqual(['r0']);
    expect(r.export!.rows.map(row => row.id)).toEqual(['r0','r1']);
  });

  it('retains reversed delivery envelopes and bounded linked/export batches', () => {
    const r = capture('raw');
    expect(r.deliveries[1].blocks.map(block => block.offset)).toEqual([2,0]);
    expect(r.linked!.batches.map(batch => ({sequence:batch.sequence,final:batch.final,ids:batch.rows.map(row=>row.id)}))).toEqual([{sequence:0,final:false,ids:['r0','r1']},{sequence:1,final:true,ids:['r2']}]);
    expect(r.export!.batches.map(batch=>batch.rows.length)).toEqual([2,1]);
  });

  it('retains source dependency order and missing analytical split cells', () => {
    const r = capture('analytical-source-split');
    expect(r.totals!.values).toEqual({'["string","0"]\u001ftotal':21,'["string","1"]\u001ftotal':41,'["string","2"]\u001ftotal':181});
    expect(r.chart!.rows.map(row=>row.values)).toEqual([
      {'\u001egroup':'A','["string","0"]\u001ftotal':21,'["string","1"]\u001ftotal':41},
      {'\u001egroup':'B','["string","2"]\u001ftotal':181},
    ]);
    expect(r.ready!.columns.slice(1).map(col=>col.splitPath![0].memberKey)).toEqual(['["string","0"]','["string","1"]','["string","2"]']);
  });

  it('retains legacy saved bucket definitions and invalid authoring diagnostics', () => {
    const bucket = capture('legacy-saved-bucket');
    expect(bucket.ready!.inspection.definition.table.pivot!.buckets).toEqual({date:'year'});
    expect(bucket.chart!.rows[0].groupPath![0].memberKey).toBe('["string","2026"]');
    expect(bucket.totals!.values.revenue).toBe(120);
    const r = capture('authoring-refusal');
    expect(r.operations[0].value).toMatchObject({bindingDiagnostics:[{code:'scope'}],resolvedOperators:[]});
    expect(r.operations[1].value).toMatchObject({bindingDiagnostics:[{code:'missing-reference'}],resolvedOperators:[]});
    expect(r.chart!.rows.map(row=>row.id)).toEqual(['r0','r1','r2']);
  });

  it('preserves company fiscal evidence and Statement mixed-unit refusal', () => {
    const r = capture('mixed-fiscal-calendars');
    const bounds = r.inspection!.find(page=>page.collection==='periodBounds')!.rows;
    expect(bounds).toMatchObject([
      {companyKey:'Actual',start:'2024-07-01',end:'2025-06-30',source:'file',period:'FY'},
      {companyKey:'Budget',start:'2025-01-01',end:'2025-12-31',source:'file',period:'FY'},
    ]);
    const statement = capture('statement-fiscal-warning');
    expect(statement.inspection!.find(page=>page.collection==='periodBounds')!.rows).toMatchObject([
      {companyKey:'ACME',start:'2025-01-01',end:'2025-12-31',source:'bound period fields'},
      {companyKey:'OTHER',start:'2024-07-01',end:'2025-06-30',source:'bound period fields'},
    ]);
    expect(capture('statement-mixed-units').chart!.rows.flatMap(row=>Object.values(row.cellErrors??{})).map(error=>error.code)).toEqual(['scope','scope','scope']);
  });

  it('uses promoted Page runtime selection while preserving identity witnesses and locale numeric order', () => {
    const page = capture('runtime-page-viewer');
    expect(page.totals!.values).toMatchObject({revenueSum:1069,costSum:60,budget:1069});
    expect(page.ready!.inspection.paramMatches).toMatchObject([{key:'pivot:page',matchedKeys:['["string","Budget"]'],unmatched:[],classificationComplete:true}]);
    expect(capture('identity-witness').operations[0].value).toMatchObject({identities:[{id:'r0',state:'present'},{id:'r2',state:'present'},{id:'absent',state:'absent'}]});
    expect(capture('locale-numeric-order').chart!.rows.map(row=>row.values.team)).toEqual(['Item1','item2','item10']);
  });

  it('compares exact identities, omissions and diagnostic evidence without losing unusual numbers', () => {
    const expected = capture('raw');
    expect(compareOracle(structuredClone(expected), expected)).toEqual([]);
    const changed = structuredClone(expected);
    changed.chart!.rows[0].id = 'wrong';
    delete changed.chart!.rows[0].values.revenue;
    expect(compareOracle(changed, expected).map(d => d.path)).toEqual(['$.chart.rows[0].id','$.chart.rows[0].values.revenue']);
    expect(compareOracle({x:NaN,y:-0} as unknown as OracleResult,{x:NaN,y:0} as unknown as OracleResult).map(d=>d.path)).toEqual(['$.y']);
  });

  it('refuses to claim parity under a locale the baseline did not evaluate', () => {
    expect(() => captureBaseline({...fixture('raw'),locale:'invalid-baseline-locale'})).toThrow(/locale/);
  });

  // Fixed reviewed outputs are loaded only; parity never writes/regenerates fixtures.
  const reviewed = import.meta.glob('../../../test/fixtures/rust-pivot/*.json', { eager: true, import: 'default' });
  it('has a frozen result for every representative case', () => {
    expect(Object.keys(reviewed)).toHaveLength(oracleCases.length);
  });
  for (const [path, wire] of Object.entries(reviewed)) {
    it(`matches frozen fixture ${path}`, () => {
      const stored = decodeOracleValue(wire) as {formatVersion:number;baselineRevision:string;case:OracleCase;result:OracleResult};
      expect(stored.formatVersion).toBe(1);
      expect(stored.baselineRevision).toBe('74cc3f6c4c718cd76044722b954a7bc0761c8866');
      expect(stored.case).toEqual(fixture(stored.case.name));
      expect(compareOracle(captureBaseline(stored.case), stored.result)).toEqual([]);
    });
  }
});
