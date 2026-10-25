// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  PROBE_RESULTS,
  type DiagnosticCode,
  type KeyCheck,
  type KeysRow,
  type ProbeResultName,
} from "./providerKeys";

export type Category = "available" | "attention" | "not_configured" | "not_checked";
export type Credential = "own" | "demo" | "none_required" | "optional" | "not_set" | "unknown";
export type Filter = "all" | "available" | "attention" | "not_configured" | "not_checked" | "none_required";
export type Sort = "name-asc" | "name-desc" | "available-first" | "attention-first";
export type View = { filter: Filter; sort: Sort };
export type Check = KeyCheck;

export type Provider = {
  id: string;      // provider_id ?? env_var
  envVar: string;  // the env var passed to Test / Save
  name: string;
  category: Category;
  keyRequired: boolean | null;
  credential: Credential;
  statusLabel: string;
  explanation: string;
  tested: boolean;
  testable: boolean;
  code?: DiagnosticCode;
  checkedAt?: string;
  checks?: Check[];
};

/** The card status label for a code; also the short label a summary uses. */
export const CODE_LABELS: Record<DiagnosticCode, string> = {
  dns_failure: "DNS failed",
  connect_timeout: "Timed out",
  connect_refused: "Connection refused",
  tls_error: "TLS error",
  http_auth: "Rejected",
  rate_limited: "Rate limited",
  upstream_error: "Upstream error",
  unexpected_response: "Unexpected response",
  egress_policy_denied: "Firewall blocked",
  not_installed: "Not installed",
};

/** The credential line's text for each derived credential state. */
export const CREDENTIAL_LABEL: Record<Credential, string> = {
  own: "Own key",
  demo: "Demo key",
  none_required: "None Required",
  optional: "Optional",
  not_set: "Not set",
  unknown: "Unknown",
};

/** The five summary tiles, in order; none_required renders only when a row carries `auth`. */
export const TILE_LABELS: ReadonlyArray<readonly [Filter, string]> = [
  ["available", "Available"],
  ["attention", "Needs attention"],
  ["not_configured", "Not configured"],
  ["not_checked", "Not checked"],
  ["none_required", "No key required"],
];

/**
 * Object.hasOwn, never `MAP[key]`: the row comes from key-maint's untrusted
 * JSON, so a result or code of "constructor"/"toString" must not resolve an
 * inherited Object.prototype member.
 */
function normalizeCode(code: string | undefined): DiagnosticCode | undefined {
  if (code === undefined) return undefined;
  return Object.hasOwn(CODE_LABELS, code) ? (code as DiagnosticCode) : undefined;
}

function probeLabel(result: string): string {
  return Object.hasOwn(PROBE_RESULTS, result) ? PROBE_RESULTS[result as ProbeResultName].label : result;
}

/** The human label for one check line in Details. */
export function checkLabel(check: Check): string {
  return CODE_LABELS[normalizeCode(check.code) as DiagnosticCode] ?? probeLabel(check.result);
}

/** The fixed Not-checked explanation for a row with no usable result. */
function notCheckedExplanation(test: KeysRow["test"]): string {
  if (test === undefined || test.result === undefined || test.result === "") return "No test result yet";
  if (test.result === "skipped") return "Probe skipped";
  return "Result not recognised";
}

function deriveCredential(row: KeysRow): Credential {
  if (row.status === "set") return row.demo ? "demo" : "own";
  if (row.auth === "not_required") return "none_required";
  if (row.auth === "optional") return "optional";
  if (row.status === "empty" || row.status === "missing") return row.auth === "unknown" ? "unknown" : "not_set";
  return "unknown"; // status "unknown"
}

/**
 * One KeysRow → one dashboard Provider. The category table is spec §3 (plus the
 * 2026-09-23 amendment), evaluated strictly top to bottom: a not-installed row
 * first, then keyless AND optional rows (so neither is ever "Not configured" for
 * a missing credential), then the credentialed cases. A stale `ok` never
 * survives a missing key — only a current `ok` reaches Available (spec §6,
 * "Configured is not Online"). `value` is never read here. `test` is already the
 * backend's worse-of-`checks`, so derivation reads only `test`.
 */
export function deriveProvider(row: KeysRow): Provider {
  const test = row.test;
  const result = test?.result;
  const code = normalizeCode(test?.code);
  const fail = result === "auth_failed" || result === "error" || result === "no_response";
  // Keyless in the category sense: works without a key, so a missing credential
  // never means "Not configured".
  const keyless = row.auth === "not_required" || row.auth === "optional";
  const notInstalled = row.supported === false || code === "not_installed";
  const base = {
    id: row.provider_id ?? row.env_var,
    envVar: row.env_var,
    name: row.provider,
    keyRequired: row.auth === "required" ? true : keyless ? false : null,
    credential: deriveCredential(row),
    tested: result !== undefined && result !== "",
    testable: !notInstalled,
    code,
    checkedAt: test?.checked_at,
    checks: row.checks,
  } as const;

  // A credential the registry knows but the backend has not installed: no test
  // to run, so no Available/attention verdict and no Test action.
  if (notInstalled)
    return { ...base, category: "not_checked", statusLabel: "Not installed", explanation: "Not installed on this backend" };

  if (keyless) {
    if (result === "ok") return { ...base, category: "available", statusLabel: "Available", explanation: test?.detail ?? "" };
    if (fail) return { ...base, category: "attention", statusLabel: CODE_LABELS[code as DiagnosticCode] ?? probeLabel(result as string), explanation: test?.detail ?? "" };
    return { ...base, category: "not_checked", statusLabel: "Not checked", explanation: notCheckedExplanation(test) };
  }
  if (row.status === "empty" || row.status === "missing")
    return { ...base, category: "not_configured", statusLabel: "Not configured", explanation: test?.detail ?? "" };
  if (row.status === "set" && row.demo)
    return { ...base, category: "attention", statusLabel: "Demo access", explanation: test?.detail ?? "" };
  if (row.status === "set" && result === "ok")
    return { ...base, category: "available", statusLabel: "Available", explanation: test?.detail ?? "" };
  if (row.status === "set" && fail)
    return { ...base, category: "attention", statusLabel: CODE_LABELS[code as DiagnosticCode] ?? probeLabel(result as string), explanation: test?.detail ?? "" };
  if (row.status === "set")
    return { ...base, category: "not_checked", statusLabel: "Not checked", explanation: notCheckedExplanation(test) };
  return { ...base, category: "not_checked", statusLabel: "Not checked", explanation: "Credential state unreadable" };
}

export function summarize(rows: Provider[]): Record<Category | "none_required", number> {
  const counts = { available: 0, attention: 0, not_configured: 0, not_checked: 0, none_required: 0 };
  for (const p of rows) {
    counts[p.category] += 1;
    if (p.keyRequired === false) counts.none_required += 1;
  }
  return counts;
}

export function filterProviders(rows: Provider[], filter: Filter): Provider[] {
  if (filter === "all") return rows;
  if (filter === "none_required") return rows.filter((p) => p.keyRequired === false);
  return rows.filter((p) => p.category === filter);
}

/** Names compared case-/accent-insensitively and naturally; the id (provider_id, else env_var) breaks ties. Copies, never mutates. */
function byName(a: Provider, b: Provider): number {
  const n = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  return n !== 0 ? n : a.id.localeCompare(b.id, undefined, { sensitivity: "base", numeric: true });
}

export function sortProviders(rows: Provider[], sort: Sort): Provider[] {
  const copy = [...rows];
  if (sort === "name-asc") return copy.sort(byName);
  if (sort === "name-desc") return copy.sort((a, b) => -byName(a, b));
  const order: Category[] =
    sort === "available-first"
      ? ["available", "attention", "not_checked", "not_configured"]
      : ["attention", "not_checked", "not_configured", "available"];
  return copy.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || byName(a, b));
}
