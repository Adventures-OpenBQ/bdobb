// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';

/** The timing and heap probes must use the same distinct-group fixtures. */
export function addCardinalityCases(cases){
 for(const count of [500,2000]){
  const c=structuredClone(cases.formula),m=c.definition.analytical;
  m.formulas=m.formulas.filter(f=>f.id==='ratio0');m.layout.values=['ratio0'];
  const category=m.categories.find(c=>c.id===m.layout.rows[0]);
  assert(category?.sourceFieldId,'Cardinality fixture needs a source category');
  c.dataset.rows=Array.from({length:count},(_,i)=>{const row=structuredClone(cases.formula.dataset.rows[i%cases.formula.dataset.rows.length]);row.id=`cardinality-${i}`;row.values[category.sourceFieldId]=`group-${i}`;return row;});
  cases[`groups${count}`]=c;
 }
}
