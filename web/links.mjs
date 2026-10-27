// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

// B12: the two link query forms. A local copy of src/lib/artsCharts/links.ts parseWebLink,
// because web/ cannot import src/. Returns the canonical (lower-cased) query, or null.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function linkQuery(search) {
  const q = new URLSearchParams(search); const keys = [...q.keys()];
  return keys.length === 1 && (keys[0] === "inbox" || keys[0] === "chart") && UUID_RE.test(q.get(keys[0]) ?? "") ? `?${keys[0]}=${q.get(keys[0]).toLowerCase()}` : null;
}
