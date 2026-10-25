// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from "vitest";
import { buildQueryRequest, dashboardContext, queryUrl } from "./request";

describe("queryUrl", () => {
  it("appends /v1/query", () => {
    expect(queryUrl("http://rita.example")).toBe("http://rita.example/v1/query");
  });

  it("tolerates a trailing slash", () => {
    expect(queryUrl("http://rita.example/")).toBe("http://rita.example/v1/query");
  });
});

describe("buildQueryRequest", () => {
  const messages = [{ role: "human" as const, content: "hello" }];

  it("sends urls and tools as arrays, never null", () => {
    // THE trap: Rita answers HTTP 400 with a pydantic payload naming the
    // field when either is null, and the request never reaches the model.
    const body = buildQueryRequest(messages);
    expect(body.urls).toEqual([]);
    expect(body.tools).toEqual([]);
    expect(body.urls).not.toBeNull();
    expect(body.tools).not.toBeNull();
  });

  it("always includes workspace_options carrying an object", () => {
    expect(buildQueryRequest(messages).workspace_options).toEqual({});
  });

  it("carries workspace options through as a keyed object", () => {
    expect(buildQueryRequest(messages, { workspaceOptions: { model: "m1", "deep-research": true } }).workspace_options).toEqual({
      model: "m1",
      "deep-research": true,
    });
  });

  it("sends context as null, which IS what the protocol expects there", () => {
    expect(buildQueryRequest(messages).context).toBeNull();
  });

  it("carries context items when given", () => {
    const item = { name: "Dashboards", description: "x" };
    expect(buildQueryRequest(messages, { context: [item] }).context).toEqual([item]);
  });

  it("defaults widgets to three empty arrays", () => {
    expect(buildQueryRequest(messages).widgets).toEqual({
      primary: [],
      secondary: [],
      extra: [],
    });
  });

  it("carries the messages through unchanged", () => {
    expect(buildQueryRequest(messages).messages).toEqual(messages);
  });

  it("resolves a timezone string", () => {
    expect(typeof buildQueryRequest(messages).timezone).toBe("string");
    expect(buildQueryRequest(messages).timezone.length).toBeGreaterThan(0);
  });

  it("accepts widget refs for the primary context", () => {
    const ref = { uuid: "u", origin: "b", widget_id: "w", name: "W", description: "", params: [] };
    expect(buildQueryRequest(messages, { primary: [ref] }).widgets.primary).toEqual([ref]);
  });

  it("accepts widget refs for the secondary context", () => {
    const ref = { uuid: "u", origin: "b", widget_id: "w", name: "W", description: "", params: [] };
    expect(buildQueryRequest(messages, { secondary: [ref] }).widgets).toEqual({
      primary: [],
      secondary: [ref],
      extra: [],
    });
  });

  it("survives JSON round-tripping with urls and tools still arrays", () => {
    // The body is sent as JSON; a value that stringifies to null would defeat
    // the guard above without this check catching it.
    const parsed = JSON.parse(JSON.stringify(buildQueryRequest(messages)));
    expect(Array.isArray(parsed.urls)).toBe(true);
    expect(Array.isArray(parsed.tools)).toBe(true);
  });

  it("passes assembled tools through verbatim", () => {
    const tool = {
      server_id: "s1",
      name: "search",
      url: "https://mcp.example/mcp",
      endpoint: "search",
      description: "d",
      input_schema: {},
    };
    expect(buildQueryRequest(messages, { tools: [tool] }).tools).toEqual([tool]);
  });

  it("sends skills_catalog and selected_skills as arrays, never null", () => {
    const body = buildQueryRequest(messages);
    expect(body.skills_catalog).toEqual([]);
    expect(body.selected_skills).toEqual([]);
  });

  it("carries the skills catalog and forced skills through verbatim", () => {
    const catalog = [{ slug: "openbb-html-table", description: "Tables.", updatedAt: "2026-09-19T00:00:00.000Z" }];
    const selected = [{ slug: "openbb-html-table", description: "Tables.", contentMarkdown: "# T", source: "forced_slash" as const }];
    const body = buildQueryRequest(messages, { skillsCatalog: catalog, selectedSkills: selected });
    expect(body.skills_catalog).toEqual(catalog);
    expect(body.selected_skills).toEqual(selected);
  });
});

describe("dashboardContext", () => {
  it("names the current dashboard and the others, as a description-only item Rita reads as text", () => {
    const item = dashboardContext({ id: "a", name: "Main" }, [{ id: "a", name: "Main" }, { id: "b", name: "Macro" }]);
    expect(item.name).toBe("Dashboards");
    expect(item.description).toContain('"Main"');
    expect(item.description).toContain('"Macro"');
    expect(item.description).toMatch(/omit dashboard_name/i);
    expect(item).not.toHaveProperty("data");
  });

  it("says so when there is no current dashboard", () => {
    expect(dashboardContext(undefined, []).description).toMatch(/no dashboard/i);
  });
});
