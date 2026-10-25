// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Pivot button's icon.
 *
 * ARTWORK: "Pivot" by Matt Garbarino, from the Noun Project
 * (https://thenounproject.com/icon/pivot-115905/), CC BY 3.0. It is NOT this
 * project's and is not under the AGPL licence above, which covers only the
 * component around it. Modified in two ways, both stated wherever the credit
 * is given: cropped to the artwork -- the download's viewBox is 0 0 100 125,
 * the bottom quarter being two lines of credit text that cannot be read at
 * title-bar size -- and drawn in `currentColor` so it follows the button's
 * text colour, pressed state included.
 *
 * The credit a 16px icon cannot carry lives in src/assets/icons/LICENSE.md,
 * THIRD_PARTY_NOTICES.md. The toolbar tooltip also identifies the artist and
 * licence. Replacing the icon requires updating its attribution.
 *
 * aria-hidden: the button names itself ("Pivot"); the drawing adds nothing a
 * screen reader should say twice.
 */
export function PivotIcon() {
  return (
    <svg
      className="pivot-icon"
      viewBox="0 0 100 100"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M43.7,65.6v24.9h15.7V65.6H43.7z" />
      <path d="M95,35c0,4.2-1.1,8.3-2.9,11.8l0,0c-2.5,4.7-6.3,8.6-11.1,11l0,0c-3.5,1.9-7.4,2.8-11.6,2.8H32.5v10.5L5,53.5l27.5-19.1  v10.5H44h25.5c5.3,0,9-4.4,9-9.9s-3.5-9.8-9-9.8h-5.1c-2.7,0-4.8,2.2-4.8,4.8v10.3H44V22.1c0-6,5-12.6,11.1-12.6h14.5  c2.9,0,5.7,0.5,8.3,1.4l0,0c6.3,2.1,11.3,6.6,14.4,12.4c0.4,0.6,0.6,1.2,1,1.9C94.3,28.2,95,31.5,95,35z" />
    </svg>
  );
}
