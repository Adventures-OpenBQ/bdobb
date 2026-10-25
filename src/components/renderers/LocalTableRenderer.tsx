// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import { extensionOf, readLocalFile } from "../../lib/localFiles";
import { tableRows } from "../../lib/tableColumns";
import { NOTHING_TO_TRANSPOSE, transposeRows } from "../../lib/transpose";
import type { TableCardState } from "../../lib/types";
import { TableRenderer, type TableStatePatch } from "./TableRenderer";

/**
 * The stored bytes as something TableRenderer can render. SheetJS reads csv,
 * tsv, xls and xlsx from the same call; JSON is parsed directly, because
 * SheetJS would flatten an array of objects through its own coercion rules
 * rather than hand back what the file says.
 *
 * Imported lazily for the reason src/lib/export.ts states: SheetJS is ~780 KB
 * and Vite splits it into its own chunk, so a session with no local file
 * never fetches it.
 *
 * Exported for its own tests: everything here is a pure bytes-in/value-out
 * function, and testing it through the component would need the filesystem.
 */
export async function dataFromBytes(name: string, bytes: Uint8Array): Promise<unknown> {
  if (extensionOf(name) === "json") return JSON.parse(new TextDecoder().decode(bytes));
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "array" });
  const first = book.SheetNames[0];
  // A workbook with no sheet at all is not an error; it has no rows.
  if (first === undefined) return [];
  // raw: true keeps the cell's own value -- a number stays a number, so
  // formatCell and the numeric filters see what the file holds, not a string.
  return XLSX.utils.sheet_to_json(book.Sheets[first]!, { raw: true });
}

type Load =
  | { status: "loading" }
  | { status: "ready"; data: unknown }
  | { status: "error"; message: string };

/**
 * A table over a file this computer holds. The card's `file` param names the
 * stored copy; `label` is the original filename, which is the only name worth
 * showing a person.
 */
export function LocalTableRenderer({
  file,
  label,
  refreshKey,
  state,
  onStateChange,
  filterRow = false,
  transposed = false,
}: {
  /** DashboardCard.params.file: the stored name under the app's files/ dir. */
  file: string;
  /** The card's title -- the name the file had when it was dropped. */
  label: string;
  /** Changes on Refresh and on refresh-all; nothing else re-reads the file. */
  refreshKey: number;
  state?: TableCardState;
  onStateChange?: (patch: TableStatePatch) => void;
  filterRow?: boolean;
  /** The card's view is Transposed: hand the parsed rows through transposeRows and draw them plain. */
  transposed?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    void (async () => {
      const bytes = await readLocalFile(file).catch(() => null);
      if (cancelled) return;
      if (bytes === null) {
        setLoad({ status: "error", message: `File missing: ${label}` });
        return;
      }
      try {
        const data = await dataFromBytes(file, bytes);
        if (!cancelled) setLoad({ status: "ready", data });
      } catch {
        // The error itself is deliberately not shown or logged: it comes from
        // a parser reading the user's own file and can quote its contents.
        if (!cancelled) setLoad({ status: "error", message: `Could not read ${label}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, label, refreshKey]);

  // Above the early returns, as every hook must be, and memoised so a render
  // that changed nothing (a resize, a parent re-render) does not turn the
  // whole file over again.
  const turned = useMemo(() => {
    if (!transposed || load.status !== "ready") return null;
    const rows = tableRows(load.data);
    return rows ? transposeRows(rows) : null;
  }, [load, transposed]);

  if (load.status === "loading") return <p className="empty-state">Loading…</p>;
  if (load.status === "error") return <p className="empty-state">{load.message}</p>;
  // The card's own rows never reach WidgetCard -- this renderer read them --
  // so the transposed view is turned here, and the toolkit state is left
  // untouched for when the view goes back to Table.
  if (transposed) {
    if (turned === null) return <p className="empty-state">{NOTHING_TO_TRANSPOSE}</p>;
    return <TableRenderer data={turned.rows} plain columns={turned.columns} />;
  }
  return (
    <TableRenderer
      data={load.data}
      state={state}
      onStateChange={onStateChange}
      filterRow={filterRow}
    />
  );
}
