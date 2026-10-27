// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * A chart card kept in step with its server document (shared chart
 * documents, step 1b). Null when the host has no `chartsFetch`: the card is
 * then exactly the card it always was (extraction R4).
 *
 * The card's own state stays where it always lived -- the host's -- and is
 * the copy the card shows. What the server holds is written INTO it through
 * the host's `onPatch`/`onParam` whenever a newer revision arrives, so a card
 * that later opens with the server unreachable still shows the last revision
 * it saw. The card's edits go the other way: each one whose chart/1 body
 * differs from the card's before it is saved over the base revision, one
 * save in flight at a time, the newest edit waiting behind it.
 *
 * - A `409` adopts the server's document; the rejected edit (and any edit
 *   queued behind it) is dropped and the note says who won.
 * - A feed event is a cue to refetch, never a revision to trust: the
 *   revision adopted is always the one a GET or a save returned, and an
 *   older one than the card holds is ignored (events can arrive out of order).
 * - While a save is in flight or queued, a refetch waits for it, so an
 *   adopted revision never paints over an edit the server has not seen yet.
 * - Every feed (re)connect catches up from `GET /charts` and refetches only
 *   if this document's revision moved; a save that failed because the
 *   server was unreachable is retried then, over its original base.
 * - A card with no `chart_id` uploads itself the first time it opens
 *   against a server and writes the new id back through `onParam`.
 * - Only the `added`/`redo` undo stacks never reach the server: an undo is
 *   an ordinary edit, saved over the base revision like any other.
 */
import { useEffect, useRef, useState } from "react";
import { getHost } from "../host";
import { bodyFromCard, cardFromBody, type ChartBody, type ChartDocument } from "../lib/chartDocument";
import type { ChartEdit } from "../lib/chart/chartGroups";
import { ChartServerError, RETRY_MS, createChart, getChart, listCharts, saveChart, watchCharts } from "../lib/chartServer";
import type { ChartCardState } from "../lib/types";
import type { TaRegistry } from "./useTaRegistry";

export const NOTES = {
  rita: "Rita changed this chart",
  elsewhere: "This chart was changed elsewhere",
  offline: "Chart server unreachable: this change is saved when it reconnects",
  offlineAtOpen: "Chart server unreachable: showing this device's last copy; changes now are not saved",
  gone: "This chart was deleted on the chart server; changes are not saved",
  // useTaRegistry never retries a failed fetch on its own (only the picker's Refresh studies does).
  registry: "Not syncing with the chart server: the study list did not load; changes now are not saved. Reload to retry.",
} as const;

type Card = {
  params: Record<string, string>;
  state: ChartCardState;
  onPatch: (edit: ChartEdit) => void;
  onParam: (patch: Record<string, string>) => void;
  registry: TaRegistry;
};

export function useChartDocument(card: Card): { onPatch: (edit: ChartEdit) => void; onParam: (patch: Record<string, string>) => void; note: string | null } | null {
  const f = getHost().chartsFetch;
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(card);
  live.current = card;
  const doc = useRef<ChartDocument | null>(null);
  const pending = useRef<ChartBody | null>(null);
  const inFlight = useRef(false);
  const stale = useRef(false);
  const gone = useRef(false);
  // The document this card is bound to, and a count of rebinds: an answer that
  // belongs to a document the card was since pointed away from must change nothing.
  const bound = useRef("");
  const epoch = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const edits = useRef<((apply: () => void) => void) | null>(null);
  const ready = card.registry.status === "ready";
  const chartId = card.params.chart_id ?? "";

  useEffect(() => {
    if (f === undefined || !ready) return;
    const pointedAway = doc.current !== null ? chartId !== "" && doc.current.id !== chartId
      : bound.current !== "" && bound.current !== chartId;
    if (pointedAway) {
      // The host pointed the card at another document: start over on that one.
      epoch.current += 1;
      doc.current = null;
      pending.current = null;
      gone.current = false;
      inFlight.current = false;
      stale.current = false;
    }
    if (chartId !== "") bound.current = chartId;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // A server that answers 5xx (a proxy mid-restart) is as unreachable as one that does not answer.
    const unreachableError = (error: unknown) => !(error instanceof ChartServerError) || error.status >= 500;
    const lookup = (name: string) => live.current.registry.lookup(name);
    const body = () => bodyFromCard(live.current.params, live.current.state, lookup);

    const adopt = (next: ChartDocument, write: boolean) => {
      if (bound.current !== next.id) return; // a document the card was pointed away from
      const known = doc.current;
      if (known !== null && known.id === next.id && next.revision <= known.revision) return;
      doc.current = next;
      if (!write || !active) return;
      const { params, state, onPatch, onParam } = live.current;
      const read = cardFromBody(next.body, lookup);
      const changed = Object.fromEntries(Object.entries(read.params).filter(([k, v]) => params[k] !== v));
      onPatch(read.state);
      if (Object.keys(changed).length > 0) onParam(changed);
      // An edit before the next render builds on the adopted card, not the one it replaced.
      live.current = { ...live.current, state: { ...state, ...read.state }, params: { ...params, ...changed } };
    };

    const fail = (error: unknown, offline: string) => {
      if (!(error instanceof ChartServerError) || error.status >= 500) return setNote(offline);
      if (error.status === 404) {
        gone.current = true;
        pending.current = null;
        return setNote(NOTES.gone);
      }
      setNote(`Not saved to the chart server: ${error.message}`);
    };

    const refetch = async () => {
      if (doc.current === null) return;
      if (inFlight.current || pending.current !== null) { stale.current = true; return; }
      const e = epoch.current;
      try { adopt(await getChart(f, doc.current.id), true); } catch (error) { if (epoch.current === e) fail(error, NOTES.offline); }
    };

    const retryLater = () => {
      if (retryTimer !== undefined || !active) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; queue(); }, RETRY_MS);
    };

    const flush = async (): Promise<void> => {
      if (inFlight.current || pending.current === null || doc.current === null || gone.current) return;
      const sent = pending.current;
      const e = epoch.current;
      pending.current = null;
      inFlight.current = true;
      let unreachable = false;
      try {
        const result = await saveChart(f, doc.current, sent);
        if (epoch.current !== e) return;
        if ("saved" in result) {
          adopt(result.saved, false);
          setNote(null);
        } else {
          pending.current = null;
          adopt(result.conflict, true);
          setNote(result.conflict.updated_by.startsWith("rita") ? NOTES.rita : NOTES.elsewhere);
        }
      } catch (error) {
        if (epoch.current !== e) return;
        unreachable = unreachableError(error);
        if (unreachable) pending.current ??= sent; // retried on the feed's reconnect, or in a second
        fail(error, NOTES.offline);
      } finally {
        if (epoch.current === e) inFlight.current = false;
      }
      if (epoch.current !== e) return;
      if (unreachable) return retryLater();
      if (pending.current !== null) return flush();
      if (stale.current) { stale.current = false; await refetch(); }
    };

    const sync = async () => {
      if (!active || gone.current) return;
      const id = doc.current?.id ?? live.current.params.chart_id ?? "";
      const e = epoch.current;
      try {
        if (id === "") {
          const mine = body();
          if (mine.symbol === "") return; // nothing to save yet
          const created = await createChart(f, mine.symbol, mine);
          // The card may have been pointed at a document while this one uploaded: the new one is then an orphan.
          if (epoch.current !== e || (live.current.params.chart_id ?? "") !== "") return;
          bound.current = created.id;
          adopt(created, true); // the card now holds the series ids the document named
          if (active) live.current.onParam({ chart_id: created.id });
          setNote(null);
        } else if (doc.current === null) {
          adopt(await getChart(f, id), true);
          setNote(null);
        } else if (pending.current !== null) {
          await flush();
        } else {
          const row = (await listCharts(f)).find((r) => r.id === id);
          if (row === undefined) fail(new ChartServerError(404, "no such chart"), NOTES.offline);
          else if (row.revision > doc.current.revision) await refetch();
        }
      } catch (error) {
        if (epoch.current === e) fail(error, doc.current === null ? NOTES.offlineAtOpen : NOTES.offline);
      }
    };
    const queue = () => { chain.current = chain.current.then(sync); };

    edits.current = (apply) => {
      const before = JSON.stringify(body());
      apply();
      const after = body();
      if (JSON.stringify(after) === before) return;
      if (doc.current === null) {
        if ((live.current.params.chart_id ?? "") === "") queue(); // a card that had nothing to upload may now
        return;
      }
      pending.current = after;
      void flush();
    };
    const stop = watchCharts(f, {
      onOpen: queue,
      onEvent: (event) => {
        const known = doc.current;
        if (event.kind === "chart" && known !== null && event.id === known.id && event.revision > known.revision) void refetch();
      },
    });
    queue();
    return () => { active = false; edits.current = null; clearTimeout(retryTimer); stop(); };
  }, [f, ready, chartId]);

  if (f === undefined) return null;
  const edit = (apply: () => void) => (edits.current ? edits.current(apply) : apply());
  return {
    note: card.registry.status === "unavailable" ? NOTES.registry : note,
    onPatch: (patch) => edit(() => {
      live.current.onPatch(patch);
      live.current = { ...live.current, state: { ...live.current.state, ...patch } };
    }),
    onParam: (patch) => edit(() => {
      live.current.onParam(patch);
      live.current = { ...live.current, params: { ...live.current.params, ...patch } };
    }),
  };
}
