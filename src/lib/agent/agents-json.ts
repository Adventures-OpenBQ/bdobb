// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Discovery. The response is VALIDATED AT THE BOUNDARY, never cast: this is a
 * document from a service that is versioned independently of this app, and a
 * field a future Rita adds must not be able to take the whole call down.
 */
import { isRecord } from "../isRecord";
import { logOnce } from "../logger";
import type { AgentDescriptor, AgentFeature, AgentsJson } from "./types";

/** Enough of an error body to name the real problem; not enough to flood a log. */
const ERROR_PREVIEW_CHARS = 500;

export function normalizeFeatures(
  raw: unknown,
  agentKey: string,
): Record<string, AgentFeature> {
  const out: Record<string, AgentFeature> = {};
  if (!isRecord(raw)) return out;

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      out[key] = { kind: "boolean", value };
      continue;
    }
    if (isRecord(value)) {
      if (value.type === "select" && Array.isArray(value.options)) {
        out[key] = {
          kind: "select",
          label: typeof value.label === "string" ? value.label : key,
          default: typeof value.default === "string" ? value.default : "",
          options: value.options.flatMap((o) =>
            isRecord(o) && typeof o.label === "string" && typeof o.value === "string"
              ? [{ label: o.label, value: o.value }]
              : [],
          ),
        };
        continue;
      }
      // Workspace's third configurable shape (custom-agent-features): a free
      // text option such as "agent-name". Its value travels in
      // workspace_options as a string.
      if (value.type === "text") {
        out[key] = {
          kind: "text",
          label: typeof value.label === "string" ? value.label : key,
          default: typeof value.default === "string" ? value.default : "",
          description: typeof value.description === "string" ? value.description : "",
        };
        continue;
      }
      // No `type` field at all — the prompt-suggestions shape. Keyed on the
      // fields that ARE present rather than on a discriminator that is absent.
      if (typeof value.default === "boolean") {
        out[key] = {
          kind: "toggle",
          label: typeof value.label === "string" ? value.label : key,
          default: value.default,
          description: typeof value.description === "string" ? value.description : "",
        };
        continue;
      }
    }
    // Once per agent+feature, not per occurrence: a future Rita adding a field
    // should cost one log line, not one per discovery call.
    void logOnce(`agents.json:${agentKey}:${key}`, `unrecognised feature shape: ${agentKey}.${key}`);
  }
  return out;
}

export function normalizeAgentsJson(raw: unknown): AgentsJson {
  const out: AgentsJson = {};
  if (!isRecord(raw)) return out;

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const endpoints = isRecord(value.endpoints) ? value.endpoints : {};
    const descriptor: AgentDescriptor = {
      id: key,
      name: typeof value.name === "string" ? value.name : key,
      description: typeof value.description === "string" ? value.description : "",
      queryPath: typeof endpoints.query === "string" ? endpoints.query : "",
      features: normalizeFeatures(value.features, key),
    };
    out[key] = descriptor;
  }
  return out;
}

export async function fetchAgentsJson(
  backendUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentsJson> {
  const base = backendUrl.replace(/\/+$/, "");
  const res = await fetchImpl(`${base}/agents.json`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `agents.json failed: HTTP ${res.status} ${body.slice(0, ERROR_PREVIEW_CHARS)}`,
    );
  }
  return normalizeAgentsJson(await res.json());
}
