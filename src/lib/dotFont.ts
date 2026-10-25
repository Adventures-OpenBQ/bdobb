// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A 5x7 dot-matrix bitmap font for the clock's digital face, so the digits are
 * drawn as individual dots (see DotMatrix) rather than set in a typeface. Only
 * the glyphs a clock needs exist: the ten digits and the colon. Rows are
 * strings of "1" (lit) and "0" (off); the colon is one column wide so it sits
 * tight between digits.
 */
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["0", "0", "1", "0", "1", "0", "0"],
};

const BLANK = ["00000", "00000", "00000", "00000", "00000", "00000", "00000"];

/**
 * The lit/off grid (7 rows) for one character. An unknown character is a blank
 * 5-wide cell rather than an error: the clock only ever passes digits and a
 * colon, and a blank keeps the layout intact if that ever changes.
 */
export function glyph(ch: string): boolean[][] {
  return (GLYPHS[ch] ?? BLANK).map((row) => [...row].map((c) => c === "1"));
}
