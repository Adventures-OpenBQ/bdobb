// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { fetchDocumentBytes } from "../../lib/dataClient";
import type { Document } from "../../lib/documents";
import { ErrorState } from "./ErrorState";
import { PdfView } from "./PdfView";

/**
 * One parsed document. Shared by PdfRenderer and MultiFileRenderer so the
 * "not displayable" wording exists once — the same reason parseDocuments is
 * one function rather than two.
 *
 * `dataType` falls back to "unknown" only for display: the parser keeps it as
 * "" when the backend sent no usable data_type, and "…: files are not
 * displayable" would read as a typo.
 */
export function DocumentView({ doc }: { doc: Document }) {
  if (doc.kind === "error") return <p className="empty-state">{`${doc.filename}: ${doc.message ?? ""}`}</p>;
  if (doc.kind === "pdf" && doc.url) return <LinkedPdf url={doc.url} filename={doc.filename} />;
  if (doc.kind !== "pdf" || !doc.bytes) {
    return (
      <p className="empty-state">
        {`${doc.filename}: ${doc.dataType || "unknown"} files are not displayable in this version.`}
      </p>
    );
  }
  return <PdfView bytes={doc.bytes} filename={doc.filename} />;
}

/**
 * A pdf the backend sent as a link: downloaded, then shown in the same viewer
 * as a base64 one. Not framed: WebKit will not render a pdf inside a
 * sandboxed iframe, and an unsandboxed one would hand a foreign page full
 * frame privileges. Retry repeats the download.
 */
/** A document is bigger than a widget payload; still finite. */
const DOCUMENT_TIMEOUT_MS = 30_000;

function LinkedPdf({ url, filename }: { url: string; filename: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ bytes: Uint8Array } | { error: string } | null>(null);
  useEffect(() => {
    // A late answer for a url this view no longer shows must not land.
    let live = true;
    setState(null);
    // The url is the backend's choice: a host that accepts and never finishes
    // is cut off at the deadline, and leaving the view cancels the download
    // rather than letting it run on unseen. A timer, not AbortSignal.timeout/
    // any, which the iOS 16.4 runtime floor does not all have.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), DOCUMENT_TIMEOUT_MS);
    fetchDocumentBytes(url, controller.signal).then(
      (bytes) => live && setState({ bytes }),
      (err: unknown) =>
        live && setState({ error: `${filename}: ${err instanceof Error ? err.message : String(err)}` }),
    );
    return () => {
      live = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [url, filename, attempt]);

  if (state === null) return <p className="empty-state">Loading…</p>;
  if ("error" in state) return <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />;
  return <PdfView bytes={state.bytes} filename={filename} />;
}
