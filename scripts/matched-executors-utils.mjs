// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export function equivalent(actual, expected, path = '', toleratedColumns = new Set(), schema = 'none', trail = []) {
 if(Object.is(actual,expected))return;
 const index=value=>/^\d+$/.test(value??'');
 const baseline=schema==='baseline'&&((trail.length===4&&trail[0]==='rows'&&index(trail[1])&&trail[2]==='values')||(trail.length===3&&trail[0]==='totals'&&trail[1]==='values'));
 const snapshot=schema==='snapshots'&&index(trail[0])&&((trail.length===6&&trail[1]==='exported'&&trail[2]==='rows'&&index(trail[3])&&trail[4]==='values')||(trail.length===7&&trail[1]==='block'&&trail[2]==='rows'&&trail[3]==='rows'&&index(trail[4])&&trail[5]==='values')||(trail.length===5&&trail[1]==='block'&&trail[2]==='totals'&&trail[3]==='values'));
 const columns=toleratedColumns instanceof Map?toleratedColumns.get(Number(trail[0])):toleratedColumns;
 if(typeof actual==='number'&&typeof expected==='number'&&actual!==0&&expected!==0&&(baseline||snapshot)&&columns?.has(trail.at(-1))&&Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=Math.max(1e-12,1e-12*Math.max(Math.abs(actual),Math.abs(expected))))return;
 if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){
  if(Array.isArray(actual)!==Array.isArray(expected))throw Error(`Parity ${path}: array mismatch`);
  const a=Object.keys(actual).sort(),e=Object.keys(expected).sort();
  if(JSON.stringify(a)!==JSON.stringify(e))throw Error(`Parity ${path}: keys ${a} != ${e}`);
  for(const key of e)equivalent(actual[key],expected[key],`${path}.${key}`,toleratedColumns,schema,[...trail,key]);
  return;
 }
 throw Error(`Parity ${path}: ${String(actual)} != ${String(expected)}`);
}
export function summarize(values){const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return {median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,p95:sorted[Math.ceil(n*.95)-1],observations:values};}
export const engineOrder = iteration => iteration%2?['rust','typescript']:['typescript','rust'];

export function toleratedComputedColumns(definition,columns){
 const formulas=definition.analytical?.formulas??[];
 const aggregated=!!definition.analytical||definition.table?.pivot?.enabled===true;
 const ratios=new Set(formulas.filter(f=>f.scope==='aggregate'&&f.ast?.kind==='binary'&&f.ast.operator==='/').map(f=>f.id));
 return new Set(columns.filter(c=>(aggregated&&c.aggregation==='mean')||(ratios.has(c.metadata?.formulaId)&&c.analytical?.scope==='aggregate')).map(c=>c.id));
}
