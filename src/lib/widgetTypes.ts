// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What WidgetCard can draw, and what it deliberately cannot.
 *
 * These are DECLARED, not derived: WidgetCard dispatches across several early
 * returns and a switch, and restructuring it so a test could read one list
 * would be a change to production code for a test's benefit. The cost is
 * stated plainly -- adding a renderer without adding its type here leaves the
 * conformance check answering from a stale list. The disjointness test catches
 * the one case that would silently pass either way.
 */
export const RENDERED_TYPES: ReadonlySet<string> = new Set([
  "table",
  "chart",
  "markdown",
  "html",
  "metric",
  "iframe",
  "note",
  "clock",
  "pdf",
  "multi_file_viewer",
  "rss",
  "keys",
  "local_table",
  "markdown_editor",
  "news",
  "param_echo",
  "youtube",
  "chart-highcharts",
  "chart-vegalite",
  "newsfeed",
  "live_grid",
  "omni",
  "advanced_charting",
  "live_chart",
]);

/**
 * Types the reference backend publishes that BDOBB shows as raw JSON. This is
 * the designed exercise of the raw fallback, not a gap: a card still renders,
 * readably, rather than failing. The set is asserted by the conformance suite
 * so a NEW upstream type arrives as a test failure rather than as a silent
 * enlargement of the set of widgets shown as raw JSON.
 */
export const KNOWN_UNRENDERED_TYPES: ReadonlySet<string> = new Set<string>();
