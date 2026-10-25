// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ModelSymbols } from './formulaBinding';
const identifier = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const reserved = new Set(['true', 'false', 'null']);
const plain = (name: string) => identifier.test(name) && !reserved.has(name);
function nameToken(name: string): string {
  if (name.includes(']')) throw new Error('This name contains a closing bracket. Rename it before inserting.');
  return plain(name) ? name : `[${name}]`;
}
type Symbol = ModelSymbols['fields'][number] | ModelSymbols['formulas'][number] | ModelSymbols['measures'][number];
/** Canonical draft syntax, independent of rendered measure labels and stable saved IDs. */
export function tokenFor(symbol: Symbol, symbols: ModelSymbols): string {
  if (!('sourceFieldId' in symbol)) return nameToken(symbol.name);
  const source = symbols.fields.find(field => field.id === symbol.sourceFieldId) ?? symbols.formulas.find(formula => formula.id === symbol.sourceFieldId);
  const name = source?.name ?? symbol.aliases?.[0] ?? symbol.name;
  const token = nameToken(name);
  return symbols.measures.filter(measure => measure.sourceFieldId === symbol.sourceFieldId).length > 1 && symbol.aggregation
    ? `${symbol.aggregation.toUpperCase()}(${token})` : token;
}
/** Preserve scalar type: numeric-looking strings and reserved literals require JSON quotes. */
export function memberToken(category: { name: string }, member: { value: number | string | boolean | null }): string {
  if (typeof member.value === 'number' && !Number.isFinite(member.value)) throw new Error('Member values must be finite.');
  const value = typeof member.value === 'string' && plain(member.value) ? member.value : JSON.stringify(member.value);
  return `[${nameToken(category.name)}=${value}]`;
}
