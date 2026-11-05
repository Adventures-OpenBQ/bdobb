// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * The date host for a page that carries no grammar (the tests, the snapshot
 * renderer): ISO instants are values, `OBS-n` is the one expression (the
 * server counts trades), and nothing else resolves.
 */
import type { Expression, HostDates } from "./dates";

const OBS = /^OBS-[1-9]\d{0,6}$/;

export const literalDates: HostDates = {
  parseExpression: (v) =>
    OBS.test(v.trim()) ? ({ start: { anchor: { kind: "obs", n: Number(v.trim().slice(4)) }, offsets: [] } } as Expression) : null,
  isExpression: (_t, v) => OBS.test(v.trim()),
  resolveExpression: () => null,
  resolveValue: (_t, v) => v,
  previewExpression: () => null,
  isRangeType: (t): t is "date_range" | "quarter_range" => t === "date_range" || t === "quarter_range",
  splitRange: (v) => {
    const slash = v.indexOf("/");
    if (slash !== -1) return [v.slice(0, slash), v.slice(slash + 1)];
    const dots = v.indexOf("..");
    if (dots !== -1) return [v.slice(0, dots), v.slice(dots + 2)];
    return [v, ""];
  },
};
