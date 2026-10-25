// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { normalizeWidgets, toOptions } from "./widgetsJson";

const raw = {
  price_history: {
    name: "Price History",
    description: "Historical prices",
    category: "Equity",
    subCategory: "Price",
    type: "table",
    endpoint: "equity/price/historical",
    gridData: { w: 20, h: 9 },
    data: { dataKey: "results" },
    source: ["Yfinance"],
    refetchInterval: 60000,
    params: [
      { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
      { paramName: "provider", type: "text", value: "yfinance", show: false },
    ],
  },
};

describe("normalizeWidgets", () => {
  it("keys the object by widget id and stamps the backendId", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(raw, "b1");
    expect(w.id).toBe("price_history");
    expect(w.backendId).toBe("b1");
  });

  it("maps the documented fields", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(raw, "b1");
    expect(w.name).toBe("Price History");
    expect(w.type).toBe("table");
    expect(w.endpoint).toBe("equity/price/historical");
    expect(w.category).toBe("Equity");
    expect(w.subCategory).toBe("Price");
    expect(w.gridData).toEqual({ w: 20, h: 9 });
    expect(w.dataKey).toBe("results");
    expect(w.source).toEqual(["Yfinance"]);
    expect(w.params).toHaveLength(2);
  });

  it("passes a param's groupType through when it is a non-empty string, and drops anything else", () => {
    const { widgets } = normalizeWidgets(
      {
        w: {
          name: "W",
          type: "table",
          endpoint: "w",
          params: [
            { paramName: "ticker", groupType: "symbol" },
            { paramName: "other", groupType: 3 },
            { paramName: "blank", groupType: "" },
          ],
        },
      },
      "b1",
    );
    const params = widgets[0].params;
    expect(params[0].groupType).toBe("symbol");
    expect(params[1]).not.toHaveProperty("groupType");
    expect(params[2]).not.toHaveProperty("groupType");
  });

  it("keeps an explicit refetchInterval: false so the opt-out reaches the hook", () => {
    const {
      widgets: [w],
    } = normalizeWidgets({ w: { endpoint: "e", refetchInterval: false } }, "b1");
    expect(w.refetchInterval).toBe(false);
  });

  it("parses runButton: true, which is what gates the card's fetch on the Run button", () => {
    const {
      widgets: [w],
    } = normalizeWidgets({ w: { endpoint: "e", runButton: true } }, "b1");
    expect(w.runButton).toBe(true);
  });

  it("leaves runButton undefined for anything but a literal true", () => {
    // A widget that never asked to stop executing must not be opted out by a
    // truthy value the reference does not document. `false` and absent are
    // the same situation: there is nothing to record.
    for (const value of ["true", 1, false, null, undefined]) {
      const {
        widgets: [w],
      } = normalizeWidgets({ w: { endpoint: "e", runButton: value } }, "b1");
      expect(w.runButton).toBeUndefined();
    }
  });

  // A typo like `1` (meant as a minute) would otherwise poll every millisecond.
  it("raises a refetchInterval under one second to one second", () => {
    const { widgets } = normalizeWidgets(
      { a: { endpoint: "e", refetchInterval: 1 }, b: { endpoint: "e", refetchInterval: 1_500 }, c: { endpoint: "e", refetchInterval: 0 } },
      "b1",
    );
    expect(widgets.map((w) => w.refetchInterval)).toEqual([1_000, 1_500, 0]);
  });

  it("parses refetchInterval, which the auto-refresh interval then reads", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(raw, "b1");
    expect(w.refetchInterval).toBe(60000);
  });

  it("normalizes a string source into an array", () => {
    const {
      widgets: [w],
    } = normalizeWidgets({ x: { ...raw.price_history, source: "Eodhd" } }, "b1");
    expect(w.source).toEqual(["Eodhd"]);
  });

  it("defaults an absent source to an empty array", () => {
    const { source: _drop, ...noSource } = raw.price_history;
    const {
      widgets: [w],
    } = normalizeWidgets({ x: noSource }, "b1");
    expect(w.source).toEqual([]);
  });

  it("supplies defaults for absent optional fields", () => {
    const {
      widgets: [w],
    } = normalizeWidgets({ bare: { endpoint: "e" } }, "b1");
    expect(w.name).toBe("bare");
    expect(w.description).toBe("");
    expect(w.type).toBe("table");
    expect(w.category).toBe("Uncategorized");
    expect(w.subCategory).toBe("");
    expect(w.gridData).toEqual({ w: 20, h: 9 });
    expect(w.params).toEqual([]);
  });

  it("keeps an unrecognised type verbatim rather than folding it back to table", () => {
    const {
      widgets: [w],
    } = normalizeWidgets({ x: { endpoint: "e", type: "live_grid" } }, "b1");
    expect(w.type).toBe("live_grid");
  });

  it("skips entries that are not objects rather than throwing", () => {
    expect(normalizeWidgets({ good: { endpoint: "e" }, bad: null }, "b1").widgets).toHaveLength(1);
  });

  it("returns an empty array for a non-object payload", () => {
    expect(normalizeWidgets(null, "b1").widgets).toEqual([]);
    expect(normalizeWidgets([], "b1").widgets).toEqual([]);
    expect(normalizeWidgets("nope", "b1").widgets).toEqual([]);
  });
});

describe("normalizeWidgets params validation", () => {
  function widgetWithParams(params: unknown[]) {
    return { w: { endpoint: "e", params } };
  }

  it("keeps a param whose show is a string, with show absent", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "p", show: "no" }]), "b1");
    expect(w.params).toHaveLength(1);
    expect(w.params[0]).toEqual({ paramName: "p" });
    expect(w.params[0]).not.toHaveProperty("show");
  });

  it("keeps optional when it is a boolean and drops it otherwise", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "a", optional: false },
        { paramName: "b", optional: "no" },
      ]),
      "b1",
    );
    expect(w.params[0]).toEqual({ paramName: "a", optional: false });
    expect(w.params[1]).not.toHaveProperty("optional");
  });

  it("keeps a param whose options is not an array, with options absent", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "p", options: "not-an-array" }]), "b1");
    expect(w.params).toHaveLength(1);
    expect(w.params[0]).toEqual({ paramName: "p" });
    expect(w.params[0]).not.toHaveProperty("options");
  });

  it("keeps every member with a string label, and drops the rest", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "p",
          options: [
            { label: "Good", value: "g" },
            // A label with no value at all is the live `{ "label": "All
            // Years" }` shape: kept, as value "", which buildWidgetUrl
            // already omits from the query string.
            { label: "All Years" },
            { value: "no-label" },
            "not-an-object",
            { label: 1, value: "x" },
            // Neither string nor number nor absent: nothing sensible to send.
            { label: "Null", value: null },
          ],
        },
      ]),
      "b1",
    );
    expect(w.params[0].options).toEqual([
      { label: "Good", value: "g" },
      { label: "All Years", value: "" },
    ]);
  });

  it("omits options when the array has no member with a string label", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([{ paramName: "p", options: [{ value: "no-label" }, "nope"] }]),
      "b1",
    );
    expect(w.params[0]).not.toHaveProperty("options");
  });

  it("stringifies a numeric option value, exactly as it already does a numeric default", () => {
    // Before this change, numeric static options (Year, Month) were dropped
    // whole and the param fell back to a text input.
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "year", options: [{ label: "2026", value: 2026 }, { label: "2025", value: 2025 }] },
      ]),
      "b1",
    );
    expect(w.params[0].options).toEqual([
      { label: "2026", value: "2026" },
      { label: "2025", value: "2025" },
    ]);
  });

  it("ignores extraInfo, which fetched options carry and nothing here needs", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "p", options: [{ label: "House", value: "house", extraInfo: { seats: 435 } }] },
      ]),
      "b1",
    );
    expect(w.params[0].options).toEqual([{ label: "House", value: "house" }]);
  });

  it("keeps string, number and boolean values in optionsParams, dropping the rest", () => {
    // The live manifest sends `{"is_workspace": true}`; dropping non-strings
    // silently changed what the options request asked for.
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "p",
          optionsParams: { a: "keep", b: 1, is_workspace: true, c: null, d: { nested: 1 } },
        },
      ]),
      "b1",
    );
    expect(w.params[0].optionsParams).toEqual({ a: "keep", b: 1, is_workspace: true });
  });

  it("omits optionsParams when no value has a usable type", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "p", optionsParams: { a: null } }]), "b1");
    expect(w.params[0]).not.toHaveProperty("optionsParams");
  });

  it("stringifies a boolean default — openbb-api's hidden chart=true", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([{ paramName: "chart", type: "boolean", value: true, show: false }]),
      "b1",
    );
    expect(w.params[0].value).toBe("true");
  });

  it("stringifies a numeric default", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "limit", type: "number", value: 100 }]), "b1");
    expect(w.params[0].value).toBe("100");
  });

  // The reference manifest's multi-select defaults are lists (pdf_name:
  // ["Sample"]); a card's params are strings, comma-joined for a multi-value,
  // so the list is joined rather than dropped.
  it("comma-joins a list default", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([{ paramName: "pdf_name", type: "endpoint", multiSelect: true, value: ["Sample", "Other"] }]),
      "b1",
    );
    expect(w.params[0].value).toBe("Sample,Other");
  });

  // An empty list was dropped before lists were joined; joining it to ""
  // would now override a widget default on import with an empty param.
  it("still drops an empty list default", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "pdf_name", value: [] }]), "b1");
    expect(w.params[0]).not.toHaveProperty("value");
  });

  it("omits value for a null default and for an object default", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "start_date", type: "date", value: null },
        { paramName: "weird", value: { a: 1 } },
      ]),
      "b1",
    );
    expect(w.params[0]).not.toHaveProperty("value");
    expect(w.params[1]).not.toHaveProperty("value");
  });

  it("preserves a well-formed param completely intact", () => {
    const full = {
      paramName: "symbol",
      label: "Symbol",
      type: "text",
      value: "AAPL",
      description: "Ticker",
      show: true,
      options: [{ label: "Apple", value: "AAPL" }],
      optionsEndpoint: "equity/search",
      optionsParams: { query: "a" },
      multiSelect: true,
      roles: ["fileSelector"],
    };
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([full]), "b1");
    expect(w.params[0]).toEqual(full);
  });

  it("keeps multiSelect only when it is a boolean", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "a", multiSelect: false },
        { paramName: "b", multiSelect: "yes" },
      ]),
      "b1",
    );
    expect(w.params[0]).toEqual({ paramName: "a", multiSelect: false });
    expect(w.params[1]).not.toHaveProperty("multiSelect");
  });

  it("parses a tabs param's options exactly as a dropdown's", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "period",
          type: "tabs",
          value: "d",
          options: [
            { label: "Daily", value: "d" },
            { label: "Weekly", value: "w" },
          ],
        },
      ]),
      "b1",
    );
    expect(w.params[0]).toEqual({
      paramName: "period",
      type: "tabs",
      value: "d",
      options: [
        { label: "Daily", value: "d" },
        { label: "Weekly", value: "w" },
      ],
    });
  });

  it("parses a form's endpoint and every documented field type", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "order",
          type: "form",
          endpoint: "orders/submit",
          description: "Place an order",
          inputParams: [
            { paramName: "symbol", type: "text", label: "Symbol", value: "AAPL" },
            { paramName: "qty", type: "number", label: "Quantity", value: 10 },
            { paramName: "when", type: "date", label: "Date" },
            {
              paramName: "side",
              type: "dropdown",
              label: "Side",
              options: [{ label: "Buy", value: "buy" }],
            },
            {
              paramName: "venues",
              type: "dropdown",
              label: "Venues",
              multiSelect: true,
              options: [{ label: "NYSE", value: "nyse" }],
            },
            { paramName: "submit", type: "button", label: "Send", value: "send" },
          ],
        },
      ]),
      "b1",
    );
    expect(w.params[0].form).toEqual({
      endpoint: "orders/submit",
      inputs: [
        { paramName: "symbol", type: "text", label: "Symbol", value: "AAPL" },
        // A numeric default stringifies exactly as WidgetParam.value does.
        { paramName: "qty", type: "number", label: "Quantity", value: "10" },
        { paramName: "when", type: "date", label: "Date" },
        {
          paramName: "side",
          type: "dropdown",
          label: "Side",
          options: [{ label: "Buy", value: "buy" }],
        },
        {
          paramName: "venues",
          type: "dropdown",
          label: "Venues",
          multiSelect: true,
          options: [{ label: "NYSE", value: "nyse" }],
        },
        { paramName: "submit", type: "button", label: "Send", value: "send" },
      ],
    });
    // The description still lands on the param itself, as on any other.
    expect(w.params[0].description).toBe("Place an order");
  });

  it("drops a form field the reference cannot describe, and keeps the rest", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "order",
          type: "form",
          endpoint: "orders/submit",
          inputParams: [
            // No paramName: names no field.
            { type: "text", label: "Nameless" },
            // A type the reference does not document.
            { paramName: "colour", type: "colorpicker" },
            // A dropdown with nothing to choose from.
            { paramName: "side", type: "dropdown" },
            // multiSelect with no list to select FROM.
            { paramName: "venues", type: "text", multiSelect: true },
            // A button with no label to press.
            { paramName: "ghost", type: "button" },
            { paramName: "symbol", type: "text" },
            { paramName: "submit", type: "button", label: "Send" },
          ],
        },
      ]),
      "b1",
    );
    expect(w.params[0].form?.inputs.map((f) => f.paramName)).toEqual(["symbol", "submit"]);
  });

  it("keeps only the first field when two inputParams entries share a paramName", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "order",
          type: "form",
          endpoint: "orders/submit",
          inputParams: [
            { paramName: "symbol", type: "text", label: "First" },
            { paramName: "symbol", type: "text", label: "Second" },
            { paramName: "submit", type: "button", label: "Send" },
          ],
        },
      ]),
      "b1",
    );
    expect(w.params[0].form?.inputs.map((f) => f.paramName)).toEqual(["symbol", "submit"]);
    expect(w.params[0].form?.inputs[0]).toMatchObject({ label: "First" });
  });

  it.each([
    ["no endpoint", { paramName: "f", type: "form", inputParams: [{ paramName: "b", type: "button", label: "Go" }] }],
    ["an empty endpoint", { paramName: "f", type: "form", endpoint: "", inputParams: [{ paramName: "b", type: "button", label: "Go" }] }],
    ["a non-string endpoint", { paramName: "f", type: "form", endpoint: 7, inputParams: [{ paramName: "b", type: "button", label: "Go" }] }],
    ["no inputParams", { paramName: "f", type: "form", endpoint: "e" }],
    ["inputParams that is not an array", { paramName: "f", type: "form", endpoint: "e", inputParams: "b" }],
    ["no surviving button", { paramName: "f", type: "form", endpoint: "e", inputParams: [{ paramName: "s", type: "text" }] }],
  ])("drops a form with %s, keeping the param itself", (_label, param) => {
    // The param survives -- controlKind reports it unsupported, which is
    // hidden and logged once, exactly what a form param did before.
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([param]), "b1");
    expect(w.params).toHaveLength(1);
    expect(w.params[0]).not.toHaveProperty("form");
  });

  it("never puts a form on a param that is not typed as one", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        {
          paramName: "p",
          type: "text",
          endpoint: "e",
          inputParams: [{ paramName: "b", type: "button", label: "Go" }],
        },
      ]),
      "b1",
    );
    expect(w.params[0]).not.toHaveProperty("form");
  });

  // The reference backend's Python Chart omni widget marks its prompt as
  // code with `language: "python"`; OmniRenderer refuses such a widget.
  it("keeps a param's language", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithParams([{ paramName: "prompt", type: "text", language: "python" }]), "b1");
    expect(w.params[0].language).toBe("python");
  });

  it("keeps only the string members of roles, and omits roles entirely when none survive", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithParams([
        { paramName: "a", roles: ["fileSelector", 7, null] },
        { paramName: "b", roles: "fileSelector" },
        { paramName: "c", roles: [1, 2] },
      ]),
      "b1",
    );
    expect(w.params[0].roles).toEqual(["fileSelector"]);
    // A bare string is not an array of strings; the reference shape is a list.
    expect(w.params[1]).not.toHaveProperty("roles");
    expect(w.params[2]).not.toHaveProperty("roles");
  });
});

describe("issue reporting", () => {
  it("accepts exactly the widgets it accepted before, with every field intact", () => {
    const raw = { w1: { name: "One", endpoint: "/a" }, w2: "not an object" };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets).toEqual([
      {
        id: "w1",
        backendId: "b1",
        name: "One",
        description: "",
        type: "table",
        category: "Uncategorized",
        subCategory: "",
        endpoint: "/a",
        gridData: { w: 20, h: 9 },
        params: [],
        dataKey: undefined,
        source: [],
        refetchInterval: undefined,
      },
    ]);
  });

  it("reports a non-object entry with its id and reason", () => {
    const raw = { w2: "not an object" };
    expect(normalizeWidgets(raw, "b1").issues).toEqual([
      { id: "w2", reason: "entry is not a JSON object" },
    ]);
  });

  it("reports how many malformed params a kept widget lost", () => {
    const raw = { w1: { name: "One", endpoint: "/a", params: [{ paramName: "ok" }, "junk", 7] } };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets[0].params).toHaveLength(1);
    expect(result.issues).toEqual([{ id: "w1", reason: "2 malformed params dropped" }]);
  });

  it("reports a single dropped param too, not just plural counts", () => {
    const raw = { w1: { name: "One", endpoint: "/a", params: [{ paramName: "ok" }, "junk"] } };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets[0].params).toHaveLength(1);
    expect(result.issues).toEqual([{ id: "w1", reason: "1 malformed params dropped" }]);
  });

  it("flattens OpenBB's organized params, where each section is a nested array", () => {
    // The reference backend's markdown_widget_with_organized_params publishes
    // params this way. Read as a flat list, every section is a non-record and
    // the widget arrives with no controls at all.
    const raw = {
      w1: {
        name: "One",
        endpoint: "/a",
        params: [
          [{ paramName: "enable_feature", type: "boolean" }],
          [{ paramName: "selected_date", type: "date" }, { paramName: "analysis_type" }],
        ],
      },
    };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets[0].params.map((p) => p.paramName)).toEqual([
      "enable_feature",
      "selected_date",
      "analysis_type",
    ]);
    // Sectioning is lost -- BDOBB has no param sections -- but nothing is
    // dropped, so nothing is reported.
    expect(result.issues).toEqual([]);
  });

  it("still counts a malformed param inside a section", () => {
    const raw = { w1: { name: "One", endpoint: "/a", params: [[{ paramName: "ok" }, "junk"]] } };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets[0].params).toHaveLength(1);
    expect(result.issues).toEqual([{ id: "w1", reason: "1 malformed params dropped" }]);
  });

  it("reports nothing for a clean payload", () => {
    expect(normalizeWidgets({ w1: { name: "One", endpoint: "/a" } }, "b1").issues).toEqual([]);
  });

  it("keeps a widget with zero params AND reports an issue when params is present but not an array", () => {
    const raw = { w1: { name: "One", endpoint: "/a", params: "not-an-array" } };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].params).toEqual([]);
    expect(result.issues).toEqual([
      { id: "w1", reason: "params is not an array; all params dropped" },
    ]);
  });

  it("reports no issue for params: null -- a plausible params=None serialization, not a dropped value", () => {
    const raw = { w1: { name: "One", endpoint: "/a", params: null } };
    const result = normalizeWidgets(raw, "b1");
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].params).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("reports total data loss instead of a silent clean result when the root is an array", () => {
    const result = normalizeWidgets([{ paramName: "not-a-widget-map" }], "b1");
    expect(result.widgets).toEqual([]);
    expect(result.issues).toEqual([
      {
        id: "<root>",
        reason: "widgets.json root is not an object keyed by widget id (got an array)",
      },
    ]);
  });

  it("reports total data loss when the root is a string", () => {
    const result = normalizeWidgets("nope", "b1");
    expect(result.widgets).toEqual([]);
    expect(result.issues).toEqual([
      {
        id: "<root>",
        reason: "widgets.json root is not an object keyed by widget id (got a string)",
      },
    ]);
  });

  it("reports total data loss when the root is null", () => {
    const result = normalizeWidgets(null, "b1");
    expect(result.widgets).toEqual([]);
    expect(result.issues).toEqual([
      { id: "<root>", reason: "widgets.json root is not an object keyed by widget id (got null)" },
    ]);
  });
});

describe("toOptions (exported for fetched option lists)", () => {
  it("normalises a fetched list exactly as it normalises a static one", () => {
    expect(
      toOptions([
        { label: "House", value: "house" },
        { label: "2026", value: 2026 },
        { label: "All Years" },
      ]),
    ).toEqual([
      { label: "House", value: "house" },
      { label: "2026", value: "2026" },
      { label: "All Years", value: "" },
    ]);
  });

  it("returns undefined for a non-array and for an array with nothing usable", () => {
    expect(toOptions({ label: "x" })).toBeUndefined();
    expect(toOptions("nope")).toBeUndefined();
    expect(toOptions([])).toBeUndefined();
    expect(toOptions([{ value: "no-label" }])).toBeUndefined();
  });
});

describe("normalizeWidgets columnsDefs parsing", () => {
  function widgetWithTable(table: unknown) {
    return { w: { endpoint: "e", data: { dataKey: "results", table } } };
  }

  it("keeps every documented column field", () => {
    const full = {
      field: "close",
      headerName: "Close",
      headerTooltip: "Closing price",
      cellDataType: "number",
      formatterFn: "normalizedPercent",
      decimalPlaces: 3,
      prefix: "$",
      suffix: " (adj)",
      pinned: "left",
      hide: true,
      width: 120,
      minWidth: 60,
      maxWidth: 400,
      renderFn: ["greenRed"],
      renderFnParams: { colorRules: [{ condition: "gt", value: 0, color: "green" }] },
    };
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithTable({ columnsDefs: [full] }), "b1");
    expect(w.table?.columns[0]).toEqual(full);
  });

  it("normalises a bare-string renderFn into a one-element array", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({ columnsDefs: [{ field: "a", renderFn: "greenRed" }] }),
      "b1",
    );
    expect(w.table?.columns[0].renderFn).toEqual(["greenRed"]);
  });

  it("keeps only the string members of a renderFn array, and omits it when none survive", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({
        columnsDefs: [
          { field: "a", renderFn: ["greenRed", 7, null] },
          { field: "b", renderFn: [1, 2] },
          { field: "c", renderFn: {} },
        ],
      }),
      "b1",
    );
    expect(w.table?.columns[0].renderFn).toEqual(["greenRed"]);
    expect(w.table?.columns[1]).not.toHaveProperty("renderFn");
    expect(w.table?.columns[2]).not.toHaveProperty("renderFn");
  });

  it("drops ill-typed properties and keeps the column, exactly as toParam does", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({
        columnsDefs: [
          {
            field: "a",
            headerName: 7,
            cellDataType: "quantum",
            formatterFn: "shouty",
            decimalPlaces: "2",
            pinned: "middle",
            hide: "yes",
            width: "120",
            minWidth: null,
            maxWidth: [],
            renderFnParams: "nope",
          },
        ],
      }),
      "b1",
    );
    expect(w.table?.columns).toEqual([{ field: "a" }]);
  });

  // Intl.NumberFormat throws a RangeError for maximumFractionDigits outside
  // 0..20, so an out-of-range value used to blank the whole table card.
  it.each([-1, 21, 2.5, Number.NaN])("drops decimalPlaces %s, which no formatter accepts", (n) => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithTable({ columnsDefs: [{ field: "a", decimalPlaces: n }] }), "b1");
    expect(w.table?.columns[0]).toEqual({ field: "a" });
  });

  it("keeps hide: false, since false is a boolean and says something", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(widgetWithTable({ columnsDefs: [{ field: "a", hide: false }] }), "b1");
    expect(w.table?.columns[0]).toEqual({ field: "a", hide: false });
  });

  it("omits an empty renderFnParams object", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({ columnsDefs: [{ field: "a", renderFnParams: {} }] }),
      "b1",
    );
    expect(w.table?.columns[0]).not.toHaveProperty("renderFnParams");
  });

  it("drops an entry with no string field, and an entry that is not an object", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({ columnsDefs: [{ headerName: "No field" }, null, 7, { field: "a" }] }),
      "b1",
    );
    expect(w.table?.columns).toEqual([{ field: "a" }]);
  });

  it("keeps the table-level formatterFn default", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({ columnsDefs: [{ field: "a" }], formatterFn: "int" }),
      "b1",
    );
    expect(w.table?.formatterFn).toBe("int");
  });

  it("omits an ill-typed table-level formatterFn", () => {
    const {
      widgets: [w],
    } = normalizeWidgets(
      widgetWithTable({ columnsDefs: [{ field: "a" }], formatterFn: 7 }),
      "b1",
    );
    expect(w.table).toEqual({ columns: [{ field: "a" }] });
  });

  it("gives a widget with no columnsDefs no table at all, so it renders exactly as today", () => {
    const {
      widgets: [noTable],
    } = normalizeWidgets({ w: { endpoint: "e", data: { dataKey: "results" } } }, "b1");
    // `undefined`, not absent: normalizeWidgets assigns every field
    // unconditionally, exactly as it already does for dataKey.
    expect(noTable.table).toBeUndefined();

    // A table block with no columnsDefs, a non-array columnsDefs, and an
    // array whose every entry is junk are all the same situation.
    for (const table of [{}, { columnsDefs: "nope" }, { columnsDefs: [null, 7] }]) {
      const {
        widgets: [w],
      } = normalizeWidgets({ w: { endpoint: "e", data: { table } } }, "b1");
      expect(w.table).toBeUndefined();
    }
  });
});

describe("live_grid manifest fields", () => {
  it("parses wsEndpoint and data.wsRowIdColumn for a live_grid widget", () => {
    const { widgets } = normalizeWidgets(
      {
        live: {
          type: "live_grid",
          endpoint: "grid_data",
          wsEndpoint: "grid_ws",
          data: { wsRowIdColumn: "symbol", table: { columnsDefs: [{ field: "symbol" }] } },
        },
      },
      "b1",
    );
    expect(widgets[0].wsEndpoint).toBe("grid_ws");
    expect(widgets[0].wsRowIdColumn).toBe("symbol");
  });

  it("leaves both undefined when absent", () => {
    const { widgets } = normalizeWidgets({ w: { type: "table", endpoint: "e" } }, "b1");
    expect(widgets[0].wsEndpoint).toBeUndefined();
    expect(widgets[0].wsRowIdColumn).toBeUndefined();
  });
});

describe("normalizeWidgets settings widgets", () => {
  const uiOf = (settings: unknown) =>
    normalizeWidgets({ s: { type: "settings", endpoint: "settings", settings } }, "b1").widgets[0]
      .settingsUi;

  it("reads each settings.ui the v1 contract defines", () => {
    expect(uiOf({ ui: "form" })).toEqual({ kind: "form" });
    expect(uiOf({ ui: { app: "keys" } })).toEqual({ kind: "app", name: "keys" });
    expect(uiOf({ ui: { page: "/settings/page" } })).toEqual({ kind: "page", path: "/settings/page" });
  });

  it("marks anything else unknown rather than guessing at it", () => {
    for (const settings of [undefined, null, "form", [], { ui: "wizard" }, { ui: { app: 3 } }, { ui: [] }]) {
      expect(uiOf(settings)).toEqual({ kind: "unknown" });
    }
  });

  it("gives every other widget type no settingsUi, whatever it carries", () => {
    const [w] = normalizeWidgets({ t: { type: "table", settings: { ui: "form" } } }, "b1").widgets;
    expect(w.settingsUi).toBeUndefined();
  });
});

describe("advanced_charting's chart spec", () => {
  const tv = (data: unknown) =>
    normalizeWidgets({ tv: { type: "advanced_charting", endpoint: "/udf", data } }, "b").widgets[0].udfChart;

  it("reads the reference widget's data block, keeping only the documented colours", () => {
    expect(
      tv({
        defaultSymbol: "MSFT",
        updateFrequency: 30000,
        chartConfig: { upColor: "#26a69a", downColor: "#ef5350", volumeUpColor: "#0f0", showVolume: false, bogus: "#fff" },
      }),
    ).toEqual({
      defaultSymbol: "MSFT",
      updateFrequency: 30000,
      colors: { upColor: "#26a69a", downColor: "#ef5350", volumeUpColor: "#0f0" },
      showVolume: false,
    });
  });

  it("defaults a missing or malformed block", () => {
    const defaults = { defaultSymbol: "AAPL", updateFrequency: 60000, colors: {}, showVolume: true };
    expect(tv(undefined)).toEqual(defaults);
    expect(
      tv({ defaultSymbol: "  ", updateFrequency: "fast", chartConfig: { upColor: 5, showVolume: "no" } }),
    ).toEqual(defaults);
  });

  it("floors updateFrequency at five seconds", () => {
    expect(tv({ updateFrequency: 100 })?.updateFrequency).toBe(5000);
  });

  it("is absent on every other type", () => {
    expect(normalizeWidgets({ t: { type: "table", data: { defaultSymbol: "X" } } }, "b").widgets[0].udfChart).toBeUndefined();
  });
});
