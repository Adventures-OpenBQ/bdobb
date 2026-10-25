// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export const DEFAULT_ZONES =
  "America/New_York,America/Chicago,America/Los_Angeles,Europe/London,Asia/Shanghai,Asia/Tokyo,Australia/Sydney";

export type ZoneRow = {
  /** The IANA name exactly as the user gave it. */
  zone: string;
  /** Last path segment of the CANONICAL zone, underscores replaced. */
  city: string;
  /** A legacy alias of the canonical zone where one is shorter, else the IANA name. */
  region: string;
  /** e.g. "GMT-5". */
  offset: string;
  /** "17:30" under the 24-hour cycle, "05:30" under the 12-hour one. */
  time: string;
  /** "" under 24-hour; a bare "A" or "P" under 12-hour. */
  suffix: string;
  /** Always 0-23, whatever the hour cycle — AnalogFace does its own %12. */
  hour: number;
  minute: number;
};

/**
 * IANA backward-compatibility names, resolved through Intl on first use to
 * build canonical -> alias. Curated to PLACE and COUNTRY style names: the
 * three-letter offset-style names (EST, MST, HST, CET, EET, WET, MET) are
 * deliberately absent, because they name an offset rather than a place and
 * are never more readable — and being three uppercase letters they are
 * structurally indistinguishable from PRC, ROC and ROK, which are wanted. No
 * rule can separate those, so the separation lives here in the data.
 *
 * The list is bounded on purpose: it covers the default zones and the common
 * cases around them, not the whole tzdata `backward` file. A zone with no
 * entry keeps its IANA name, which is the documented fallback anyway.
 *
 * EST5EDT, CST6CDT, MST7MDT and PST8PDT ARE included, on purpose, even
 * though they are POSIX offset rules rather than places: they canonicalise
 * to the same four zones as US/Eastern, US/Central, US/Mountain and
 * US/Pacific, and are shorter than every one of those. They exist here to
 * exercise the digit filter in buildAliasMap below — without a candidate
 * that has a digit AND is shorter than its place-style rival, that filter
 * has nothing to reject and its test passes vacuously. Do not "clean up"
 * these four as stray offset rules; removing them silently reopens the bug
 * where zoneLabel("America/New_York") would return "EST5EDT" instead of
 * "US/Eastern".
 */
const ALIAS_CANDIDATES = [
  "US/Eastern", "US/Central", "US/Mountain", "US/Pacific",
  "US/Alaska", "US/Hawaii", "US/Arizona", "US/Samoa",
  "EST5EDT", "CST6CDT", "MST7MDT", "PST8PDT",
  "Canada/Eastern", "Canada/Central", "Canada/Mountain", "Canada/Pacific",
  "Canada/Atlantic", "Canada/Newfoundland",
  "Mexico/General", "Mexico/BajaNorte", "Mexico/BajaSur",
  "Brazil/East", "Brazil/West", "Brazil/Acre",
  "Chile/Continental", "Chile/EasterIsland",
  "GB", "GB-Eire", "Eire", "Portugal", "Iceland", "Poland", "Turkey",
  "Israel", "Egypt", "Libya", "Iran", "Cuba", "Jamaica",
  "PRC", "ROC", "ROK", "Japan", "Singapore", "Hongkong",
  "NZ", "NZ-CHAT",
  "Australia/NSW", "Australia/Victoria", "Australia/Queensland",
  "Australia/North", "Australia/South", "Australia/West", "Australia/Tasmania",
];

function buildAliasMap(): Map<string, string> {
  const byCanonical = new Map<string, string[]>();
  for (const candidate of ALIAS_CANDIDATES) {
    let canonical: string;
    try {
      canonical = new Intl.DateTimeFormat("en", { timeZone: candidate })
        .resolvedOptions().timeZone;
    } catch {
      continue; // An engine that does not know this alias simply has no entry.
    }
    // A name that resolves to itself is a zone, not an alias.
    if (canonical === candidate) continue;
    const list = byCanonical.get(canonical) ?? [];
    list.push(candidate);
    byCanonical.set(canonical, list);
  }

  const chosen = new Map<string, string>();
  for (const [canonical, aliases] of byCanonical) {
    // A digit means a POSIX offset rule (EST5EDT, PST8PDT). Those also
    // canonicalise to real zones and are SHORTER than the place-style alias,
    // so without this filter EST5EDT would beat US/Eastern.
    const readable = aliases.filter((a) => !/[0-9]/.test(a));
    if (readable.length === 0) continue;
    readable.sort((a, b) => a.length - b.length || a.localeCompare(b));
    const best = readable[0];
    // Only an alias that is actually shorter earns the swap; otherwise the
    // IANA name stands, which is what the spec says to fall back to.
    if (best.length < canonical.length) chosen.set(canonical, best);
  }
  return chosen;
}

// Built lazily, on the first zoneLabel call, rather than at module load: the
// ~54 Intl.DateTimeFormat constructions in buildAliasMap cost roughly 16ms,
// which is otherwise paid by every user on the boot path, including one who
// never adds a clock.
let aliases: Map<string, string> | undefined;

function getAliases(): Map<string, string> {
  return (aliases ??= buildAliasMap());
}

export function zoneLabel(zone: string): string {
  return getAliases().get(zone) ?? zone;
}

/**
 * The IANA name Intl actually resolved `zone` to, or null if Intl does not
 * recognise it. `Intl` accepts more than the canonical spelling — a legacy
 * alias like US/Eastern or a differently-cased name like america/new_york —
 * so anything derived from the zone (city, region, dedupe identity) must be
 * derived from this, not from the string the caller typed.
 */
function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidZone(zone: string): boolean {
  return canonicalZone(zone) !== null;
}

/**
 * Dedupes on the canonical zone, not the raw text: America/New_York and
 * US/Eastern are the same IANA zone spelled two ways, and a pasted list
 * mixing them should still produce one row, not two clocks reading the same
 * time under different labels. An entry Intl does not recognise has no
 * canonical form to key on, so it dedupes on its own trimmed text instead —
 * it still reaches `unknown` in deriveRows, just once per distinct spelling.
 * The first occurrence's original spelling is what survives, since that is
 * the string ZoneRow.zone must keep.
 */
export function parseZones(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw.split(",")) {
    const zone = entry.trim();
    if (zone === "") continue;
    const key = canonicalZone(zone) ?? zone;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(zone);
  }
  return out;
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

function rowFor(zone: string, canonical: string, now: Date, hourCycle: "12" | "24"): ZoneRow {
  // `canonical` is the form deriveRows already resolved while separating the
  // invalid zones, so each zone is resolved once, not twice.
  const segments = canonical.split("/");
  const city = segments[segments.length - 1].replace(/_/g, " ");

  const offset = part(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now),
    "timeZoneName",
  );

  // Always read the hands from a 24-hour formatting, whatever the widget's
  // hour cycle: AnalogFace takes its own modulo and must not be handed a
  // 12-hour value that has already lost the distinction.
  const h23 = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(part(h23, "hour"));
  const minute = Number(part(h23, "minute"));

  if (hourCycle === "24") {
    return { zone, city, region: zoneLabel(canonical), offset, hour, minute,
             time: `${part(h23, "hour")}:${part(h23, "minute")}`, suffix: "" };
  }

  const h12 = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(now);
  return {
    zone, city, region: zoneLabel(canonical), offset, hour, minute,
    time: `${part(h12, "hour")}:${part(h12, "minute")}`,
    // A BARE letter, per the spec — "P", not "PM".
    suffix: part(h12, "dayPeriod").charAt(0).toUpperCase(),
  };
}

/**
 * Invalid zones are separated BEFORE any formatting. `zones` is free text, so
 * a typo is the expected case rather than an edge case, and a RangeError
 * thrown during render would escape the card entirely.
 */
export function deriveRows(
  zones: string[],
  now: Date,
  hourCycle: "12" | "24",
): { rows: ZoneRow[]; unknown: string[] } {
  const rows: ZoneRow[] = [];
  const unknown: string[] = [];
  for (const zone of zones) {
    const canonical = canonicalZone(zone);
    if (canonical === null) {
      unknown.push(zone);
      continue;
    }
    rows.push(rowFor(zone, canonical, now, hourCycle));
  }
  return { rows, unknown };
}
