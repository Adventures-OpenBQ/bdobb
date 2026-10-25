// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { BUILTIN_BACKEND_ID, BUILTIN_WIDGETS, SSRM_TYPES, fetchesData, LOCAL_TABLE_ID } from "./builtins";
import type { WidgetDef } from "./types";
import { widget as baseWidget } from "../test/fixtures";

function byId(id: string): WidgetDef {
  const w = BUILTIN_WIDGETS.find((x) => x.id === id);
  if (!w) throw new Error(`no builtin ${id}`);
  return w;
}

describe("BUILTIN_WIDGETS", () => {
  it("uses the reserved backend id for every built-in", () => {
    expect(BUILTIN_WIDGETS.every((w) => w.backendId === BUILTIN_BACKEND_ID)).toBe(true);
  });

  it("defines the note with a hidden text param", () => {
    const note = byId("note");
    expect(note.type).toBe("note");
    expect(note.gridData).toEqual({ w: 15, h: 8 });
    expect(note.params.find((p) => p.paramName === "text")?.show).toBe(false);
  });

  it("defines the markdown editor with a hidden text param, distinct from the note", () => {
    const md = byId("markdown");
    expect(md.name).toBe("Markdown");
    expect(md.type).toBe("markdown_editor");
    expect(md.gridData).toEqual({ w: 20, h: 14 });
    expect(md.params).toEqual([{ paramName: "text", label: "Text", type: "text", show: false }]);
    // The note is untouched: same id, same type, same shape as before.
    expect(byId("note").type).toBe("note");
  });

  it("declares the Parameter echo with a symbol-typed ticker, a date, and a year list", () => {
    const echo = BUILTIN_WIDGETS.find((w) => w.id === "param_echo")!;
    expect(echo.type).toBe("param_echo");
    expect(echo.params.map((p) => [p.paramName, p.type, p.groupType])).toEqual([
      ["ticker", "text", "symbol"],
      ["date", "date", undefined],
      ["year", undefined, undefined],
    ]);
    expect(fetchesData(echo)).toBe(false);
  });

  it("declares the Period echo: one control per period type, the fiscal ones reading fy_end, all defaulting to T", () => {
    const echo = byId("period_echo");
    expect(echo.type).toBe("param_echo");
    expect(echo.name).toBe("Period echo");
    expect(echo.gridData).toEqual({ w: 20, h: 8 });
    expect(echo.params.map((p) => [p.paramName, p.type, p.value])).toEqual([
      ["fy_end", undefined, "December"],
      ["quarter", "quarter", "T"],
      ["fiscal_year", "fiscal_year", "T"],
      ["week", "week", "T"],
      ["asof", "datetime", "T"],
      ["start_date", "date_range", "2026-01-01/T"],
      ["session", "time", "09:30:00"],
    ]);
    expect(echo.params[0].options?.map((o) => o.value)).toEqual(["December", "September", "June", "January"]);
    expect(echo.params[1].fiscalYearEndParam).toBe("fy_end");
    expect(echo.params[2].fiscalYearEndParam).toBe("fy_end");
    expect(echo.params[4].granularity).toBe("second");
    expect(echo.params[5].rangeEnd).toBe("end_date");
    expect(fetchesData(echo)).toBe(false);
  });

  it("gives the Parameter echo's date the T default", () => {
    expect(byId("param_echo").params.find((p) => p.paramName === "date")?.value).toBe("T");
  });

  it("defines the website as an iframe with a url param", () => {
    const site = byId("website");
    expect(site.type).toBe("iframe");
    expect(site.gridData).toEqual({ w: 24, h: 16 });
    expect(site.params.map((p) => p.paramName)).toContain("url");
  });

  it("warns in the url param description that many sites refuse framing", () => {
    const url = byId("website").params.find((p) => p.paramName === "url")!;
    expect(url.description).toMatch(/refuse to be embedded/i);
  });

  it("files both built-ins under the Built-in category", () => {
    expect(BUILTIN_WIDGETS.every((w) => w.category === "Built-in")).toBe(true);
  });
});

describe("fetchesData", () => {
  const widget = (over: Partial<WidgetDef>): WidgetDef =>
    baseWidget({ category: "", gridData: { w: 1, h: 1 }, ...over });

  it("is true for an ordinary backend widget", () => {
    expect(fetchesData(widget({}))).toBe(true);
  });

  it("is false for any iframe widget, whose endpoint is the URL", () => {
    expect(fetchesData(widget({ type: "iframe" }))).toBe(false);
  });

  it("is false for anything the app supplies itself", () => {
    expect(fetchesData(widget({ backendId: BUILTIN_BACKEND_ID, type: "note" }))).toBe(false);
  });

  it("is false for every shipped built-in", () => {
    expect(BUILTIN_WIDGETS.every((w) => !fetchesData(w))).toBe(true);
  });

  it("is false for advanced_charting: its renderer asks the UDF history route itself", () => {
    expect(fetchesData(widget({ type: "advanced_charting" }))).toBe(false);
  });

  it("is false for a keys widget on a real backend: its surface lives in Settings and must never pull the tier-3 plaintext payload", () => {
    expect(fetchesData(widget({ type: "keys" }))).toBe(false);
  });

  it("is false for an omni widget, which POSTs on prompt submit", () => {
    expect(fetchesData(widget({ type: "omni" }))).toBe(false);
  });

  it("is false for a settings widget: it is a Settings section, and key-maint's points at the tier-3 /keys payload", () => {
    expect(fetchesData(widget({ type: "settings" }))).toBe(false);
  });

  it("is false for a multi_file_viewer, whose endpoint answers 405 to a GET", () => {
    // Its documents are reached by a POST the renderer issues once files are
    // picked, so a card-level fetch could only ever produce an error card.
    expect(fetchesData(widget({ type: "multi_file_viewer" }))).toBe(false);
  });

  it("is still true for a pdf widget, which IS an ordinary GET", () => {
    expect(fetchesData(widget({ type: "pdf" }))).toBe(true);
  });

  it.each([["ssrm_table"], ["table_ssrm"]])(
    "is false for a %s widget, whose endpoint answers a POST carrying the row range",
    (type) => {
      // A GET is at best a 405 and at worst an answer this app cannot read.
      // The card says the type is unsupported instead; see WidgetCard's body().
      expect(fetchesData(widget({ type }))).toBe(false);
    },
  );

  it("is still true for an ordinary table, which SSRM must not drag down with it", () => {
    expect(fetchesData(widget({ type: "table" }))).toBe(true);
  });
});

describe("SSRM_TYPES", () => {
  it("holds both spellings OpenBB's own documents use, and nothing else", () => {
    // The ssrm_mode page and the example backend say "ssrm_table"; the
    // widgets.json reference page says "table_ssrm". Both are matched; the
    // first is the one the UI names.
    expect([...SSRM_TYPES].sort()).toEqual(["ssrm_table", "table_ssrm"]);
  });
});

describe("the clock built-in", () => {
  it("is defined with the spec's type, grid and params", () => {
    const clock = BUILTIN_WIDGETS.find((w) => w.id === "clock")!;
    expect(clock.type).toBe("clock");
    expect(clock.gridData).toEqual({ w: 22, h: 16 });
    expect(clock.params.map((p) => p.paramName)).toEqual([
      "zones", "layout", "hourCycle", "face",
    ]);
  });

  it("tells the reader the face param does nothing under the horizontal layout", () => {
    const clock = BUILTIN_WIDGETS.find((w) => w.id === "clock")!;
    const face = clock.params.find((p) => p.paramName === "face")!;
    expect(face.description).toMatch(/Only applies to the Vertical layout\.$/);
  });

  it("does not fetch", () => {
    expect(fetchesData(BUILTIN_WIDGETS.find((w) => w.id === "clock")!)).toBe(false);
  });
});

describe("the rss built-in", () => {
  it("is defined with the spec's type, grid and params", () => {
    const rss = byId("rss");
    expect(rss.type).toBe("rss");
    expect(rss.name).toBe("RSS feed");
    expect(rss.gridData).toEqual({ w: 20, h: 12 });
    expect(rss.params).toEqual([
      { paramName: "url", label: "Feed URL", type: "text", show: true },
      { paramName: "limit", label: "Items", type: "number", value: "20", show: true },
    ]);
  });

  it("declares no refetchInterval, so the user's auto-refresh setting governs it", () => {
    expect(byId("rss").refetchInterval).toBeUndefined();
  });

  it("does not fetch: the renderer owns the request, and the card must issue none", () => {
    // A card-level fetch would join the feed URL onto a backend base and ask
    // a backend for it -- there is no backend behind a built-in at all.
    expect(fetchesData(byId("rss"))).toBe(false);
  });
});

describe("the local table built-in", () => {
  it("is defined with the spec's type, grid and hidden file param", () => {
    const local = byId(LOCAL_TABLE_ID);
    expect(local.type).toBe(LOCAL_TABLE_ID);
    expect(local.name).toBe("Local file");
    expect(local.gridData).toEqual({ w: 24, h: 14 });
    expect(local.params).toEqual([
      { paramName: "file", label: "File", type: "text", show: false },
    ]);
  });

  it("does not fetch: its rows come from a file, not from a backend", () => {
    expect(fetchesData(byId(LOCAL_TABLE_ID))).toBe(false);
  });
});

describe("fetchesData for live_grid", () => {
  it("is false so the card leaves the snapshot fetch to LiveGridRenderer", () => {
    expect(fetchesData({ type: "live_grid", backendId: "b1" } as unknown as WidgetDef)).toBe(false);
  });
});
