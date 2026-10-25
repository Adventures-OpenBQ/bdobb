// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { parseExpression, type Expression, type PeriodType } from "../dateExpressions";
import { CalendarError, freeze, LIMITS } from "./contracts";
/** An expression compiled once for a batch: its AST, output type and limits. */
export type ResolutionProgram = {
  schemaVersion: 1;
  expression: string;
  ast: Expression;
  outputType: PeriodType;
  fiscalYearEnd: number;
  symbol?: string;
  bounds?: { min: string; max: string };
};
/** Parses and bounds an expression for the resolution service; throws on anything it cannot run. */
export function compileProgram(
  expression: string,
  outputType: PeriodType,
  options: { fiscalYearEnd?: number; symbol?: string; bounds?: { min: string; max: string } } = {},
): ResolutionProgram {
  const ast = parseExpression(expression);
  if (!ast) throw new CalendarError("INVALID_EXPRESSION");
  const fiscalYearEnd = options.fiscalYearEnd ?? 12;
  if (!Number.isInteger(fiscalYearEnd) || fiscalYearEnd < 1 || fiscalYearEnd > 12)
    throw new CalendarError("INVALID_FISCAL_YEAR");
  const steps = [ast.start, ast.end]
    .filter((v): v is NonNullable<typeof v> => !!v)
    .flatMap((a) => a.offsets)
    .filter((o) => o.unit === "bd")
    .reduce((n, o) => n + o.amount, 0);
  if (steps > LIMITS.steps) throw new CalendarError("RESOURCE_LIMIT");
  return freeze({
    schemaVersion: 1,
    expression,
    ast,
    outputType,
    fiscalYearEnd,
    ...(options.symbol !== undefined ? { symbol: options.symbol } : {}),
    ...(options.bounds !== undefined ? { bounds: options.bounds } : {}),
  });
}
