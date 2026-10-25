// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { AGG_NAMES } from '../types';
import type { FormulaAst, MemberSelector } from './types';

export type FormulaDiagnostic = {
  code: 'syntax' | 'invalid-ast' | 'expression-limit' | 'node-limit' | 'depth-limit' | 'parser-nesting-limit' | 'missing-reference' | 'missing-member' | 'missing-aggregation' | 'ambiguous-reference' | 'scope' | 'cycle' | 'blocked-dependency' | 'duplicate-id';
  message: string;
  definitionId?: string;
  dependencyIds?: string[];
  candidateIds?: string[];
  position?: number;
};
type Literal = Extract<FormulaAst, { kind: 'literal' }>;
type Reference = Extract<FormulaAst, { kind: 'reference' }>;
export type SyntaxSelector = { categoryName: string; value: Literal['value'] };
/** Names exist only in drafts; persisted FormulaAst nodes contain stable identities. */
export type SyntaxAst = Literal | Reference | { kind: 'name'; name: string }
  | { kind: 'unary'; operator: '+' | '-'; operand: SyntaxAst }
  | { kind: 'binary'; operator: Extract<FormulaAst, { kind: 'binary' }>['operator']; left: SyntaxAst; right: SyntaxAst }
  | { kind: 'call'; function: Extract<FormulaAst, { kind: 'call' }>['function']; args: SyntaxAst[] }
  | { kind: 'member'; value: SyntaxAst; selectors: (SyntaxSelector | MemberSelector)[] };
export type ParseResult = { ast?: SyntaxAst; diagnostics: FormulaDiagnostic[] };
export type AstValidation = { ast?: FormulaAst; diagnostics: FormulaDiagnostic[] };
const encoder = new TextEncoder();
const binaryOperators = ['+', '-', '*', '/', '=', '!=', '<', '<=', '>', '>='];
const functions: readonly string[] = [...AGG_NAMES, 'IF'];
const functionNames = new Map<string, Extract<FormulaAst, { kind: 'call' }>['function']>([...AGG_NAMES.map(fn => [fn.toUpperCase(), fn] as const), ['IF', 'IF']]);
class FormulaFailure extends Error {
  constructor(readonly diagnostic: FormulaDiagnostic) { super(diagnostic.message); }
}
function fail(code: FormulaDiagnostic['code'], message: string, position?: number): never {
  throw new FormulaFailure({ code, message, ...(position === undefined ? {} : { position }) });
}
function textLimit(bytes: number) { if (bytes > 16384) fail('expression-limit', 'Formula exceeds the 16 KiB UTF-8 expression limit.'); }
function depthLimit(depth: number) { if (depth > 64) fail('depth-limit', 'Formula exceeds the AST depth limit of 64.'); }
function caught(error: unknown): FormulaDiagnostic[] {
  return [error instanceof FormulaFailure ? error.diagnostic : { code: 'invalid-ast', message: 'Expected bounded plain formula data.' }];
}

/** Descriptor-based decoding refuses accessors, prototypes, extra payloads and cycles. */
function decode(raw: unknown, names: boolean): SyntaxAst {
  let nodes = 0;
  let stringBytes = 0;
  const invalid = (): never => fail('invalid-ast', 'Invalid formula AST structure.');
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) return invalid();
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== 'string' || !('value' in d)) return invalid();
      entries.push([key, d.value]);
    }
    return Object.fromEntries(entries);
  };
  const keys = (v: Record<string, unknown>, expected: string[]) => {
    if (Object.keys(v).length !== expected.length || expected.some(k => !Object.hasOwn(v, k))) invalid();
  };
  const string = (v: unknown, nonempty = true): string => {
    if (typeof v !== 'string' || (nonempty && !v.length)) return invalid();
    stringBytes += encoder.encode(v).length; textLimit(stringBytes); return v;
  };
  const scalar = (v: unknown): Literal['value'] => {
    if (typeof v === 'string') return string(v, false);
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    return invalid();
  };
  const array = (v: unknown): unknown[] => {
    if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return invalid();
    const length = Object.getOwnPropertyDescriptor(v, 'length')?.value;
    if (!Number.isInteger(length) || length > 1024) fail('node-limit', 'Formula exceeds the AST node limit of 1,024.');
    if (Reflect.ownKeys(v).length !== length + 1) return invalid();
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (!d || !('value' in d)) return invalid();
      values.push(d.value);
    }
    return values;
  };
  const visit = (value: unknown, depth: number): SyntaxAst => {
    depthLimit(depth);
    if (++nodes > 1024) fail('node-limit', 'Formula exceeds the AST node limit of 1,024.');
    const v = record(value);
    switch (v.kind) {
      case 'literal': keys(v, ['kind', 'value']); return { kind: 'literal', value: scalar(v.value) };
      case 'name':
        if (!names) return invalid();
        keys(v, ['kind', 'name']); return { kind: 'name', name: string(v.name) };
      case 'reference':
        keys(v, ['kind', 'target', 'id']);
        if (v.target !== 'field' && v.target !== 'formula' && v.target !== 'measure') return invalid();
        return { kind: 'reference', target: v.target, id: string(v.id) };
      case 'unary':
        keys(v, ['kind', 'operator', 'operand']);
        if (v.operator !== '+' && v.operator !== '-') return invalid();
        return { kind: 'unary', operator: v.operator, operand: visit(v.operand, depth + 1) };
      case 'binary':
        keys(v, ['kind', 'operator', 'left', 'right']);
        if (typeof v.operator !== 'string' || !binaryOperators.includes(v.operator)) return invalid();
        return { kind: 'binary', operator: v.operator as Extract<FormulaAst, { kind: 'binary' }>['operator'], left: visit(v.left, depth + 1), right: visit(v.right, depth + 1) };
      case 'call': {
        keys(v, ['kind', 'function', 'args']);
        if (typeof v.function !== 'string' || !functions.includes(v.function)) return invalid();
        const args = array(v.args);
        if (args.length !== (v.function === 'IF' ? 3 : 1)) return invalid();
        return { kind: 'call', function: v.function as Extract<FormulaAst, { kind: 'call' }>['function'], args: args.map(arg => visit(arg, depth + 1)) };
      }
      case 'member': {
        keys(v, ['kind', 'value', 'selectors']);
        const selectors = array(v.selectors);
        if (!selectors.length) return invalid();
        return { kind: 'member', value: visit(v.value, depth + 1), selectors: selectors.map(s => {
          const selector = record(s);
          if (names && Object.hasOwn(selector, 'categoryName')) {
            keys(selector, ['categoryName', 'value']);
            return { categoryName: string(selector.categoryName), value: scalar(selector.value) };
          }
          keys(selector, ['categoryId', 'memberKey']);
          return { categoryId: string(selector.categoryId), memberKey: string(selector.memberKey) };
        }) };
      }
      default: return invalid();
    }
  };
  return visit(raw, 1);
}
/** A node's direct sub-expressions, in source order. */
export function astChildren(node: FormulaAst): FormulaAst[] {
  switch (node.kind) {
    case 'unary': return [node.operand];
    case 'binary': return [node.left, node.right];
    case 'call': return node.args;
    case 'member': return [node.value];
    default: return [];
  }
}
export function validateFormulaAst(raw: unknown): AstValidation {
  try { return { ast: decode(raw, false) as FormulaAst, diagnostics: [] }; }
  catch (error) { return { diagnostics: caught(error) }; }
}
export function validateSyntaxAst(raw: unknown): ParseResult {
  try { return { ast: decode(raw, true), diagnostics: [] }; }
  catch (error) { return { diagnostics: caught(error) }; }
}

/**
 * A bounded Pratt parser. IF remains a call with three unevaluated branches.
 * Parser nesting counts recursive grammar descent (including parentheses), with
 * its own limit of 256. The decoded AST independently enforces depth 64.
 */
export function parseFormula(text: string): ParseResult {
  try {
    textLimit(encoder.encode(text).length);
    let position = 0;
    let nodes = 0;
    const whitespace = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
    const syntax = (message = 'Unexpected formula syntax.'): never => fail('syntax', message, position);
    const consume = (token: string) => { whitespace(); if (!text.startsWith(token, position)) syntax(`Expected ${token}.`); position += token.length; };
    const peek = () => { whitespace(); return text[position]; };
    const node = <T extends SyntaxAst>(value: T): T => {
      if (++nodes > 1024) fail('node-limit', 'Formula exceeds the AST node limit of 1,024.');
      return value;
    };
    const name = (): string => {
      whitespace();
      if (text[position] === '[') {
        const end = text.indexOf(']', ++position);
        if (end < 0 || end === position) syntax('Expected a bracketed identifier.');
        const result = text.slice(position, end); position = end + 1; return result;
      }
      const match = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(position));
      if (!match) return syntax('Expected an identifier.');
      position += match[0].length; return match[0];
    };
    const scalar = (): Literal['value'] => {
      whitespace();
      if (text[position] === '"') {
        const start = position++;
        while (position < text.length) {
          if (text[position] === '\\') { position += 2; continue; }
          if (text[position++] === '"') {
            try { return JSON.parse(text.slice(start, position)) as string; } catch { return syntax('Invalid quoted literal.'); }
          }
        }
        return syntax('Unterminated quoted literal.');
      }
      const match = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(position));
      if (match) {
        position += match[0].length;
        const value = Number(match[0]); if (!Number.isFinite(value)) syntax('Expected a finite numeric literal.'); return value;
      }
      const value = name();
      return value === 'true' ? true : value === 'false' ? false : value === 'null' ? null : value;
    };
    const precedence: Record<string, number> = { '=': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
    const expression = (minimum: number, nesting: number): SyntaxAst => {
      if (nesting > 256) fail('parser-nesting-limit', 'Formula exceeds the parser nesting limit of 256.');
      const token = peek();
      let left: SyntaxAst;
      if (token === '+' || token === '-') {
        position++; left = node({ kind: 'unary', operator: token, operand: expression(4, nesting + 1) });
      } else if (token === '(') {
        position++; left = expression(0, nesting + 1); consume(')');
      } else if (token === '"' || /[\d.]/.test(token ?? '')) {
        left = node({ kind: 'literal', value: scalar() });
      } else {
        const bracketed = token === '[';
        const identifier = name();
        if (!bracketed && peek() === '(') {
          const fn = functionNames.get(identifier);
          if (!fn) syntax('Unknown formula function.');
          position++;
          const args: SyntaxAst[] = [];
          if (peek() !== ')') {
            args.push(expression(0, nesting + 1));
            while (peek() === ',') { position++; args.push(expression(0, nesting + 1)); }
          }
          consume(')');
          if (args.length !== (identifier === 'IF' ? 3 : 1)) syntax('Invalid function argument count.');
          left = node({ kind: 'call', function: fn!, args });
        } else if (!bracketed && ['true', 'false', 'null'].includes(identifier)) {
          left = node({ kind: 'literal', value: identifier === 'null' ? null : identifier === 'true' });
        } else left = node({ kind: 'name', name: identifier });
      }
      if (peek() === '[') {
        const selectors: SyntaxSelector[] = [];
        while (peek() === '[') {
          position++; const categoryName = name(); consume('='); const value = scalar(); consume(']'); selectors.push({ categoryName, value });
        }
        left = node({ kind: 'member', value: left, selectors });
      }
      while (true) {
        whitespace();
        const operator = /^(?:!=|<=|>=|[+*/=<>-])/.exec(text.slice(position))?.[0];
        if (!operator || precedence[operator] < minimum) break;
        position += operator.length;
        left = node({ kind: 'binary', operator: operator as Extract<FormulaAst, { kind: 'binary' }>['operator'], left, right: expression(precedence[operator] + 1, nesting + 1) });
      }
      return left;
    };
    const ast = expression(0, 0);
    whitespace(); if (position !== text.length) syntax();
    // Left-associative chains can have deeper ASTs than the parser's call stack.
    return validateSyntaxAst(ast);
  } catch (error) { return { diagnostics: caught(error) }; }
}
