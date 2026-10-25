// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from "react";
import { isRecord } from "../../lib/isRecord";
import {
  PROBE_RESULTS,
  type KeysRow,
  type ProbeResultName,
  type ProbeTone,
} from "../../lib/providerKeys";
import { isMenuKey, RowContextMenu } from "../RowContextMenu";

// The row shapes live in lib/providerKeys.ts, so providerAvailability (lib)
// imports nothing from components; re-exported for this file's importers.
export type { DiagnosticCode, KeyCheck, KeysRow } from "../../lib/providerKeys";

export type KeysPayload = { tier: number; rows: KeysRow[] };

export function isKeysPayload(data: unknown): data is KeysPayload {
  return isRecord(data) && typeof data.tier === "number" && Array.isArray(data.rows);
}

/**
 * The rows of a keys payload, or null if it is not one at all.
 *
 * key-maint's document is untrusted JSON like any other, and `isKeysPayload`
 * only proves `rows` is an array — nothing about what is IN it. A null or a
 * bare string among them is one bad row, not a bad document: it is dropped
 * here, so neither the table below nor providerKeysStore's hand-off has to
 * survive destructuring it. Both read rows through this one function, so a
 * row one of them skips cannot be a row the other trips over.
 *
 * The same goes for a row whose provider or env_var is not a string (or whose
 * provider_id is there and not one): the table's sort and the provider
 * dashboard's byName call localeCompare on them, and a TypeError there takes
 * the whole panel down.
 */
export function keysRows(data: unknown): KeysRow[] | null {
  if (!isKeysPayload(data)) return null;
  return (data.rows as unknown[]).filter(
    (r) =>
      isRecord(r) &&
      typeof r.provider === "string" &&
      typeof r.env_var === "string" &&
      (r.provider_id === undefined || typeof r.provider_id === "string"),
  ) as unknown as KeysRow[];
}

const UNPROBED = { tone: "grey" as ProbeTone, label: "not probed" };

/**
 * A probe ran and key-maint sent a result the app does not recognise. Kept
 * grey — inventing a colour for a state the app does not understand would be
 * worse than not knowing — but this is NOT the same situation as no probe
 * having run at all, so it gets its own label.
 */
const UNRECOGNISED = { tone: "grey" as ProbeTone, label: "probe ran, but the result is not recognised" };

/**
 * The dot for one row: no probe, a known result, or an unrecognised one. The
 * result table lives in lib/providerKeys so the Library's provider badge
 * colours the same provider the same way; only the two labels above, which
 * describe the absence of a result rather than a result, stay here.
 */
export function dotFor(row: KeysRow): { tone: ProbeTone; label: string } {
  if (!row.test) return UNPROBED;
  // Object.hasOwn, not `PROBE_RESULTS[result]`: a result of "constructor" or
  // "toString" would otherwise find an inherited Object.prototype member.
  return Object.hasOwn(PROBE_RESULTS, row.test.result)
    ? PROBE_RESULTS[row.test.result as ProbeResultName]
    : UNRECOGNISED;
}

/** What the deployment has configured. Separate question from the dot. */
export function pill(row: KeysRow): { text: string; tone: ProbeTone } {
  if (row.status === "set") {
    return row.demo
      ? { text: "Demo key", tone: "amber" }
      : { text: "Own key", tone: "green" };
  }
  if (row.status === "empty" || row.status === "missing") {
    return { text: "Not set", tone: "red" };
  }
  return { text: "Unknown", tone: "grey" };
}

export function KeysRenderer({
  data,
  onProbe,
  onTest,
  onSubmit,
}: {
  data: unknown;
  onProbe: () => void;
  onTest: (envVar: string) => void;
  onSubmit: (envVar: string, value: string) => Promise<{ restart_required?: boolean }>;
}) {
  /** Provider is the only sortable column; null is the payload's own order. */
  const [sort, setSort] = useState<"asc" | "desc" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; envVar: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [restart, setRestart] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  // The trigger that opened the current menu, so focus can be returned to
  // it on close instead of being lost to <body>.
  const triggerRef = useRef<HTMLElement | null>(null);

  function openMenu(trigger: HTMLElement, x: number, y: number, envVar: string) {
    triggerRef.current = trigger;
    setMenu({ x, y, envVar });
  }

  // This component never probes on its own: its owner decides when vendors
  // are contacted (KeysPanel fetches cheap status on mount and only probes
  // on Refresh). onProbe is purely the Refresh button's handler.
  const rows = keysRows(data);
  const tier = isKeysPayload(data) ? data.tier : 0;

  // The form must not outlive the authority to use it: a refresh that drops
  // the tier below 3 has to close any open edit and drop its draft, not just
  // stop rendering the Edit button.
  useEffect(() => {
    if (tier !== 3) {
      setEditing(null);
      setDraft("");
    }
  }, [tier]);

  /**
   * Provider is the only column with anything to sort by, and the payload is
   * a handful of rows: one comparator over a copy, not a table library.
   * `null` leaves key-maint's own order alone, which is where the header
   * cycles back to on a third click.
   */
  const sorted = useMemo(() => {
    if (rows === null || sort === null) return rows;
    const direction = sort === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => a.provider.localeCompare(b.provider) * direction);
  }, [rows, sort]);

  /** One press of the Provider header, by pointer or by key. */
  const cycleSort = () =>
    setSort((cur) => (cur === null ? "asc" : cur === "asc" ? "desc" : null));

  if (rows === null) {
    return <p className="empty-state">This payload is not a key status response.</p>;
  }

  return (
    <div className="keys-wrap">
      <div className="keys-actions">
        <button type="button" aria-label="Refresh key status" onClick={onProbe}>
          Refresh
        </button>
      </div>
      <table className="widget-table keys-table">
        <thead>
          <tr>
            <th />
            <th
              aria-sort={sort === null ? "none" : sort === "asc" ? "ascending" : "descending"}
              // In the Tab order and operable by Enter/Space, the same way the
              // virtualised table's header cell is: a sort a keyboard cannot
              // reach is a feature a keyboard cannot use. A <th> is not
              // natively activatable, so the browser synthesises no click for
              // either key -- both are handled here instead.
              tabIndex={0}
              onClick={cycleSort}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // Space would scroll the panel out from under the table.
                e.preventDefault();
                cycleSort();
              }}
            >
              Provider
            </th>
            <th>Key</th>
            <th>Detail</th>
            {tier === 3 ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {sorted?.map((row) => {
            const dot = dotFor(row);
            const p = pill(row);
            return (
              // Keyed by env_var, never by `value` — a React key reaches the DOM.
              <tr key={row.env_var || row.provider}>
                <td>
                  <span
                    className="key-dot"
                    data-testid="key-dot"
                    data-tone={dot.tone}
                    // Never colour alone.
                    aria-label={dot.label}
                    role="img"
                  />
                </td>
                <td>
                  <span
                    tabIndex={0}
                    role="button"
                    aria-haspopup="menu"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e.currentTarget, e.clientX, e.clientY, row.env_var);
                    }}
                    onKeyDown={(e) => {
                      // Enter/Space: the conventional way to activate a focused
                      // control, and this trigger has no other action bound to
                      // them. ContextMenu / Shift+F10: the OS-level keys for
                      // opening a context menu, kept so the menu is reachable the
                      // way a keyboard-only user expects even without knowing this
                      // span doubles as a button.
                      if (!isMenuKey(e)) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openMenu(e.currentTarget, rect.left, rect.bottom, row.env_var);
                    }}
                  >
                    {row.provider}
                  </span>
                </td>
                <td>
                  <span className="key-pill" data-tone={p.tone}>
                    {p.text}
                  </span>
                </td>
                {/* Built by key-maint from status codes and exception class
                    names only — never URLs, bodies or key material. Rendered
                    as-is. Never `row.value`, which at tier 3 is the plaintext
                    credential. */}
                <td>{row.test?.detail ?? ""}</td>
                {tier === 3 ? (
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(row.env_var);
                        setDraft("");
                      }}
                    >
                      Edit
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu ? (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          returnFocusTo={triggerRef.current}
          items={[{ label: "Test this service", onSelect: () => onTest(menu.envVar) }]}
        />
      ) : null}

      {editing && tier === 3 ? (
        <form
          className="keys-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const envVar = editing;
            const value = draft;
            // Cleared before the await: the draft must not outlive the
            // submit in component state.
            setEditing(null);
            setDraft("");
            setSubmitFailed(false);
            void onSubmit(envVar, value)
              .then((r) => setRestart(Boolean(r?.restart_required)))
              .catch(() => setSubmitFailed(true));
          }}
        >
          <label htmlFor="keys-new-value">New value</label>
          {/* type=password so a shoulder-surfer and a screenshot see nothing;
              the value is never echoed back after submit. */}
          <input
            id="keys-new-value"
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit">Save</button>
        </form>
      ) : null}

      {restart ? (
        <p className="keys-restart">
          Saved. The running <code>openbb-api</code> container cannot see this change — its
          environment is fixed when the process starts. Restart it to pick the key up.
        </p>
      ) : null}

      {submitFailed ? (
        // Fixed message only — never text derived from the rejection. A
        // network-layer error can carry a URL (which may itself carry the
        // submitted value, e.g. in a query string), so nothing from `error`
        // is shown here.
        <p className="keys-submit-error">Save failed. The key was not updated.</p>
      ) : null}
    </div>
  );
}
