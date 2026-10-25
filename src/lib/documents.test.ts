// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseDocuments } from "./documents";

/** "hi" as base64 — short enough that the decoded bytes are assertable. */
const HI = "aGk=";

describe("parseDocuments", () => {
  it("parses a single document object, decoding pdf content to bytes", () => {
    const docs = parseDocuments({
      content: HI,
      data_format: { data_type: "pdf", filename: "report.pdf" },
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe("report.pdf");
    expect(docs[0].dataType).toBe("pdf");
    expect(docs[0].kind).toBe("pdf");
    // Not toEqual on the Uint8Array itself: a length mismatch reads far
    // more clearly as an array of numbers.
    expect(Array.from(docs[0].bytes ?? [])).toEqual([104, 105]);
  });

  it("parses an array of documents, in order", () => {
    const docs = parseDocuments([
      { content: HI, data_format: { data_type: "pdf", filename: "a.pdf" } },
      { content: HI, data_format: { data_type: "pdf", filename: "b.pdf" } },
    ]);

    expect(docs.map((d) => d.filename)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("returns an empty list for an empty array — a POST that matched nothing", () => {
    expect(parseDocuments([])).toEqual([]);
  });

  it("numbers a document whose filename is missing or blank by its 1-based position", () => {
    // A nameless row in the file rail is unusable; the position is the only
    // thing that always distinguishes one document from another.
    const docs = parseDocuments([
      { content: HI, data_format: { data_type: "pdf", filename: "a.pdf" } },
      { content: HI, data_format: { data_type: "pdf" } },
      { content: HI, data_format: { data_type: "pdf", filename: "   " } },
    ]);

    expect(docs.map((d) => d.filename)).toEqual(["a.pdf", "document 2", "document 3"]);
  });

  it("marks a non-pdf document as other and decodes nothing for it", () => {
    // Decoding a 600 KB spreadsheet nothing can display would be pure waste,
    // and `bytes` is the flag the renderers switch on.
    const docs = parseDocuments({
      content: HI,
      data_format: { data_type: "csv", filename: "table.csv" },
    });

    expect(docs[0].kind).toBe("other");
    expect(docs[0].dataType).toBe("csv");
    expect(docs[0].bytes).toBeUndefined();
  });

  it("keeps an unusable data_type as the empty string rather than guessing pdf", () => {
    const docs = parseDocuments({ content: HI, data_format: { filename: "x.bin" } });

    expect(docs[0].dataType).toBe("");
    expect(docs[0].kind).toBe("other");
  });

  // The reference backend's pdf_widget_url and multi_pdf_url answer with a
  // link instead of content: { url, data_format }.
  it("keeps an https url in place of content, with no bytes", () => {
    const [doc] = parseDocuments({
      url: "https://example.com/sample.pdf",
      data_format: { data_type: "pdf", filename: "Sample.pdf" },
    });
    expect(doc).toEqual({
      filename: "Sample.pdf",
      dataType: "pdf",
      kind: "pdf",
      url: "https://example.com/sample.pdf",
    });
  });

  it("throws for a url that is not http(s)", () => {
    expect(() =>
      parseDocuments({ url: "javascript:alert(1)", data_format: { data_type: "pdf", filename: "a.pdf" } }),
    ).toThrow("not a document payload");
  });

  // A multi_file_viewer answers one entry per requested file, and a file the
  // backend cannot serve comes back as { error_type, content } in its place.
  // Refusing the whole list for it blanked every file that DID come back.
  it("keeps a backend error entry as an error document beside the others", () => {
    const docs = parseDocuments([
      { error_type: "not_found", content: "PDF 'Bitcoin' not found" },
      { content: HI, data_format: { data_type: "pdf", filename: "b.pdf" } },
    ]);
    expect(docs[0]).toEqual({
      filename: "document 1",
      dataType: "",
      kind: "error",
      message: "PDF 'Bitcoin' not found",
    });
    expect(docs[1].kind).toBe("pdf");
  });

  it("throws when the entry carries no data_format", () => {
    expect(() => parseDocuments({ content: HI })).toThrow("not a document payload");
  });

  it("throws when content is not a string", () => {
    expect(() =>
      parseDocuments({ content: 42, data_format: { data_type: "pdf", filename: "a.pdf" } }),
    ).toThrow("not a document payload");
  });

  it("throws on content that is not valid base64", () => {
    // atob rejects it; the whole parse fails rather than yielding a document
    // with no bytes, which the viewer would render as a blank page.
    expect(() =>
      parseDocuments({
        content: "not base64!!!",
        data_format: { data_type: "pdf", filename: "a.pdf" },
      }),
    ).toThrow("not a document payload");
  });

  it("throws for a payload that is not an object at all", () => {
    expect(() => parseDocuments(null)).toThrow("not a document payload");
    expect(() => parseDocuments("a string")).toThrow("not a document payload");
    expect(() => parseDocuments([{ content: HI, data_format: {} }, 7])).toThrow(
      "not a document payload",
    );
  });
});
