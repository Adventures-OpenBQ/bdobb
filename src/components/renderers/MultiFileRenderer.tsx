// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHoverPanel } from "../../hooks/useHoverPanel";
import { useParamOptions, type OptionsState } from "../../hooks/useParamOptions";
import { fetchWidgetDocuments } from "../../lib/dataClient";
import { parseDocuments, type Document } from "../../lib/documents";
import { logError } from "../../lib/logger";
import type { BackendConfig, ParamOption, WidgetDef } from "../../lib/types";
import { DocumentView } from "./DocumentView";
import { ErrorState } from "./ErrorState";

/**
 * Said by the rail AND by the empty viewer: without the second one, a filter
 * that matched nothing sends the reader to a rail to pick from an empty list.
 */
const NO_DOCUMENTS = "No documents for these parameters.";

/**
 * The collapsed rail's badge. The count of CHECKED files alone could not tell
 * "the new parameters match nothing" from "you have not picked anything yet" —
 * both read `0` — so after an Apply the reader had to hover the rail to find
 * out whether the filter had matched. Pure and exported for its own test.
 *
 * A loading state can still carry the PREVIOUS list's options (useParamOptions
 * keeps them so the strip does not flicker); counting those would state the
 * old filter's answer as the current one, so loading shows neither count.
 */
export function fileRailBadge(
  state: OptionsState | undefined,
  checkedCount: number,
): { text: string; title?: string } {
  if (state === undefined || state.status === "loading") return { text: "…" };
  // The hook's message, which describeHttpError has already made safe: no URL
  // and no credential reaches this tooltip.
  if (state.status === "error") return { text: "!", title: state.error };
  const available = state.options.length;
  // A cached param change goes ready→ready with no loading render between,
  // and the checked set is cleared by an effect one render later; clamp so
  // that frame never shows an impossible fraction like 3/2.
  const checked = Math.min(checkedCount, available);
  return {
    text: checked === 0 ? String(available) : `${checked}/${available}`,
  };
}

type Props = {
  widget: WidgetDef;
  backend: BackendConfig | undefined;
  /** The card's EFFECTIVE params — group values already merged in. */
  params: Record<string, string>;
  /**
   * Bumped by the card's Refresh button (useWidgetData's `attempt`). This type
   * fetches nothing through useWidgetData, so Refresh has no request of its
   * own to repeat: re-issuing the last Open is the only thing it can mean
   * here. Required: a caller with no Refresh to offer passes 0 explicitly
   * rather than leaving the re-open trigger to a default.
   */
  refreshKey: number;
};

/**
 * A multi_file_viewer's documents are chosen inside the card, not in the
 * params strip: the choice is a viewing decision, and persisting it would mean
 * a disk write per click. fetchesData is false for this type, so the card
 * mounts this immediately and every request below is this component's own.
 */
export function MultiFileRenderer({ widget, backend, params, refreshKey }: Props) {
  const panel = useHoverPanel();
  const selector = widget.params.find((p) => p.roles?.includes("fileSelector"));

  /**
   * A one-param stand-in widget, so the existing hook fetches exactly this
   * param's choices and nothing else — templated on the card's own params, so
   * the list follows the strip (the cascade), cached per backend + request
   * like every other option list, and never duplicated across cards.
   */
  const selectorWidget = useMemo<WidgetDef>(
    () => ({ ...widget, params: selector ? [selector] : [] }),
    [widget, selector],
  );
  const optionStates = useParamOptions(backend, selectorWidget, params);
  const state = selector ? optionStates[selector.paramName] : undefined;
  const options: ParamOption[] = state?.status === "ready" ? state.options : [];

  const [checked, setChecked] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The selection the last Open was issued for, so Retry repeats that POST. */
  const lastRequest = useRef<string[]>([]);
  /** Two rapid Opens are reachable; without this the slower answer can win. */
  const sequence = useRef(0);
  /** Read by the rail's own onMouseLeave, to find focus still inside it. */
  const railRef = useRef<HTMLDivElement>(null);

  // The checked set is component state, never written to the card. It resets
  // when the CHOICES change — a different request key means an upstream param
  // moved, and a URL from the old list is not offered by the new one.
  const choicesKey = state?.status === "ready" ? state.key : "";
  useEffect(() => {
    setChecked([]);
  }, [choicesKey]);

  const open = useCallback(
    async (urls: string[]) => {
      // No backend is not a state Open can be pressed in: the options hook
      // reports "Backend not configured" in the rail, so no checkbox exists,
      // so Open is disabled. The guard is here for the type, not the case.
      if (!selector || !backend || urls.length === 0) return;
      const seq = sequence.current + 1;
      sequence.current = seq;
      lastRequest.current = urls;
      setLoadingCount(urls.length);
      setError(null);
      try {
        const payload = await fetchWidgetDocuments(backend, widget, params, {
          [selector.paramName]: urls,
        });
        // 204 is how openbb-api answers an EmptyDataError, and sendJson turns
        // it into null. That is an empty answer, not a malformed one: handing
        // it to parseDocuments would throw "not a document payload" and put a
        // failure banner and a log line where "No documents came back." belongs.
        const parsed = payload === null ? [] : parseDocuments(payload);
        if (seq !== sequence.current) return;
        setDocuments(parsed);
        setIndex(0);
      } catch (err) {
        if (seq !== sequence.current) return;
        const message = err instanceof Error ? err.message : String(err);
        // The previous documents stay on screen: losing what you were reading
        // because the NEXT request failed is worse than the failure.
        setError(message);
        // Widget id and message only. describeHttpError and
        // safeNetworkErrorMessage already made the message safe, and no
        // document URL and no credential is written here.
        await logError(`widget ${widget.id} documents fetch failed: ${message}`);
      } finally {
        if (seq === sequence.current) setLoadingCount(0);
      }
    },
    [backend, params, selector, widget],
  );

  // Refresh repeats the last Open, and only that: the choices list is NOT
  // refetched, because its cache is app-lifetime by design (see
  // useParamOptions). The mount value is skipped, so a card that has just
  // appeared still issues nothing until the reader picks files -- the whole
  // point of this type not fetching on mount.
  const seenRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefresh.current) return;
    seenRefresh.current = refreshKey;
    if (lastRequest.current.length > 0) void open(lastRequest.current);
  }, [refreshKey, open]);

  if (!selector) return <p className="empty-state">This widget declares no file selector.</p>;

  const choices =
    state === undefined || state.status === "loading" ? (
      <p className="empty-state">Loading documents…</p>
    ) : state.status === "error" ? (
      <p className="empty-state">{state.error}</p>
    ) : options.length === 0 ? (
      <p className="empty-state">{NO_DOCUMENTS}</p>
    ) : (
      <ul className="file-rail-list">
        {options.map((option) => (
          <li key={option.value}>
            {/* The URL is the title, not the label: it is long enough to
                destroy the rail's layout but is the only thing that tells two
                same-named documents apart. */}
            <label title={option.value}>
              <input
                type="checkbox"
                checked={checked.includes(option.value)}
                onChange={(e) =>
                  setChecked((current) =>
                    e.target.checked
                      ? [...current, option.value]
                      : current.filter((v) => v !== option.value),
                  )
                }
              />
              <span className="file-rail-label">{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    );

  const badge = fileRailBadge(state, checked.length);

  const viewer =
    loadingCount > 0 ? (
      <p className="empty-state">{`Loading ${loadingCount} document(s)…`}</p>
    ) : documents === null ? (
      <p className="empty-state">
        {state?.status === "ready" && options.length === 0
          ? NO_DOCUMENTS
          : "Choose documents in the rail."}
      </p>
    ) : documents.length === 0 ? (
      <p className="empty-state">No documents came back.</p>
    ) : (
      <>
        <div className="multi-file-nav">
          <button
            type="button"
            aria-label="Previous document"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            ‹
          </button>
          <span className="multi-file-position">{`${index + 1} / ${documents.length}`}</span>
          <button
            type="button"
            aria-label="Next document"
            disabled={index >= documents.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            ›
          </button>
        </div>
        <DocumentView doc={documents[index]} />
      </>
    );

  return (
    <div className="multi-file">
      {/* Absolute over the viewer, at rest as well as expanded, so expanding
          never reflows the pages — the guarantee .left-rail makes for the
          dashboard, at a card's scale. The hook's drag handlers come along
          with the spread and are simply inert here: nothing is dropped on a
          file rail. */}
      <div
        ref={railRef}
        className="file-rail"
        data-expanded={panel.open}
        // A tab stop, so the panel is reachable without a pointer: the
        // expanded half is display:none until :hover OR :focus-within, and
        // focus can only get inside it through this.
        tabIndex={0}
        aria-label="Documents"
        {...panel.handlers}
        // Declared AFTER the spread on purpose: it replaces the hook's own
        // onMouseLeave. A checkbox keeps focus after it is clicked, and
        // `.file-rail:focus-within` paints the expanded rules whatever
        // data-expanded says -- so in WKWebView the rail stayed open after the
        // pointer left. Dropping focus as the pointer goes is what reconciles
        // the two. A keyboard user never fires mouseleave, so :focus-within
        // still holds the rail open for them.
        onMouseLeave={() => {
          const el = document.activeElement;
          if (el instanceof HTMLElement && railRef.current?.contains(el)) el.blur();
          panel.handlers.onMouseLeave();
        }}
      >
        <div className="file-rail-collapsed">
          <span className="file-rail-glyph">▤</span>
          <span className="file-rail-count" title={badge.title}>
            {badge.text}
          </span>
        </div>
        <div className="file-rail-expanded">
          {choices}
          <div className="file-rail-actions">
            <button
              type="button"
              disabled={checked.length === 0}
              // Deliberately does NOT collapse the rail. Several Opens in a
              // row are the normal way to compare filings, and a rail that
              // shut on each one would cost a re-hover every time. The rail
              // closes on exactly one thing -- the pointer leaving it -- and
              // the rail's own onMouseLeave drops the focus that would
              // otherwise keep :focus-within holding it open.
              onClick={() => void open(checked)}
            >
              Open
            </button>
            <button type="button" className="file-rail-clear" onClick={() => setChecked([])}>
              Clear
            </button>
          </div>
        </div>
      </div>
      <div className="multi-file-viewer">
        {error !== null ? (
          <ErrorState message={error} onRetry={() => void open(lastRequest.current)} />
        ) : null}
        {viewer}
      </div>
    </div>
  );
}
