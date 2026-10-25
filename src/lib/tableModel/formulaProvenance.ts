// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Shared stable draft provenance; no member-domain proof or UI state.
import {astChildren, parseFormula, type SyntaxAst} from './formulaSyntax';
import type {FormulaAst, FormulaDef, MemberSelector} from './types';
export type Reference = Extract<FormulaAst, {kind:'reference'}>;
export type DraftBindings = Map<string, Reference>;
/** Recover committed token bindings per scope; explicit aggregate inputs and implicit instances may share a name. */
export function rememberFormulaBindings(formula: FormulaDef | undefined): DraftBindings {
    const bindings: DraftBindings = new Map();
    const ambiguous = new Set<string>();
    if (!formula)
        return bindings;
    const syntax = parseFormula(formula.expression).ast;
    const visit = (s: SyntaxAst, b: FormulaAst, scope: FormulaDef['scope']) => {
        const key = `${scope}\0${s.kind === 'name' ? s.name : ''}`;
        if (s.kind === 'name' && b.kind === 'reference' && !ambiguous.has(key)) {
            const previous=bindings.get(key);
            if(previous&&(previous.target!==b.target||previous.id!==b.id)){bindings.delete(key);ambiguous.add(key);}
            else bindings.set(key,b);
        }
        if (s.kind === 'binary' && b.kind === 'binary') {
            visit(s.left, b.left, scope);
            visit(s.right, b.right, scope);
        }
        if (s.kind === 'unary' && b.kind === 'unary')
            visit(s.operand, b.operand, scope);
        if (s.kind === 'call' && b.kind === 'call')
            s.args.forEach((a, i) => { if (b.args[i])
                visit(a, b.args[i], s.function === 'IF' ? scope : 'source'); });
        if (s.kind === 'member' && b.kind === 'member')
            visit(s.value, b.value, scope);
    };
    if (syntax)
        visit(syntax, formula.ast, formula.scope);
    return bindings;
}
export function rememberMembers(formula: FormulaDef | undefined): Map<string, MemberSelector> {
    const members = new Map<string, MemberSelector>();
    const ambiguous = new Set<string>();
    if (!formula)
        return members;
    const syntax = parseFormula(formula.expression).ast;
    const visit = (s: SyntaxAst, b: FormulaAst) => {
        if (s.kind === 'binary' && b.kind === 'binary') {
            visit(s.left, b.left);
            visit(s.right, b.right);
        }
        if (s.kind === 'unary' && b.kind === 'unary')
            visit(s.operand, b.operand);
        if (s.kind === 'call' && b.kind === 'call')
            s.args.forEach((arg, i) => { if (b.args[i])
                visit(arg, b.args[i]); });
        if (s.kind === 'member' && b.kind === 'member') {
            visit(s.value, b.value);
            s.selectors.forEach((selector, i) => {
                if(!('categoryName' in selector)||!b.selectors[i])return;
                const key=JSON.stringify([selector.categoryName,selector.value]);if(ambiguous.has(key))return;
                const previous=members.get(key);const next=b.selectors[i];
                if(previous&&(previous.categoryId!==next.categoryId||previous.memberKey!==next.memberKey)){members.delete(key);ambiguous.add(key);}
                else members.set(key,next);
            });
        }
    };
    if (syntax)
        visit(syntax, formula.ast);
    return members;
}
export function applyBindings(ast: SyntaxAst, bindings: DraftBindings, members: Map<string, MemberSelector>, scope: FormulaDef['scope']): SyntaxAst {
    switch (ast.kind) {
        case 'name': return bindings.get(`${scope}\0${ast.name}`) ?? bindings.get(ast.name) ?? ast;
        case 'unary': return { ...ast, operand: applyBindings(ast.operand, bindings, members, scope) };
        case 'binary': return { ...ast, left: applyBindings(ast.left, bindings, members, scope), right: applyBindings(ast.right, bindings, members, scope) };
        case 'call': return { ...ast, args: ast.args.map(a => applyBindings(a, bindings, members, ast.function === 'IF' ? scope : 'source')) };
        case 'member': return { ...ast, value: applyBindings(ast.value, bindings, members, scope), selectors: ast.selectors.map(selector => 'categoryName' in selector ? members.get(JSON.stringify([selector.categoryName, selector.value])) ?? selector : selector) };
        default: return ast;
    }
}
export function chronological(ast: FormulaAst): boolean {
    return (ast.kind === 'call' && (ast.function === 'first' || ast.function === 'last')) || astChildren(ast).some(chronological);
}
