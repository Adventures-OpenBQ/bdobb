// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A security boundary, not a convenience. The URL may come from a backend's
 * widgets.json or, from SP4, be typed by a user, and it is handed straight to
 * an iframe `src` or to the system browser. Anything but http/https — most
 * pointedly `javascript:` and `data:` — is refused.
 *
 * Parsing with `URL` rather than string-matching is deliberate: it normalises
 * casing and leading whitespace, so `" JaVaScRiPt:"` cannot slip past a
 * `startsWith` check. A relative path has no protocol and is refused too;
 * an iframe widget's endpoint is specified as a full URL.
 */
export function safeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}
