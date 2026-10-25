// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { decodeWire, type WireValue } from './wireCodec';
const missing = (value: unknown) => value === undefined || value === null || value === '';
/** One session's explicitly negotiated collator. Native consumers must supply an equivalent adapter. */
export class LocaleOrderBridge {
  readonly locale: string;
  private readonly collator: Intl.Collator;
  private readonly recipeCollator: Intl.Collator;
  private readonly recipeCache = new Map<string, number>();
  private retainedBytes = 0;
  private readonly cache = new Map<string, number>();
  constructor(locale: string, private readonly limit = 4096, private readonly byteLimit = Number.MAX_SAFE_INTEGER) {
    if (!locale || Intl.Collator.supportedLocalesOf([locale]).length !== 1) throw new Error(`Unsupported Pivot locale: ${locale}`);
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 0) throw new Error('Invalid collation byte limit');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid collation cache limit');
    this.collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    this.locale = this.collator.resolvedOptions().locale;
    this.recipeCollator = new Intl.Collator(locale);
  }
  /** Recipe witnesses use baseline localeCompare defaults, never Pivot base/numeric options. */
  compareRecipe(a: string,b: string): number {
    if(a===b)return 0;
    const key=JSON.stringify([a,b]),reverse=JSON.stringify([b,a]);
    const cached=this.recipeCache.get(key),reversed=this.recipeCache.get(reverse);
    if(cached!==undefined)return cached;
    if(reversed!==undefined)return -reversed||0;
    const result=Math.sign(this.recipeCollator.compare(a,b))||0;
    if(this.recipeCache.size>=this.limit)this.remove(this.recipeCache,this.recipeCache.keys().next().value!);
    this.remember(this.recipeCache,key,result);return result;
  }
  private remember(cache:Map<string,number>,key:string,value:number):void {
    const bytes=128+key.length*2;
    if(bytes>this.byteLimit)return;
    while(this.cacheBytes+bytes>this.byteLimit){const oldest=this.cache.keys().next().value;if(oldest!==undefined)this.remove(this.cache,oldest);else {const recipe=this.recipeCache.keys().next().value;if(recipe===undefined)break;this.remove(this.recipeCache,recipe);}}
    cache.set(key,value);this.retainedBytes+=bytes;
  }
  private remove(cache:Map<string,number>,key:string):void {if(cache.delete(key))this.retainedBytes-=128+key.length*2;}
  get cacheBytes():number {return this.retainedBytes;}

  get recipeCacheSize(): number { return this.recipeCache.size; }
  /** Scalar min/max consumers treat unordered comparisons as ties. */
  compare(a: WireValue, b: WireValue): number { return Math.sign(this.compareRaw(a,b)) || 0; }
  /** Raw numeric NaN must terminate multi-key sorting before a later key. */
  compareRaw(a: WireValue, b: WireValue): number { return this.compareDecoded(decodeWire(a),decodeWire(b)); }
  private compareDecoded(left: unknown, right: unknown): number {
    const am = missing(left), bm = missing(right);
    if (am || bm) return am === bm ? 0 : am ? 1 : -1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    const x = String(left), y = String(right);
    if (x === y) return 0;
    const key = JSON.stringify([x,y]), reverse = JSON.stringify([y,x]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const reversed = this.cache.get(reverse);
    if (reversed !== undefined) return -reversed || 0;
    const result = Math.sign(this.collator.compare(x,y)) || 0;
    if (this.cache.size >= this.limit) this.remove(this.cache,this.cache.keys().next().value!);
    this.remember(this.cache,key,result);
    return result;
  }
  /** Current JS engine's full permutation over already evaluated, validated keys. */
  sortPermutation(rows: ReadonlyArray<ReadonlyArray<WireValue>>, descending: readonly boolean[]): number[] {
    if (descending.some(value=>typeof value!=='boolean') || rows.some(row=>row.length!==descending.length)) throw new Error('Invalid Pivot sort key matrix');
    const values=rows.map(row=>row.map(decodeWire));
    return rows.map((_,index)=>index).sort((a,b)=>{
      for (let key=0;key<descending.length;key++) {
        const left=values[a][key],right=values[b][key];
        const raw=this.compareDecoded(left,right);
        const comparison=descending[key] && !missing(left) && !missing(right) ? -raw : raw;
        if (comparison!==0) return comparison;
      }
      return 0;
    });
  }
  /** Batch known pairs before a Wasm stage; cache also bounds repeat callback work. */
  prepare(pairs: ReadonlyArray<readonly [WireValue, WireValue]>): void {
    for (const [a,b] of pairs) this.compare(a,b);
  }
  get cacheSize(): number { return this.cache.size; }
}
