// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/** B12: a link is untrusted input. Exactly two shapes, a UUID each, and a link only opens. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type ArtsLink = { kind: "inbox" | "chart"; id: string };

export function parseDeepLink(raw: string): ArtsLink | null {
  const m = /^bdobb:\/\/(inbox|chart)\/([^/?#]+)$/.exec(raw);
  if (!m) return null;
  const id = m[2].toLowerCase();
  return UUID.test(id) ? { kind: m[1] as ArtsLink["kind"], id } : null;
}

export function parseWebLink(search: string): ArtsLink | null {
  const q = new URLSearchParams(search);
  const keys = [...q.keys()];
  if (keys.length !== 1 || (keys[0] !== "inbox" && keys[0] !== "chart")) return null;
  const id = (q.get(keys[0]) ?? "").toLowerCase();
  return UUID.test(id) ? { kind: keys[0], id } : null;
}
