// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * The card's symbol block alone (spec 2026-09-24, A1/A3): the pack's pill
 * holding the 22px round mark, the ticker, and the issuer's name underneath
 * it. The command cluster (timeframe, range, session, Adjusted, Panels) and
 * the actions (Series, `{ }`, Snapshot) that used to share this row moved to
 * `ChartControls`, on the Parameters row; the price hero moved to the
 * legend row's `trailing` slot (A1). The symbol block is not a search box
 * (spec ruling): it focuses the card's own symbol control.
 */
export function Header({
  symbol, meta, symbolEditing, onSymbolEditing, onSymbol,
}: {
  symbol: string;
  meta: { name: string | null; logoUrl: string | null } | null;
  /**
   * The symbol block edits in place (user ruling 2026-09-17, replacing the
   * "focus the card's parameter" ruling): a click, or `/`, turns the ticker
   * into a text field; Enter commits through `onSymbol` (the card's own
   * parameter path, so a grouped symbol moves its group), blur commits the
   * same way, Esc cancels. Controlled, because the renderer's keyboard map
   * opens it.
   */
  symbolEditing: boolean; onSymbolEditing: (open: boolean) => void; onSymbol: (symbol: string) => void;
}) {
  // The editor opens on the user's own click or `/`, so taking focus is the
  // action they asked for -- done here rather than with autoFocus (a11y lint).
  const symbolInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (symbolEditing) { symbolInput.current?.focus(); symbolInput.current?.select(); }
  }, [symbolEditing]);
  // Enter and blur commit; Esc cancels. Esc's own close can blur the input
  // afterwards, and a commit must run once, so either path marks it done.
  const cancelled = useRef(false);
  useEffect(() => { if (symbolEditing) cancelled.current = false; }, [symbolEditing]);
  const commit = (raw: string) => {
    if (cancelled.current) return;
    cancelled.current = true;
    const next = raw.trim().toUpperCase();
    onSymbolEditing(false);
    if (next !== "" && next !== symbol) onSymbol(next);
  };
  // The pack's 22px round mark at the head of the symbol pill: the issuer's
  // logo when the backend knows one, and the ticker's initial on the accent
  // otherwise, so the pill never opens on a hole. Decorative either way --
  // the ticker beside it is the name.
  const mark = meta?.logoUrl
    ? <img className="chart-symbol-logo" src={meta.logoUrl} alt="" />
    : <span className="chart-symbol-mark" aria-hidden="true">{symbol.slice(0, 1)}</span>;
  return (
    <div className="chart-symbol-col">
      {symbolEditing ? (
        <span className="chart-symbol chart-symbol-editing">
          {mark}
          <input
            className="chart-symbol-input"
            aria-label="Symbol"
            ref={symbolInput}
            defaultValue={symbol}
            spellCheck={false}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Escape") { e.preventDefault(); cancelled.current = true; onSymbolEditing(false); return; }
              if (e.key !== "Enter") return;
              e.preventDefault();
              commit(e.currentTarget.value);
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
          />
        </span>
      ) : (
        <button type="button" className="chart-symbol" onClick={() => onSymbolEditing(true)} title="Change the symbol (/)">
          {mark}
          <span className="chart-symbol-ticker">{symbol} ▾</span>
        </button>
      )}
      {/* Outside the pill and under it, as the pack has it. */}
      {meta?.name ? <span className="chart-symbol-name">{meta.name}</span> : null}
    </div>
  );
}
