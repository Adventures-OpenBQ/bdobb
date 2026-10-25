// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A name this app did not choose, made safe to interpolate into one log line:
 * a widget's `name` from a user-added backend, a parameter pushed by a framed
 * page. C0 controls and DEL are removed -- the newline among them, which would
 * otherwise end the line early and forge a second one of the sender's choosing
 * in a file read on the user's machine -- and 64 characters is the most any
 * one of them gets, since whoever chose the name chose its length too.
 *
 * Deliberately here and not in the logger, which stays a plain writer: this is
 * about the few logged values that are NOT the app's own literals, and each
 * call site is the only thing that knows which of its pieces those are.
 */
export function clampLogName(name: string): string {
  // eslint-disable-next-line no-control-regex -- Remove control characters from untrusted log labels.
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
}
