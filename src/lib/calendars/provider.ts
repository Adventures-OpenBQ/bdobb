// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {
  CalendarError,
  LIMITS,
  bundleRevision,
  freeze,
  parseBinding,
  utcInstant,
  type CalendarBinding,
  type CalendarBundle,
  type Policy,
  type RunContext,
} from "./contracts";
import type { CalendarCache } from "./cache";
import { bundleWindow, calendarWindow } from "./window";
import type { ResolutionProgram } from "./program";
/** One bundle ask: a calendar, an inclusive date window and, optionally, the revision it must be. */
export type BundleRequest = { calendarId: string; start: string; end: string; revision?: string };
/** One calendar a provider advertises: its coverage, zone and the policies it serves. */
export type CalendarCapability = {
  calendarId: string;
  name: string;
  timezone: string;
  kind: CalendarBundle["kind"];
  start: string;
  end: string;
  policies: string[];
};
/** A provider's capabilities document: its calendars and limits. */
export type CalendarCapabilities = {
  schemaVersion: 1;
  providerId: string;
  calendars: CalendarCapability[];
  limits: Record<string, number>;
};
/** Where verified bundles come from: a capability list and a bundle loader. */
export interface CalendarProvider {
  list(signal: AbortSignal): Promise<CalendarCapabilities>;
  load(request: BundleRequest, signal: AbortSignal): Promise<CalendarBundle>;
}
/** A batch to prepare: one reference instant and the fields that resolve on it. */
export type BatchInput = {
  referenceInstant: string;
  fields: { fieldId: string; program: ResolutionProgram; binding: CalendarBinding; policy: Policy }[];
};
/** A prepared batch: every field's program and frozen run context, plus the bundles they name. */
export type PreparedCalendarBatch = {
  schemaVersion: 1;
  referenceInstant: string;
  fields: { fieldId: string; program: ResolutionProgram; context: RunContext }[];
  bundles: CalendarBundle[];
};
/**
 * The v11 TemporalDB entry point; unused in v4 (ruling RF1). A CalendarProvider over a fetch function, verifying what
 * it loads into `cache`, which must be the app's shared one (bundles.ts `sharedBundleCache`, review I3), never a private
 * one. `scope` is the backend's bundleScope, so an entry is keyed exactly as the card path keys it and a credential
 * change clears it.
 */
export function createBundleProvider(
  scope: string,
  cache: CalendarCache,
  fetchBundle: (r: BundleRequest, signal: AbortSignal) => Promise<unknown>,
  fetchList?: (signal: AbortSignal) => Promise<CalendarCapabilities>,
): CalendarProvider {
  return {
    async list(signal) {
      if (!fetchList) throw new CalendarError("CAPABILITIES_UNAVAILABLE");
      return fetchList(signal);
    },
    async load(r, signal) {
      // Keyed on the window, not the revision (P4): one fetch per window, and a revision is checked below.
      const key = JSON.stringify([scope, r.calendarId, r.start, r.end]);
      const b = await cache.load(key, () => fetchBundle(r, signal), signal);
      if (
        b.calendarId !== r.calendarId ||
        b.coverage.start > r.start ||
        b.coverage.end < r.end ||
        (r.revision && r.revision !== bundleRevision(b))
      )
        throw new CalendarError("BUNDLE_REQUEST_MISMATCH");
      return b;
    },
  };
}
/** Loads every calendar a batch names and freezes one reference instant and bundle vector for it. */
export async function prepareCalendarBatch(
  input: BatchInput,
  provider: CalendarProvider,
  signal: AbortSignal,
  range?: { start: string; end: string },
): Promise<PreparedCalendarBatch> {
  if (
    !utcInstant(input.referenceInstant) ||
    !input.fields.length ||
    input.fields.length > LIMITS.expressions ||
    new Set(input.fields.map((f) => f.fieldId)).size !== input.fields.length
  )
    throw new CalendarError("INVALID_BATCH");
  const requested = range ?? bundleWindow(input.fields.map((f) => f.program.expression), new Date(input.referenceInstant));
  const bindings = input.fields.map((f) => parseBinding(f.binding));
  const ids = [...new Set(bindings.flatMap((b) => (b.kind === "single" ? [b.calendarId] : b.members)))].sort();
  if (ids.length > LIMITS.members) throw new CalendarError("RESOURCE_LIMIT");
  const bundles = await Promise.all(ids.map((calendarId) => provider.load({ calendarId, ...calendarWindow(calendarId, requested) }, signal)));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const fields = input.fields.map((f, i) => {
    const binding = bindings[i];
    const members = binding.kind === "single" ? [binding.calendarId] : binding.members;
    return {
      fieldId: f.fieldId,
      program: f.program,
      context: {
        schemaVersion: 1 as const,
        referenceInstant: input.referenceInstant,
        binding,
        policy: f.policy,
        vector: bundles
          .filter((b) => members.includes(b.calendarId))
          .map((b) => ({ calendarId: b.calendarId, revision: bundleRevision(b), digest: b.digest })),
        resolverVersion: "calendar-v1",
      },
    };
  });
  return freeze({ schemaVersion: 1, referenceInstant: input.referenceInstant, fields, bundles });
}
