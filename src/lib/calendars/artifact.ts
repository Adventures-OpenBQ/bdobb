// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarError, validateBundle, type CalendarBundle } from "./contracts";
/** RFC 8785-style canonical JSON: sorted keys, no whitespace; refuses numbers JSON cannot carry exactly. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new CalendarError("UNSAFE_NUMBER");
  if (value === undefined) throw new CalendarError("INVALID_JSON");
  return JSON.stringify(value);
}
/** Lower-case hex SHA-256 of a string's UTF-8 bytes, via WebCrypto. */
export async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** A bundle that passes the vendored schema AND whose content digest matches; anything else throws. */
export async function verifyBundle(value: unknown): Promise<CalendarBundle> {
  const b = validateBundle(value);
  const content = Object.fromEntries(Object.entries(b).filter(([k]) => k !== "digest" && k !== "generatedAt"));
  if ((await sha256(canonical(content))) !== b.digest) throw new CalendarError("DIGEST_MISMATCH");
  return b;
}
