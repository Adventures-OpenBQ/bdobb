// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { availableViews } from "../../cardViews";
import type { DashboardCard } from "../../types";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { capabilitiesFor } from "./capabilities";
import { buildCandidate } from "./candidate";
import { fieldHints, providerOperators } from "./hint";
import { parseArrangement, type Arrangement, type ArrangeError } from "./contract";
import { analyticalErrors, modelSummary, tableModelOf, type ModelSummary } from "./describe";
import { openRuntime, resolveTableTarget, revisionWitness, type TableRuntime, type TableTarget } from "./target";
import { registerArrangeUndo, setView } from "./undo";
import { paramRow } from "../../tableModel/pivotParams";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import type { RuntimeParams } from "../../tableExecution/runtimeParams";
import type { CommitOutcome } from "../../../stores/tableCommitCoordinator";
import type { StatementUpdateConflict } from "../../statementModel/updates";
import type { TableDefinition } from "../../tableExecution/types";

export type ArrangeResult =
  | { status: "applied"; card_id: string; revision: string | null; recalculating?: true; message?: string; ids: Record<string, string>; before: ModelSummary; after: ModelSummary; view?: string; preview: { columns: { id: string; label: string }[]; rows: unknown[]; total: number; completeness: unknown }; warnings: unknown[]; linked: { card_id: string; status: string; stale: boolean }[]; undo: "available" }
  | { status: "unchanged"; card_id: string; revision: string }
  | { status: "refused"; code: string; message: string; errors?: ArrangeError[]; conflicts?: StatementUpdateConflict[]; revision?: string; alternatives?: string[] }
  | { status: "failed"; code: "commit-failed"; message: string }
  | { status: "previewed"; committed: false; card_id: string; revision: string; preview: { columns: { id: string; label: string }[]; rows: unknown[]; total: number; truncated: boolean; completeness: unknown }; warnings: unknown[] };
const PREVIEW_ROWS = 20;
// Unknown arguments refuse: a model's invented dry_run:true must never fall through to an apply (D-012).
const ARGS = new Set(["card_id", "expected_revision", "arrangement", "mode"]);

// An emptied list is the same presentation as an absent one; compare on that footing so a no-op reads as unchanged.
const canon = (d: TableDefinition) => JSON.stringify({ ...d, table: Object.fromEntries(Object.entries(d.table ?? {}).filter(([, v]) => !(Array.isArray(v) && !v.length))) });
const refuse = (code: string, message: string, extra: Partial<Extract<ArrangeResult, { status: "refused" }>> = {}): ArrangeResult => ({ status: "refused", code, message, ...extra });
export const PREVIEW_TIMEOUT_MS = 15_000, SETTLE_TIMEOUT_MS = 5_000;
const STALE = "the table changed since it was described; call describe_table again and rebuild the request";
/** The card's views as describe_table lists them; an unset view is the default, "table". */
export const cardViews = (card: DashboardCard) => availableViews(useWidgetRegistryStore.getState().find(card.backendId, card.widgetId), null, card).map((v): string => v.value ?? "table");
const viewOf = (card: DashboardCard) => card.view ?? "table";
const liveCards = (dashboardId: string) => useDashboardStore.getState().dashboards.find(d => d.id === dashboardId)?.tabs.flatMap(t => t.cards) ?? [];

/** Linked tables fed (transitively) by this card, with the worker's own status for each. */
export function linkedStatus(dashboardId: string, cardId: string): { card_id: string; status: string; stale: boolean }[] {
  const cards = liveCards(dashboardId);
  const out: { card_id: string; status: string; stale: boolean }[] = [];
  const seen = new Set([cardId]);
  const queue = [cardId];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of cards.filter(c => c.linkedSource?.sourceWidgetId === parent && !seen.has(c.id))) {
      seen.add(child.id);
      const v = tableExecutionStore.readView(dashboardId, child.id);
      out.push({ card_id: child.id, status: v.status, stale: v.stale });
      queue.push(child.id);
    }
  }
  return out;
}

/** Resolves once the card's view is ready and settled on its saved definition, or false on timeout. */
function settled(dashboardId: string, cardId: string, ms: number): Promise<boolean> {
  const ok = () => { const v = tableExecutionStore.readView(dashboardId, cardId); return ["ready", "empty"].includes(v.status) && !v.stale && !v.error && !!v.ready; };
  if (ok()) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = (r: boolean) => { clearTimeout(timer); stop(); resolve(r); };
    const stop = tableExecutionStore.subscribe(() => { if (ok()) done(true); });
    const timer = setTimeout(() => done(false), ms);
  });
}

const refusalCode = (errors: ArrangeError[]) => errors.some(e => e.code === "viewer-scope") ? "viewer-scope" : errors.some(e => e.code === "validation") ? "validation-failed" : "invalid-arrangement";

/**
 * The 7-step transaction: witness -> candidate -> shared validation -> worker preview -> re-verified guarded write -> publish -> one Undo.
 * Every path other than "applied" leaves the card, the persisted dashboard and the Undo stack untouched. Numbers come only from the worker preview.
 */
export async function arrangeWorkerTable(target: Extract<TableTarget, { kind: "worker" }>, args: Record<string, unknown>): Promise<ArrangeResult | ViewerResult> {
  const unknown = Object.keys(args).filter(k => !ARGS.has(k));
  if (unknown.length) return refuse("invalid-arrangement", `unknown argument ${unknown.join(", ")}; nothing was changed`, { alternatives: [...ARGS] });
  if (args.mode !== undefined && args.mode !== "apply" && args.mode !== "preview") return refuse("invalid-arrangement", 'mode must be "apply" or "preview"; nothing was changed', { alternatives: ["apply", "preview"] });
  const previewOnly = args.mode === "preview";
  const parsed = parseArrangement(args.arrangement);
  if (!parsed.arrangement) return refuse("invalid-arrangement", "the arrangement is not a valid table-model/1 request; nothing was changed", { errors: parsed.errors });
  const rt = openRuntime(target);
  if ("status" in rt) return refuse(rt.status, rt.message, { alternatives: rt.alternatives });
  // 1. access, mode, identity, witness
  const revision = revisionWitness(rt.card, rt.view);
  if (args.expected_revision !== revision) return refuse("stale-revision", STALE, { revision });
  if (rt.mode === "viewer" && !previewOnly) return arrangeViewer(rt, parsed.arrangement);
  const base = rt.coordinator!.authoringBase();
  const previous = structuredClone(rt.view.definition);
  // 2-3. candidate + shared validation
  const candidate = buildCandidate(previous, rt.columns, parsed.arrangement);
  if (!candidate.definition) return refuse(refusalCode(candidate.errors), "the arrangement was refused; nothing was changed", { errors: candidate.errors, ...(candidate.conflicts?.length ? { conflicts: candidate.conflicts } : {}) });
  const checked = analyticalErrors(candidate.definition.analytical, rt.columns);
  const errors: ArrangeError[] = checked.errors.map(message => ({ code: "validation", message }));
  let hinted: unknown[] = [];
  if (checked.model) {
    hinted = providerOperators(checked.model, tableModelOf(previous), rt.columns, rt.view.ready!.inspection.inputPeriodicity);
    const originalMeasures = new Map((tableModelOf(previous)?.measures ?? []).map(measure => [measure.id, measure]));
    const hints = fieldHints(checked.model, rt.columns, rt.view.ready!.inspection.inputPeriodicity);
    for (const measure of checked.model.measures) {
      const hint = hints.get(measure.sourceFieldId);
      const old = originalMeasures.get(measure.id);
      // Legacy migrations are not fresh choices; unchanged operators remain compatible.
      if (!candidate.aggregationChoices?.has(measure.id) || !measure.aggregation ||
        hint?.hint.status !== "conditional" || !hint.hint.time || hint.suggested === measure.aggregation) continue;
      const unchanged = old?.aggregation === measure.aggregation && old.sourceFieldId === measure.sourceFieldId;
      const marked = candidate.aggregationOverrides?.get(measure.id) === measure.aggregation;
      if (!unchanged && !marked) {
        errors.push({ code: "provider-override-required", target_id: measure.id,
          message: `${measure.sourceFieldId}: ${measure.aggregation} does not follow the provider's ${hint.hint.time} rule in this arrangement. ${hint.suggestion_note ?? "Follow the provider's suggested operator."} Nothing was changed. Add the required categories and omit aggregation to follow the provider. Only if the user explicitly requested this operator, put aggregation_intent: "user_override" on this measure operation. Do not mark an override just to bypass this refusal.` });
      } else if (marked && !hint.suggested) {
        hinted.push({ severity: "warning", code: "provider-aggregation-hint", target_id: measure.id,
          message: `${measure.sourceFieldId}: ${measure.aggregation} explicitly requested, but the provider's ${hint.hint.time} rule is unavailable in this arrangement` });
      }
    }
    // An omitted operator on a new hinted measure asks for the provider default.
    // If its prerequisites are unmet, refuse an apply instead of saving blank values.
    // Preview remains read-only; existing measures and explicit operators keep their semantics.
    if (!previewOnly) {
      const existing = new Set((tableModelOf(previous)?.measures ?? []).map(measure => measure.id));
      for (const measure of checked.model.measures) {
        const hint = hints.get(measure.sourceFieldId);
        if (!measure.aggregation && !existing.has(measure.id) && hint?.hint.status === "conditional" && hint.hint.time) {
          errors.push({ code: "validation", target_id: measure.id,
            message: `${measure.sourceFieldId}: the provider's ${hint.hint.time} cannot be applied yet. ${hint.suggestion_note ?? "The provider rule is not available in this arrangement."} Nothing was changed. Add the required categories and leave aggregation out of measure.add when retrying, so the provider's ${hint.hint.time} applies. Do not substitute a different operator unless the user explicitly named an operator. A requested date category does not mean only that category: add the provider-required entity categories too and explain them. Ask before proceeding only if the user explicitly excludes those categories or asks to combine the entities.` });
        }
      }
    }
    // checkAuthoringModel validates bindings, not operators: offer exactly the drawer's operators per field.
    const allowed = capabilitiesFor(checked.model, rt.columns, "authoring").aggregations_by_field;
    for (const m of checked.model.measures)
      if (m.aggregation && !(allowed[m.sourceFieldId] ?? []).includes(m.aggregation))
        errors.push({ code: "validation", target_id: m.id, message: `${m.aggregation} is not available for ${m.sourceFieldId}`, alternatives: allowed[m.sourceFieldId] ?? [] });
    candidate.definition.analytical = checked.model;
  }
  if (candidate.view !== undefined && !cardViews(rt.card).includes(candidate.view)) {
    const index = parsed.arrangement.operations.map(o => o.op).lastIndexOf("view.set");
    errors.push({ code: "invalid-field", operation_index: index, path: `operations[${index}].view`, message: `${candidate.view} is not a view this card offers`, alternatives: cardViews(rt.card) });
  }
  if (errors.length) return refuse("validation-failed", "the shared table validator refused the arrangement; nothing was changed", { errors });
  const defChanged = canon(candidate.definition) !== canon(previous);
  const viewChanged = candidate.view !== undefined && candidate.view !== viewOf(rt.card);
  if (!previewOnly && !defChanged && !viewChanged) return { status: "unchanged", card_id: rt.card.id, revision };
  // 4. bounded preview through the live executor (nothing is published)
  if (!rt.executor.previewDefinition) return refuse("unavailable", "this table cannot preview a candidate; nothing was changed");
  let preview;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PREVIEW_TIMEOUT_MS);
  try { preview = await rt.executor.previewDefinition(rt.view.requested, candidate.definition, ctl.signal); }
  catch (e) {
    if (ctl.signal.aborted) return refuse("timeout", "the table worker did not answer in time; nothing was changed", { alternatives: ["try again"] });
    return refuse("calculation-failed", `${e instanceof Error ? e.message : "the candidate could not be calculated"}; nothing was changed`);
  } finally { clearTimeout(timer); }
  const rows = { columns: preview.columns.map(c => ({ id: c.id, label: c.label })), rows: preview.rows.slice(0, PREVIEW_ROWS), total: preview.total, completeness: preview.completeness };
  const warnings = [...(preview.modelWarnings ?? []), ...preview.diagnostics.filter(d => d.severity !== "error"), ...hinted];
  // A preview ends here: no re-verify, no write, no publish, no Undo.
  if (previewOnly) return { status: "previewed", committed: false, card_id: rt.card.id, revision, preview: { ...rows, truncated: preview.total > PREVIEW_ROWS }, warnings };
  // 5. re-verify at the write boundary: the describe-time witness and the preview are minutes old. The coordinator re-admits again inside the write.
  // Re-resolve the card: the target holds the card as it was at call time.
  const again = resolveTableTarget(rt.card.id);
  if (again.kind !== "worker" || again.dashboardId !== rt.dashboardId) return refuse("stale-revision", STALE);
  const fresh = openRuntime(again);
  if ("status" in fresh) return refuse(fresh.status, fresh.message, { alternatives: fresh.alternatives });
  if (fresh.mode === "viewer") return refuse("viewer-scope", "this dashboard became read-only; nothing was changed");
  if (!fresh.coordinator?.getSnapshot().canReplace) return refuse("busy", "the table is busy or not editable right now; nothing was changed", { alternatives: ["try again shortly"] });
  if (!tableExecutionStore.sourceMatches(rt.dashboardId, rt.card.id, liveCards(rt.dashboardId))) return refuse("stale-revision", "the table's source changed; nothing was changed", { alternatives: ["call describe_table again"] });
  if (revisionWitness(fresh.card, fresh.view) !== revision || fresh.executor !== rt.executor) return refuse("stale-revision", STALE);
  // 6. guarded durable write, publish and cascade (the coordinator owns all three)
  if (defChanged) {
    const outcome: CommitOutcome = await fresh.coordinator.replaceDefinition(base, candidate.definition);
    if (outcome.status === "failed") return { status: "failed", code: "commit-failed", message: "the table could not be saved; nothing was changed" };
    if (outcome.status === "superseded") return refuse("stale-revision", STALE);
    if (outcome.status === "refused") return refuse(outcome.reason === "viewer" ? "viewer-scope" : outcome.reason === "invalid" ? "validation-failed" : outcome.reason === "unavailable" ? "unavailable" : outcome.reason === "busy" ? "busy" : "stale-revision", `${outcome.message} Nothing was changed.`, { alternatives: ["call describe_table again"] });
  }
  // The view is card state beside the definition: written after it, and on failure the definition is put back so nothing half-applies.
  const viewBefore = viewOf(fresh.card);
  if (viewChanged) {
    try { await setView(rt.card.id, candidate.view!); }
    catch {
      if (defChanged) await fresh.coordinator.replaceDefinition(fresh.coordinator.authoringBase(), previous);
      return { status: "failed", code: "commit-failed", message: "the card's view could not be saved; nothing was changed" };
    }
  }
  // 7. one Undo and the applied summary
  // Register Undo now, against what was just published: a drawer edit made while we wait to settle must make Undo refuse, not be reverted with Rita's edit.
  registerArrangeUndo({ dashboardId: rt.dashboardId, cardId: rt.card.id, title: rt.card.title ?? "table", applied: structuredClone(tableExecutionStore.readView(rt.dashboardId, rt.card.id).definition), previous, ...(viewChanged ? { view: { applied: candidate.view!, previous: viewBefore } } : {}) });
  // The witness covers the accepted revision, which only settles after recalculation: wait for it, never hand back a pre-commit value.
  const isSettled = await settled(rt.dashboardId, rt.card.id, SETTLE_TIMEOUT_MS);
  const view = tableExecutionStore.readView(rt.dashboardId, rt.card.id);
  const card = liveCards(rt.dashboardId).find(c => c.id === rt.card.id) ?? rt.card;
  return {
    status: "applied", card_id: rt.card.id, ids: candidate.ids,
    before: modelSummary(previous), after: modelSummary(candidate.definition),
    preview: rows, warnings,
    linked: linkedStatus(rt.dashboardId, rt.card.id), undo: "available",
    ...(viewChanged ? { view: candidate.view } : {}),
    ...(isSettled ? { revision: revisionWitness(card, view) } : { revision: null, recalculating: true as const, message: "saved, but the table is still recalculating; call describe_table before arranging again" }),
  };
}

type ViewerResult = Extract<ArrangeResult, { status: "refused" }> | { status: "applied"; scope: "session"; card_id: string; controls: RuntimeParams; linked: { card_id: string; status: string; stale: boolean }[]; undo: "available" } | { status: "unchanged"; card_id: string; revision: string };
const vrefuse = (...a: Parameters<typeof refuse>) => refuse(...a) as Extract<ArrangeResult, { status: "refused" }>;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Viewer scope: Rita may only move existing promoted controls, for this session. No durable write happens.
 * The store calls demand viewer authority themselves, so a flip to authoring mid-apply throws and is rolled back.
 * Undo restores only the keys Rita changed, and only while each still holds Rita's value; other controls the user moved since are left alone.
 */
function arrangeViewer(rt: TableRuntime, arrangement: Arrangement): ViewerResult {
  const { dashboardId, card } = rt;
  const model = tableModelOf(rt.view.definition);
  const keys = new Set(model ? paramRow(model).map(p => p.key) : []);
  const current = () => tableExecutionStore.readRuntimeParams(dashboardId, card.id);
  const errors = arrangement.operations.flatMap((op, i): ArrangeError[] =>
    !op.op.startsWith("viewer.") ? [{ code: "viewer-scope", operation_index: i, message: `${op.op} is an authoring change; in viewer mode only existing viewer controls can change` }]
    : typeof op.key === "string" && !keys.has(op.key) ? [{ code: "unknown-reference", operation_index: i, target_id: op.key, message: "no such viewer control", alternatives: [...keys] }] : []);
  if (errors.length) return vrefuse(refusalCode(errors), "nothing was changed", { errors });
  const before = structuredClone(current());
  const put = (k: string, p: RuntimeParams[string] | undefined) => p?.source === "viewer" ? tableExecutionStore.setViewerParam(dashboardId, card.id, k, p.memberKeys) : tableExecutionStore.resetViewerParams(dashboardId, card.id, k);
  const touched = new Set<string>();
  try {
    for (const op of arrangement.operations) {
      const ks = typeof op.key === "string" ? [op.key] : Object.keys(current());
      for (const k of ks) {
        touched.add(k);
        if (op.op === "viewer.set") tableExecutionStore.setViewerParam(dashboardId, card.id, k, op.member_keys as string[] | null);
        else tableExecutionStore.resetViewerParams(dashboardId, card.id, k);
      }
    }
  } catch (e) {
    for (const k of touched) try { put(k, before[k]); } catch { /* authority gone; nothing more can be restored */ }
    return vrefuse("validation-failed", `${e instanceof Error ? e.message : "viewer control refused"}; nothing was changed`);
  }
  const after = structuredClone(current());
  const changed = [...touched].filter(k => !sameJson(before[k], after[k]));
  if (!changed.length) return { status: "unchanged", card_id: card.id, revision: revisionWitness(card, tableExecutionStore.readView(dashboardId, card.id)) };
  useAgentEditsStore.getState().push({ summary: `Rita changed viewer controls on ${card.title ?? "table"}`, undo: async () => {
    const t = resolveTableTarget(card.id);
    if (t.kind !== "worker" || t.dashboardId !== dashboardId || !useDashboardStore.getState().viewer) throw new Error("Undo needs the table on the active dashboard in viewer mode; nothing was restored.");
    if (changed.some(k => !sameJson(current()[k], after[k]))) throw new Error("A viewer control changed after Rita's edit, so Undo would overwrite that change; nothing was restored.");
    for (const k of changed) put(k, before[k]);
  } });
  return { status: "applied", scope: "session", card_id: card.id, controls: after, linked: linkedStatus(dashboardId, card.id), undo: "available" };
}
