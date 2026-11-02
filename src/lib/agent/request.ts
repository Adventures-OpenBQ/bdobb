// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** The POST body for `<ritaUrl>/v1/query`. */
import type { AgentMessage, AgentTool, SkillCatalogEntry, SkillPayload } from "./types";

export type WidgetRef = Record<string, unknown>;

export type QueryRequest = {
  messages: AgentMessage[];
  widgets: { primary: WidgetRef[]; secondary: WidgetRef[]; extra: WidgetRef[] };
  context: ContextItem[] | null;
  urls: unknown[];
  timezone: string;
  workspace_options: Record<string, unknown>;
  tools: unknown[];
  /** The enabled skills, slug + description only; Rita fetches a body with get_skill_content. */
  skills_catalog: SkillCatalogEntry[];
  /** Bodies forced into this turn by `/skill:<slug>`. */
  selected_skills: SkillPayload[];
};

export type ContextItem = {
  uuid: string;
  name: string;
  description: string;
  data: { items: { content: string; data_format: { data_type: "object"; parse_as: "text" }; citable: boolean }[] };
};

// openbb-ai's RawContext requires a uuid and data; Rita reads the same text block either way (conformance Q1).
const DASHBOARDS_CONTEXT_UUID = "6f1d5b2e-3c4a-4e8b-9a7d-0b5c2e1f4a90";

/**
 * Which dashboard the user is on, and what the others are called. Without it
 * the model cannot know the board's name, and tools that take a dashboard_name
 * (add_note, navigate) got invented ones: "Default" failed as unknown, and the
 * model then created a dashboard by that name to put its note on. Rita's own
 * "Current dashboard" prompt line comes only with generative UI on, which also
 * switches on bridge tools this app does not run, so this rides in context.
 */
export function dashboardContext(current: { id: string; name: string } | undefined, all: { id: string; name: string }[]): ContextItem {
  const others = current ? all.filter((d) => d.id !== current.id).map((d) => JSON.stringify(d.name)) : [];
  const description = !current
    ? "The user has no dashboard open."
    : `The user is on the dashboard ${JSON.stringify(current.name)}; tools act on it by default, so omit dashboard_name to target it. ` +
      (others.length > 0 ? `Their other dashboards: ${others.join(", ")}.` : "They have no other dashboards.");
  return {
    uuid: DASHBOARDS_CONTEXT_UUID,
    name: "Dashboards",
    description,
    data: { items: [{ content: description, data_format: { data_type: "object", parse_as: "text" }, citable: false }] },
  };
}

export function queryUrl(ritaUrl: string): string {
  return `${ritaUrl.replace(/\/+$/, "")}/v1/query`;
}

export function buildQueryRequest(
  messages: AgentMessage[],
  options: {
    primary?: WidgetRef[];
    secondary?: WidgetRef[];
    tools?: AgentTool[];
    workspaceOptions?: Record<string, boolean | string>;
    skillsCatalog?: SkillCatalogEntry[];
    selectedSkills?: SkillPayload[];
    context?: ContextItem[];
  } = {},
): QueryRequest {
  return {
    messages,
    widgets: { primary: options.primary ?? [], secondary: options.secondary ?? [], extra: [] },
    // `context` is genuinely null in the protocol when empty — unlike urls and tools.
    context: options.context ?? null,
    // urls and tools MUST be [] or absent, never null: Rita answers HTTP 400
    // with a pydantic payload naming the field, and the request never reaches
    // the model. Typed as arrays so the type system refuses null too.
    urls: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Always present, carrying an object: {} when the agent declares no
    // configurable features. A client that omits the key is not what shipped.
    workspace_options: options.workspaceOptions ?? {},
    tools: options.tools ?? [],
    // Arrays like urls and tools: absent is fine to Rita, null is a 400.
    skills_catalog: options.skillsCatalog ?? [],
    selected_skills: options.selectedSkills ?? [],
  };
}
