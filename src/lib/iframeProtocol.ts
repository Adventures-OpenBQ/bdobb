// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace's postMessage protocol, as much of it as bdobb speaks: the
 * shapes, and nothing that touches React, the DOM or a store. Everything here
 * runs against `MessageEvent.data` from a page this app does not control, so
 * every function is total — it answers, it never throws.
 *
 * `openbb-request` and `openbb-data` (sub-widget data) and the theme messages
 * are deliberately absent: nothing in bdobb consumes them, and a shape parsed
 * into a type nobody reads is a promise this app does not keep.
 */

import { isRecord } from "./isRecord";
import { safeUrl } from "./safeUrl";

export type Inbound =
  | { type: "openbb-connect" }
  | { type: "openbb:widget-params:update"; params: Record<string, unknown> }
  | { type: "openbb:widget-params:update"; paramName: string; value: unknown };

export type Outbound =
  | { type: "openbb-auth"; headers: Record<string, string> }
  | { type: "openbb-params-update"; params: Record<string, string> };

const CONNECT = "openbb-connect";
const PARAMS_UPDATE = "openbb:widget-params:update";

/**
 * A structured-clone payload from an untrusted page, narrowed to one of the
 * three shapes this app acts on, or `null`. Strict on purpose: a half-formed
 * message must not become a half-applied edit, and a shape that is merely
 * unrecognised is not an error worth surfacing — the caller decides whether
 * to say anything about it.
 *
 * A connect narrows to its `type` alone. The reference puts `widgets` and
 * `params` on it, and the reply depends on neither, so carrying them through
 * would be a promise about sub-widget data that this version does not keep.
 */
export function parseInbound(data: unknown): Inbound | null {
  if (!isRecord(data)) return null;
  if (data.type === CONNECT) return { type: CONNECT };
  if (data.type !== PARAMS_UPDATE) return null;
  // The map form first: a malformed message carrying both forms loses
  // nothing this way, since only the map can name several parameters.
  if (isRecord(data.params)) return { type: PARAMS_UPDATE, params: data.params };
  if (typeof data.paramName === "string" && data.paramName !== "") {
    return { type: PARAMS_UPDATE, paramName: data.paramName, value: data.value };
  }
  return null;
}

/**
 * Both update forms flattened to the one shape a card can commit: a flat map
 * of strings, because that is what `DashboardCard.params` is and what a query
 * string carries.
 *
 * `null` and `undefined` become `""` rather than their `String()` spelling.
 * `""` is this app's own "send nothing" — `buildWidgetUrl` drops an empty
 * value from the query string and `missingRequiredParams` stops the card at
 * "incomplete" instead of issuing a request — whereas the literal text
 * "null" would be sent to the endpoint as a value.
 */
export function paramsFromUpdate(
  msg: Extract<Inbound, { type: typeof PARAMS_UPDATE }>,
): Record<string, string> {
  if ("params" in msg) {
    // Own enumerable keys only, which is all a structured clone carries.
    return Object.fromEntries(
      Object.entries(msg.params).map(([name, value]) => [name, stringify(value)]),
    );
  }
  return { [msg.paramName]: stringify(msg.value) };
}

/** A declared param's value is persisted and put in a query string; a frame
 * must not be able to make either unbounded. A user could not type this much. */
export const MAX_PARAM_VALUE_LENGTH = 4096;

function stringify(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.length > MAX_PARAM_VALUE_LENGTH ? text.slice(0, MAX_PARAM_VALUE_LENGTH) : text;
}

/**
 * The origin a message from this URL would report, or `null` when there is
 * none to name. `null` is the answer for `about:blank` and `about:srcdoc` —
 * the two a frame actually sits at before, and instead of, a real document —
 * and for anything that is not http(s).
 *
 * It shares `safeUrl`'s parse and http(s) check, but hands back an ORIGIN, and
 * its `null` means "no origin to name as a postMessage target", not "unsafe".
 * The auth rule turns on this and on nothing else.
 */
export function originOf(url: string): string | null {
  const href = safeUrl(url);
  return href === null ? null : new URL(href).origin;
}
