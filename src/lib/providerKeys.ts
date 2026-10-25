// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDef } from "./types";

export type KeyStatus = "keyed" | "unkeyed" | "unknown";

/**
 * The table widget key-maint serves alongside its keys panel. A backend
 * serving this id is a key-maint instance.
 */
export const KEY_MAINT_WIDGET_ID = "provider_api_keys";

/**
 * Is this widget key-maint's key surface?
 *
 * key-maint serves the same `GET /keys` document under two handles: a
 * `keys`-type widget (the Settings panel renders it) and a plain table widget
 * with the id above (a card a user can put on a dashboard). Either one is
 * enough to say "this backend is key-maint", and the two consumers used to
 * ask different questions -- KeysPanel by type, providerKeysStore by id -- so
 * a backend serving only one of them was recognised by only one of them. One
 * rule, both handles, one answer.
 */
export function isKeyMaintWidget(widget: Pick<WidgetDef, "id" | "type">): boolean {
  return widget.type === "keys" || widget.id === KEY_MAINT_WIDGET_ID;
}

/**
 * The ONE key-maint widget both consumers act on, so they can never end up
 * pointed at different ones.
 *
 * The `keys`-type widget wins whenever a backend serves both, and that is not
 * a preference but a requirement: fetchWidgetData hands back the whole
 * `{ tier, rows }` envelope only for that type (the table widget's own
 * `data.dataKey: "rows"` strips it), and the envelope's `tier` is what
 * decides whether KeysPanel may show edit controls at all. The store is happy
 * with either shape, so a backend serving only the table widget is still
 * found -- by the id, exactly as before.
 */
export function findKeyMaintWidget(widgets: WidgetDef[]): WidgetDef | undefined {
  return widgets.find((w) => w.type === "keys") ?? widgets.find(isKeyMaintWidget);
}

/**
 * widgets.json says `Eodhd` / `Alpha_vantage`; key-maint says `EODHD` /
 * `Alpha Vantage`. Lowercase and strip every non-alphanumeric character so
 * the two vocabularies meet.
 *
 * The parenthetical suffix goes first, which is what collapses
 * `Alpaca (secret)` onto `alpaca` — the pairing rule depends on it.
 */
export function normalizeProvider(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The providers key-maint's registry knows, read from its `app/registry.py`.
 * Eighteen rows collapse to seventeen names because Alpaca and Alpaca
 * (secret) normalise together.
 *
 * Expressed as the KEYED set rather than a keyless one: "providers that need
 * no credential" is open-ended and cannot be enumerated, while the registry
 * is finite. Anything outside this set is keyless by definition.
 */
export const REGISTRY_PROVIDERS: ReadonlySet<string> = new Set([
  "fmp", "fred", "tiingo", "alphavantage", "nasdaqdatalink", "eia", "bls",
  "cftc", "congressgov", "econdb", "biztoc", "intrinio", "benzinga",
  "tradingeconomics", "tradier", "alpaca", "eodhd",
]);

export function needsKey(provider: string): boolean {
  return REGISTRY_PROVIDERS.has(normalizeProvider(provider));
}

/**
 * Only these three return JSON. Every other type returns a body `res.json()`
 * would throw on, and the probe would be misclassified as `unknown` instead
 * of skipped outright. `metric` cannot be dropped: a provider serving only
 * metric widgets would otherwise go permanently unprobed.
 */
const PROBEABLE = new Set(["table", "chart", "metric"]);

function missingDefaults(widget: WidgetDef): number {
  return widget.params.filter((p) => p.value === undefined || p.value === "").length;
}

/**
 * Takes the eligible candidate needing the fewest arguments — then returns
 * null unless that count is zero. A provider whose every widget needs an
 * argument the app cannot supply is not probed at all, and its status stays
 * `unknown`. Firing such a probe would return a validation error, which
 * classifyProbe already calls `unknown`; declining is the same answer without
 * the wasted vendor call.
 */
export function pickProbeWidget(widgets: WidgetDef[]): WidgetDef | null {
  const eligible = widgets.filter((w) => PROBEABLE.has(w.type));
  if (eligible.length === 0) return null;
  const best = eligible.reduce((a, b) => (missingDefaults(b) < missingDefaults(a) ? b : a));
  return missingDefaults(best) === 0 ? best : null;
}

/**
 * `unknown` is the default for every failure. A timeout, a 401 or a 5xx does
 * not prove the key is absent — only the backend saying so does.
 */
export function classifyProbe(ok: boolean, body: string): KeyStatus {
  if (ok) return "keyed";
  return body.includes("Missing credential") ? "unkeyed" : "unknown";
}

/**
 * How a provider's latest probe reads on screen. Shared by the Key
 * Maintenance dots and the Library's provider badge so the two surfaces
 * cannot disagree about the same provider.
 */
export type ProbeTone = "green" | "amber" | "red" | "grey";

/**
 * What the vendor said when probed, in key-maint's own vocabulary. A 2xx that
 * rejects the key is AMBER, not red: several vendors (Alpha Vantage and FMP
 * among them) report a bad key with HTTP 200 and an error string in the body,
 * so the status code alone is not the signal — the vendor answered, and the
 * answer was an error.
 */
export const PROBE_RESULTS = {
  ok: { tone: "green", label: "vendor accepted the key" },
  auth_failed: { tone: "amber", label: "vendor rejected the key" },
  error: { tone: "amber", label: "vendor returned an error" },
  no_response: { tone: "red", label: "vendor did not respond" },
  skipped: { tone: "grey", label: "probe skipped" },
  // `as const satisfies`, not a plain annotation: the table is shared by both
  // surfaces that draw a tone, so a caller must not be able to add a result
  // to it or repaint one at runtime. `satisfies` still type-checks every row.
} as const satisfies Record<string, { tone: ProbeTone; label: string }>;

/** The keys of that table, for the `Object.hasOwn` narrowing its readers do. */
export type ProbeResultName = keyof typeof PROBE_RESULTS;

/**
 * Grey covers both "no probe has run" and "a probe ran and said something
 * this app does not understand": inventing a colour for a state we cannot
 * read would be worse than admitting we do not know it. (Callers that must
 * tell the two apart — KeysRenderer's dot label — check `test` themselves.)
 */
export function probeTone(result: string | undefined): ProbeTone {
  if (result === undefined) return "grey";
  // Object.hasOwn, not `PROBE_RESULTS[result]`: a result of "constructor" or
  // "toString" would otherwise find an inherited Object.prototype member.
  return Object.hasOwn(PROBE_RESULTS, result)
    ? PROBE_RESULTS[result as ProbeResultName].tone
    : "grey";
}

/**
 * Worst first: a widget drawing on several providers is only as good as its
 * weakest one, and grey outranks green because "not known to work" must not
 * read as "works".
 */
const TONE_RANK: Record<ProbeTone, number> = { red: 0, amber: 1, grey: 2, green: 3 };

export function worstTone(tones: ProbeTone[]): ProbeTone {
  if (tones.length === 0) return "grey";
  return tones.reduce((worst, tone) => (TONE_RANK[tone] < TONE_RANK[worst] ? tone : worst));
}

/**
 * The store's OWN probe outcome, expressed in key-maint's vocabulary so both
 * sources reach a tone through the one table above.
 *
 * `HTTP <status>` is dataClient's shape for a failure the backend answered
 * with (describeHttpError); a connect timeout, a refused connection or a DNS
 * failure never gets a status, and is the "no response" case.
 */
export function probeResult(ok: boolean, message: string): string {
  if (ok) return "ok";
  return message.startsWith("HTTP ") ? "error" : "no_response";
}

// key-maint's row shapes, read by KeysRenderer and providerAvailability.
export type DiagnosticCode =
  | "dns_failure" | "connect_timeout" | "connect_refused" | "tls_error"
  | "http_auth" | "rate_limited" | "upstream_error" | "unexpected_response"
  | "egress_policy_denied" | "not_installed";

export type UsageWindow = "day" | "hour" | "minute" | "period";

/** A vendor's API usage, as key-maint reports it on the credential check. */
export type Usage = { used: number; limit: number; window: UsageWindow; resets_at?: string; extra?: number };

export type KeyCheck = {
  result: string;
  detail: string;
  kind?: "credential" | "connectivity";
  code?: DiagnosticCode;
  checked_at?: string;
  /** Untrusted until credentialUsage (lib/providerUsage) has checked it. */
  usage?: Usage;
};

export type KeysRow = {
  provider: string;
  env_var: string;
  /** The OpenBB provider id, when key-maint sends it: identity and tie-break. */
  provider_id?: string;
  /** false = the credential is in the registry but the backend has no such provider installed. */
  supported?: boolean;
  status: "set" | "empty" | "missing" | "unknown";
  demo?: boolean;
  /** Present ONLY at tier 3, and deliberately never rendered. */
  value?: string;
  /** What key-maint says about the credential requirement. Absent = today's key-maint. */
  auth?: "required" | "not_required" | "optional" | "unknown";
  /** The backend-computed worse of `checks`; the widget and derivation read this. */
  test?: KeyCheck;
  /** Every check the backend ran, for the Details per-check list. */
  checks?: KeyCheck[];
};
