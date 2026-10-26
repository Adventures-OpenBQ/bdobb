# Engine-grounded Rita table summaries implementation plan

> Implement natively in this chat, as authorized. Use executing-plans and test-driven-development.

Goal: successful local table results, warnings and Undo state are rendered from engine data, never model arithmetic.
Architecture: executeFunction computes private client metadata before result capping. Query strips metadata from persisted/upstream history, keeps executing the workflow, and emits a client-only replacement summary event. Chat store replaces current-turn prose with that summary. No tools execute automatically and no mutations change.
Tech: existing TypeScript, Vitest, Rita SSE protocol and Markdown UI.
Spec: user approved engine-rendered table summaries after three free-model guidance cycles remained18/19.

Constraints: retain one-arrange-call acceptance, preview non-mutation, exact source count only from describe_table, warning and Undo provenance, Context Sharing privacy, remote MCP behavior, existing streaming for non-table chat. No Claude/Luna calls; V11 paused; no release promotion.

Review focus: large capped tool results; untrusted labels/Markdown; mixed/multi-table workflows; failed/cancelled calls after successful changes; metadata leaking upstream or into persisted history.

## Task 1 — trusted result formatting
Files: agent/tableResultSummary.ts(+test), agent/types.ts, agent/execute.ts(+test), tiny local server-id constant module if needed to avoid import cycles.
- Write failing tests for applied/preview/refused/unchanged results, actual engine warnings and Undo, escaping cells, omitted/truncated rows, malformed values, remote server spoof, exact count.
- Run red; implement pure formatter and client metadata capture before toolResultData capping.
- Keep private metadata out of generic upstream/persisted tool messages.
- Run focused tests and typecheck; commit.

## Task 2 — final presentation and workflow
Files: agent/query.ts(+test), stores/chatStore.ts(+tests), Rita live fixture.
- Write failing query test: model emits a false1185, engine returns360/210/615; final presented summary contains only engine values. Retain complete tool history with no metadata leak.
- Add client-only tableSummary event and consumer handling; live fixture consumes it exactly as chat store does. Original19 assertions remain, including exactly one arrange_table call.
- Continue function rounds; preserve multiple table results and errors, cancellation, round limits and read-only labels. Do not stop a multi-table workflow after its first result.
- Keep non-table streaming unchanged. Render status/errors from actual tool results; no claim an incomplete mixed workflow completed.
- Run focused query/chat/table suites, independent review, and static checks; commit.

## Task 3 — qualification
- Run clean full suite with source held fixed; retain prior failed-cycle evidence.
- Run one full free Qwen19 cycle after fixes; DeepSeek availability already billing blocked, no repeated billing probes or paid inference.
- Rebuild Mac and signed iPad from final source; verify source snapshot identity.
- Verify cold discovery and recorded native stream/persistence; retain earlier native Files/sync evidence with exact source scope.
- Push candidate only; verify releases/tags unchanged; update V10 record honestly. Signoff only if required gates pass.

## Concrete interfaces and rulings
- Add ClientTableResult metadata to tool AgentMessage only: inspection {kind, cardId, sourceRows?}; result {kind, cardId, text, ending}. executeFunction creates it from raw local describe_table/arrange_table results BEFORE100k result capping. It is never sent to Rita or persisted: query destructures it away before history.push.
- Pure tableResultSummary.ts owns formatting and trusted local-call recognition. Move reserved LOCAL_TOOL_SERVER_ID into a tiny dependency-free module and re-export it from localTools to avoid a query/localTools/store import cycle.
- Query remembers exact source count per card from actual describe_table completeness (safe nonnegative integer and exact kind only). Every arrange result gets a canonical result panel; preserve failures/refusals and applied/preview/unchanged distinctions. No arithmetic or grand totals are synthesized.
- New client-only AgentEvent tableSummary {text} replaces streamed model prose for the current turn after an engine result. Subsequent model chunk events are suppressed once engine-result presentation starts; statuses/errors/tool calls continue and the model may continue a multi-table workflow. Re-emit the accumulated canonical panels as results arrive; do not short-circuit after the first table call.
- Chat store removes only current-turn AI string messages, preserving artifact objects and prior conversation, then inserts engine summary; calls/transcript remain intact. Rita table live fixture consumes tableSummary as the production store does; all existing numeric/mutation/call-count assertions remain unchanged.
- Bound output by rows/columns/cell lengths and total characters; use generic omission notices without invented numeric counts. Escape Markdown metacharacters and HTML in labels, values and warnings.
- Applied status may say Undo available only for actual result.undo=available. Preview ends Nothing was changed. Refusal/failed status must not claim a commit; unchanged must not invent Undo. Recalculating flag remains explicit.
- Normal non-table SSE streaming stays unchanged. Metadata is accepted only for execute_agent_tool on bdobb-local with the matching describe_table/arrange_table call; remote MCP cannot spoof client summaries.
- Scope: successful table-result summaries are deterministic. Inspection-only analytical prose is not automatically replaced, preserving the existing refusal-in-prose behavior for unsummable text columns.

Ruling (user approved): Table-result turns show engine-only results and a visible notice that other explanations require a separate message. Tool execution/artifacts/history continue; inspection refusals after an arrangement are canonical panels. Arbitrary mixed explanatory prose is intentionally omitted. Preserve completed tool history when Stop interrupts the next model round.
