// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import schema from "./vendor/calendar-v1.schema.json";
import { matchesJsonSchema } from "./schema";
/** Resolution strictness: legacy-v1 is v3 behaviour; operational-v1 blocks provisional/conflict days; planning-v1 accepts provisional. */
export type Policy = "legacy-v1" | "operational-v1" | "planning-v1";
export type EvidenceStatus =
  | "library_baseline"
  | "provisional"
  | "authority_confirmed"
  | "market_final"
  | "operator_final"
  | "conflict";
export type CalendarDay = {
  date: string;
  state: "open" | "closed" | "unresolved";
  evidenceStatus: EvidenceStatus;
  open: string | null;
  close: string | null;
  segments: { start: string; end: string }[];
  evidence: { id: string; kind: string; domain: string; references: string[] }[];
  candidates: { id: string; condition: string; evidenceReferences: string[] }[];
  selectedBranch: string | null;
};
export type CalendarBundle = {
  schemaVersion: 1;
  calendarId: string;
  name: string;
  kind: "exchange_trading" | "currency_payment" | "securities_settlement";
  currency: string | null;
  timezone: string;
  definitionRevision: string;
  aliasRevision: string;
  resolverPolicyVersion: "calendar-v1";
  generatedAt: string;
  coverage: { start: string; end: string; complete: boolean };
  source: { adapter: string; packageVersion: string; tzdataVersion: string; ruleDigest: string };
  days: CalendarDay[];
  digest: string;
};
export type CalendarBinding =
  | { schemaVersion: 1; kind: "single"; calendarId: string }
  | { schemaVersion: 1; kind: "joint"; members: string[]; mode: "all_open" | "any_open"; referenceTimezone: string };
export type CalendarRevisionRef = { calendarId: string; revision: string; digest: string };
/**
 * The calendar definition a bundle was cut from: the same for every date range cut from it, unlike the content digest
 * (parent design: "delivery, fact key, and immutable revision identity remain distinct"; review minor: they were equal).
 */
export const bundleRevision = (b: CalendarBundle): string => `${b.definitionRevision}@${b.source.ruleDigest}`;
export type RunContext = {
  schemaVersion: 1;
  referenceInstant: string;
  binding: CalendarBinding;
  policy: Policy;
  vector: CalendarRevisionRef[];
  resolverVersion: string;
};
/** The calendar contract's resource ceilings, shared with openbq-docker's capabilities. */
export const LIMITS = { members: 8, days: 366 * 20, steps: 10000, expressions: 100, bytes: 16 * 1024 * 1024 } as const;
/** A calendar failure with a stable code; `message` is what a card shows. */
export class CalendarError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
/** A real calendar day as YYYY-MM-DD. */
export const isoDay = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const instantOrder = (s: string) =>
  s.replace(/(?:\.(\d{1,6}))?Z$/, (_match, fraction = "") => "." + fraction.padEnd(6, "0") + "Z");
/** A UTC instant as the bundle writes it: seconds, optional fraction, Z. */
export const utcInstant = (s: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(s) && Number.isFinite(Date.parse(s));
/** Deep-freezes a value in place so a retained bundle cannot be mutated after verification. */
export function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
/** Schema plus the invariants the schema cannot state: coverage, ordered sessions, authority evidence, branches. */
export function validateBundle(value: unknown): CalendarBundle {
  if (!matchesJsonSchema(value, schema, schema.$defs)) throw new CalendarError("INVALID_BUNDLE");
  const b = structuredClone(value) as CalendarBundle;
  try {
    new Intl.DateTimeFormat("en", { timeZone: b.timezone });
  } catch {
    throw new CalendarError("INVALID_TIMEZONE");
  }
  const prefix = { exchange_trading: "exchange:", currency_payment: "payment:", securities_settlement: "settlement:" }[
    b.kind
  ];
  if (!b.calendarId.startsWith(prefix) || (b.kind === "currency_payment" && !b.currency))
    throw new CalendarError("INVALID_CALENDAR_KIND");
  const { start, end, complete } = b.coverage;
  const span = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (
    !isoDay(start) ||
    !isoDay(end) ||
    span < 0 ||
    span >= LIMITS.days ||
    b.days.length > LIMITS.days ||
    !utcInstant(b.generatedAt)
  )
    throw new CalendarError("INVALID_COVERAGE");
  let previous = "";
  for (const [i, d] of b.days.entries()) {
    if (
      !isoDay(d.date) ||
      d.date <= previous ||
      d.date < start ||
      d.date > end ||
      (complete && d.date !== new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10))
    )
      throw new CalendarError("INVALID_COVERAGE");
    previous = d.date;
    if (d.state === "open") {
      if (
        !d.open ||
        !d.close ||
        !utcInstant(d.open) ||
        !utcInstant(d.close) ||
        !d.segments.length ||
        d.segments[0].start !== d.open ||
        d.segments.at(-1)!.end !== d.close
      )
        throw new CalendarError("INVALID_SESSION");
      for (const [n, s] of d.segments.entries())
        if (
          !utcInstant(s.start) ||
          !utcInstant(s.end) ||
          instantOrder(s.start) >= instantOrder(s.end) ||
          (n > 0 && instantOrder(d.segments[n - 1].end) > instantOrder(s.start))
        )
          throw new CalendarError("INVALID_SEGMENTS");
    } else if (d.open !== null || d.close !== null || d.segments.length) throw new CalendarError("INVALID_SESSION");
    if (
      d.evidenceStatus === "market_final" &&
      !d.evidence.some(
        (e) =>
          e.domain === "trading" &&
          ["exchange_notice", "exchange_conditional_resolution"].includes(e.kind) &&
          e.references.length,
      )
    )
      throw new CalendarError("MISSING_AUTHORITY");
    if (
      d.evidenceStatus === "operator_final" &&
      !d.evidence.some(
        (e) =>
          e.domain === "settlement" &&
          ["central_bank_notice", "payment_operator_notice", "clearing_notice"].includes(e.kind) &&
          e.references.length,
      )
    )
      throw new CalendarError("MISSING_AUTHORITY");
    const ids = d.candidates.map((c) => c.id);
    if (new Set(ids).size !== ids.length || (d.selectedBranch !== null && !ids.includes(d.selectedBranch)))
      throw new CalendarError("INVALID_BRANCH");
  }
  if (complete && b.days.length !== span + 1) throw new CalendarError("INVALID_COVERAGE");
  return freeze(b);
}
/** A manifest calendarBinding, validated and normalised (joint members sorted); throws INVALID_BINDING. */
export function parseBinding(value: unknown): CalendarBinding {
  const v = value as CalendarBinding;
  if (!v || v.schemaVersion !== 1 || !["single", "joint"].includes(v.kind)) throw new CalendarError("INVALID_BINDING");
  const keys =
    v.kind === "single"
      ? ["schemaVersion", "kind", "calendarId"]
      : ["schemaVersion", "kind", "members", "mode", "referenceTimezone"];
  if (Object.keys(v).some((k) => !keys.includes(k))) throw new CalendarError("INVALID_BINDING");
  const ids = v.kind === "single" ? [v.calendarId] : v.members;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > LIMITS.members ||
    new Set(ids).size !== ids.length ||
    // The library's own names include 24/5, 24/7 and us_futures (2026-10-24), as the vendored schema now does.
    ids.some((id) => typeof id !== "string" || !/^(exchange|payment|settlement):[A-Za-z0-9_/-]+$/.test(id))
  )
    throw new CalendarError("INVALID_BINDING");
  if (v.kind === "joint") {
    if (!["all_open", "any_open"].includes(v.mode) || typeof v.referenceTimezone !== "string")
      throw new CalendarError("INVALID_BINDING");
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.referenceTimezone });
    } catch {
      throw new CalendarError("INVALID_TIMEZONE");
    }
  }
  return freeze(structuredClone(v.kind === "joint" ? { ...v, members: [...v.members].sort() } : v));
}
