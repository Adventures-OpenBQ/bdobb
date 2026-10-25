// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMinuteTick } from "../../hooks/useMinuteTick";
import { DEFAULT_ZONES, deriveRows, parseZones, type ZoneRow } from "../../lib/zones";
import { AnalogFace } from "./AnalogFace";
import { DotMatrix } from "./DotMatrix";

/** The spoken equivalent of a tile, since the face itself is aria-hidden. */
function spoken(row: ZoneRow): string {
  return `${row.city}, ${row.time}${row.suffix}, ${row.region}, ${row.offset}`;
}

/**
 * Takes the card's params, not a payload — a clock has no backend and nothing
 * is fetched for it.
 *
 * `timezone` and `hour12` are legacy params from before this widget took a
 * list. They are read only when the modern param is absent, so a card created
 * back then keeps working without being silently rewritten.
 */
export function ClockRenderer({ params }: { params: Record<string, string> }) {
  const now = useMinuteTick();

  // Treats null/undefined and empty/whitespace-only strings as absent.
  const raw = params.zones?.trim() || params.timezone?.trim() || DEFAULT_ZONES;
  const hourCycle: "12" | "24" =
    params.hourCycle === "12" || (params.hourCycle === undefined && params.hour12 === "true")
      ? "12"
      : "24";
  const horizontal = params.layout === "horizontal";
  const face = params.face === "solid" ? "solid" : "dots";

  const { rows, unknown } = deriveRows(parseZones(raw), now, hourCycle);

  return (
    <div className="clock">
      {unknown.length > 0 ? (
        <p className="clock-unknown">Unknown time zone: {unknown.join(", ")}</p>
      ) : null}

      {horizontal ? (
        <div className="clock-gallery">
          {rows.map((row) => (
            <div className="clock-tile" key={row.zone} role="img" aria-label={spoken(row)}>
              <AnalogFace hour={row.hour} minute={row.minute} />
              <span className="clock-tile-city">{row.city}</span>
              <span className="clock-tile-region">{row.region}</span>
              <span className="clock-tile-offset">{row.offset}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="clock-list" data-face={face}>
          {rows.map((row) => (
            <div className="clock-row" key={row.zone}>
              <span className="clock-row-city">{row.city}</span>
              {/* Region and offset sit between the city and the time, as one
                  centred group, so the eye reads city -> where -> when. */}
              <span className="clock-row-where">
                <span className="clock-row-region">{row.region}</span>
                <span className="clock-row-offset">{row.offset}</span>
              </span>
              {/* The digital time as a real dot-matrix panel (see DotMatrix),
                  not a typeface. row.time ("17:30") is its accessible label. */}
              <DotMatrix className="clock-row-time" text={row.time} face={face} />
              {row.suffix ? <span className="clock-row-suffix">{row.suffix}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
