// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { resolveParamValue } from "./params";

/**
 * The query params for one options request.
 *
 * A literal entry is copied stringified (`true` -> "true", `10` -> "10"). An
 * entry whose value is `"$name"` resolves to `values[name]` — the strip's
 * CURRENT value for that param — run through resolveParamValue, so a stored
 * `$currentDate` arrives as today's date.
 *
 * An unresolved reference is OMITTED, never sent empty. Probed live on
 * 2026-08-27: `fomc_documents_choices?year=` answers 422 int_parsing rather
 * than an empty list, so an empty entry costs a request and earns nothing.
 *
 * Limitation, deliberately not worked around: a leading `$` always means "a
 * reference to a param", so a literal `{"date": "$currentDate"}` in
 * widgets.json would look up a param named `currentDate` and be omitted. No
 * param in the live manifest does that, and guessing at which `$` is which
 * would be a rule with nothing to validate it against.
 */
export function optionsRequestParams(
  optionsParams: Record<string, string | number | boolean> | undefined,
  values: Record<string, string>,
  today: Date = new Date(),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(optionsParams ?? {})) {
    if (typeof raw === "string" && raw.startsWith("$")) {
      const referenced = values[raw.slice(1)];
      if (referenced === undefined || referenced === "") continue;
      out[key] = resolveParamValue(referenced, today);
      continue;
    }
    out[key] = String(raw);
  }
  return out;
}
