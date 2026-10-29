# Agent Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate BDOBB v6 (as host) against the OpenBB example agents 30–42 and Rita (as agent) against BDOBB's live suite, building PDF context, PDF highlight citations and feedback so every example has something to verify, then redeploy the Spark and NAS Ritas and the door.

**Architecture:** BDOBB gains a PDF file item in `get_widget_data`, a validated `quote_bounding_boxes` on citations that opens the cited card's page with overlays, and thumbs feedback posted to `<agent>/v1/feedback`. A shell harness clones the examples at a pinned SHA, runs each on loopback behind a 34-line stub OpenAI server, and drives them through BDOBB's real discovery, query loop and executor. Rita gets recipe patches 0015 (feedback route) and 0016 (`cite_quote` + boxes); the door's gateway relays feedback.

**Tech Stack:** TypeScript/React/vitest (BDOBB), Bash + Node + uv/Python 3.12 (harness), Bun/Hono/zod/unpdf (Rita), Node `node:test` (gateway), Docker/buildx/GHCR.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-conformance-design.md` (this repo). Read it with this plan.

## Global Constraints

- Home: BDOBB v6.0.0 `release/v6` (worktree `~/Developer/openbq-bdobb-v6-agent-conformance`, branch `claude/v6-agent-conformance`). Carrying to v7–v10 is a separate plan.
- No `git push` of any branch or tag, in any repo, until the user authorizes delivery. GHCR image pushes are allowed (private deployment store).
- Example agents pinned at `openbq-org/agents-for-openbb` `aa1073d2b098ae6cf597dabf0635822aa808dd81` (main, 2026-07-01). No example code or payload is committed; clones live in `.superpowers/agent-conformance/` (gitignored).
- Example Python deps pinned: `openbb-ai==2.2.0 fastapi==0.118.3 uvicorn==0.27.1 sse-starlette==2.4.1 pdfplumber==0.11.10 httpx==0.28.1 openai==2.54.0` (resolved from the examples' `pyproject.toml` ranges on 2026-10-28). Python runs with `-I`.
- Example ports: 17730 + example number (17760–17772); stub OpenAI on 17799.
- Any skip fails a gate (`scripts/rita-live-check.sh` rule).
- New first-party BDOBB files carry the AGPL header exactly as neighbours: TS/TSX/MJS `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.` + `// SPDX-License-Identifier: AGPL-3.0-only`; shell `#` form as in `scripts/rita-live-check.sh`. Gateway files keep their Apache-2.0 headers. Rita source files follow upstream (no header).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never write the tailnet name into a tracked file: use `<your-tailnet>`; the NAS's Tailscale name is `<nas-ts-name>`.
- Multi-GB scratch builds go under `/Volumes/Builds/<name>`; say so if it is not mounted.
- Rita recipe base: `Adventures-OpenBQ/agent-rita-bdobb` `origin/main` `0cfbe8b` (patches 0001–0014; tag `v6.0.0` = `bc00fd3` has only 0001–0012). Upstream pin `f673c1fbeeeedfdbf4a253031d85eb8e96538924`.
- Production facts verified 2026-10-28: Spark `rita` = `agent-rita:a2aaa91` from `~/rita/agent-rita/compose.yaml` (host network, `.env`); vLLM `qwen3.6-35b` at `127.0.0.1:8000`. NAS `openbq-stack` at `$STACK`: `openbq-rita` and `openbq-rita-door` = `ghcr.io/adventures-openbq/openbq-rita:sha-94a5d0e@sha256:14a18321e59abdd31c80a9636966c7029a2bef688a1a24492996b45127d4eb79`; `funnel-gateway` = `ghcr.io/adventures-openbq/openbq-funnel-gateway:11.0.0-temporal@sha256:0a25c57fadaed56cb0876c679a34bd44c60a3f0d03151faed2df1772fc1b4f96` (revision `b480f0c`, release/v11; the brief's `aea29572…` is stale). Rita containers run as `USER bun`.

## Decision gate (user rulings needed before Phase B can run green)

These were found by validating BDOBB-shaped requests against `openbb-ai` 2.2.0 and by running examples 36/38/40/41/42 against the stub on 2026-10-28. Each is "BDOBB defect or example quirk" — the user decides; the plan carries the default (BDOBB unchanged) code and the exact alternative.

- **Q1 — `context` 422s every example.** `chatStore.send` always sends `context: [dashboardContext(...)]` = `{name, description}`. `openbb-ai` types `context` as `list[RawContext]` requiring `uuid` and `data`, so every real BDOBB turn to a stock openbb-ai agent answers 422 (verified). Options: (A) BDOBB defect: move the dashboard note to the protocol's `workspace_state.current_dashboard_info` (also fixes Q4) — needs its own design, because Rita reads that only with generative UI on; (B) BDOBB defect, narrow: omit `context` for non-Rita agents (needs a rule for "is Rita"); (C) example quirk: the conformance test sends no `context` (one-line change below) and BDOBB stays as is.
- **Q2 — MCP results lack `content`.** `execute_agent_tool` results go back as `[{items:[{type:"text", text}]}]`; `openbb-ai` needs `content` on each item (422, verified), and example 38 reads `item.content`. (A) BDOBB defect: add `content` beside `text` (diff in Task B3); Rita reads `text` or `content`. (B) quirk: row 38 asserts the 422.
- **Q3 — error items lack `content`.** `{error_type, message}` fails `ClientFunctionCallError` (needs `content`). No happy-path example exercises it; it matters for the PDF-over-limit error. (A) add `content: message` (diff in Task B3). (B) leave.
- **Q4 — example 40 lists secondary widgets only beside `workspace_state` tabs** (BDOBB sends none) or when there is no primary. Default plan: row 40 makes two calls (primary+secondary, then secondary only). (A) BDOBB should send `workspace_state` → same design as Q1(A).
- **Q5 — Qwen on vLLM cannot read a PDF.** Rita sends a PDF to the model as a `file` content part; the Spark's vLLM answers `400 Unsupported chat content part type: 'file'` (verified). So live cases 1–2 cannot pass on Qwen today. (A) new Rita patch 0017: send the PDF's extracted text instead of a file part (Task C4); (B) run the two PDF live cases only against the NAS private Rita on Claude; (C) drop them.
- **Q6 — feedback tags.** Only two Workspace tags are known (from example 42's recorded `feedback.json`): `Not factually correct / Hallucinations / Inaccurate` and `Other`. Plan uses those two. Supply the full list if wanted.
- **Q7 — gateway lineage and tags.** NAS runs `openbq-funnel-gateway:11.0.0-temporal` built from `release/v11` `b480f0c`. `origin/release/v10` = `c3b0ce0` (the public-snapshot line; tag `v10.0.0` = `4acf443` is its parent); `release/v11` descends from a different internal v10 line (`ad74033`). `rita-policy.mjs` and its tests are byte-identical across all three. Plan: commit on `origin/release/v10`, carry to `origin/release/v11`, push image `10.0.0` from v10 and re-cut `11.0.0-temporal` from v11 for the NAS. Confirm both tag names and that the local tag `v10.0.0` may move.
- **Q8 — web relay.** BDOBB's v10 web layer (`web/server.mjs relayRita`) forwards only `/ai/agents.json` and `/ai/v1/query`, so a web user's feedback POST would 404 there. That fix belongs to the v7–v10 carry plan; confirm.

Spec corrections the plan makes (both counterparts agree, so not left open): a URL-served PDF goes as `{url, data_format, citable}` (openbb-ai's `SingleFileReference`; Rita reads `item.url`), not `{content: url}` — examples 35/36 would base64-decode a URL in `content`. Example citations (`openbb_ai.cite`) carry `origin` + `widget_id` but no `uuid` or `name`, so row 32 asserts those and BDOBB resolves a cited card by Rita's `metadata.widget_uuid`, else by `origin` + `widget_id`.

## Review Focus

1. A real PDF larger than the base64 cap (`MAX_RESULT_CHARS` = 100,000 chars, about 73 KB of PDF): the tool result is an error naming the card and the limit, never a truncated PDF. Test: Task A1 "over the limit".
2. A citation whose boxes are partly malformed (string page, `x1 < x0`, missing field): bad boxes and emptied groups are dropped, the citation and its good boxes kept; a citation left with no boxes renders as an ordinary source. Tests: Task A2 and Task A3.
3. Zooming after a highlight opens: pdf.js empties the page div on re-render, so the overlay must come back at the new scale; removing the highlight or closing the card clears it. Tests: Task A3 PdfView "redraws" and store `clear`.
4. A feedback POST that fails (agent down, 5xx): inline error, buttons stay, retry re-sends with the same `trace_id`; after success no second vote. Test: Task A5.
5. Door: feedback from a principal in the middle of a turn still goes through (no turn slot), feedback past `ritaPerHour` is 429, a body over 64 KiB is 413, any other `/ai/v1/*` stays 404. Tests: Task D1.

Also pinned: vitest must not collect `*.test.*` files from the harness's venv under `.superpowers/` (Task B1 adds the exclude).

---

## Phase A — BDOBB v6 features (worktree `~/Developer/openbq-bdobb-v6-agent-conformance`)

All paths in Phase A and B are relative to this worktree. Run commands from it (`cd` first in each shell, or use absolute paths).

### Task A1: PDF context in `get_widget_data`

**Files:**
- Modify: `src/lib/agent/execute.ts` (`WidgetFetch` type ~line 55, `makeWidgetDataFetcher` return ~line 112, `widgetDataResults` ~lines 181–207; new `pdfItem`)
- Test: `src/lib/agent/execute.test.ts`

**Interfaces:**
- Produces: `WidgetFetch = { data; url; params; pdf?: boolean; name?: string }` (the two new fields only for a `pdf` widget, so the existing `toEqual` at execute.test.ts:174 stands); `export function pdfItem(data: unknown, name: string): Record<string, unknown>` — returns `{content, data_format:{data_type:"pdf", filename}, citable:true}` or `{url, data_format, citable:true}`, throws `Error` naming the card when over the cap or not a document.

- [ ] **Step 1: Install and take a baseline**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm exec vitest run src/lib/agent`
Expected: install completes; typecheck and the agent tests PASS. If the unit suite times out under host load, rerun with `--maxWorkers=2` (known flake), and record it.

- [ ] **Step 2: Write the failing tests** (append inside `execute.test.ts`; `backend`, `card`, `widget` come from `../../test/fixtures`, already imported there; `signal` is the file's constant)

```ts
describe("PDF cards in get_widget_data", () => {
  const PDF_CARD = card({ id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "report", backendId: "reference", title: "Annual Report" });
  const report = widget({ id: "report", backendId: "reference", name: "Report", type: "pdf", params: [] });
  const run = (data: unknown) =>
    executeFunction(
      { function: "get_widget_data", input_arguments: { data_sources: [{ widget_uuid: PDF_CARD.id, origin: "reference" }] } },
      { fetchWidget: async () => ({ data, url: "", params: {}, pdf: true, name: "Annual Report" }), runAgentTool: async () => null },
      signal,
    );
  const items = async (data: unknown) => ((await run(data)) as { data: Array<{ items?: unknown[]; message?: string }> }).data[0];

  it("sends a base64 PDF as a pdf file item, not as a table", async () => {
    expect((await items({ content: "JVBERi0=", data_format: { data_type: "pdf", filename: "ar.pdf" } })).items).toEqual([
      { content: "JVBERi0=", data_format: { data_type: "pdf", filename: "ar.pdf" }, citable: true },
    ]);
  });

  it("keeps a backend's PDF link as a url item", async () => {
    expect((await items({ url: "https://example.com/ar.pdf", data_format: { data_type: "pdf", filename: "ar.pdf" } })).items).toEqual([
      { url: "https://example.com/ar.pdf", data_format: { data_type: "pdf", filename: "ar.pdf" }, citable: true },
    ]);
  });

  it("names the file after the card when the backend gave no filename", async () => {
    expect((await items({ content: "JVBERi0=", data_format: { data_type: "pdf" } })).items).toEqual([
      { content: "JVBERi0=", data_format: { data_type: "pdf", filename: "Annual Report.pdf" }, citable: true },
    ]);
  });

  it("is an error naming the card and the limit when the base64 is over the cap, never a truncated PDF", async () => {
    const result = await items({ content: "A".repeat(MAX_RESULT_CHARS + 1), data_format: { data_type: "pdf", filename: "big.pdf" } });
    expect(result.items).toBeUndefined();
    expect(result.message).toContain("Annual Report");
    expect(result.message).toContain(String(MAX_RESULT_CHARS));
  });

  it("marks a pdf widget's fetch as a PDF named after the card", async () => {
    const fetcher = makeWidgetDataFetcher(
      { cards: [PDF_CARD], backends, findWidget: () => report, keyMaintBackends: new Set(), ...NO_GROUPS },
      vi.fn(async () => ({ content: "JVBERi0=", data_format: { data_type: "pdf" } })) as never,
    );
    expect(await fetcher({ widget_uuid: PDF_CARD.id, origin: "reference" }, signal)).toMatchObject({ pdf: true, name: "Annual Report" });
  });
});
```

Add `MAX_RESULT_CHARS` to the file's existing import from `./execute` if it is not already there.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec vitest run src/lib/agent/execute.test.ts -t "PDF cards"`
Expected: FAIL — items are `{content: <json>, data_format: {data_type: "object", ...}}`; `pdf`/`name` missing.

- [ ] **Step 4: Implement**

In `execute.ts`, add the import `import { safeUrl } from "../safeUrl";` and change the type:

```ts
/** `pdf` and `name` only for a pdf widget: its document goes to the agent as a file, named after the card. */
export type WidgetFetch = { data: unknown; url: string; params: Record<string, string>; pdf?: boolean; name?: string };
```

At the end of `makeWidgetDataFetcher`'s returned function replace `return { data, url, params };` with:

```ts
    // The same test WidgetCard uses to choose PdfRenderer.
    return widget.type === "pdf" ? { data, url, params, pdf: true, name: card.title ?? widget.name } : { data, url, params };
```

Add after `capContent`:

```ts
/**
 * A pdf card's document as the protocol's file item. A backend's link stays a
 * link (openbb-ai's SingleFileReference; Rita fetches `url`); bytes go as base64
 * within MAX_RESULT_CHARS, and past it the call fails rather than send half a PDF.
 */
export function pdfItem(data: unknown, name: string): Record<string, unknown> {
  const doc = isRecord(data) ? data : {};
  const format = isRecord(doc.data_format) ? doc.data_format : {};
  const filename = typeof format.filename === "string" && format.filename.trim() !== "" ? format.filename : `${name}.pdf`;
  const data_format = { data_type: "pdf", filename };
  const link = typeof doc.content !== "string" && typeof doc.url === "string" ? safeUrl(doc.url) : null;
  if (link !== null) return { url: link, data_format, citable: true };
  if (typeof doc.content !== "string") throw new Error(`${name}: not a document payload`);
  if (doc.content.length > MAX_RESULT_CHARS) {
    throw new Error(`${name}: the PDF is ${doc.content.length} base64 characters, over the ${MAX_RESULT_CHARS}-character limit for one tool result`);
  }
  return { content: doc.content, data_format, citable: true };
}
```

In `widgetDataResults`, replace the body of the `try`:

```ts
      const { data, url, params, pdf, name } = await deps.fetchWidget(source, signal);
      const item = pdf
        ? pdfItem(data, name ?? String(source.widget_uuid ?? ""))
        : { content: capContent(data), data_format: { data_type: "object", parse_as: "table" }, citable: true };
      deps.onCall?.({ kind: "widget_data", url, params, ok: true, durationMs: Date.now() - started, rows: rowCount(data) });
      out.push({ items: [item] });
```

- [ ] **Step 5: Run the file**

Run: `pnpm exec vitest run src/lib/agent/execute.test.ts`
Expected: PASS (all, including the existing `toEqual` at the old line 174).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/execute.ts src/lib/agent/execute.test.ts
git commit -m "feat(agent): send a PDF card to the agent as a pdf file item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A2: Citation quote boxes — type and parser

**Files:**
- Modify: `src/lib/agent/types.ts` (add `BoundingBox`), `src/lib/agent/events.ts` (citations case)
- Test: `src/lib/agent/events.test.ts`

**Interfaces:**
- Produces: `export type BoundingBox = { text: string; page: number; x0: number; top: number; x1: number; bottom: number }` (PDF points, top-left origin); `export function withQuoteBoxes(c: Record<string, unknown>): Record<string, unknown>` in `events.ts`. After `toAgentEvent`, every citation's `quote_bounding_boxes` is either absent or a non-empty `BoundingBox[][]`.

- [ ] **Step 1: Write the failing tests** (append to `events.test.ts`; import `withQuoteBoxes` from `./events`)

```ts
describe("citation quote boxes", () => {
  const good = { text: "Revenue grew", page: 1, x0: 72, top: 92, x1: 255, bottom: 104 };
  const sse = (payload: unknown) => toAgentEvent({ event: "copilotCitationCollection", data: JSON.stringify(payload) });

  it("keeps well-formed boxes in their groups", () => {
    const event = sse({ citations: [{ id: "c", source_info: { type: "widget" }, quote_bounding_boxes: [[good]] }] });
    expect(event).toEqual({ type: "citations", payload: { citations: [{ id: "c", source_info: { type: "widget" }, quote_bounding_boxes: [[good]] }] } });
  });

  it("drops malformed boxes and emptied groups, and keeps the citation", () => {
    const c = withQuoteBoxes({
      id: "c",
      quote_bounding_boxes: [[good, { ...good, page: "1" }, { ...good, x1: 10 }], [{ ...good, top: undefined }], "junk"],
    });
    expect(c).toEqual({ id: "c", quote_bounding_boxes: [[good]] });
  });

  it("removes the field when no box survives, and leaves a citation without it alone", () => {
    expect(withQuoteBoxes({ id: "c", quote_bounding_boxes: [[{ page: 0 }]] })).toEqual({ id: "c" });
    expect(withQuoteBoxes({ id: "c", quote_bounding_boxes: null })).toEqual({ id: "c" });
    const plain = { id: "c" };
    expect(withQuoteBoxes(plain)).toBe(plain);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/lib/agent/events.test.ts -t "quote boxes"`
Expected: FAIL — `withQuoteBoxes` is not exported.

- [ ] **Step 3: Implement**

In `types.ts`, after `ClientArtifact`:

```ts
/**
 * One highlighted line of a cited PDF quote, in PDF points from the page's
 * top-left corner (pdfplumber's convention, which openbb-ai and Rita use).
 */
export type BoundingBox = { text: string; page: number; x0: number; top: number; x1: number; bottom: number };
```

In `events.ts`, import `BoundingBox` with the other types and add above `toAgentEvent`:

```ts
function boxOf(v: unknown): BoundingBox | null {
  if (!isRecord(v)) return null;
  const { text, page, x0, top, x1, bottom } = v;
  if (typeof text !== "string" || typeof page !== "number" || !Number.isInteger(page) || page < 1) return null;
  if (![x0, top, x1, bottom].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const box = { text, page, x0, top, x1, bottom } as BoundingBox;
  return box.x1 >= box.x0 && box.bottom >= box.top ? box : null;
}

/** A citation with its quote_bounding_boxes validated: bad boxes and emptied groups go, the citation stays. */
export function withQuoteBoxes(c: Record<string, unknown>): Record<string, unknown> {
  if (!("quote_bounding_boxes" in c)) return c;
  const { quote_bounding_boxes: raw, ...rest } = c;
  const groups = (Array.isArray(raw) ? raw : [])
    .map((g) => (Array.isArray(g) ? g.map(boxOf).filter((b): b is BoundingBox => b !== null) : []))
    .filter((g) => g.length > 0);
  return groups.length > 0 ? { ...rest, quote_bounding_boxes: groups } : rest;
}
```

Replace the `copilotCitationCollection` case:

```ts
    // AWAITING rita/roundtrip-answer.sse, which carries a citation collection.
    case "copilotCitationCollection": {
      if (!isRecord(payload)) return null;
      const list = payload.citations;
      return {
        type: "citations",
        payload: Array.isArray(list) ? { ...payload, citations: list.map((c) => (isRecord(c) ? withQuoteBoxes(c) : c)) } : payload,
      };
    }
```

- [ ] **Step 4: Run**

Run: `pnpm exec vitest run src/lib/agent/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/types.ts src/lib/agent/events.ts src/lib/agent/events.test.ts
git commit -m "feat(agent): parse citation quote_bounding_boxes, dropping malformed boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A3: Open a quote on its card — store, Sources, PdfView overlays, wiring

**Files:**
- Create: `src/stores/pdfHighlightStore.ts`, `src/stores/pdfHighlightStore.test.ts`
- Modify: `src/components/rita/Sources.tsx`, `src/components/rita/ChatPane.tsx` (pass cards), `src/components/renderers/PdfView.tsx`, `src/components/renderers/DocumentView.tsx`, `src/components/renderers/PdfRenderer.tsx`, `src/components/WidgetCard.tsx` (~line 1131 and the `<article className="widget-card"` at ~line 1263), `src/styles.css` (after `.pdf-body` ~line 2396)
- Test: `src/components/rita/Sources.test.tsx`, `src/components/renderers/PdfView.test.tsx`, `src/components/renderers/PdfRenderer.test.tsx`

**Interfaces:**
- Consumes: `BoundingBox` (A2); citations already passed through `withQuoteBoxes`.
- Produces: `usePdfHighlightStore` with `{ highlight: PdfHighlight | null; show(h: PdfHighlight): void; clear(cardId: string): void }`, `PdfHighlight = { cardId: string; page: number; boxes: BoundingBox[] }`; `export function citedCardId(c: Record<string, unknown>, cards: DashboardCard[]): string | null` in Sources; `Sources({ citations, cards? })`; `PdfView({ bytes, filename, highlight? })`, `DocumentView({ doc, highlight? })`, `PdfRenderer({ data, onRetry, highlight? })` with `highlight?: { page: number; boxes: BoundingBox[] } | null`; `export function boxRect(box: BoundingBox, scale: number): { left; top; width; height }` in PdfView.

- [ ] **Step 1: Write the failing store test** (`src/stores/pdfHighlightStore.test.ts`, with the AGPL header)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePdfHighlightStore } from "./pdfHighlightStore";

const box = { text: "q", page: 2, x0: 1, top: 2, x1: 3, bottom: 4 };

describe("pdfHighlightStore", () => {
  beforeEach(() => usePdfHighlightStore.setState({ highlight: null }));

  it("holds one highlight; opening another replaces it", () => {
    usePdfHighlightStore.getState().show({ cardId: "a", page: 2, boxes: [box] });
    usePdfHighlightStore.getState().show({ cardId: "b", page: 1, boxes: [] });
    expect(usePdfHighlightStore.getState().highlight?.cardId).toBe("b");
  });

  it("clears only for the card that holds it", () => {
    usePdfHighlightStore.getState().show({ cardId: "a", page: 2, boxes: [box] });
    usePdfHighlightStore.getState().clear("b");
    expect(usePdfHighlightStore.getState().highlight?.cardId).toBe("a");
    usePdfHighlightStore.getState().clear("a");
    expect(usePdfHighlightStore.getState().highlight).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing Sources tests** (append to `Sources.test.tsx`; add imports `import { card } from "../../test/fixtures";`, `import { usePdfHighlightStore } from "../../stores/pdfHighlightStore";`, and `citedCardId` from `./Sources`)

```tsx
describe("quote citations", () => {
  const box = (page: number) => ({ text: "q", page, x0: 1, top: 2, x1: 3, bottom: 4 });
  const REPORT = card({ id: "11111111-1111-4111-8111-111111111111", backendId: "b1", widgetId: "report" });

  it("finds the cited card by Rita's metadata.widget_uuid, else by origin and widget_id", () => {
    expect(citedCardId({ source_info: { metadata: { widget_uuid: REPORT.id } } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { origin: "b1", widget_id: "report" } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { metadata: { widget_uuid: "gone" }, origin: "b1", widget_id: "report" } }, [REPORT])).toBeNull();
    expect(citedCardId({ source_info: { origin: "b2", widget_id: "report" } }, [REPORT])).toBeNull();
  });

  it("opens a boxed citation on its card at the first box's page", async () => {
    usePdfHighlightStore.setState({ highlight: null });
    const groups = [[box(2)], [box(3), box(2)]];
    render(<Sources cards={[REPORT]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: groups }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(usePdfHighlightStore.getState().highlight).toEqual({ cardId: REPORT.id, page: 2, boxes: [box(2), box(2)] });
  });

  it("shows a boxed citation whose card is not on the dashboard as plain text", () => {
    render(<Sources cards={[]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: [[box(1)]] }]} />);
    expect(screen.getByText("Report").tagName).not.toBe("BUTTON");
  });
});
```

- [ ] **Step 3: Write the failing PdfView tests**

In `PdfView.test.tsx`'s hoisted `vw`: add `pageScale: 2,` to `state`; add `state.pageScale = 2;` to `reset`; add this method to the mocked `class PDFViewer` after `setDocument`:

```ts
    getPageView(index: number) {
      const container = state.viewerOptions.container as HTMLElement;
      let div = container.querySelector<HTMLDivElement>(`[data-page="${index + 1}"]`);
      if (!div) {
        div = document.createElement("div");
        div.dataset.page = String(index + 1);
        container.append(div);
      }
      return { div, viewport: { scale: state.pageScale } };
    }
```

Change the import to `import { PdfView, boxRect } from "./PdfView";` and append:

```tsx
describe("PdfView highlights", () => {
  const box = { text: "q", page: 2, x0: 10, top: 20, x1: 30, bottom: 25 };
  const rect = () => {
    const el = document.querySelector<HTMLElement>(".pdf-highlight");
    return el && [el.style.left, el.style.top, el.style.width, el.style.height];
  };

  it("scales PDF points by the page view's scale", () => {
    expect(boxRect({ text: "", page: 1, x0: 72, top: 92, x1: 255, bottom: 104 }, 1.5)).toEqual({ left: 108, top: 138, width: 274.5, height: 18 });
  });

  it("opens the cited page and draws its boxes there", async () => {
    render(<PdfView bytes={bytes} filename="report.pdf" highlight={{ page: 2, boxes: [box] }} />);
    await screen.findByText("/ 3");
    expect(vw.state.pageNumber).toBe(2);
    expect(rect()).toEqual(["20px", "40px", "40px", "10px"]);
  });

  it("redraws after pdf.js re-renders the page at a new scale, and clears when the highlight goes", async () => {
    const { rerender } = render(<PdfView bytes={bytes} filename="report.pdf" highlight={{ page: 2, boxes: [box] }} />);
    await screen.findByText("/ 3");
    // What pdf.js's PDFPageView.reset does to a page on zoom: it empties the div.
    document.querySelectorAll(".pdf-highlight").forEach((n) => n.remove());
    vw.state.pageScale = 3;
    emit("pagerendered", { pageNumber: 2 });
    expect(rect()).toEqual(["30px", "60px", "60px", "15px"]);
    rerender(<PdfView bytes={bytes} filename="report.pdf" highlight={null} />);
    expect(document.querySelector(".pdf-highlight")).toBeNull();
  });
});
```

- [ ] **Step 4: Write the failing PdfRenderer test**

In `PdfRenderer.test.tsx`, add `const receivedHighlights = vi.hoisted((): unknown[] => []);` and change the mock to `PdfView: ({ bytes, filename, highlight }: { bytes: Uint8Array; filename: string; highlight?: unknown }) => { receivedBytes.push(bytes); receivedHighlights.push(highlight); return <div data-testid="pdf-view">{`${filename} (${bytes.length} bytes)`}</div>; },`. Append:

```tsx
  it("hands a highlight through to the viewer", () => {
    const highlight = { page: 1, boxes: [{ text: "q", page: 1, x0: 1, top: 2, x1: 3, bottom: 4 }] };
    render(<PdfRenderer data={{ content: HI, data_format: { data_type: "pdf", filename: "report.pdf" } }} onRetry={vi.fn()} highlight={highlight} />);
    expect(receivedHighlights.at(-1)).toEqual(highlight);
  });
```

- [ ] **Step 5: Run to verify they fail**

Run: `pnpm exec vitest run src/stores/pdfHighlightStore.test.ts src/components/rita/Sources.test.tsx src/components/renderers/PdfView.test.tsx src/components/renderers/PdfRenderer.test.tsx`
Expected: FAIL (missing module, missing exports, no `.pdf-highlight`).

- [ ] **Step 6: Implement the store** (`src/stores/pdfHighlightStore.ts`, AGPL header)

```ts
import { create } from "zustand";
import type { BoundingBox } from "../lib/agent/types";

/** The quote a citation opened: one card, one page, that page's boxes. One at a time. */
export type PdfHighlight = { cardId: string; page: number; boxes: BoundingBox[] };

type State = { highlight: PdfHighlight | null; show: (h: PdfHighlight) => void; clear: (cardId: string) => void };

export const usePdfHighlightStore = create<State>((set, get) => ({
  highlight: null,
  show: (highlight) => set({ highlight }),
  clear: (cardId) => {
    if (get().highlight?.cardId === cardId) set({ highlight: null });
  },
}));
```

- [ ] **Step 7: Implement Sources** (replace the body below `citationLink` in `Sources.tsx`; add imports `import type { BoundingBox } from "../../lib/agent/types";`, `import type { DashboardCard } from "../../lib/types";`, `import { usePdfHighlightStore } from "../../stores/pdfHighlightStore";`)

```tsx
/**
 * The dashboard card a widget citation names: Rita's metadata.widget_uuid, else
 * the first card with the citation's origin and widget_id (openbb-ai's cite()
 * sends no uuid). Null when that card is not on the dashboard.
 */
export function citedCardId(c: Record<string, unknown>, cards: DashboardCard[]): string | null {
  const info = isRecord(c.source_info) ? c.source_info : {};
  const meta = isRecord(info.metadata) ? info.metadata : {};
  if (typeof meta.widget_uuid === "string") return cards.some((k) => k.id === meta.widget_uuid) ? meta.widget_uuid : null;
  return cards.find((k) => k.backendId === info.origin && k.widgetId === info.widget_id)?.id ?? null;
}

function openQuote(cardId: string, groups: BoundingBox[][]) {
  const page = groups[0][0].page;
  usePdfHighlightStore.getState().show({ cardId, page, boxes: groups.flat().filter((b) => b.page === page) });
  const el = document.querySelector(`[data-card-id="${cardId}"]`);
  // jsdom has no scrollIntoView.
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}

export function Sources({ citations, cards = [] }: { citations: Record<string, unknown>[]; cards?: DashboardCard[] }) {
  const items = citations.flatMap((c, i) => {
    const link = citationLink(c);
    // withQuoteBoxes (events.ts) left only a non-empty, validated BoundingBox[][] here.
    const groups = Array.isArray(c.quote_bounding_boxes) ? (c.quote_bounding_boxes as BoundingBox[][]) : [];
    const cardId = groups.length > 0 ? citedCardId(c, cards) : null;
    if (cardId !== null) {
      return [
        <button key={i} type="button" onClick={() => openQuote(cardId, groups)}>
          {link?.name ?? "Quote"}
        </button>,
      ];
    }
    if (link === null) return [];
    return [
      link.url === null ? (
        <span key={i}>{link.name}</span>
      ) : (
        <button key={i} type="button" onClick={() => void openUrl(link.url as string)}>
          {link.name}
        </button>
      ),
    ];
  });
  if (items.length === 0) return null;
  return <p className="chat-sources">Sources: {items}</p>;
}
```

In `ChatPane.tsx`, add `import { useDashboardStore } from "../../stores/dashboardStore";`, then inside the component `const dashboard = useDashboardStore((s) => s.activeDashboard());` and change `<Sources citations={citations} />` to `<Sources citations={citations} cards={dashboard?.tabs.flatMap((t) => t.cards) ?? []} />`. (Select the dashboard object, not a fresh array: a selector returning a new array re-renders forever under zustand 5.)

- [ ] **Step 8: Implement PdfView overlays**

In `PdfView.tsx` add `import type { BoundingBox } from "../../lib/agent/types";` and, after `sameBytes`:

```ts
/** A cited quote on one page: what Sources opened. */
type Highlight = { page: number; boxes: BoundingBox[] };

/** A quote box in CSS pixels: PDF points (top-left origin) times the page view's viewport scale. */
export function boxRect(box: BoundingBox, scale: number) {
  return { left: box.x0 * scale, top: box.top * scale, width: (box.x1 - box.x0) * scale, height: (box.bottom - box.top) * scale };
}

/**
 * Replaces the overlays: removes every one in this viewer, then draws `h`'s boxes
 * into its page's div. pdf.js empties that div whenever it re-renders the page
 * (PDFPageView.reset, on zoom or scroll-back), so `pagerendered` calls this again.
 * ponytail: ignores page rotation; add viewport.convertToViewportRectangle if a rotated PDF ever matters.
 */
function drawHighlights(viewer: Viewer, body: HTMLElement, h: Highlight | null) {
  body.querySelectorAll(".pdf-highlight").forEach((n) => n.remove());
  if (!h) return;
  const view = viewer.getPageView(h.page - 1) as { div: HTMLDivElement; viewport: { scale: number } } | undefined;
  if (!view) return;
  for (const box of h.boxes) {
    const r = boxRect(box, view.viewport.scale);
    const el = document.createElement("div");
    el.className = "pdf-highlight";
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    view.div.append(el);
  }
}
```

Change `type Props` to `type Props = { bytes: Uint8Array; filename: string; highlight?: Highlight | null };` and the signature to `export function PdfView({ bytes, filename, highlight = null }: Props) {`. After `const pageDirtyRef = useRef(false);` add `const highlightRef = useRef<Highlight | null>(highlight);`.

In the load effect, after the `scalechanging` listener, add:

```ts
        eventBus.on("pagerendered", (evt: { pageNumber: number }) => {
          if (!cancelled && evt.pageNumber === highlightRef.current?.page) drawHighlights(viewer, body, highlightRef.current);
        });
```

After the ResizeObserver effect, add:

```ts
  // A highlight opens its page and draws now; the pagerendered listener above
  // redraws it each time pdf.js re-renders that page (zoom included).
  useEffect(() => {
    highlightRef.current = highlight;
    const viewer = viewerRef.current;
    if (!body || !viewer || pageCount === 0) return;
    if (highlight) viewer.currentPageNumber = Math.min(Math.max(highlight.page, 1), pageCount);
    drawHighlights(viewer, body, highlight);
  }, [highlight, pageCount, body]);
```

- [ ] **Step 9: Wire the renderers and the card**

`DocumentView.tsx`: add `import type { BoundingBox } from "../../lib/agent/types";`, `type Highlight = { page: number; boxes: BoundingBox[] } | null;`, change to `export function DocumentView({ doc, highlight = null }: { doc: Document; highlight?: Highlight })`, pass `highlight={highlight}` to both `<LinkedPdf …>` and `<PdfView …>`, and give `LinkedPdf` the same prop and pass it to its `<PdfView …>`.

`PdfRenderer.tsx`: add the same `BoundingBox` import, extend props to `{ data, onRetry, highlight = null }: { data: unknown; onRetry: () => void; highlight?: { page: number; boxes: BoundingBox[] } | null }`, and render `<DocumentView doc={doc} highlight={highlight} />`.

`WidgetCard.tsx`: add `import { usePdfHighlightStore } from "../stores/pdfHighlightStore";`. Near the component's other hooks (beside the `useEffect` at ~line 287):

```tsx
  // The quote a Rita citation opened on this card, if any; closing the card drops it.
  const highlight = usePdfHighlightStore((s) => (s.highlight?.cardId === card.id ? s.highlight : null));
  useEffect(() => () => usePdfHighlightStore.getState().clear(card.id), [card.id]);
```

Change line ~1131 to `if (widget?.type === "pdf") return <PdfRenderer data={data} onRetry={retry} highlight={highlight} />;` and add `data-card-id={card.id}` to `<article className="widget-card"`.

`styles.css`, after `.pdf-body { … }`:

```css
/* A cited quote (Rita's quote_bounding_boxes), drawn inside pdf.js's page div. */
.pdf-highlight { position: absolute; background: rgba(255, 213, 0, 0.35); pointer-events: none; z-index: 5; }
```

- [ ] **Step 10: Run**

Run: `pnpm exec vitest run src/stores/pdfHighlightStore.test.ts src/components/rita src/components/renderers && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add src/stores/pdfHighlightStore.ts src/stores/pdfHighlightStore.test.ts src/components/rita/Sources.tsx src/components/rita/Sources.test.tsx src/components/rita/ChatPane.tsx src/components/renderers/PdfView.tsx src/components/renderers/PdfView.test.tsx src/components/renderers/DocumentView.tsx src/components/renderers/PdfRenderer.tsx src/components/renderers/PdfRenderer.test.tsx src/components/WidgetCard.tsx src/styles.css
git commit -m "feat(rita): open a cited PDF quote on its card with highlight overlays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A4: `sendFeedback` and feature detection

**Files:**
- Create: `src/lib/agent/feedback.ts`, `src/lib/agent/feedback.test.ts`
- Test: `src/lib/agent/agents-json.test.ts` (one case)

**Interfaces:**
- Produces: `type FeedbackVote = "thumbs_up" | "thumbs_down"`; `type FeedbackPayload = { vote; tags: string[]; user_comment: string; ai_response: string; user_prompt: string; trace_id: string }`; `FEEDBACK_TAGS: readonly string[]`; `advertisesFeedback(agent: AgentDescriptor | undefined): boolean`; `sendFeedback(agentUrl: string, payload: FeedbackPayload, fetchImpl?: typeof fetch): Promise<void>` (throws on non-2xx).

- [ ] **Step 1: Write the failing tests** (`feedback.test.ts`, AGPL header)

```ts
import { describe, expect, it, vi } from "vitest";
import { advertisesFeedback, sendFeedback, type FeedbackPayload } from "./feedback";
import type { AgentDescriptor } from "./types";

const payload: FeedbackPayload = { vote: "thumbs_up", tags: [], user_comment: "", ai_response: "hello", user_prompt: "hi", trace_id: "t-1" };

describe("sendFeedback", () => {
  it("POSTs the payload as JSON to <agent>/v1/feedback", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await sendFeedback("https://rita.example/", payload, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("https://rita.example/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("throws on an answer that is not 2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(sendFeedback("https://rita.example", payload, fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("advertisesFeedback", () => {
  const agent = (features: AgentDescriptor["features"]): AgentDescriptor => ({ id: "a", name: "A", description: "", queryPath: "/v1/query", features });
  it("is true only for a boolean feedback feature set to true", () => {
    expect(advertisesFeedback(agent({ feedback: { kind: "boolean", value: true } }))).toBe(true);
    expect(advertisesFeedback(agent({ feedback: { kind: "boolean", value: false } }))).toBe(false);
    expect(advertisesFeedback(agent({}))).toBe(false);
    expect(advertisesFeedback(undefined)).toBe(false);
  });
});
```

Append to `agents-json.test.ts`:

```ts
it("keeps features.feedback: true as a boolean feature (agents-for-openbb 42)", () => {
  const out = normalizeAgentsJson({ a: { name: "A", endpoints: { query: "/v1/query" }, features: { feedback: true } } });
  expect(out.a.features.feedback).toEqual({ kind: "boolean", value: true });
});
```

- [ ] **Step 2: Run to verify the new file fails** (the agents-json case already passes: `normalizeFeatures` keeps every boolean)

Run: `pnpm exec vitest run src/lib/agent/feedback.test.ts src/lib/agent/agents-json.test.ts`
Expected: feedback.test FAIL (module missing); agents-json PASS.

- [ ] **Step 3: Implement** (`feedback.ts`, AGPL header)

```ts
/**
 * Workspace feedback (agents-for-openbb 42): a thumbs vote on one AI message,
 * sent only when the agent advertises `features.feedback` and only on a click.
 */
import { describeHttpError } from "../dataClient";
import type { AgentDescriptor } from "./types";

export type FeedbackVote = "thumbs_up" | "thumbs_down";
export type FeedbackPayload = {
  vote: FeedbackVote;
  tags: string[];
  user_comment: string;
  ai_response: string;
  user_prompt: string;
  /** Minted by the client per AI message: Rita sends no trace id on the wire. */
  trace_id: string;
};

/** The thumbs-down tags known from Workspace (example 42's recorded feedback). */
export const FEEDBACK_TAGS = ["Not factually correct / Hallucinations / Inaccurate", "Other"] as const;

export function advertisesFeedback(agent: AgentDescriptor | undefined): boolean {
  const f = agent?.features.feedback;
  return f?.kind === "boolean" && f.value;
}

export async function sendFeedback(agentUrl: string, payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${agentUrl.replace(/\/+$/, "")}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => "")));
}
```

- [ ] **Step 4: Run** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/feedback.ts src/lib/agent/feedback.test.ts src/lib/agent/agents-json.test.ts
git commit -m "feat(agent): sendFeedback and feedback feature detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A5: Feedback buttons in the chat

**Files:**
- Create: `src/components/rita/FeedbackBar.tsx`, `src/components/rita/FeedbackBar.test.tsx`
- Modify: `src/components/rita/ChatMessages.tsx`, `src/components/rita/ChatPane.tsx`, `src/styles.css` (after `.chat-sources button` rules ~line 2682)
- Test: `src/components/rita/ChatMessages.test.tsx`, `src/components/rita/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `sendFeedback`, `FEEDBACK_TAGS`, `advertisesFeedback` (A4); `pickAgent` (`src/lib/agent/workspaceOptions.ts`).
- Produces: `FeedbackBar({ agentUrl, prompt, response })`; `ChatMessages({ messages, feedbackUrl?: string | null, running?: boolean })`.

- [ ] **Step 1: Write the failing FeedbackBar tests** (AGPL header)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendFeedback = vi.fn();
vi.mock("../../lib/agent/feedback", async (orig) => ({
  ...(await orig<typeof import("../../lib/agent/feedback")>()),
  sendFeedback: (...a: unknown[]) => sendFeedback(...a),
}));
import { FeedbackBar } from "./FeedbackBar";

const bar = () => render(<FeedbackBar agentUrl="https://rita.example" prompt="hi" response="hello" />);

describe("FeedbackBar", () => {
  beforeEach(() => sendFeedback.mockReset().mockResolvedValue(undefined));

  it("sends a thumbs up once, with the prompt and reply, then thanks the user", async () => {
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(sendFeedback).toHaveBeenCalledWith("https://rita.example", {
      vote: "thumbs_up", tags: [], user_comment: "", ai_response: "hello", user_prompt: "hi", trace_id: expect.any(String),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Thanks for the feedback.");
    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });

  it("thumbs down asks for optional tags and a comment, and sends them", async () => {
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Bad response" }));
    expect(sendFeedback).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Feedback comment" }), "too vague");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(sendFeedback).toHaveBeenCalledWith("https://rita.example", expect.objectContaining({ vote: "thumbs_down", tags: ["Other"], user_comment: "too vague" }));
  });

  it("shows a failure inline and retries with the same trace id", async () => {
    sendFeedback.mockRejectedValueOnce(new Error("HTTP 500"));
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Feedback not sent: HTTP 500");
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(sendFeedback).toHaveBeenCalledTimes(2);
    expect(sendFeedback.mock.calls[1][1].trace_id).toBe(sendFeedback.mock.calls[0][1].trace_id);
  });
});
```

Append to `ChatMessages.test.tsx` (no mock needed: nothing is clicked):

```tsx
describe("feedback buttons", () => {
  const msgs = [{ role: "human" as const, content: "hi" }, { role: "ai" as const, content: "hello" }];
  it("are on a finished reply when a feedback url is given", () => {
    render(<ChatMessages messages={msgs} feedbackUrl="https://rita.example" />);
    expect(screen.getByRole("button", { name: "Good response" })).toBeInTheDocument();
  });
  it("are not on the reply still streaming, nor without a feedback url", () => {
    const { rerender } = render(<ChatMessages messages={msgs} feedbackUrl="https://rita.example" running />);
    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
    rerender(<ChatMessages messages={msgs} />);
    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });
});
```

Append to `ChatPane.test.tsx` (inside its main `describe`, using the file's existing render pattern for `<ChatPane onInputFocus={...} />`):

```tsx
  it("shows feedback buttons when the agent advertises feedback", async () => {
    fetchAgentsJson.mockResolvedValue({ rita: { id: "rita", name: "Rita", description: "", queryPath: "/v1/query", features: { feedback: { kind: "boolean", value: true } } } });
    render(<ChatPane onInputFocus={() => {}} />);
    expect(await screen.findByRole("button", { name: "Good response" })).toBeInTheDocument();
  });

  it("renders no feedback buttons when the agent does not advertise feedback", async () => {
    render(<ChatPane onInputFocus={() => {}} />);
    await screen.findByRole("img", { name: "Rita online" });
    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/components/rita`
Expected: FAIL (FeedbackBar missing; no buttons).

- [ ] **Step 3: Implement FeedbackBar** (AGPL header)

```tsx
import { useState } from "react";
import { FEEDBACK_TAGS, sendFeedback, type FeedbackVote } from "../../lib/agent/feedback";

/**
 * Thumbs up / down on one finished AI message. One vote: after a success the
 * buttons go. A failure stays inline and the same vote, trace id included, can
 * be sent again. Only the rated prompt and reply are sent, and only on a click.
 */
export function FeedbackBar({ agentUrl, prompt, response }: { agentUrl: string; prompt: string; response: string }) {
  const [traceId] = useState(() => crypto.randomUUID());
  const [vote, setVote] = useState<FeedbackVote | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  const submit = async (v: FeedbackVote) => {
    setBusy(true);
    setError(null);
    try {
      const down = v === "thumbs_down";
      await sendFeedback(agentUrl, { vote: v, tags: down ? tags : [], user_comment: down ? comment : "", ai_response: response, user_prompt: prompt, trace_id: traceId });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p className="chat-feedback" role="status">
        Thanks for the feedback.
      </p>
    );
  }
  return (
    <div className="chat-feedback">
      <button type="button" aria-label="Good response" aria-pressed={vote === "thumbs_up"} disabled={busy} onClick={() => { setVote("thumbs_up"); void submit("thumbs_up"); }}>
        👍
      </button>
      <button type="button" aria-label="Bad response" aria-pressed={vote === "thumbs_down"} disabled={busy} onClick={() => setVote("thumbs_down")}>
        👎
      </button>
      {vote === "thumbs_down" ? (
        <fieldset className="chat-feedback-details">
          {FEEDBACK_TAGS.map((t) => (
            <label key={t}>
              <input type="checkbox" checked={tags.includes(t)} onChange={() => setTags((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]))} />
              {t}
            </label>
          ))}
          <textarea aria-label="Feedback comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void submit("thumbs_down")}>
            Send feedback
          </button>
        </fieldset>
      ) : null}
      {error !== null ? (
        <p className="chat-error" role="alert">
          Feedback not sent: {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire ChatMessages and ChatPane**

`ChatMessages.tsx`: import `FeedbackBar`; change the signature to `export function ChatMessages({ messages, feedbackUrl = null, running = false }: { messages: ChatMessage[]; feedbackUrl?: string | null; running?: boolean })`; before `return (` add `let prompt = "";`; in the map, set `prompt = String(m.content);` inside the human branch before its `return`; and change the ai-string branch to:

```tsx
        if (m.role === "ai" && typeof m.content === "string") {
          // A reply still streaming is not finished, so it is not rated yet.
          const rateable = feedbackUrl !== null && !(running && i === messages.length - 1);
          return (
            <div key={i} className="chat-bubble chat-ai">
              <MarkdownRenderer data={m.content} />
              {rateable && feedbackUrl !== null ? <FeedbackBar agentUrl={feedbackUrl} prompt={prompt} response={m.content} /> : null}
            </div>
          );
        }
```

`ChatPane.tsx`: add `import { advertisesFeedback } from "../../lib/agent/feedback";` and `import { pickAgent } from "../../lib/agent/workspaceOptions";`; after `const model = …` add

```tsx
  // Context Sharing does not gate this: only the rated prompt and reply go, on a click.
  const feedbackUrl = discovery.state === "online" && advertisesFeedback(pickAgent(discovery.agents, ritaUrl)) ? ritaUrl : null;
```

and render `<ChatMessages messages={messages} feedbackUrl={feedbackUrl} running={running} />`.

`styles.css`, after the `.chat-sources button, …` rule:

```css
.chat-feedback { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; font-size: var(--font-size-12); color: var(--text-muted); }
.chat-feedback button { background: none; border: 0; cursor: pointer; padding: 0 2px; }
.chat-feedback button[aria-pressed="true"] { outline: 1px solid var(--accent); border-radius: 4px; }
.chat-feedback-details { display: flex; flex-direction: column; gap: 4px; width: 100%; border: 0; padding: 0; margin: 0; }
```

- [ ] **Step 5: Run**

Run: `pnpm exec vitest run src/components/rita && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/rita/FeedbackBar.tsx src/components/rita/FeedbackBar.test.tsx src/components/rita/ChatMessages.tsx src/components/rita/ChatMessages.test.tsx src/components/rita/ChatPane.tsx src/components/rita/ChatPane.test.tsx src/styles.css
git commit -m "feat(rita): thumbs feedback on finished replies when the agent advertises it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A6: v6 gates

- [ ] **Step 1:** Run `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && pnpm scrub`. Expected: all pass (`scrub` checks headers and private patterns in new files). Known today: `scrub` fails on the spec's line 216 (its `DOCKER_CONFIG` value is a private NAS path). Ask the user to approve rewording it (e.g. "`DOCKER_CONFIG` set to the NAS's GHCR login directory") before this gate.
- [ ] **Step 2:** Run `pnpm e2e`. Expected: pass. A failure that also fails on `44452f74` is pre-existing: record it, do not fix it here.
- [ ] **Step 3:** No commit unless a gate forced a fix (then commit that fix with its own message).

---

## Phase B — Conformance harness (same worktree)

### Task B1: PDF fixture, stub OpenAI server, harness script

**Files:**
- Create: `src/test/pdfFixture.ts`, `scripts/stub-openai.mjs`, `scripts/agent-conformance.sh`
- Modify: `vite.config.ts` (test `exclude`), `package.json` (script `test:conformance`)

**Interfaces:**
- Produces: `pdfBase64(lines: string[]): string` — one-page Helvetica 12 pt PDF, 16 pt leading, first baseline y = 704 on a 612×792 page (so pdf.js reports line 1 at top 76/bottom 88, line 2 at 92/104; pdfplumber's line 1 chars at top 78.484). Env from the harness: `OPENBB_EXAMPLE_AGENTS` (`30=http://127.0.0.1:17760,…`), `OPENBB_EXAMPLE_FEEDBACK_FILE`.

- [ ] **Step 1: Create `src/test/pdfFixture.ts`** (AGPL header)

```ts
/**
 * A one-page PDF for tests that need a real document: Helvetica 12 pt, 16 pt
 * leading, the first line's baseline at y = 704 on a US Letter page. Verified to
 * parse in pdfplumber 0.11.10 and unpdf 1.6.2 (2026-10-28).
 */
export function pdfBase64(lines: string[]): string {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${esc(l)}) '`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return btoa(out);
}
```

- [ ] **Step 2: Create `scripts/stub-openai.mjs`** (AGPL header; verified against openai-python 2.54.0 on 2026-10-28)

```js
// A stand-in for OpenAI's chat completions, for scripts/agent-conformance.sh. It streams
// "stub reply", then the system prompt and the last user message, so a test can see what
// the example agent built from BDOBB's request. A non-streamed call with `functions` answers
// with a call to the first function, every enum parameter set to its first value.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 17799);
const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4o", object: "model", created: 0, owned_by: "stub" }] }));
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404); return res.end(); }
  const parts = []; for await (const p of req) parts.push(p);
  const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const fn = Array.isArray(body.functions) ? body.functions[0] : undefined;
  if (fn && !body.stream) {
    const args = Object.fromEntries(Object.entries(fn.parameters?.properties ?? {}).flatMap(([k, p]) =>
      Array.isArray(p.enum) ? [[k, p.enum[0]]] : p.type === "object" ? [[k, {}]] : []));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "stub", object: "chat.completion", created: 0, model: "gpt-4o",
      choices: [{ index: 0, finish_reason: "function_call", message: { role: "assistant", content: null, function_call: { name: fn.name, arguments: JSON.stringify(args) } } }] }));
  }
  const text = (role) => body.messages.filter((m) => m.role === role).map((m) => m.content).at(-1) ?? "";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(chunk({ role: "assistant", content: `stub reply\n${text("system")}\n${text("user")}` }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
}).listen(port, "127.0.0.1");
```

(The spec's "fixed reply" is extended with the echo: rows 30, 35, 37, 38 and 41 can only be observed through what the example put in its prompt.)

- [ ] **Step 3: Create `scripts/agent-conformance.sh`** (shell AGPL header; `chmod +x`)

```bash
#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
# BDOBB as host, against openbq-org/agents-for-openbb examples 30-42 (MIT) on loopback, each
# behind scripts/stub-openai.mjs. The examples are cloned per run into .superpowers/ (gitignored);
# nothing of theirs is committed. A skip counts as not run, so it fails (rita-live-check.sh rule).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA=aa1073d2b098ae6cf597dabf0635822aa808dd81
WORK="$ROOT/.superpowers/agent-conformance"
CLONE="$WORK/agents"
UV="${UV:-$(command -v uv || echo "$HOME/.local/bin/uv")}"
STUB_PORT=17799
pids=(); out=""
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; [ -z "$out" ] || rm -f "$out"; }
trap cleanup EXIT
mkdir -p "$WORK"
if [ "$(git -C "$CLONE" rev-parse HEAD 2>/dev/null)" != "$SHA" ]; then
  rm -rf "$CLONE" && git init -q "$CLONE"
  git -C "$CLONE" fetch -q --depth 1 https://github.com/openbq-org/agents-for-openbb.git "$SHA"
  git -C "$CLONE" checkout -q FETCH_HEAD
fi
git -C "$CLONE" checkout -q -- .   # example 42 appends to its feedback.json: start from the pinned file
[ -x "$WORK/venv/bin/python" ] || "$UV" venv -q --python 3.12 "$WORK/venv"
VIRTUAL_ENV="$WORK/venv" "$UV" pip install -q openbb-ai==2.2.0 fastapi==0.118.3 uvicorn==0.27.1 \
  sse-starlette==2.4.1 pdfplumber==0.11.10 httpx==0.28.1 openai==2.54.0
node "$ROOT/scripts/stub-openai.mjs" "$STUB_PORT" & pids+=($!)
agents=()
for n in $(seq 30 42); do
  dir=$(echo "$CLONE"/"$n"-*/); main=$(echo "$dir"*/main.py); mod=$(basename "$(dirname "$main")")
  port=$((17730 + n))
  # -I ignores the cwd and PYTHONPATH, so uvicorn's --app-dir is what puts the example on sys.path.
  OPENAI_BASE_URL="http://127.0.0.1:$STUB_PORT/v1" OPENAI_API_KEY=stub \
    "$WORK/venv/bin/python" -I -m uvicorn --app-dir "$dir" "$mod.main:app" --host 127.0.0.1 --port "$port" --log-level warning & pids+=($!)
  agents+=("$n=http://127.0.0.1:$port")
done
for a in "${agents[@]}"; do
  for _ in $(seq 50); do curl -fs -o /dev/null "${a#*=}/agents.json" && continue 2; sleep 0.2; done
  echo "agent-conformance: example ${a%%=*} did not start" >&2; exit 3
done
export OPENBB_EXAMPLE_AGENTS="$(IFS=,; echo "${agents[*]}")"
export OPENBB_EXAMPLE_FEEDBACK_FILE="$(echo "$CLONE"/42-*/)feedback.json"
out="$(mktemp)"
pnpm exec vitest run src/test/integration/agent-conformance-live.test.ts --testTimeout=60000 \
  --reporter=default --reporter=json --outputFile="$out" || true
node -e 'const r=JSON.parse(process.argv[1]);const bad=r.numFailedTests+r.numPendingTests+(r.numTodoTests||0)+(r.numFailedTestSuites||0);if(r.numTotalTests===0||bad>0){console.error(`conformance: ${r.numPassedTests}/${r.numTotalTests} passed, ${r.numPendingTests} skipped, ${r.numFailedTests} failed`);process.exit(1)}console.error(`conformance: ${r.numPassedTests}/${r.numTotalTests} passed, 0 skipped, 0 failed`)' "$(cat "$out")"
```

- [ ] **Step 4: Keep vitest out of the venv, add the script**

`vite.config.ts`: add `".superpowers/**"` to the `exclude` array (beside `".reference-backend/**"`; same reason as its comment: a cloned venv's site-packages can ship `*.test.js`). `package.json` scripts: add `"test:conformance": "bash scripts/agent-conformance.sh",` after `"test:live"`.

- [ ] **Step 5: Smoke the stub**

Run: `node scripts/stub-openai.mjs 17799 & sleep 1; curl -sN localhost:17799/v1/chat/completions -d '{"stream":true,"messages":[{"role":"system","content":"S"},{"role":"user","content":"U"}]}'; kill %1`
Expected: one chunk whose content is `stub reply\nS\nU`, a stop chunk, `data: [DONE]`.

- [ ] **Step 6: Commit**

```bash
git add src/test/pdfFixture.ts scripts/stub-openai.mjs scripts/agent-conformance.sh vite.config.ts package.json
git commit -m "test(conformance): harness, stub OpenAI server and a PDF fixture for the example agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B2: `agent-conformance-live.test.ts`

**Files:**
- Create: `src/test/integration/agent-conformance-live.test.ts`

**Interfaces:**
- Consumes: `pdfBase64` (B1), `advertisesFeedback`/`sendFeedback` (A4), `BoundingBox` (A2), PDF item (A1), `fetchAgentsJson`, `runAgentQuery`, `executeFunction`, `makeWidgetDataFetcher`, `buildWidgetRefs`, `dashboardContext`, `pickAgent`, `workspaceOptionsFor`, `isClientArtifact`, `cardRequestSync`, fixtures `backend`/`card`/`widget`.

- [ ] **Step 1: Write the test** (AGPL header, then exactly this)

```ts
// @vitest-environment jsdom
// BDOBB as host, against openbq-org/agents-for-openbb examples 30-42 (MIT), which
// scripts/agent-conformance.sh starts on loopback behind a stub OpenAI server. Each example
// answers 422 when its openbb-ai QueryRequest refuses a body, so every passing case also
// proves the request BDOBB built validates. Runs only when OPENBB_EXAMPLE_AGENTS is set.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cardRequestSync } from "../../hooks/useCardRequest";
import { fetchAgentsJson } from "../../lib/agent/agents-json";
import { buildWidgetRefs, executeFunction, makeWidgetDataFetcher, type ExecuteDeps } from "../../lib/agent/execute";
import { advertisesFeedback, sendFeedback } from "../../lib/agent/feedback";
import { runAgentQuery } from "../../lib/agent/query";
import { dashboardContext } from "../../lib/agent/request";
import type { AgentEvent, AgentMessage, AgentTool, BoundingBox, SkillCatalogEntry } from "../../lib/agent/types";
import { pickAgent, workspaceOptionsFor } from "../../lib/agent/workspaceOptions";
import type { fetchWidgetData } from "../../lib/dataClient";
import type { Skill } from "../../lib/skillsFiles";
import type { DashboardCard, WidgetDef } from "../../lib/types";
import { isClientArtifact } from "../../stores/chatStore";
import { backend as backendOf, card as cardOf, widget as widgetOf } from "../fixtures";
import { pdfBase64 } from "../pdfFixture";

const agents = new Map(
  (process.env.OPENBB_EXAMPLE_AGENTS ?? "").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
);
const live = agents.size > 0 ? describe : describe.skip;
const url = (n: number) => {
  const u = agents.get(String(n));
  if (!u) throw new Error(`example ${n} was not started`);
  return u;
};

const backend = backendOf({ id: "conformance", name: "Conformance", baseUrl: "http://127.0.0.1:9" });
const def = (id: string, name: string, type: string, params: WidgetDef["params"] = []) =>
  widgetOf({ id, backendId: backend.id, name, description: `${name} for the conformance run.`, type, endpoint: `/${id}`, params });
const WIDGETS = [
  def("prices", "Conformance Prices", "table", [{ paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" }]),
  def("report", "Conformance Report", "pdf"),
  def("notes", "Conformance Notes", "table"),
];
// openbb-ai types a widget's uuid as a UUID, as BDOBB's own card ids are.
const PRICES = cardOf({ id: "6f1c7a52-8a43-4d0b-9a3e-0b5d1c2e3f40", widgetId: "prices", backendId: backend.id });
const REPORT = cardOf({ id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "report", backendId: backend.id });
const NOTES = cardOf({ id: "8e4fa021-3c5d-4f6b-9071-2b3c4d5e6f70", widgetId: "notes", backendId: backend.id });
const findWidget = (_backendId: string, id: string) => WIDGETS.find((w) => w.id === id);
const refs = (cards: DashboardCard[]) => buildWidgetRefs(cards, findWidget, () => backend.name, new Set());
const PDF = pdfBase64(["Conformance fixture page one.", "Revenue grew 12 percent in 2025."]);
const fetchData = (async (_b: unknown, w: WidgetDef) =>
  w.type === "pdf"
    ? { content: PDF, data_format: { data_type: "pdf", filename: "conformance.pdf" } }
    : [{ symbol: "AAPL", marker: `row-${w.id}` }]) as unknown as typeof fetchWidgetData;
const fetchWidget = makeWidgetDataFetcher(
  { cards: [PRICES, REPORT, NOTES], backends: [backend], findWidget, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) },
  fetchData,
);
// What chatStore.send's refresh sends beside the cards. Q1 decides whether this stays.
const CONTEXT = [dashboardContext({ id: "conformance", name: "Conformance" }, [])];

type Options = {
  primary?: DashboardCard[];
  secondary?: DashboardCard[];
  tools?: AgentTool[];
  workspaceOptions?: Record<string, boolean | string>;
  skillsCatalog?: SkillCatalogEntry[];
  deps?: Partial<ExecuteDeps>;
};

/** One user turn through runAgentQuery, executing calls the way chatStore.send does. */
async function turn(n: number, o: Options = {}) {
  const events: AgentEvent[] = [];
  const calls: Record<string, unknown>[] = [];
  const gen = runAgentQuery({
    ritaUrl: url(n),
    messages: [{ role: "human", content: "hi" }],
    refresh: () => ({ primary: refs(o.primary ?? []), secondary: refs(o.secondary ?? []), context: CONTEXT }),
    tools: o.tools ?? [],
    executeFunction: (payload, signal) => {
      calls.push(payload);
      return executeFunction(payload, { fetchWidget, runAgentTool: async () => null, ...o.deps }, signal);
    },
    workspaceOptions: o.workspaceOptions,
    skillsCatalog: o.skillsCatalog,
    timeoutMs: 30_000,
  });
  let history: AgentMessage[];
  for (;;) {
    const next = await gen.next();
    if (next.done) { history = next.value; break; }
    events.push(next.value);
  }
  const of = <T extends AgentEvent["type"]>(type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);
  const text = of("chunk").map((e) => e.delta).join("");
  const citations = of("citations").flatMap((e) => (Array.isArray(e.payload.citations) ? (e.payload.citations as Record<string, unknown>[]) : []));
  return { events, calls, history, text, of, citations };
}

live("OpenBB example agents (agents-for-openbb aa1073d)", () => {
  it("30 raw widget data: get_widget_data round-trips and the reply streams", async () => {
    const t = await turn(30, { primary: [PRICES] });
    expect(t.calls.map((c) => c.function)).toEqual(["get_widget_data"]);
    expect(t.text).toContain("stub reply");
    expect(t.text).toContain("row-prices");
  });

  it("31 reasoning steps: a status arrives before the reply", async () => {
    const t = await turn(31);
    const firstStatus = t.events.findIndex((e) => e.type === "status");
    expect(firstStatus).toBeGreaterThanOrEqual(0);
    expect(firstStatus).toBeLessThan(t.events.findIndex((e) => e.type === "chunk"));
    expect(t.of("status").map((e) => e.status.message)).toContain("Starting to answer the question...");
  });

  it("32 citations: the collection names the primary card's widget", async () => {
    const t = await turn(32, { primary: [PRICES] });
    expect(t.citations.map((c) => c.source_info)).toContainEqual(expect.objectContaining({ type: "widget", origin: backend.id, widget_id: "prices" }));
  });

  it("33 charts: five chart artifacts pass BDOBB's artifact guard", async () => {
    const arts = (await turn(33)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(5);
    for (const a of arts) {
      expect(isClientArtifact(a)).toBe(true);
      expect(a.type).toBe("chart");
    }
  });

  it("34 tables: a table artifact passes the guard", async () => {
    const arts = (await turn(34)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(1);
    expect(isClientArtifact(arts[0])).toBe(true);
    expect(arts[0].type).toBe("table");
  });

  it("35 PDF: BDOBB sends the PDF card as data_type pdf and the example reads it", async () => {
    const t = await turn(35, { primary: [REPORT] });
    const tool = t.history.find((m) => m.role === "tool") as { data: Array<{ items: unknown[] }> };
    expect(tool.data[0].items[0]).toEqual({ content: PDF, data_format: { data_type: "pdf", filename: "conformance.pdf" }, citable: true });
    expect(t.text).toContain("===== conformance.pdf =====");
    expect(t.text).toContain("Revenue grew 12 percent in 2025.");
  });

  it("36 PDF citations: quote_bounding_boxes arrive and parse into boxes", async () => {
    const boxed = (await turn(36, { primary: [REPORT] })).citations.filter((c) => "quote_bounding_boxes" in c);
    expect(boxed).toHaveLength(1);
    const [[box]] = boxed[0].quote_bounding_boxes as BoundingBox[][];
    expect(box).toEqual({ text: "Conformance fixture page one.", page: 1, x0: 72, top: 78, x1: expect.closeTo(236.748, 2), bottom: 90 });
  });

  it("37 custom features: all four shapes normalize and the set values reach the request", async () => {
    const agent = pickAgent(await fetchAgentsJson(url(37)), url(37));
    expect(Object.fromEntries(Object.entries(agent?.features ?? {}).map(([k, f]) => [k, f.kind]))).toMatchObject({
      "deep-research": "toggle", "web-search": "toggle", model: "select", "agent-name": "text",
    });
    const t = await turn(37, { workspaceOptions: workspaceOptionsFor(agent, { "deep-research": true, model: "gpt-4o-mini", "agent-name": "Conformance Agent" }) });
    expect(t.text).toContain("- Deep Research: ✅ Enabled");
    expect(t.text).toContain("- Model: gpt-4o-mini");
    expect(t.text).toContain("- Agent Name: Conformance Agent");
  });

  it("38 MCP tools: the tool list is sent and an execute_agent_tool call round-trips", async () => {
    const tool: AgentTool = { server_id: "conformance", name: "echo", url: "http://127.0.0.1:9/mcp", endpoint: "", description: "Echo for the conformance run.", input_schema: { type: "object", properties: {} } };
    const ran: unknown[][] = [];
    const t = await turn(38, {
      tools: [tool],
      deps: { runAgentTool: async (...a) => { ran.push(a.slice(0, 3)); return { content: [{ type: "text", text: "echo-38" }] }; } },
    });
    expect(ran).toEqual([["conformance", "echo", {}]]);
    expect(t.text).toContain("Tool: echo (Server ID: conformance)");
    expect(t.text).toContain("echo-38");
  });

  it("39 HTML artifacts: three html artifacts pass the guard", async () => {
    const arts = (await turn(39)).of("artifact").map((e) => e.payload);
    expect(arts).toHaveLength(3);
    for (const a of arts) {
      expect(isClientArtifact(a)).toBe(true);
      expect(a.type).toBe("html");
    }
  });

  it("40 dashboard widgets: primary and secondary refs both validate and reach the example", async () => {
    const both = await turn(40, { primary: [PRICES], secondary: [NOTES] });
    expect(both.text).toContain("# Explicit Context (Primary)");
    expect(both.text).toContain("Conformance Prices");
    // The example lists secondary widgets only beside workspace_state's tabs (BDOBB sends none, Q4) or with no primary.
    const secondary = await turn(40, { secondary: [NOTES] });
    expect(secondary.text).toContain("**Available widgets**");
    expect(secondary.text).toContain("Conformance Notes");
  });

  it("41 dynamic skill: get_skill_content round-trips and the skill reaches the prompt", async () => {
    const skill: Skill = { slug: "conformance-skill", description: "Skill for the conformance run.", content: "SKILL-BODY-41", enabled: true, updated: "2026-10-28T00:00:00Z", extra: {} };
    const t = await turn(41, {
      skillsCatalog: [{ slug: skill.slug, description: skill.description, updatedAt: skill.updated }],
      deps: { readSkill: (slug) => (slug === skill.slug ? skill : undefined) },
    });
    expect(t.calls).toEqual([expect.objectContaining({ function: "get_skill_content", input_arguments: { slug: "conformance-skill" } })]);
    expect(t.text).toContain("SKILL-BODY-41");
  });

  it("42 feedback: advertised, accepted with 2xx, and recorded", async () => {
    expect(advertisesFeedback(pickAgent(await fetchAgentsJson(url(42)), url(42)))).toBe(true);
    const file = process.env.OPENBB_EXAMPLE_FEEDBACK_FILE ?? "";
    const before = JSON.parse(await readFile(file, "utf8")) as unknown[];
    const t = await turn(42);
    const trace_id = crypto.randomUUID();
    await sendFeedback(url(42), { vote: "thumbs_down", tags: ["Other"], user_comment: "conformance", ai_response: t.text, user_prompt: "hi", trace_id });
    const after = JSON.parse(await readFile(file, "utf8")) as Array<Record<string, unknown>>;
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ vote: "thumbs_down", tags: ["Other"], trace_id, user_prompt: "hi" });
  });
});
```

- [ ] **Step 2: Confirm it skips without the harness** — `pnpm exec vitest run src/test/integration/agent-conformance-live.test.ts`. Expected: 13 skipped, 0 failed. `pnpm typecheck` clean.

- [ ] **Step 3: First harness run (expected red before the rulings)**

Run: `pnpm test:conformance`
Expected today: every row fails with an HTTP 422 naming `context.0.uuid` (Q1). Record the output.

- [ ] **Step 4: Commit** (the red run is the evidence for the gate)

```bash
git add src/test/integration/agent-conformance-live.test.ts
git commit -m "test(conformance): BDOBB against agents-for-openbb examples 30-42

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B3: Apply the Q1–Q4 rulings and run green

Stop here until the user has ruled on Q1–Q4. Apply only the rulings' diffs:

- **Q1 = C (quirk):** in the test, change `const CONTEXT = [...]` to `const CONTEXT: never[] = [];` with the comment `// Q1 ruling 2026-10-xx: stock openbb-ai agents refuse BDOBB's name/description context item; chatStore keeps sending it to Rita.` **Q1 = A or B:** stop and brainstorm that change as its own design; it changes what Rita receives.
- **Q2 = A (defect):** in `execute.ts` `toolResultData`, replace the `items` map and the `typed` item with

  ```ts
  const items = raw.map((item: unknown) => {
    if (isRecord(item) && typeof item.text === "string") {
      const text = item.text.length > MAX_RESULT_CHARS ? capContent(item.text) : item.text;
      // openbb-ai's SingleDataContent reads `content`; Rita reads `text` or `content` (conformance Q2).
      return { ...item, text, content: text };
    }
    if (JSON.stringify(item ?? null).length <= MAX_RESULT_CHARS) return item;
    const capped = capContent(item);
    return { type: "text", text: capped, content: capped };
  });
  ```

  and `const typedText = JSON.stringify({ $rita_kind: "error", error: failure }); const typed = { type: "text", text: typedText, content: typedText };`. Add to `execute.test.ts`: an `execute_agent_tool` whose `runAgentTool` returns `{ content: [{ type: "text", text: "a" }] }` yields `data` `[{ items: [{ type: "text", text: "a", content: "a" }] }]`. Existing `toEqual`s on these items gain `content` (additions only; keep every existing assertion). **Q2 = B:** row 38 becomes `await expect(turn(38, …)).rejects.toThrow(/422/)`, keeping the `ran` assertion.
- **Q3 = A:** in `widgetDataResults`' catch, push `{ error_type: "fetch_failed", message, content: message }`; extend the A1 over-limit test to expect `content` equal to `message`.
- **Q4 = B (default):** no change. **Q4 = A:** same as Q1 A.

- [ ] **Step 1:** Apply the ruled diffs; run `pnpm exec vitest run src/lib/agent && pnpm typecheck`. Expected: PASS.
- [ ] **Step 2:** Run `pnpm test:conformance`. Expected: `conformance: 13/13 passed, 0 skipped, 0 failed`.
- [ ] **Step 3:** Commit with a message naming the rulings, e.g. `fix(agent): give MCP result items a content field (conformance Q2 ruling)` plus the trailer.

---

## Phase C — Rita patches (recipe worktree `~/Developer/agent-rita-bdobb-conformance`)

### Task C1: Worktree and patched baseline

- [ ] **Step 1:** 

```bash
C=~/Developer/adventures-in-openbb-articles/openbq-relaunch/agent-rita-bdobb
git -C "$C" fetch -q origin
git -C "$C" worktree add ~/Developer/agent-rita-bdobb-conformance -b claude/rita-feedback-quote-boxes origin/main
cd ~/Developer/agent-rita-bdobb-conformance && git log --oneline -1   # expect 0cfbe8b
scripts/build.sh --check-only     # expect "applied 0001…0014", "check-only: OK"
git -C build/rita add -A && git -C build/rita commit -qm "recipe 0001-0014 (baseline, not a patch)"
scripts/test-aperture.sh          # baseline: bun test + tsc pass in oven/bun:1.4.4-slim
```

Expected: tests and tsc pass. A failure here is pre-existing; record it and stop.

Work in `build/rita` from now on. `build.sh` deletes `build/rita` on every run, so export each patch (C2/C3 step "export") before running `build.sh` again.

### Task C2: Patch 0015 — `POST /v1/feedback`

**Files (in `build/rita`):** Create `src/routes/feedback.ts`, `tests/integration/routes/feedback.test.ts`; Modify `src/server.ts`, `src/routes/agents.ts`, `tests/integration/routes/agents-status.test.ts`.

**Interfaces:** Produces `feedbackRouter` (Hono). Body = BDOBB's `FeedbackPayload` (A4). 204 on success, 400 bad body. One JSONL line `{received_at, principal?, vote, tags, user_comment, ai_response, user_prompt, trace_id}` appended to `FEEDBACK_PATH` (default `/data/feedback.jsonl`).

- [ ] **Step 1: Write the failing tests**

`tests/integration/routes/feedback.test.ts`:

```ts
/**
 * Tier 2 -- POST /v1/feedback (agent-rita-bdobb 0015). No LLM.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { feedbackRouter } from "../../../src/routes/feedback";

const dir = mkdtempSync(join(tmpdir(), "rita-feedback-"));
const path = join(dir, "sub", "feedback.jsonl");
process.env.FEEDBACK_PATH = path;
afterEach(() => rmSync(join(dir, "sub"), { recursive: true, force: true }));

function post(body: string, headers: Record<string, string> = {}) {
  const app = new Hono();
  app.route("/", feedbackRouter);
  return app.request("/v1/feedback", { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } });
}
const lines = () => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("POST /v1/feedback", () => {
  it("appends one JSON line with a receive time and answers 204", async () => {
    const res = await post(JSON.stringify({ vote: "thumbs_up", ai_response: "hello", user_prompt: "hi", trace_id: "t-1" }));
    expect(res.status).toBe(204);
    const [line] = lines();
    expect(line).toMatchObject({ vote: "thumbs_up", tags: [], user_comment: "", ai_response: "hello", user_prompt: "hi", trace_id: "t-1" });
    expect(Number.isNaN(Date.parse(line.received_at))).toBe(false);
    expect(line.principal).toBeUndefined();
  });

  it("records the door's X-Rita-Principal, and ignores one that is not github:<id>", async () => {
    await post(JSON.stringify({ vote: "thumbs_down", tags: ["Other"] }), { "X-Rita-Principal": "github:42" });
    await post(JSON.stringify({ vote: "thumbs_down" }), { "X-Rita-Principal": "admin" });
    expect(lines().map((l) => l.principal)).toEqual(["github:42", undefined]);
  });

  it("answers 400 for a bad body and writes nothing", async () => {
    for (const body of ["not json", JSON.stringify({ vote: "meh" }), JSON.stringify({ vote: "thumbs_up", tags: "x" })]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(() => readFileSync(path)).toThrow();
  });
});
```

In `agents-status.test.ts` "advertises the supported feature flags", add `expect(features.feedback).toBe(true);`.

- [ ] **Step 2: Run to verify they fail** — from the recipe root: `scripts/test-aperture.sh`. Expected: FAIL (missing module; `feedback` undefined).

- [ ] **Step 3: Implement**

`src/routes/feedback.ts`:

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../lib/logger";

const logger = getLogger(["app", "routes", "feedback"]);

/** OpenBB Workspace's feedback body (agents-for-openbb 42). */
const FeedbackSchema = z.object({
  vote: z.enum(["thumbs_up", "thumbs_down"]),
  tags: z.array(z.string().max(200)).max(20).default([]),
  user_comment: z.string().max(10_000).default(""),
  ai_response: z.string().max(100_000).default(""),
  user_prompt: z.string().max(100_000).default(""),
  trace_id: z.string().max(200).default(""),
});
/** What the door sets (openbq-docker funnel-gateway); anything else is not recorded. */
const PRINCIPAL_RE = /^github:[1-9][0-9]{0,19}$/;

export const feedbackRouter = new Hono();

feedbackRouter.post("/v1/feedback", async (c) => {
  const raw = await c.req.json().catch(() => undefined); // non-JSON body -> 400, as 0010 does for /v1/query
  const parsed = FeedbackSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid feedback", details: parsed.error.issues }, 400);
  const principal = c.req.header("X-Rita-Principal");
  const line = {
    received_at: new Date().toISOString(),
    ...(principal && PRINCIPAL_RE.test(principal) ? { principal } : {}),
    ...parsed.data,
  };
  const path = process.env.FEEDBACK_PATH || "/data/feedback.jsonl";
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(line)}\n`);
  logger.info("Feedback recorded", { vote: line.vote, principal: line.principal ?? null });
  return c.body(null, 204);
});
```

`src/server.ts`: add `import { feedbackRouter } from "./routes/feedback";` and `app.route("/", feedbackRouter);` after `app.route("/", queryRouter);`.

`src/routes/agents.ts`: in `features`, after `"file-upload": true,` add `feedback: true,`.

- [ ] **Step 4: Run** — `scripts/test-aperture.sh`. Expected: PASS (bun test + tsc).

- [ ] **Step 5: Export the patch**

```bash
git -C build/rita add -A
git -C build/rita commit -qm "feat(routes): POST /v1/feedback appends a JSON line per vote, with the door's principal"
git -C build/rita format-patch -1 HEAD --start-number 15 -o "$PWD/patches"
ls patches | tail -1   # 0015-feat-routes-POST-v1-feedback-appends-a-JSON-line-per-.patch
```

### Task C3: Patch 0016 — `cite_quote` and quote bounding boxes

**Files (in `build/rita`):** Create `src/agent/tools/cite-quote.ts`, `tests/unit/src/agent/tools/cite-quote.test.ts`; Modify `src/protocol/types.ts` (Citation ~line 304), `src/protocol/citations.ts`, `src/agent/loop.ts` (imports; tools object ~line 1172), `src/agent/prompt.ts` (~line 61), `tests/unit/src/protocol/citations.test.ts`, `tests/unit/src/agent/prompt.test.ts`.

**Interfaces:** Produces `QuoteBoundingBox` (same shape as BDOBB's `BoundingBox`); `CitedWidget.quoteBoxes?: QuoteBoundingBox[][]`; `findQuoteBoxes(bytes: Uint8Array, quote: string): Promise<QuoteBoundingBox[]>`; `widgetPdf(messages: Message[], widgetUuid: string): { content?: string; url?: string } | null`; `runCiteQuote(args, ctx): Promise<string>` returning `"Quote highlighted."` or `"Noted."`, never throwing; `makeCiteQuoteTool(ctx)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/src/agent/tools/cite-quote.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { findQuoteBoxes, runCiteQuote, widgetPdf } from "../../../../../src/agent/tools/cite-quote";
import type { CitedWidget } from "../../../../../src/protocol/citations";
import type { Message } from "../../../../../src/protocol/types";

/** One page, Helvetica 12 pt, 16 pt leading, first baseline at y = 704 (BDOBB's src/test/pdfFixture.ts). */
function pdfBase64(lines: string[]): string {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${esc(l)}) '`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64");
}

const PDF = pdfBase64(["Conformance fixture page one.", "Revenue grew 12 percent in 2025."]);
const bytes = () => Uint8Array.from(Buffer.from(PDF, "base64"));
const UUID = "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f";
const messages = [
  { role: "human", content: "q" },
  {
    role: "tool",
    function: "get_widget_data",
    input_arguments: { data_sources: [{ widget_uuid: "other" }, { widget_uuid: UUID }] },
    data: [{ items: [{ content: "[]" }] }, { items: [{ content: PDF, data_format: { data_type: "pdf", filename: "r.pdf" } }] }],
  },
] as unknown as Message[];
const KEY = `${UUID}|{}`;
const cited = (): Map<string, CitedWidget> =>
  new Map([[KEY, { widget: { uuid: UUID, origin: "b", widget_id: "report", name: "Report", description: "", params: [] }, inputArgs: {}, widgetUuid: UUID }]]);

describe("findQuoteBoxes", () => {
  it("boxes the line a quote falls on, in PDF points from the top-left", async () => {
    const [box, ...rest] = await findQuoteBoxes(bytes(), "  revenue GREW 12   percent ");
    expect(rest).toEqual([]);
    expect(box).toMatchObject({ text: "Revenue grew 12 percent in 2025.", page: 1, x0: 72, top: 92, bottom: 104 });
    expect(box.x1).toBeCloseTo(255.432, 2);
  });

  it("gives one box per line for a quote across two lines", async () => {
    expect((await findQuoteBoxes(bytes(), "page one. Revenue grew")).map((b) => b.top)).toEqual([76, 92]);
  });

  it("finds nothing for a quote that is not in the document", async () => {
    expect(await findQuoteBoxes(bytes(), "Revenue fell")).toEqual([]);
  });
});

describe("widgetPdf", () => {
  it("takes the pdf item from the data source whose widget_uuid matches", () => {
    expect(widgetPdf(messages, UUID)).toEqual({ content: PDF, url: undefined });
    expect(widgetPdf(messages, "missing")).toBeNull();
  });
});

describe("runCiteQuote", () => {
  it("attaches the boxes to the cited widget", async () => {
    const citedWidgets = cited();
    expect(await runCiteQuote({ widget_uuid: UUID, quote: "Revenue grew 12 percent" }, { messages, citedWidgets })).toBe("Quote highlighted.");
    expect(citedWidgets.get(KEY)?.quoteBoxes).toEqual([[expect.objectContaining({ page: 1, top: 92 })]]);
  });

  it("answers without an error and attaches nothing when the quote is not found", async () => {
    const citedWidgets = cited();
    expect(await runCiteQuote({ widget_uuid: UUID, quote: "Revenue fell" }, { messages, citedWidgets })).toBe("Noted.");
    expect(citedWidgets.get(KEY)?.quoteBoxes).toBeUndefined();
  });
});
```

Append to `tests/unit/src/protocol/citations.test.ts`:

```ts
describe("buildWidgetCitations quote boxes", () => {
  it("carries a cited widget's quote boxes, and omits the field without them", async () => {
    const box = { text: "t", page: 1, x0: 1, top: 2, x1: 3, bottom: 4 };
    const [boxed] = await buildWidgetCitations(new Map([["u-1|{}", { widget: widget(), inputArgs: {}, widgetUuid: "u-1", quoteBoxes: [[box]] }]]));
    expect(boxed.quote_bounding_boxes).toEqual([[box]]);
    const [plain] = await buildWidgetCitations(new Map([["u-1|{}", { widget: widget(), inputArgs: {}, widgetUuid: "u-1" }]]));
    expect("quote_bounding_boxes" in plain).toBe(false);
  });
});
```

Append to `tests/unit/src/agent/prompt.test.ts` inside "buildSystemPrompt — base content":

```ts
  it("tells the model to cite a verbatim PDF quote with cite_quote", () => {
    expect(buildSystemPrompt(req())).toContain("cite_quote");
  });
```

- [ ] **Step 2: Run to verify they fail** — `scripts/test-aperture.sh`. Expected: FAIL.

- [ ] **Step 3: Implement**

`src/protocol/types.ts`: above `export interface Citation`:

```ts
/** One highlighted line of a cited PDF quote, in PDF points from the page's top-left (pdfplumber's convention). */
export interface QuoteBoundingBox {
  text: string;
  page: number;
  x0: number;
  top: number;
  x1: number;
  bottom: number;
}
```

and change `quote_bounding_boxes?: null;` to `quote_bounding_boxes?: QuoteBoundingBox[][];`.

`src/protocol/citations.ts`: import `QuoteBoundingBox`; add `quoteBoxes?: QuoteBoundingBox[][];` to `CitedWidget`; in `buildWidgetCitations` destructure `{ widget, inputArgs, widgetUuid, quoteBoxes }` and add `...(quoteBoxes?.length ? { quote_bounding_boxes: quoteBoxes } : {}),` after `signature: "",` in the `type: "widget"` citation.

`src/agent/tools/cite-quote.ts`:

```ts
/**
 * `cite_quote` (agent-rita-bdobb 0016): the model names a PDF widget and a
 * verbatim quote; Rita finds it with unpdf and attaches one box per line to that
 * widget's citation (quote_bounding_boxes). A quote it cannot find costs a debug
 * line, never an error to the model.
 */
import { tool } from "ai";
import { getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { CitedWidget } from "../../protocol/citations";
import type { Message, QuoteBoundingBox, ToolMessage } from "../../protocol/types";
import { getLogger } from "../../lib/logger";

const logger = getLogger(["app", "tools", "cite_quote"]);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The PDF the latest get_widget_data round returned for this widget, if any. */
export function widgetPdf(messages: Message[], widgetUuid: string): { content?: string; url?: string } | null {
  for (const m of [...messages].reverse()) {
    if (m.role !== "tool") continue;
    const t = m as ToolMessage;
    if (t.function !== "get_widget_data") continue;
    const sources = (t.input_arguments?.data_sources as Array<{ widget_uuid?: string }> | undefined) ?? [];
    const i = sources.findIndex((s) => s.widget_uuid === widgetUuid);
    const item = i >= 0 ? t.data?.[i]?.items?.find((it) => (it.data_format as { data_type?: string } | undefined)?.data_type === "pdf") : undefined;
    if (item) return { content: typeof item.content === "string" && item.content ? item.content : undefined, url: typeof item.url === "string" && item.url ? item.url : undefined };
  }
  return null;
}

type TextItem = { str?: string; transform: number[]; width: number; height: number };

/**
 * One box per line the quote covers, on the first page whose text contains it.
 * ponytail: item-granular (a partly quoted text item is boxed whole) and page-local; go per-glyph if highlights look too wide.
 */
export async function findQuoteBoxes(bytes: Uint8Array, quote: string): Promise<QuoteBoundingBox[]> {
  const want = norm(quote);
  if (!want) return [];
  const doc = await getDocumentProxy(bytes);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const items = ((await page.getTextContent()).items as TextItem[]).filter((it) => typeof it.str === "string" && norm(it.str) !== "");
    let text = "";
    const spans = items.map((it) => {
      if (text) text += " ";
      const start = text.length;
      text += norm(it.str as string);
      return [start, text.length] as const;
    });
    const at = text.indexOf(want);
    if (at < 0) continue;
    const lines = new Map<number, QuoteBoundingBox>();
    items.forEach((it, i) => {
      const [s, e] = spans[i];
      if (e <= at || s >= at + want.length) return;
      const [, , , , x, y] = it.transform;
      const box = { text: it.str as string, page: p, x0: x, top: height - y - it.height, x1: x + it.width, bottom: height - y };
      const key = Math.round(y);
      const line = lines.get(key);
      lines.set(key, line
        ? { ...line, text: `${line.text} ${box.text}`, x0: Math.min(line.x0, box.x0), x1: Math.max(line.x1, box.x1), top: Math.min(line.top, box.top), bottom: Math.max(line.bottom, box.bottom) }
        : box);
    });
    return [...lines.values()];
  }
  return [];
}

export interface CiteQuoteContext {
  messages: Message[];
  citedWidgets: Map<string, CitedWidget>;
}

export async function runCiteQuote({ widget_uuid, quote }: { widget_uuid: string; quote: string }, ctx: CiteQuoteContext): Promise<string> {
  try {
    const pdf = widgetPdf(ctx.messages, widget_uuid);
    const bytes = pdf?.content
      ? Uint8Array.from(Buffer.from(pdf.content, "base64"))
      : pdf?.url
        ? new Uint8Array(await (await fetch(pdf.url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer())
        : null;
    const boxes = bytes ? await findQuoteBoxes(bytes, quote) : [];
    const cited = [...ctx.citedWidgets.values()].filter((c) => c.widgetUuid === widget_uuid);
    if (boxes.length === 0 || cited.length === 0) {
      logger.debug("cite_quote: nothing to highlight", { widget_uuid, boxes: boxes.length, cited: cited.length, hasPdf: pdf !== null });
      return "Noted.";
    }
    for (const c of cited) c.quoteBoxes = [...(c.quoteBoxes ?? []), boxes];
    return "Quote highlighted.";
  } catch (error) {
    logger.debug("cite_quote failed", { widget_uuid, error });
    return "Noted.";
  }
}

export const citeQuoteSchema = z.object({
  widget_uuid: z.string().min(1).describe("The PDF widget's widget_uuid, exactly as in get_widget_data."),
  quote: z.string().min(1).max(500).describe("A short passage copied verbatim from that PDF."),
});

export function makeCiteQuoteTool(ctx: CiteQuoteContext) {
  return tool({
    description: "Highlight a verbatim quote from a PDF widget you have loaded, so the user sees where your answer comes from. Call once per quote you rely on.",
    inputSchema: citeQuoteSchema,
    execute: async (args) => runCiteQuote(args, ctx),
  });
}
```

`src/agent/loop.ts`: add `import { makeCiteQuoteTool } from "./tools/cite-quote";` beside the other tool imports, and in the `tools: ToolSet = {` object after the `get_widget_data` line:

```ts
        ...(hasWidgets && { cite_quote: makeCiteQuoteTool({ messages: request.messages, citedWidgets }) }),
```

`src/agent/prompt.ts`: after the line ending `"query_documents returns nothing for a file you have not loaded yet — never call it before get_widget_data on that file.\n\n" +`, insert before it (inside the same bullet list, as its own bullet):

```ts
  "- When your answer relies on a PDF widget's text, call cite_quote with that widget's widget_uuid and a short quote copied verbatim from the PDF, so the user sees it highlighted.\n" +
```

- [ ] **Step 4: Run** — `scripts/test-aperture.sh`. Expected: PASS.

- [ ] **Step 5: Export the patch**

```bash
git -C build/rita add -A
git -C build/rita commit -qm "feat(agent): cite_quote finds a PDF quote with unpdf and attaches quote_bounding_boxes"
git -C build/rita format-patch -1 HEAD --start-number 16 -o "$PWD/patches"
```

### Task C4 (only if Q5 = A): Patch 0017 — PDF text for model servers without file parts

**Files (in `build/rita`):** Modify `src/widgets/parse.ts` (the two `kind === "pdf"` branches, ~lines 180 and 205); Test `tests/unit/src/widgets/parse.test.ts`.

- [ ] **Step 1: Failing test** (append to `parse.test.ts`; reuse the `pdfBase64` helper by copying it into this file)

```ts
describe("extractWidgetItems — PDFs", () => {
  it("hands the model the PDF's text, not a file part (vLLM refuses file parts)", async () => {
    const pdf = pdfBase64(["Conformance fixture page one.", "Revenue grew 12 percent in 2025."]);
    const [item] = await extractWidgetItems(
      { role: "tool", function: "get_widget_data", input_arguments: { data_sources: [{ widget_uuid: "u" }] }, data: [{ items: [{ content: pdf, data_format: { data_type: "pdf", filename: "r.pdf" } }] }] } as never,
      [{ uuid: "u", origin: "b", widget_id: "report", name: "Report", description: "", params: [] }],
    );
    expect(item.parts).toBeUndefined();
    expect(item.content).toContain("Revenue grew 12 percent in 2025.");
  });
});
```

- [ ] **Step 2:** `scripts/test-aperture.sh` → FAIL (a `file` part, empty content).
- [ ] **Step 3: Implement** — add `import { extractText, getDocumentProxy } from "unpdf";` and

```ts
/** A PDF's text, for model servers that take no `file` part (the Spark's vLLM answers 400). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return text;
}
```

In the inline branch replace the `mediaParts.push({ type: "file", … })` with `contentParts.push(await pdfText(Uint8Array.from(Buffer.from(raw.content, "base64"))));`; in the URL branch replace its `mediaParts.push({ type: "file", … })` with `contentParts.push(await pdfText(new Uint8Array(buf)));`. Keep both size checks.
- [ ] **Step 4:** `scripts/test-aperture.sh` → PASS. Also confirm the round-trip tests still pass (a PDF's text now arrives as `content`; check `tests/unit/src/agent/round-trip.test.ts` is green — if a PDF item is now routed to SQLite as rows, stop and report).
- [ ] **Step 5:** `git -C build/rita add -A && git -C build/rita commit -qm "fix(widgets): send a PDF's text, not a file part, so OpenAI-compatible servers can read it" && git -C build/rita format-patch -1 HEAD --start-number 17 -o "$PWD/patches"`

### Task C5: README, clean check, commit

- [ ] **Step 1:** In `README.md`'s patch table, after the 0014 row add:

```
| 0015 | `POST /v1/feedback`: validate the vote with zod and append one JSON line (receive time, the door's `X-Rita-Principal`) to `FEEDBACK_PATH` (default `/data/feedback.jsonl`); `agents.json` advertises `feedback: true` |
| 0016 | `cite_quote`: find a verbatim PDF quote with `unpdf` and attach one box per line to that widget's citation as `quote_bounding_boxes` |
```

and, only with C4, `| 0017 | Send a PDF's extracted text, not a file part, so OpenAI-compatible model servers (vLLM) can read it |`.
- [ ] **Step 2:** `scripts/build.sh --check-only && scripts/test-aperture.sh` from a clean `build/` (it re-clones and applies 0001–0016/0017). Expected: every patch applies; tests + tsc PASS.
- [ ] **Step 3: Commit** (recipe repo; not pushed)

```bash
git add patches/0015-*.patch patches/0016-*.patch README.md   # plus patches/0017-*.patch with C4
git commit -m "patches: 0015 feedback route, 0016 cite_quote quote boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase D — Door gateway feedback relay (Adventures-OpenBQ/openbq-docker)

### Task D1: v10 — relay `POST /ai/v1/feedback`

**Worktree:** `git -C ~/Developer/openbq-docker-v10-rita fetch -q origin && git -C ~/Developer/openbq-docker-v10-rita worktree add ~/Developer/openbq-docker-v10-feedback -b claude/v10-rita-feedback origin/release/v10` (expect `c3b0ce0`). Then `cd ~/Developer/openbq-docker-v10-feedback/funnel-gateway && npm ci && npm test` for a green baseline.

**Files:** Modify `funnel-gateway/rita-policy.mjs`, `funnel-gateway/server.mjs` (`postRita` area ~line 541; `handleRita` ~lines 644–660), `funnel-gateway/verify.mjs` (~line 116), `funnel-gateway/README.md` (route table, after the `/ai/v1/query` row ~line 74); Test `funnel-gateway/rita-policy.test.mjs`, `funnel-gateway/rita.test.mjs`.

**Interfaces:** Produces `ritaRoute(...) === "feedback"` for `POST /ai/v1/feedback`; `ritaFeedback(body: Buffer): object | null`; `RITA_FEEDBACK_MAX = 64 * 1024`; `postRitaFeedback(body, principal, config, signal)`.

- [ ] **Step 1: Failing policy tests** (append to `rita-policy.test.mjs`; add `ritaFeedback` to its import)

```js
test("feedback is one more exact route", () => {
  assert.equal(ritaRoute(at("/ai/v1/feedback"), "POST"), "feedback");
  assert.equal(ritaRoute(at("/ai/v1/feedback"), "GET"), null);
  assert.equal(ritaRoute(at("/ai/v1/feedback?x=1"), "POST"), null);
});

test("a feedback body is rebuilt from its six known fields, or refused", () => {
  const fb = value => ritaFeedback(Buffer.from(JSON.stringify(value)));
  assert.deepEqual(fb({ vote: "thumbs_up" }), { vote: "thumbs_up", tags: [], user_comment: "", ai_response: "", user_prompt: "", trace_id: "" });
  assert.deepEqual(fb({ vote: "thumbs_down", tags: ["Other"], trace_id: "t", url: `http://${LAN}/`, extra: 1 }),
    { vote: "thumbs_down", tags: ["Other"], user_comment: "", ai_response: "", user_prompt: "", trace_id: "t" });
  for (const bad of [{}, { vote: "meh" }, { vote: "thumbs_up", tags: "Other" }, { vote: "thumbs_up", tags: [1] },
    { vote: "thumbs_up", user_comment: 5 }, [], "x"]) assert.equal(fb(bad), null, JSON.stringify(bad));
  assert.equal(ritaFeedback(Buffer.from("{")), null);
});
```

- [ ] **Step 2: Failing door tests** (append to `rita.test.mjs`)

```js
const FEEDBACK = JSON.stringify({ vote: "thumbs_down", tags: ["Other"], user_comment: "c", ai_response: "r", user_prompt: "p", trace_id: "t-1", extra: "dropped" });
const feedback = (port, headers = { "X-Rita-Principal": USER }, body = FEEDBACK) =>
  call(port, "/ai/v1/feedback", { method: "POST", body, headers });
const accepted = (_, res) => { res.writeHead(204); res.end(); };

test("feedback reaches her rebuilt, with the caller's principal and nothing else of theirs", async t => {
  const rita = await fakeRita(t, accepted);
  const port = await door(t, rita);
  assert.equal((await feedback(port, { "X-Rita-Principal": USER, Cookie: "a=b" })).status, 204);
  assert.equal(rita.seen[0].url, "/v1/feedback");
  assert.equal(rita.seen[0].headers["x-rita-principal"], USER);
  for (const name of ["authorization", "cookie"]) assert.equal(rita.seen[0].headers[name], undefined, name);
  assert.deepEqual(JSON.parse(rita.seen[0].body), { vote: "thumbs_down", tags: ["Other"], user_comment: "c", ai_response: "r", user_prompt: "p", trace_id: "t-1" });
});

test("agents.json keeps her feedback: true, so web users see the buttons", async t => {
  const rita = await fakeRita(t, (_, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ openbb_agent_rita: { name: "Agent Rita", endpoints: { query: "/v1/query" }, features: { feedback: true } } }));
  });
  const port = await door(t, rita);
  const answer = await call(port, "/ai/agents.json", { headers: { "X-Rita-Principal": USER } });
  assert.equal(JSON.parse(answer.text).openbb_agent_rita.features.feedback, true);
});

test("the desktop's feedback names no principal", async t => {
  const rita = await fakeRita(t, accepted);
  const port = await door(t, rita);
  assert.equal((await feedback(port, {})).status, 204);
  assert.equal(rita.seen[0].headers["x-rita-principal"], undefined);
});

test("feedback is charged to the hour but takes no turn slot", async t => {
  let release;
  const held = new Promise(r => { release = r; });
  const rita = await fakeRita(t, async (req, res) => {
    if (req.url === "/v1/feedback") return accepted(req, res);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"type":"first"}\n\n');
    await held; res.end();
  });
  const port = await door(t, rita, { ritaPerHour: 2 });
  const turn = ask(port);
  while (!rita.seen.some(s => s.url === "/v1/query")) await new Promise(r => setTimeout(r, 10));
  assert.equal((await feedback(port)).status, 204, "mid-turn, same principal");
  assert.equal((await feedback(port)).status, 429, "the query and one vote are the hour's two");
  release(); await turn;
});

test("feedback refuses a bad body, an oversized one, a GET, and a refusing Rita", async t => {
  const rita = await fakeRita(t, accepted);
  const port = await door(t, rita);
  assert.equal((await feedback(port, undefined, JSON.stringify({ vote: "meh" }))).status, 400);
  assert.equal((await feedback(port, undefined, JSON.stringify({ vote: "thumbs_up", ai_response: "x".repeat(70 * 1024) }))).status, 413);
  assert.equal((await call(port, "/ai/v1/feedback", { headers: { "X-Rita-Principal": USER } })).status, 404);
  assert.equal(rita.seen.length, 0);
  const down = await fakeRita(t, (_, res) => { res.writeHead(500); res.end(); });
  assert.equal((await feedback(await door(t, down))).status, 502);
});
```

- [ ] **Step 3:** `npm test` → the new tests FAIL.

- [ ] **Step 4: Implement**

`rita-policy.mjs`: add to the header comment's route list "her feedback vote (`/ai/v1/feedback`, rebuilt from its six fields)"; in `ritaRoute` add `if (url.pathname === "/ai/v1/feedback" && method === "POST") return "feedback";` before `return null;`; append:

```js
export const RITA_FEEDBACK_MAX = 64 * 1024;
const VOTES = new Set(["thumbs_up", "thumbs_down"]);

/** A feedback vote as the door forwards it: the six known fields, rebuilt; null to refuse (400). */
export function ritaFeedback(body) {
  let raw;
  try { raw = JSON.parse(body.toString("utf8")); } catch { return null; }
  if (!plain(raw) || !VOTES.has(raw.vote)) return null;
  const tags = raw.tags ?? [];
  if (!Array.isArray(tags) || !tags.every(tag => typeof tag === "string")) return null;
  const out = { vote: raw.vote, tags };
  for (const key of ["user_comment", "ai_response", "user_prompt", "trace_id"]) {
    const value = raw[key] ?? "";
    if (typeof value !== "string") return null;
    out[key] = value;
  }
  return out;
}
```

`server.mjs`: import `ritaFeedback, RITA_FEEDBACK_MAX` from `./rita-policy.mjs`; after `postRita` add

```js
/** Her feedback POST, charged to `principal`: a web user's github:<id> goes with it; the desktop's bucket sends none. */
export function postRitaFeedback(body, principal, config, signal) {
  return new Promise((resolve, rejectPromise) => {
    const headers = { "Content-Type": "application/json", "Content-Length": body.length,
      ...(principal.startsWith("github:") ? { "X-Rita-Principal": principal } : {}) };
    const request = httpRequest(new URL("/v1/feedback", config.ritaUpstream), { method: "POST", signal, headers }, resolve);
    request.once("error", rejectPromise);
    request.end(body);
  });
}
```

In `handleRita`, replace these four statements

```js
    if (ritaInflight >= RITA_CONCURRENT || ritaBusy.has(principal)) return reply(res, 429);
    // Only a token holder can name a principal, but it can name many: past 1000, sweep the hour.
    if (ritaUse.size > 1000) for (const [who, times] of ritaUse) if (!times.some(at => now() - at < RITA_HOUR_MS)) ritaUse.delete(who);
    const recent = (ritaUse.get(principal) ?? []).filter(at => now() - at < RITA_HOUR_MS);
    if (recent.length) ritaUse.set(principal, recent); else ritaUse.delete(principal);
    if (recent.length >= config.ritaPerHour) return reply(res, 429);
```

with

```js
    // Only a token holder can name a principal, but it can name many: past 1000, sweep the hour.
    if (ritaUse.size > 1000) for (const [who, times] of ritaUse) if (!times.some(at => now() - at < RITA_HOUR_MS)) ritaUse.delete(who);
    const recent = (ritaUse.get(principal) ?? []).filter(at => now() - at < RITA_HOUR_MS);
    if (recent.length) ritaUse.set(principal, recent); else ritaUse.delete(principal);
    if (route === "feedback") {
      // Charged to the hour like a query, but no turn slot: one small POST, not a stream.
      if (recent.length >= config.ritaPerHour) return reply(res, 429);
      const raw = await jsonBody(req, RITA_FEEDBACK_MAX);
      if (typeof raw === "number") { if (raw === 413) res.setHeader("Connection", "close"); return reply(res, raw); }
      const body = ritaFeedback(raw);
      if (!body) return reply(res, 400);
      ritaUse.set(principal, [...recent, now()]);
      const upstream = await postRitaFeedback(Buffer.from(JSON.stringify(body)), principal, config, AbortSignal.timeout(requestMs));
      upstream.resume();
      if (upstream.statusCode !== 204) return reply(res, 502);
      res.writeHead(204, COMMON);
      return res.end();
    }
    if (ritaInflight >= RITA_CONCURRENT || ritaBusy.has(principal)) return reply(res, 429);
    if (recent.length >= config.ritaPerHour) return reply(res, 429);
```

`verify.mjs`: in the `/ai` refusal list add `"/ai/v1/feedback",` after `"/ai/v1/query",` (a GET there must stay 404). `README.md`: after the `/ai/v1/query` row add

```
| `/ai/v1/feedback` | POST | with `rita` on: a feedback vote (JSON, ≤ 64 KiB) rebuilt by `rita-policy.mjs` from its six fields and posted to Rita's `/v1/feedback`, with `X-Rita-Principal` only when the caller's is `github:<id>`. Charged to `ritaPerHour` like a query; takes no turn slot. `204` relayed; `400` malformed, `413` too large, `429` past the hour, `502` if she refuses |
```

- [ ] **Step 5:** `npm test` → PASS (all gateway tests, including `gateway.test.mjs`'s `verify` runs).

- [ ] **Step 6: Commit and re-cut (local only)**

```bash
cd ~/Developer/openbq-docker-v10-feedback
git add funnel-gateway/rita-policy.mjs funnel-gateway/rita-policy.test.mjs funnel-gateway/server.mjs funnel-gateway/rita.test.mjs funnel-gateway/verify.mjs funnel-gateway/README.md
git commit -m "feat(funnel-gateway): relay Rita feedback votes through the door

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -f v10.0.0   # only with the Q7 ruling; not pushed
```

- [ ] **Step 7: Build and push the v10 image** (Q7 confirms the tag)

```bash
docker buildx build --platform linux/amd64 --build-context lanes=./lanes \
  --label org.opencontainers.image.source=https://github.com/Adventures-OpenBQ/openbq-docker \
  --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
  -t ghcr.io/adventures-openbq/openbq-funnel-gateway:10.0.0 --push funnel-gateway
docker buildx imagetools inspect ghcr.io/adventures-openbq/openbq-funnel-gateway:10.0.0 --format '{{json .Manifest.Digest}}'
```

Record the digest.

### Task D2: carry to v11 and build the NAS gateway image

- [ ] **Step 1:** `git -C ~/Developer/openbq-docker-v10-rita worktree add ~/Developer/openbq-docker-v11-feedback -b claude/v11-rita-feedback origin/release/v11` (expect `b480f0c`), then `git cherry-pick <D1 commit>`. `rita-policy.mjs` and its tests are identical on both lines; resolve any `server.mjs` conflict by hand so `handleRita` matches D1.
- [ ] **Step 2:** `cd funnel-gateway && npm ci && npm test` → PASS.
- [ ] **Step 3:** Build and push the NAS image under the Q7 tag (default `11.0.0-temporal`), same command as D1 Step 7 with that tag. Record the digest.

---

## Phase E — Spark redeploy and live suite

### Task E1: Replace the Spark's `rita` with the recipe build

- [ ] **Step 1: Record and tag the rollback** (on the Spark)

```bash
ssh <spark-host> 'set -e; mkdir -p ~/rita/rollback-20261028
  docker tag agent-rita:a2aaa91 agent-rita:rollback-20261028
  docker inspect rita > ~/rita/rollback-20261028/rita-inspect.json
  cp ~/rita/agent-rita/compose.yaml ~/rita/rollback-20261028/compose.yaml
  git -C ~/rita/agent-rita rev-parse HEAD > ~/rita/rollback-20261028/agent-rita-head.txt'
```

- [ ] **Step 2: Ship the recipe and build there** (arm64; git push is not used)

```bash
SCR=<your scratchpad dir>
git -C ~/Developer/agent-rita-bdobb-conformance bundle create "$SCR/recipe.bundle" HEAD
scp "$SCR/recipe.bundle" <spark-host>:rita/recipe.bundle
ssh <spark-host> 'set -e; rm -rf ~/rita/recipe && git clone -q ~/rita/recipe.bundle ~/rita/recipe
  cd ~/rita/recipe && IMAGE=openbq-rita:6.0.0 scripts/build.sh && docker run --rm --entrypoint id openbq-rita:6.0.0 bun'
```

Expected: every patch applied; `built openbq-rita:6.0.0 (sha-<recipe>, upstream f673c1f…)`; `id` prints the bun uid (expect 1000; use it below).

- [ ] **Step 3: Swap** (create the feedback dir owned by that uid, stop the old compose, start the new one)

```bash
ssh <spark-host> 'set -e; mkdir -p ~/rita/feedback
  docker run --rm --user 0 --entrypoint chown -v "$HOME/rita/feedback:/d" openbq-rita:6.0.0 1000:1000 /d
  cat > ~/rita/recipe-compose.yaml <<EOF
# Rita from the agent-rita-bdobb recipe (patches 0001-0016), replacing the bdobb-dev build.
# Rollback: ~/rita/rollback-20261028 (see the plan).
services:
  rita:
    image: openbq-rita:6.0.0
    container_name: rita
    network_mode: host
    env_file: ./agent-rita/.env
    environment:
      FEEDBACK_PATH: /data/feedback.jsonl
    volumes:
      - ./feedback:/data
    restart: unless-stopped
EOF
  docker compose -f ~/rita/agent-rita/compose.yaml down
  docker compose -f ~/rita/recipe-compose.yaml up -d
  sleep 10; docker ps --filter name=rita --format "{{.Names}} {{.Image}} {{.Status}}"'
```

- [ ] **Step 4: Verify through the svc name** (from the Mac)

```bash
curl -fsS https://openbb-rita.<your-tailnet>.ts.net/status
curl -fsS https://openbb-rita.<your-tailnet>.ts.net/agents.json | jq '.openbb_agent_rita.features.feedback'   # true
```

**Rollback E:** `ssh <spark-host> 'docker compose -f ~/rita/recipe-compose.yaml down && cd ~/rita/agent-rita && GIT_SHA=a2aaa91 docker compose up -d'` (no `--build`; `agent-rita:a2aaa91` and `agent-rita:rollback-20261028` are the same image). Then the Step 4 `/status` check. Do not run `tailscale serve reset`.

### Task E2: New live cases and `pnpm test:live`

**Files (BDOBB worktree):** Modify `src/test/integration/rita-live.test.ts`.

- [ ] **Step 1: Add the cases** (imports: `pdfBase64` from `"../pdfFixture"`, `sendFeedback` from `"../../lib/agent/feedback"`, `widget as widgetOf` from `"../fixtures"`; inside `live("Rita live", …)` after the last `it`)

```ts
  const PDF_CARD: DashboardCard = { id: "7d3e9f10-2b4c-4e5a-8f60-1a2b3c4d5e6f", widgetId: "conformance_report", backendId: backend.id, params: {}, layout: { x: 0, y: 0, w: 4, h: 4 } };
  const PDF_WIDGET = widgetOf({ id: "conformance_report", backendId: backend.id, name: "Quarterly Report", description: "A one-page PDF report.", type: "pdf", endpoint: "/conformance_report", params: [] });
  const PDF = pdfBase64(["Quarterly report for the conformance run.", "Revenue grew 12 percent in 2025."]);

  /** One turn over a dashboard holding only the PDF card, its document served from memory. */
  async function pdfTurn(question: string) {
    const fetchWidget = makeWidgetDataFetcher(
      { cards: [PDF_CARD], backends: [backend], findWidget: () => PDF_WIDGET, keyMaintBackends: new Set(), request: (c, w, b) => cardRequestSync(c, w, b, undefined) },
      (async () => ({ content: PDF, data_format: { data_type: "pdf", filename: "report.pdf" } })) as never,
    );
    const primary = buildWidgetRefs([PDF_CARD], () => PDF_WIDGET, () => backend.name, new Set());
    const gen = runAgentQuery({
      ritaUrl,
      messages: [{ role: "human", content: `${question} The PDF is on widget ${PDF_CARD.id}; load it with get_widget_data.` }],
      refresh: () => ({ primary }),
      tools: [],
      executeFunction: (payload, signal) => executeFunction(payload, { fetchWidget, runAgentTool: async () => null }, signal),
      timeoutMs: 120_000,
    });
    let text = "";
    const citations: Record<string, unknown>[] = [];
    for (;;) {
      const next = await gen.next();
      if (next.done) break;
      const e = next.value;
      if (e.type === "chunk") text += e.delta;
      if (e.type === "citations" && Array.isArray(e.payload.citations)) citations.push(...(e.payload.citations as Record<string, unknown>[]));
    }
    return { text, citations };
  }

  it("answers from a PDF card's content", async () => {
    const { text } = await pdfTurn("By what percent did revenue grow in 2025, according to the PDF?");
    expect(text).toMatch(/12\s*(%|percent)/i);
  }, 300_000);

  it("cites a PDF quote with at least one highlight box", async () => {
    const { citations } = await pdfTurn("Quote the sentence about revenue verbatim and cite it with cite_quote.");
    expect(citations.some((c) => Array.isArray(c.quote_bounding_boxes) && c.quote_bounding_boxes.length > 0)).toBe(true);
  }, 300_000);

  it("accepts a feedback vote", async () => {
    await expect(sendFeedback(ritaUrl, { vote: "thumbs_up", tags: [], user_comment: "", ai_response: "pong", user_prompt: "ping", trace_id: crypto.randomUUID() })).resolves.toBeUndefined();
  });
```

- [ ] **Step 2:** `pnpm typecheck` clean; `pnpm exec vitest run src/test/integration/rita-live.test.ts` without `OPENBB_RITA_URL` → all skipped.
- [ ] **Step 3: Run the gate** with the env of the last green live run (`OPENBB_BACKEND_URL`, `OPENBB_MCP_URLS`, `OPENBB_NAS_AUTH`; ask the user if not to hand) plus `OPENBB_RITA_URL=https://openbb-rita.<your-tailnet>.ts.net`:

Run: `pnpm test:live`
Expected: `live gate: N/N passed, 0 skipped, 0 failed`. Without C4 (Q5 ≠ A) the two PDF cases fail on Qwen by design: stop and report, do not weaken them.

- [ ] **Step 4: Commit**

```bash
git add src/test/integration/rita-live.test.ts
git commit -m "test(live): PDF context, PDF quote boxes and feedback against Rita

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase F — NAS redeploy and the public door

Nothing is built on the NAS. Three values come from the private NAS notes (auto-memory `qnap-stack-operations` / `nas-production-is-openbq-stack`), never from this file: `STACK` (the `openbq-stack` directory), `DK` (Container Station's docker binary, which is not on the SSH `PATH`) and `GHCR_CONFIG` (the `DOCKER_CONFIG` directory holding the GHCR login). Set them in the Mac shell, and begin every `ssh nas '…'` below with `STACK=…; DK=…; GHCR_CONFIG=…;` (written `<vars>;` here).

### Task F1: Rita image for amd64

- [ ] **Step 1:** In the recipe worktree: `scripts/build.sh --check-only`, then

```bash
R=$(git rev-parse --short=7 HEAD)
docker buildx build --platform linux/amd64 --build-arg GIT_SHA="sha-$R" \
  --label org.opencontainers.image.source=https://github.com/Adventures-OpenBQ/agent-rita-bdobb \
  --label org.opencontainers.image.revision=f673c1fbeeeedfdbf4a253031d85eb8e96538924 \
  -t "ghcr.io/adventures-openbq/openbq-rita:sha-$R" --push build/rita
docker buildx imagetools inspect "ghcr.io/adventures-openbq/openbq-rita:sha-$R" --format '{{json .Manifest.Digest}}'
```

Record `sha-$R` and the digest. The gateway image is D2's.

### Task F2: Deploy on `openbq-stack`

- [ ] **Step 1: Back up** (NAS)

```bash
ssh nas '<vars>; set -e; cd $STACK; TS=$(date -u +%Y%m%dT%H%M%SZ); echo $TS
  cp docker-compose.yml docker-compose-before-rita-feedback-$TS.yml
  cp rita.env rita.env.before-rita-feedback-$TS; cp rita-door.env rita-door.env.before-rita-feedback-$TS'
```

- [ ] **Step 2: Edit the compose file on the Mac**: `scp nas:$STACK/docker-compose.yml "$SCR/compose.yml"`; with the Edit tool change
  - both `ghcr.io/adventures-openbq/openbq-rita:sha-94a5d0e@sha256:14a18321…` lines to `ghcr.io/adventures-openbq/openbq-rita:sha-<R>@<F1 digest>`;
  - `openbq-funnel-gateway:11.0.0-temporal@sha256:0a25c57f…` to the D2 tag `@<D2 digest>`;
  - `openbq-rita`: add `environment:` with `FEEDBACK_PATH: /data/feedback.jsonl` and a volume `- ./rita-feedback/private:/data` beside the `rita-resolv.conf` one;
  - `openbq-rita-door`: add `FEEDBACK_PATH: /data/feedback.jsonl` to its `environment:` and `- ./rita-feedback/door:/data` to its volumes.
  Review `diff` against the fetched copy (only those lines), then `scp "$SCR/compose.yml" nas:$STACK/docker-compose.yml`.

- [ ] **Step 3: Pull, prepare the feedback dirs, start the touched services only**

```bash
ssh nas '<vars>; set -e; cd $STACK;
  DOCKER_CONFIG=$GHCR_CONFIG $DK compose pull openbq-rita openbq-rita-door funnel-gateway
  mkdir -p rita-feedback/private rita-feedback/door
  $DK run --rm --user 0 --entrypoint chown -v $STACK/rita-feedback:/d ghcr.io/adventures-openbq/openbq-rita:sha-<R> -R 1000:1000 /d
  $DK compose up -d --no-deps openbq-rita openbq-rita-door funnel-gateway
  sleep 15; $DK compose ps openbq-rita openbq-rita-door funnel-gateway'
```

(`--no-deps`: `compose up` of a service can otherwise recreate its `tailscale` dependency.)

### Task F3: Verify

- [ ] **Step 1: Private Rita through :10443** (Mac; `N=<nas-ts-name>.<your-tailnet>.ts.net`)

```bash
curl -fsS https://$N:10443/status
curl -fsS https://$N:10443/agents.json | jq '.openbb_agent_rita.features.feedback, [.openbb_agent_rita.features.model.options[].value]'
q() { curl -sN -X POST https://$N:10443/v1/query -H 'content-type: application/json' \
  -d "{\"messages\":[{\"role\":\"human\",\"content\":\"Reply with the single word pong.\"}],\"workspace_options\":{\"model\":\"$1\"}}" | grep -c -i pong; }
q openai:qwen3.6-35b                 # >= 1
q "<an anthropic: id from the list>" # >= 1
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://$N:10443/v1/feedback -H 'content-type: application/json' -d '{"vote":"thumbs_up","trace_id":"nas-verify-private"}'   # 204
ssh nas '<vars>; grep -c nas-verify-private $STACK/rita-feedback/private/feedback.jsonl'   # 1
```

- [ ] **Step 2: The door** — write `$SCR/door-check.mjs`:

```js
import { request } from "node:http";
import { readConfig } from "/app/config.mjs";
const c = readConfig(), base = "http://127.0.0.1:8091", who = "github:900000000001";
const send = (method, path, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const headers = { Host: new URL(c.origin).host, Authorization: `Bearer ${c.token}`, "X-Rita-Principal": who,
    ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) };
  const req = request(base + path, { method, headers }, res => {
    const parts = []; res.on("data", p => parts.push(p));
    res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString() }));
  });
  req.on("error", reject); req.end(data);
});
const q = await send("POST", "/ai/v1/query", { messages: [{ role: "human", content: "Reply with the single word pong." }] });
console.log("query", q.status, /pong/i.test(q.text) ? "pong" : "NO PONG");
console.log("feedback", (await send("POST", "/ai/v1/feedback", { vote: "thumbs_up", trace_id: "nas-verify-door" })).status);
console.log("unknown", (await send("GET", "/ai/v1/other")).status);
let status = 0, n = 0;
while (status !== 429 && n <= c.ritaPerHour) { status = (await send("POST", "/ai/v1/feedback", { vote: "thumbs_up", trace_id: "nas-verify-rate" })).status; n++; }
console.log("rate", status, "after", n);
```

Run: `ssh nas '<vars>; cd $STACK && $DK compose exec -T funnel-gateway node --input-type=module' < "$SCR/door-check.mjs"`
Expected: `query 200 pong`, `feedback 204`, `unknown 404`, `rate 429 after <ritaPerHour - 1>` (the query and first vote already count). This writes up to `ritaPerHour` lines tagged `nas-verify-rate` to the door's file; say so in the report.

Then: `ssh nas '<vars>; grep nas-verify-door $STACK/rita-feedback/door/feedback.jsonl | grep -c "\"principal\":\"github:900000000001\""'` → 1.

- [ ] **Step 3: Gateway self-checks**

```bash
ssh nas '<vars>; cd $STACK;
  $DK compose exec -T funnel-gateway node check-upstreams.mjs && $DK compose exec -T funnel-gateway node verify.mjs'
```

Expected: both PASS.

**Rollback F:** `ssh nas '<vars>; cd $STACK && cp docker-compose-before-rita-feedback-<TS>.yml docker-compose.yml && $DK compose up -d --no-deps openbq-rita openbq-rita-door funnel-gateway'` — restores `openbq-rita@sha256:14a18321e59abdd31c80a9636966c7029a2bef688a1a24492996b45127d4eb79` and `openbq-funnel-gateway:11.0.0-temporal@sha256:0a25c57fadaed56cb0876c679a34bd44c60a3f0d03151faed2df1772fc1b4f96`. The `rita-feedback/` dir is left in place. Then Step 3's checks.

---

## Delivery (stops here)

Nothing is pushed to GitHub. Awaiting the user's delivery authorization:
- BDOBB `claude/v6-agent-conformance` (Adventures-OpenBQ/bdobb, onto `release/v6`).
- agent-rita-bdobb `claude/rita-feedback-quote-boxes` (onto `main`; release tag decision separate).
- openbq-docker `claude/v10-rita-feedback`, `claude/v11-rita-feedback`, and the locally moved `v10.0.0` tag (Q7).

Report: the GHCR tags and digests pushed (F1, D1, D2), the Spark rollback point, the NAS backup timestamp, and the verify-line counts written to the feedback files.
