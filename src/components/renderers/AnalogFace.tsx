// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** The twelve baton positions, in degrees. */
const BATONS = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * A self-contained SVG face taking only the time. It makes no Intl call —
 * the angles come from arithmetic the clock already has — and it is inherently
 * 12-hour whatever the widget's hour-format setting says.
 *
 * NO SECOND HAND, by construction. The baton ring evokes railway-clock
 * minimalism without reproducing any specific protected design: the
 * proportions are not copied, and the most recognisable protected element —
 * the red lollipop second hand — is absent rather than merely unstyled.
 *
 * White face and black hands regardless of the dashboard's dark theme; a clock
 * face is a physical object and reads wrong inverted.
 */
export function AnalogFace({ hour, minute }: { hour: number; minute: number }) {
  const hourAngle = ((hour % 12) + minute / 60) * 30;
  const minuteAngle = minute * 6;

  return (
    <svg className="analog-face" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill="#fff" stroke="#222" strokeWidth="2" />
      {BATONS.map((angle) => (
        <rect
          key={angle}
          data-baton={angle}
          x="49"
          y="6"
          width="2"
          height="8"
          fill="#222"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <rect
        data-hand="hour"
        x="48.5"
        y="26"
        width="3"
        height="26"
        fill="#111"
        transform={`rotate(${hourAngle} 50 50)`}
      />
      <rect
        data-hand="minute"
        x="49"
        y="14"
        width="2"
        height="38"
        fill="#111"
        transform={`rotate(${minuteAngle} 50 50)`}
      />
      <circle cx="50" cy="50" r="3" fill="#111" />
    </svg>
  );
}
