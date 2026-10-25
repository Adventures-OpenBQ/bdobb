// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One document as a widget's payload delivers it. openbb-api answers a `pdf`
 * widget with `{ content: <base64>, data_format: { data_type, filename } }`,
 * and a `multi_file_viewer` POST with an array of exactly the same objects —
 * so both renderers parse through this one function and "what counts as a
 * document" is decided in exactly one place.
 */
import { safeUrl } from "./safeUrl";

export type Document = {
  filename: string;
  /** `data_format.data_type` as sent, or "" when it was not a string. */
  dataType: string;
  /**
   * "pdf" only when the type says pdf AND the content decoded (or a url came
   * instead). "error" is a file the backend answered with
   * `{ error_type, content }` in its place; `message` is that content.
   */
  kind: "pdf" | "other" | "error";
  message?: string;
  /** Present iff kind === "pdf" and the backend sent `content`. */
  bytes?: Uint8Array;
  /**
   * Instead of `content`, a backend may send `{ url, data_format }` (the
   * reference backend's pdf_widget_url and multi_pdf_url). Always http(s):
   * safeUrl decides, and anything else is not a document.
   */
  url?: string;
};

/**
 * `atob` plus charCodeAt, never Buffer: there is no Node polyfill in this
 * bundle and `Buffer` does not exist in the app's webview. `atob` throws
 * InvalidCharacterError on a non-base64 string, which is what turns bad
 * content into one honest failure instead of a half-built document.
 */
function decodeBase64(content: string): Uint8Array {
  return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
}

function parseOne(entry: unknown, position: number): Document {
  if (typeof entry !== "object" || entry === null) throw new Error("not a document payload");
  // One file the backend could not serve must not cost the reader every file
  // it did: the entry stands in for that file, and says why.
  const { error_type: errorType, content: errorText } = entry as { error_type?: unknown; content?: unknown };
  if (typeof errorType === "string" && typeof errorText === "string") {
    return { filename: `document ${position}`, dataType: "", kind: "error", message: errorText };
  }
  const { content, url, data_format: format } = entry as {
    content?: unknown;
    url?: unknown;
    data_format?: unknown;
  };
  if (typeof format !== "object" || format === null) throw new Error("not a document payload");
  const link = typeof content !== "string" && typeof url === "string" ? safeUrl(url) : null;
  if (typeof content !== "string" && link === null) throw new Error("not a document payload");

  const { data_type: rawType, filename } = format as { data_type?: unknown; filename?: unknown };
  const dataType = typeof rawType === "string" ? rawType : "";
  // A blank name is common enough on the live backend that numbering it is
  // the difference between a usable file rail and a list of empty rows.
  const name =
    typeof filename === "string" && filename.trim() !== "" ? filename : `document ${position}`;

  if (dataType !== "pdf") return { filename: name, dataType, kind: "other" };
  if (link !== null) return { filename: name, dataType, kind: "pdf", url: link };

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(content as string);
  } catch {
    throw new Error("not a document payload");
  }
  return { filename: name, dataType, kind: "pdf", bytes };
}

/**
 * Accepts one document object or an array of them. Anything else throws
 * `Error("not a document payload")` — a message a card renders verbatim, so
 * it deliberately names no URL and carries nothing from the request.
 */
export function parseDocuments(payload: unknown): Document[] {
  const entries = Array.isArray(payload) ? payload : [payload];
  return entries.map((entry, i) => parseOne(entry, i + 1));
}
