// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

// Intl.NumberFormat construction is expensive and TableRenderer calls
// formatCell per cell, so formatters are cached by locale + options. Shared
// (exported) rather than kept per module: src/lib/chart/formats.ts builds
// its own fixed-decimal and compact-volume formatters from the same cache
// instead of keeping a second Map.
const formatterCache = new Map<string, Intl.NumberFormat>();

export function getFormatter(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = formatterCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, nf);
  }
  return nf;
}
