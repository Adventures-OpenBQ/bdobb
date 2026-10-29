# Validate BDOBB and Rita against the OpenBB example agents

Status: draft for review, 2026-10-28. Home: BDOBB v6.0.0 (`release/v6`) and
`adventures-openbq/agent-rita-bdobb`. Carried to v7 through v10 after v6 is
verified. Also touches Adventures-OpenBQ/openbq-docker v10 (the door's
gateway policy) and the NAS `openbq-stack`. No git push happens until the
user authorizes delivery.

## Intent

`openbq-org/agents-for-openbb` holds one small reference agent per Workspace
agent-protocol feature (examples 30–42). Use them for two checks:

1. **BDOBB as host.** Each example agent is a known-good counterpart. If BDOBB
   drives it and gets the expected events, BDOBB speaks that part of the
   protocol correctly.
2. **Rita as agent.** Extend BDOBB's live suite and run it against a fresh
   agent-rita-bdobb build on the Spark.

Three features that BDOBB and Rita lack are built so that every example has
something to verify: PDF context (35), PDF highlight citations (36) and
feedback (42).

User rulings, 2026-10-28:

- Do both checks.
- Build the missing features rather than record them as gaps.
- Patch Rita for feedback and highlight boxes (new patches 0015 and 0016).
- Use local Qwen on the Spark.
- Replace the Spark's production `rita` with the recipe build.
- The work's home is Adventures-OpenBQ/bdobb `release/v6`.
- Redeploying the NAS `openbq-rita` and `openbq-rita-door` is in scope.
- The public door relays feedback (it does not hide it).

## Findings that shape the design

- The examples are MIT-licensed Python apps built on `openbb-ai`. Each calls
  `openai.AsyncOpenAI()` with `model="gpt-4o"`, and that client reads
  `OPENAI_BASE_URL`.
- Rita's pin (`openbq-org/agent-rita` `f673c1f`) is the head of both upstream
  repos, so there is no newer Rita to adopt. The Spark runs
  `bdobb-dev/agent-rita` `a2aaa91`, which lacks recipe patches 0009–0014.
- Rita already accepts PDF widget data (`data_type: "pdf"`, inline or URL).
  It has no `/v1/feedback`. It types `quote_bounding_boxes` as `null`. It
  ships `unpdf`.
- v6 BDOBB renders PDF cards with pdf.js (`PdfView.tsx`). `execute.ts`
  labels all widget data `{data_type: "object", parse_as: "table"}`.
  `Sources.tsx` only opens citation URLs.
- `pnpm test:live` (`scripts/rita-live-check.sh`) fails on any skipped test.

## 1. Conformance harness

`scripts/agent-conformance.sh`:

1. Clones `agents-for-openbb` at the SHA pinned in the script into
   `.superpowers/agent-conformance/` (gitignored). No example code or payload
   is committed.
2. Creates a venv with `uv`. It installs the examples' `pyproject.toml`
   dependencies and runs Python with `-I`.
3. Starts `scripts/stub-openai.mjs`. This is a Node `http` server, about 40
   lines with no dependencies, that answers `POST /v1/chat/completions` with
   a fixed streamed reply ("stub reply") and `GET /v1/models` with one model.
4. Starts each example on its own loopback port (17730 + example number),
   with `OPENAI_BASE_URL` pointing at the stub and `OPENAI_API_KEY=stub`.
   Example 42 writes `feedback.json` into its scratch clone.
5. Exports `OPENBB_EXAMPLE_AGENTS` as `id=url` pairs and runs
   `src/test/integration/agent-conformance-live.test.ts`.
6. Stops every process on exit (`trap`). As in `rita-live-check.sh`, any
   skip fails the run.

The test drives BDOBB's real `fetchAgentsJson` and `runAgentQuery` with a
synthetic dashboard. It asserts the following for each example:

| Example | Assertion |
|---|---|
| 30 | A `get_widget_data` round trip completes and the reply streams |
| 31 | At least one reasoning-step status arrives before the reply |
| 32 | A citation collection names the primary card's widget |
| 33 | A chart artifact arrives and passes BDOBB's artifact guard |
| 34 | A table artifact arrives and passes the guard |
| 35 | BDOBB sends a PDF card as `data_type: "pdf"`; the example parses it and replies |
| 36 | A citation arrives with `quote_bounding_boxes`, which BDOBB parses into boxes |
| 37 | `agents.json` custom features normalize, and a set feature reaches the request |
| 38 | MCP tool listing is sent, and an `execute_agent_tool` call round-trips |
| 39 | An HTML artifact arrives and passes the guard |
| 40 | Primary and secondary widgets both appear in the example's echo |
| 41 | A skill load round-trips |
| 42 | `features.feedback` is detected, and `sendFeedback` gets a 2xx; `feedback.json` gains the vote |

Every example returns 4xx when pydantic rejects a request. So each passing
row also proves that BDOBB's request validates against `openbb-ai`'s
`QueryRequest`.

When writing the plan, read each example's `main.py` and fix its exact
assertion there. If an example needs a request shape BDOBB doesn't send, the
plan records whether that is a BDOBB defect or an example quirk. The user
decides which.

## 2. PDF context (example 35)

`execute.ts` `get_widget_data`: when the card's widget renders as a PDF (the
same test `WidgetCard` uses to choose `PdfRenderer`), send

```json
{ "content": "<base64 or url>", "data_format": { "data_type": "pdf", "filename": "<name>.pdf" }, "citable": true }
```

Use a URL when the backend served one; otherwise send base64. The existing
`capContent` limit applies to base64. Over the limit, the item is an error
that names the card and the limit, not a truncated PDF.

## 3. PDF highlight citations (example 36)

- Add `quote_bounding_boxes?: BoundingBox[][]` to the citation type, where
  `BoundingBox` is `{ text, page, x0, top, x1, bottom }` in PDF points with a
  top-left origin (pdfplumber's convention).
- Parse it in `events.ts`. Malformed boxes are dropped and the citation is
  kept.
- In `Sources.tsx`, a widget citation that carries boxes renders as a button.
  Clicking it focuses the cited card and opens the boxes' page.
- `PdfView` accepts `highlights` for the current page. It draws absolutely
  positioned overlays, scaled by the viewer's current scale, which pdf.js
  `PDFPageView` exposes. They redraw on zoom. The highlight clears when
  another citation is opened or the card is closed.

## 4. Feedback (example 42)

- `normalizeAgentsJson` keeps `features.feedback === true`.
- When the discovered agent advertises it, each finished AI message in
  `ChatPane` shows thumbs up and thumbs down. Thumbs down opens an optional
  tag list (the Workspace's tags) and a comment field.
- `sendFeedback(agentUrl, payload)` POSTs
  `{ vote, tags, user_comment, ai_response, user_prompt, trace_id }` to
  `{agentUrl}/v1/feedback`. `trace_id` is a client UUID minted once per AI
  message, because Rita sends no trace id on the wire.
- One vote per message. A failure shows inline and the vote can be retried.
- When the agent doesn't advertise feedback, nothing is rendered.

Context Sharing does not gate feedback. Only the prompt and reply the user
rated are sent, and only when the user clicks.

## 5. Rita patches (agent-rita-bdobb)

Each patch follows the recipe's practice: a numbered patch, a line in the
README table, and a `build.sh --check-only` pass.

- **0015 feedback.**
  - `POST /v1/feedback` validates the payload with zod and appends one JSON
    line to `FEEDBACK_PATH` (default `/data/feedback.jsonl`). It returns 204,
    or 400 for a bad body (as 0010 does).
  - Each line also records a receive timestamp and, when present, the
    `X-Rita-Principal` header the door sets (`github:<id>`).
  - `agents.json` advertises `feedback: true`.
  - A unit test runs under `scripts/test-aperture.sh`'s `bun test`.
- **0016 PDF quote boxes.**
  - A `cite_quote` tool takes `{ widget_uuid, quote }`.
  - Rita reads the cited widget's PDF with `unpdf`, normalizes whitespace,
    finds the quote's text items, and records a box per line.
  - `buildWidgetCitations` attaches the boxes to that widget's citation.
    `quote_bounding_boxes` is typed to match §3.
  - A quote that isn't found yields a citation with no boxes and a debug log,
    never an error to the model.
  - The prompt tells the model to call `cite_quote` with a verbatim quote
    when it relies on a PDF.
  - Unit tests use a fixture PDF generated in the test.

## 6. Spark redeploy and live suite

- On the Spark, tag the running image `agent-rita:rollback-20261028` and
  record the compose state.
- Build the recipe (0001–0016) with `scripts/build.sh` as `openbq-rita:6.0.0`.
  Run it as `rita` with the existing `.env`, plus a `FEEDBACK_PATH` volume.
- Verify `/status` and `/agents.json` (`feedback: true`) through the svc name.
- Rollback is the tagged image plus the recorded compose file.
- New live cases go in `rita-live.test.ts` and join `pnpm test:live`:
  1. A PDF card's content is answered from the PDF.
  2. A question about a PDF yields a citation with at least one box.
  3. A feedback vote returns 2xx.
- Pass means `pnpm test:live` reports 0 skipped and 0 failed, with
  `OPENBB_RITA_URL` set to the Spark svc name.

## 7. NAS redeploy and the public door

The NAS deploys by image pin; nothing is built there.

**Rita image:**

- Run `build.sh --check-only` to produce the patched tree.
- Run `docker buildx build --platform linux/amd64 --push` from the Mac. The
  image goes to the private `ghcr.io/adventures-openbq/openbq-rita`, tagged
  `sha-<recipe short sha>` with the recipe's OCI labels.
- The package stays private.

**Gateway change (Adventures-OpenBQ/openbq-docker, home v10, carried to
v11):**

- `funnel-gateway/rita-policy.mjs` relays `POST /ai/v1/feedback` to the door
  upstream with the caller's `X-Rita-Principal`, the same way it relays
  queries.
- Feedback requests count against the principal's `ritaPerHour` budget. They
  do not take a concurrent-turn slot.
- The body is capped at 64 KB, and any other `/ai/v1/*` path stays refused.
- `agents.json` passes through unchanged, so `feedback: true` reaches web
  users.
- Tests go in the gateway's existing policy tests. The fix re-cuts
  `openbq-funnel-gateway:10.0.0` and od v10.0.0, following the vN.0.0 rule.

**Deploy on the NAS `openbq-stack`:**

1. Back up the compose file and the Rita env files with a timestamp suffix,
   as earlier Rita swaps did.
2. Repin `openbq-rita`, `openbq-rita-door` and the gateway.
3. Add a `FEEDBACK_PATH` volume to each Rita service, with separate files for
   the private Rita and the door.
4. Run `compose pull`, then `up -d` on those services only. Pulls use
   `DOCKER_CONFIG=<nas-compose-dir>/.docker`.

**Verify:**

- Through :10443: `/status`, `agents.json` (`feedback: true`), a Qwen turn
  and a Claude turn.
- Through the door: a query, a feedback POST that returns 204 and lands with
  the principal, a refused unknown path, and the rate limit applied.
- Then `check-upstreams` and `verify` pass.

**Rollback:** the backed-up compose file and the prior digests
(`openbq-rita@sha256:14a18321…`, gateway `sha256:aea29572…`).

## Out of scope

- Examples 20 and 99: these are not protocol features.
- Carrying the work to v7–v10. That follows v6 verification, as its own
  plan.
- Pushing git branches or tags to GitHub before the user authorizes it.
  Private GHCR image pushes for §7 happen at the deploy step, which is its
  own approval checkpoint.

## Testing

- **Unit:** the PDF data format, the citation-box parser, overlay scaling,
  `sendFeedback`, and feedback-button visibility.
- **Conformance:** `scripts/agent-conformance.sh`, 13 examples, no skips.
- **Live:** `pnpm test:live` against the redeployed Spark Rita.
- **NAS:** the §7 verify list, plus the gateway's policy tests.
- **Gates:** the v6 repo's existing typecheck, unit, build and e2e gates.
