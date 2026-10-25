// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "vitest";
import { RENDERED_TYPES, KNOWN_UNRENDERED_TYPES } from "./widgetTypes";

describe("widget type sets", () => {
  it("names every type WidgetCard has a renderer for", () => {
    // The types WidgetCard dispatches on, across its early returns and its
    // switch. Kept as a literal here so a drift shows up as a diff.
    for (const type of [
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
    ]) {
      expect(RENDERED_TYPES.has(type)).toBe(true);
    }
  });

  it("names the reference backend's unrendered types", () => {
    // CHANGED ASSERTION: advanced_charting left this list when the TradingView
    // renderer landed (v3.2.4), and omni when its own renderer landed (v3.3.0).
    expect([...KNOWN_UNRENDERED_TYPES]).toEqual([]);
  });

  it("keeps the two sets disjoint", () => {
    // A type in both would make the conformance check pass no matter which
    // branch is true, which is the one way this pair can lie.
    const both = [...RENDERED_TYPES].filter((t) => KNOWN_UNRENDERED_TYPES.has(t));
    expect(both).toEqual([]);
  });
});
