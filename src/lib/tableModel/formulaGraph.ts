// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { bindFormula, type ModelSymbols } from './formulaBinding';
import { validateFormulaAst, type FormulaDiagnostic } from './formulaSyntax';
import type { FormulaAst, FormulaDef } from './types';
export type GraphEntry = { raw: unknown; value?: FormulaDef; diagnostics: FormulaDiagnostic[] };
export type GraphNode = { kind: 'formula' | 'measure' | 'category'; id: string; name: string };
export type FormulaCycle = { ids: string[]; names: string[]; nodes: GraphNode[] };
export type GraphResult = {
  entries: GraphEntry[];
  /** Valid independent formula IDs, dependencies first; blocked definitions are omitted. */
  order: string[];
  cycles: FormulaCycle[];
  blockedIds: string[];
  diagnostics: FormulaDiagnostic[];
  /** Without symbols this graph is NOT approved for execution. */
  externalValidation: 'complete' | 'not-performed';
};
const encoder = new TextEncoder();
const key = (kind: GraphNode['kind'], id: string) => JSON.stringify([kind, id]);

/** Inspect imports without parsing old display text or modifying committed definitions. */
export function validateFormulaGraph(definitions: readonly unknown[], symbols?: ModelSymbols, options: { boundMembers?: 'structural' } = {}): GraphResult {
  const result: GraphResult = { entries: [], order: [], cycles: [], blockedIds: [], diagnostics: [], externalValidation: symbols ? 'complete' : 'not-performed' };
  const headers = new Map<GraphEntry, Pick<FormulaDef, 'id' | 'name' | 'scope'>>();
  const issue = (entry: GraphEntry, diagnostic: FormulaDiagnostic) => {
    const enriched = { ...diagnostic, ...(headers.has(entry) ? { definitionId: headers.get(entry)!.id } : {}) };
    entry.diagnostics.push(enriched); result.diagnostics.push(enriched);
  };
  // A collection guard prevents sparse imports from turning into enormous loops.
  if (!Array.isArray(definitions) || definitions.length > 50_000 || Reflect.ownKeys(definitions).length !== definitions.length + 1) {
    result.diagnostics.push({ code: 'invalid-ast', message: 'Expected a bounded dense formula definition array (at most 50,000 entries).' });
    return result;
  }
  for (let i = 0; i < definitions.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(definitions, String(i));
    const entry: GraphEntry = { raw: descriptor && 'value' in descriptor ? descriptor.value : undefined, diagnostics: [] };
    result.entries.push(entry);
    const invalid = () => issue(entry, { code: 'invalid-ast', message: 'Invalid plain formula definition; original entry retained.' });
    const raw = entry.raw;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) { invalid(); continue; }
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !['id', 'name', 'scope', 'expression', 'ast', 'format'].includes(k) || !('value' in descriptors[k]))) { invalid(); continue; }
    const id = descriptors.id?.value; const name = descriptors.name?.value; const scope = descriptors.scope?.value;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || (scope !== 'source' && scope !== 'aggregate')) { invalid(); continue; }
    headers.set(entry, { id, name, scope });
    const expression = descriptors.expression?.value; const format = descriptors.format?.value;
    if (typeof expression !== 'string' || (format !== undefined && typeof format !== 'string')) { invalid(); continue; }
    if (encoder.encode(expression).length > 16384 || encoder.encode(id + name + (format ?? '')).length > 16384) {
      issue(entry, { code: 'expression-limit', message: 'Formula exceeds the 16 KiB UTF-8 expression/metadata limit.' }); continue;
    }
    const checked = validateFormulaAst(descriptors.ast?.value);
    checked.diagnostics.forEach(d => issue(entry, d));
    if (checked.ast) entry.value = { id, name, scope, expression, ast: checked.ast, ...(format === undefined ? {} : { format }) };
  }
  const byId = new Map<string, GraphEntry[]>();
  for (const [entry, header] of headers) byId.set(header.id, [...(byId.get(header.id) ?? []), entry]);
  for (const entries of byId.values()) if (entries.length > 1) for (const entry of entries) {
    issue(entry, { code: 'duplicate-id', message: 'Formula ID is ambiguous.' }); delete entry.value;
  }
  // Definitions are authoritative; stale caller formula symbols must never hide missing IDs.
  const context = symbols ? { ...symbols, formulas: [...headers.values()] } : undefined;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, Set<string>>();
  const addNode = (node: GraphNode) => { const k = key(node.kind, node.id); nodes.set(k, node); if (!edges.has(k)) edges.set(k, new Set()); return k; };
  const edge = (from: string, kind: GraphNode['kind'], id: string) => { edges.get(from)!.add(key(kind, id)); };
  for (const header of headers.values()) addNode({ kind: 'formula', id: header.id, name: header.name });
  if (context) {
    for (const kind of ['measure', 'category'] as const) for (const symbol of kind === 'measure' ? context.measures : context.categories) {
      const from = addNode({ kind, id: symbol.id, name: symbol.name });
      if (byId.has(symbol.sourceFieldId)) edge(from, 'formula', symbol.sourceFieldId);
    }
  }
  const walk = (ast: FormulaAst, entry: GraphEntry, from: string, scope: FormulaDef['scope']) => {
    const report = (code: FormulaDiagnostic['code'], message: string, dependencyIds?: string[]) => { if (!context) issue(entry, { code, message, dependencyIds }); };
    switch (ast.kind) {
      case 'reference':
        if (ast.target === 'formula') {
          edge(from, 'formula', ast.id);
          const referenced = byId.get(ast.id);
          if (!referenced) report('missing-reference', 'Referenced formula is missing.', [ast.id]);
          else if (referenced.length > 1) report('ambiguous-reference', 'Referenced formula ID is ambiguous.', [ast.id]);
          else {
            const targetScope = headers.get(referenced[0])!.scope;
            if (scope === 'source' && targetScope === 'aggregate') report('scope', 'Source expressions cannot depend on aggregate formulas.', [ast.id]);
            if (scope === 'aggregate' && targetScope === 'source') report('missing-aggregation', 'Choose an aggregation for the source formula.', [ast.id]);
          }
        } else if (ast.target === 'measure') {
          edge(from, 'measure', ast.id);
          if (scope === 'source') report('scope', 'Source expressions cannot depend on aggregate measure instances.', [ast.id]);
        } else if (scope === 'aggregate') report('missing-aggregation', 'Choose an aggregation for the source field.', [ast.id]);
        break;
      case 'unary': walk(ast.operand, entry, from, scope); break;
      case 'binary': walk(ast.left, entry, from, scope); walk(ast.right, entry, from, scope); break;
      case 'call':
        if (ast.function !== 'IF' && scope === 'source') report('scope', 'Aggregate calls require aggregate scope.');
        ast.args.forEach(arg => walk(arg, entry, from, ast.function === 'IF' ? scope : 'source'));
        break;
      case 'member':
        if (scope === 'source') report('scope', 'Category member comparisons require aggregate scope.');
        walk(ast.value, entry, from, scope);
        ast.selectors.forEach(selector => edge(from, 'category', selector.categoryId));
        break;
    }
  };
  const blocked = new Set<string>();
  for (const entry of result.entries) {
    const header = headers.get(entry); if (!header) continue;
    const from = key('formula', header.id);
    if (entry.value) {
      if (context && header.scope === 'source' && context.fields.some(f => f.id === header.id)) issue(entry, { code: 'ambiguous-reference', message: 'A source formula output cannot overwrite a raw input field with the same ID.', dependencyIds: [header.id] });
      if (context) bindFormula(entry.value.ast, context, entry.value.scope, options).diagnostics.forEach(d => issue(entry, d));
      walk(entry.value.ast, entry, from, entry.value.scope);
    }
    if (entry.diagnostics.length) blocked.add(from);
  }
  // Iterative DFS avoids a JS call-stack limit on long chains of individually bounded ASTs.
  const state = new Map<string, 'active' | 'done'>();
  const postorder: string[] = [];
  for (const start of nodes.keys()) {
    if (state.has(start)) continue;
    const stack = [{ id: start, remaining: [...edges.get(start)!], index: 0 }];
    state.set(start, 'active');
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = frame.remaining[frame.index++];
      if (next === undefined) { state.set(frame.id, 'done'); postorder.push(frame.id); stack.pop(); continue; }
      if (!nodes.has(next)) continue;
      if (state.get(next) === 'active') {
        const path = [...stack.slice(stack.findIndex(f => f.id === next)).map(f => nodes.get(f.id)!), nodes.get(next)!];
        const cycle: FormulaCycle = { ids: path.map(n => n.id), names: path.map(n => n.name), nodes: path };
        result.cycles.push(cycle);
        for (const node of path) {
          blocked.add(key(node.kind, node.id));
          if (node.kind === 'formula') for (const entry of byId.get(node.id) ?? []) {
            if (!entry.diagnostics.some(d => d.code === 'cycle' && d.dependencyIds?.join('\0') === cycle.ids.join('\0'))) issue(entry, { code: 'cycle', message: `Circular reference: ${cycle.names.join(' → ')}.`, dependencyIds: cycle.ids });
          }
        }
      } else if (!state.has(next)) { state.set(next, 'active'); stack.push({ id: next, remaining: [...edges.get(next)!], index: 0 }); }
    }
  }
  const reverse = new Map<string, Set<string>>();
  for (const [from, targets] of edges) for (const to of targets) { if (!reverse.has(to)) reverse.set(to, new Set()); reverse.get(to)!.add(from); }
  const queue = [...blocked];
  for (let i = 0; i < queue.length; i++) for (const dependent of reverse.get(queue[i]) ?? []) {
    if (blocked.has(dependent)) continue;
    blocked.add(dependent); queue.push(dependent);
    const node = nodes.get(dependent)!;
    if (node.kind === 'formula') for (const entry of byId.get(node.id) ?? []) issue(entry, { code: 'blocked-dependency', message: 'A required definition is invalid or circular.', dependencyIds: [nodes.get(queue[i])!.id] });
  }
  result.blockedIds = [...byId.keys()].filter(id => blocked.has(key('formula', id)));
  result.order = postorder.filter(k => nodes.get(k)!.kind === 'formula' && !blocked.has(k)).map(k => nodes.get(k)!.id);
  return result;
}
