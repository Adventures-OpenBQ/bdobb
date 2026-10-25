// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { openRuntime, resolveTableTarget } from "./target";
import { describeWorkerTable } from "./describe";
import { arrangeWorkerTable } from "./arrange";

const cardIdOf = (args: Record<string, unknown>) => (typeof args.card_id === "string" ? args.card_id : "");

export async function describeTable(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = resolveTableTarget(cardIdOf(args));
  if (target.kind === "refusal") return { status: "unavailable", reason: target.status, message: target.message, alternatives: target.alternatives };
  const rt = openRuntime(target);
  if ("status" in rt) return { status: "unavailable", reason: rt.status, message: rt.message, alternatives: rt.alternatives };
  const str = (k: string) => (typeof args[k] === "string" ? args[k] as string : undefined);
  return describeWorkerTable(rt, str("section"), str("cursor"), str("search"), args.scope, args.fields);
}

export async function arrangeTable(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = resolveTableTarget(cardIdOf(args));
  if (target.kind === "refusal") return { status: "refused", code: target.status, message: target.message, alternatives: target.alternatives };
  return { ...await arrangeWorkerTable(target, args) };
}
