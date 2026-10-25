// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { parseExpression, resolveValue, type PeriodType } from "../dateExpressions";
import type { ExchangeCalendar } from "../calendar";
import { canonical } from "./artifact";
import {
  CalendarError,
  bundleRevision,
  parseBinding,
  utcInstant,
  freeze,
  type CalendarBinding,
  type CalendarBundle,
  type Policy,
  type RunContext,
  type CalendarDay,
  LIMITS,
} from "./contracts";
import { createIndex, type CalendarIndex } from "./operations";
import type { ResolutionProgram } from "./program";
import type { PreparedCalendarBatch } from "./provider";
export type ResolutionResult = {
  status: "resolved" | "provisional" | "unavailable";
  value?: string;
  reason?: string;
  authority: "client" | "server";
  context: RunContext;
  expression: string;
  programFingerprint: string;
  consulted: { start: string; end: string }[];
  warnings: string[];
  fieldId?: string;
};
/**
 * The index a binding reads: a single bundle's own, or the day-by-day union/intersection of a joint binding's members.
 * Evidence is combined by the ruling: any ambiguous member makes the day `conflict`, else any `provisional` member makes
 * it `provisional`, else it is a baseline day.
 */
function composite(bundles: CalendarBundle[], context: RunContext): CalendarIndex {
  const index = createIndex(bundles[0]);
  if (context.binding.kind === "single") return index;
  const mode = context.binding.mode;
  // One map per member: each day is a lookup, not a scan (review minor: was O(n²·k)).
  const members = bundles.map((b) => new Map(b.days.map((d) => [d.date, d])));
  const days = new Map<string, CalendarDay>();
  for (const d of bundles[0].days) {
    const found = members.map((m) => m.get(d.date));
    if (found.some((x) => !x)) continue;
    const actual = found as CalendarDay[];
    const ambiguous = actual.some(
      (x) => x.state === "unresolved" || (x.candidates.length && !x.selectedBranch) || x.evidenceStatus === "conflict",
    );
    const open = mode === "all_open" ? actual.every((x) => x.state === "open") : actual.some((x) => x.state === "open");
    const evidenceStatus = ambiguous
      ? "conflict"
      : actual.some((x) => x.evidenceStatus === "provisional")
        ? "provisional"
        : "library_baseline";
    days.set(d.date, { ...d, state: ambiguous ? "unresolved" : open ? "open" : "closed", evidenceStatus });
  }
  return {
    bundle: {
      ...bundles[0],
      coverage: {
        start: bundles
          .map((b) => b.coverage.start)
          .sort()
          .at(-1)!,
        end: bundles.map((b) => b.coverage.end).sort()[0],
        complete: bundles.every((b) => b.coverage.complete),
      },
    },
    days,
    labels: [...days.values()].filter((d) => d.state === "open").map((d) => d.date),
  };
}
/** The ExchangeCalendar a run context selects, after checking its vector against the bundles. */
export function calendarForContext(context: RunContext, bundles: CalendarBundle[]): ExchangeCalendar {
  const binding = parseBinding(context.binding);
  const ids = binding.kind === "single" ? [binding.calendarId] : binding.members;
  if (
    !utcInstant(context.referenceInstant) ||
    context.vector.length !== ids.length ||
    new Set(context.vector.map((r) => r.calendarId)).size !== ids.length
  )
    throw new CalendarError("INVALID_VECTOR");
  const selected = ids.map((id) => {
    const ref = context.vector.find((r) => r.calendarId === id);
    const b = bundles.find((b) => b.calendarId === id && b.digest === ref?.digest);
    if (!b || ref?.revision !== bundleRevision(b)) throw new CalendarError("INVALID_VECTOR");
    return b;
  });
  const index = composite(selected, context);
  return {
    code: ids.join("+"),
    name: ids.join("+"),
    timezone: binding.kind === "joint" ? binding.referenceTimezone : selected[0].timezone,
    session: { open: "00:00:00", close: "00:00:00", workingDays: [] },
    holidays: {},
    years: [],
    source: "backend",
    sessionIndex: index,
    calendarPolicy: context.policy,
    calendarUse: { provisional: false, ranges: [] },
  };
}
/** One compiled program resolved under its run context; never throws, returns a typed unavailable instead. */
export function evaluateProgram(
  program: ResolutionProgram,
  context: RunContext,
  bundles: CalendarBundle[],
): ResolutionResult {
  const base = {
    authority: "client" as const,
    context,
    expression: program.expression,
    programFingerprint: canonical(program),
    consulted: [] as { start: string; end: string }[],
    warnings: [] as string[],
  };
  try {
    if (program.schemaVersion !== 1 || canonical(parseExpression(program.expression)) !== canonical(program.ast))
      throw new CalendarError("INVALID_PROGRAM");
    const atoms = [program.ast.start, ...(program.ast.end ? [program.ast.end] : [])];
    const steps = atoms
      .flatMap((a) => a.offsets)
      .filter((o) => o.unit === "bd")
      .reduce((n, o) => n + o.amount, 0);
    if (steps > LIMITS.steps) throw new CalendarError("RESOURCE_LIMIT");
    if (
      context.binding.kind === "joint" &&
      (["datetime", "time"].includes(program.outputType) ||
        atoms.some(
          (a) =>
            a.anchor.kind === "named" &&
            ["session_open", "session_close", "trade_date", "prev_trade_date"].includes(a.anchor.name),
        ))
    )
      throw new CalendarError("JOINT_INTRADAY_UNSUPPORTED");
    const calendar = calendarForContext(context, bundles);
    const value = resolveValue(program.outputType as PeriodType, program.expression, {
      now: new Date(context.referenceInstant),
      zone: calendar.timezone,
      exchange: calendar.code,
      calendar,
      fiscalYearEnd: program.fiscalYearEnd,
      symbol: program.symbol,
      bounds: program.bounds ? { min: new Date(program.bounds.min), max: new Date(program.bounds.max) } : undefined,
    });
    if (value === program.expression) throw new CalendarError("EXPRESSION_UNAVAILABLE");
    return freeze({
      ...base,
      status: calendar.calendarUse!.provisional ? "provisional" : "resolved",
      value,
      consulted: calendar.calendarUse!.ranges,
    });
  } catch (e) {
    return freeze({
      ...base,
      status: "unavailable",
      reason:
        e instanceof CalendarError ? e.code : e instanceof RangeError ? "INVALID_LOCAL_TIME" : "RESOLUTION_UNAVAILABLE",
    });
  }
}
/**
 * Verified bundles as the ExchangeCalendar every resolver helper reads, for one binding and policy: the same calendar
 * the batch service builds, without its per-run `calendarUse` record, so a calendar shared by every card on a
 * dashboard holds no state. The reference instant is irrelevant to building it and is fixed.
 */
export function bundleCalendar(bundles: CalendarBundle[], binding: CalendarBinding, policy: Policy): ExchangeCalendar {
  const parsed = parseBinding(binding);
  const ids = parsed.kind === "single" ? [parsed.calendarId] : parsed.members;
  const vector = ids.map((id) => {
    const b = bundles.find((x) => x.calendarId === id);
    if (!b) throw new CalendarError("COVERAGE_UNAVAILABLE", `No bundle for ${id}`);
    return { calendarId: id, revision: bundleRevision(b), digest: b.digest };
  });
  const context: RunContext = {
    schemaVersion: 1,
    referenceInstant: "1970-01-01T00:00:00Z",
    binding: parsed,
    policy,
    vector,
    resolverVersion: "calendar-v1",
  };
  return { ...calendarForContext(context, bundles), calendarUse: undefined };
}

export interface CalendarResolutionService {
  resolveBatch(prepared: PreparedCalendarBatch, signal: AbortSignal): Promise<ResolutionResult[]>;
}
/** The in-process resolution service (a server one can replace it with the same interface). */
export const localResolutionService: CalendarResolutionService = {
  async resolveBatch(prepared, signal) {
    if (prepared.fields.length > LIMITS.expressions) throw new CalendarError("RESOURCE_LIMIT");
    return prepared.fields.map((f) => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (f.context.referenceInstant !== prepared.referenceInstant) throw new CalendarError("BATCH_CLOCK_MISMATCH");
      return { ...evaluateProgram(f.program, f.context, prepared.bundles), fieldId: f.fieldId };
    });
  },
};
