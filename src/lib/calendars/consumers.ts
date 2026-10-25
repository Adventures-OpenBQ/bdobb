// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarError, type CalendarBinding, type Policy } from "./contracts";
import { compileProgram } from "./program";
import { prepareCalendarBatch, type CalendarProvider } from "./provider";
import { localResolutionService, type CalendarResolutionService } from "./resolver";
import type { PeriodType } from "../dateExpressions";
export type CalendarField = {
  fieldId: string;
  expression: string;
  outputType: PeriodType;
  binding: CalendarBinding;
  policy?: Policy;
  fiscalYearEnd?: number;
  symbol?: string;
  bounds?: { min: string; max: string };
};
/** One batch clock, the same service seam for widgets and TemporalDB parameters. */
export async function resolveCalendarFields(
  fields: CalendarField[],
  provider: CalendarProvider,
  referenceInstant: string,
  signal: AbortSignal,
  range?: { start: string; end: string },
  service: CalendarResolutionService = localResolutionService,
) {
  const input = {
    referenceInstant,
    fields: fields.map((f) => ({
      fieldId: f.fieldId,
      program: compileProgram(f.expression, f.outputType, {
        fiscalYearEnd: f.fiscalYearEnd ?? 12,
        symbol: f.symbol,
        bounds: f.bounds,
      }),
      binding: f.binding,
      policy: f.policy ?? ("operational-v1" as Policy),
    })),
  };
  const prepared = await prepareCalendarBatch(input, provider, signal, range);
  const results = await service.resolveBatch(prepared, signal);
  const values: Record<string, string> = Object.create(null);
  for (const r of results) {
    if (r.status === "unavailable" || r.value === undefined)
      throw new CalendarError(
        r.reason ?? "RESOLUTION_UNAVAILABLE",
        `${r.fieldId}: ${r.reason ?? "RESOLUTION_UNAVAILABLE"}`,
      );
    values[r.fieldId!] = r.value;
  }
  return { values, results, prepared };
}
