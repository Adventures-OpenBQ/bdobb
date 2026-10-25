// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { LocaleOrderBridge } from './orderingBridge';
import { encodeWire } from './wireCodec';
import { compareSorted } from '../../pivotTable';

describe('negotiated legacy locale ordering', () => {
  it('orders numeric text and preserves base accent ties', () => {
    const order = new LocaleOrderBridge('en-US');
    expect(order.locale).toBe('en-US');
    expect(order.compare(encodeWire('item2'), encodeWire('item10'))).toBe(-1);
    expect(order.compare(encodeWire('Éclair'), encodeWire('eclair'))).toBe(0);
  });
  it('matches baseline for mixed values, blanks, and nonfinite comparisons', () => {
    const order = new LocaleOrderBridge('en-US');
    const values = [undefined, null, '', false, 0, -0, '0', 10, 'item10', 'item2', 'Éclair', 'eclair', 9007199254740993n, NaN, Infinity, -Infinity, [1,null,2], {value:1}];
    for (const a of values) for (const b of values) {
      const expected = compareSorted(a,b,false);
      expect(order.compare(encodeWire(a),encodeWire(b))).toBe(Number.isNaN(expected) ? 0 : Math.sign(expected) || 0);
    }
  });
  it('refuses absent or unsupported locales instead of negotiating a fallback', () => {
    expect(() => new LocaleOrderBridge('')).toThrow(/locale/i);
    expect(() => new LocaleOrderBridge('zz-ZZ')).toThrow(/locale/i);
    expect(() => new LocaleOrderBridge('invalid-baseline-locale')).toThrow(/locale/i);
  });
  it('prepares and reuses text comparisons with a bounded cache', () => {
    const order = new LocaleOrderBridge('en-US', 2);
    order.prepare([[encodeWire('item2'),encodeWire('item10')]]);
    expect(order.compare(encodeWire('item2'),encodeWire('item10'))).toBe(-1);
    expect(order.compare(encodeWire('item10'),encodeWire('item2'))).toBe(1);
    order.compare(encodeWire('a'),encodeWire('b'));
    order.compare(encodeWire('c'),encodeWire('d'));
    expect(order.cacheSize).toBeLessThanOrEqual(2);
  });
  it('retains unordered comparisons and the runtime host sort permutation', () => {
    const order = new LocaleOrderBridge('en-US');
    expect(order.compareRaw(encodeWire(NaN), encodeWire(1))).toBeNaN();
    expect(order.compareRaw(encodeWire(Infinity), encodeWire(Infinity))).toBeNaN();
    const cases: unknown[][][] = [
      [[NaN,2],[1,1]], [[Infinity,2],[Infinity,1]], [[1,2],[1,1]],
      [...Array.from({length:31},(_,i)=>[62-i]),[NaN],...Array.from({length:32},(_,i)=>[31-i])],
      [[-10],['-3'],[-2],['-20'],[false]],
    ];
    for (const rows of cases) {
      const descending = rows[0].map(()=>false);
      const expected = rows.map((_,i)=>i).sort((a,b)=>{
        for (let key=0;key<descending.length;key++) {
          const c=compareSorted(rows[a][key],rows[b][key],descending[key]);
          if (c!==0) return c;
        }
        return 0;
      });
      expect(order.sortPermutation(rows.map(row=>row.map(encodeWire)),descending)).toEqual(expected);
    }
  });
});

it('recipe ordering preserves default accent/case and nonnumeric collation independently',()=>{
 const bridge=new LocaleOrderBridge('en-US',2),raw=new Intl.Collator('en-US');
 for(const [a,b]of [['item2','item10'],['e','é'],['a','A'],['é','z']])expect(bridge.compareRecipe(a,b)).toBe(Math.sign(raw.compare(a,b))||0);
 expect(bridge.recipeCacheSize).toBeLessThanOrEqual(2);
});
