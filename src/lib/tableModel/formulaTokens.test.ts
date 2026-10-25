// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { memberToken, tokenFor } from './formulaTokens';
import { parseFormula } from './formulaSyntax';
import type { ModelSymbols } from './formulaBinding';
const symbols:ModelSymbols={fields:[{id:'revenue',name:'Revenue'},{id:'net',name:'Net income'}],formulas:[],measures:[{id:'total',name:'Revenue — Total',sourceFieldId:'revenue',aggregation:'sum',aliases:['Revenue']}],categories:[]};
it('offers source spelling rather than rendered measure labels and explicit functions for duplicate measures',()=>{
 expect(tokenFor(symbols.fields[0],symbols)).toBe('Revenue');
 expect(tokenFor(symbols.fields[1],symbols)).toBe('[Net income]');
 expect(tokenFor(symbols.measures[0],symbols)).toBe('Revenue');
 const duplicate={...symbols,measures:[...symbols.measures,{id:'average',name:'Revenue — Average',sourceFieldId:'revenue',aggregation:'mean' as const}]};
 expect(tokenFor(duplicate.measures[0],duplicate)).toBe('SUM(Revenue)');
 expect(tokenFor(duplicate.measures[1],duplicate)).toBe('MEAN(Revenue)');
});
it.each(['true','false','null'])('quotes reserved name %s without interpreting it as a literal or call',name=>{
 const text=tokenFor({id:'x',name},symbols);expect(text).toBe(`[${name}]`);expect(parseFormula(text).ast).toEqual({kind:'name',name});
});
it('uses Unicode grammar and rejects closing brackets',()=>{
 expect(tokenFor({id:'x',name:'É収益'},symbols)).toBe('É収益');
 expect(()=>tokenFor({id:'x',name:'bad]name'},symbols)).toThrow('closing bracket');
 expect(()=>memberToken({name:'bad]category'},{value:'Actual'})).toThrow('closing bracket');
});
it.each([
 ['Scenario','Actual','[Scenario=Actual]'],['Report year',2024,'[[Report year]=2024]'],['条件','予算','[条件=予算]'],['true','false','[[true]="false"]'],['Scenario','1','[Scenario="1"]'],['Scenario','Prior Budget','[Scenario="Prior Budget"]'],['Scenario',true,'[Scenario=true]'],['Scenario',null,'[Scenario=null]'],['Scenario','a"b','[Scenario="a\\"b"]'],
] as const)('round-trips typed selector %s=%s', (name,value,expected)=>{
 const text=memberToken({name},{value});expect(text).toBe(expected);expect(parseFormula('Revenue'+text).ast).toEqual({kind:'member',value:{kind:'name',name:'Revenue'},selectors:[{categoryName:name,value}]});
});

it.each(['SUM','IF'])('keeps a function-named plain reference %s in the parser grammar',name=>{
 const token=tokenFor({id:'function-name',name},symbols);expect(token).toBe(name);expect(parseFormula(token).ast).toEqual({kind:'name',name});
});

it.each([Infinity,-Infinity,NaN])('refuses a nonfinite member %s rather than serializing it as null',value=>{
 expect(()=>memberToken({name:'Scenario'},{value})).toThrow('finite');
});
