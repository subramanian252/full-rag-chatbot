# Backend changes for the LazyChat interface

The original FastAPI / LangGraph / SQLAlchemy / FAISS architecture, system prompt, tools, model allowlist, and checkpoint implementation remain the foundation of this project. The frontend uses the existing API routes. It adds no Node server in production.

## What changed and why

| File | Change | Reason |
| --- | --- | --- |
| `app.py` | Import `json` and `StreamingResponse`; retain text streaming and emit status, completion, and usage events | Make the existing streaming route work with the frontend |
| `app.py` | Rename the history route handler | Fix its collision with the imported `get_chat_history` database helper |
| `app.py` | Serve `frontend/dist/index.html`, `/assets`, and the favicon | Serve the built React application from FastAPI |
| `app.py` | Add `GET /models` and `GET /usage` | Expose the existing model allowlist and recorded workspace totals |
| `app.py` | Return message IDs, usage, model, and document name with history | Restore conversation details after reopening or refreshing |
| `app.py` | Validate message input, conversation IDs, and uploads; limit uploads to 20 MB | Give the frontend clear errors and keep path construction inside the runtime directories |
| `app.py` | Move embedding work into a worker thread; stage uploads before replacement | Keep the API responsive during document processing |
| `app.py` | Prevent overlapping requests to the same thread; save measured usage on failures | Avoid conflicting checkpoints and silently lost usage |
| `agent.py` | Instantiate `UsageChatOpenAI` with streaming usage enabled | Preserve provider usage through the existing agent graph |
| `usage.py` (new) | Small `ChatOpenAI` adapter and per-turn callback | Keep the extra OpenRouter `cost` field and sum all model calls, including tool loops |
| `database.py` | Add a `message_usage` table and small read/write/aggregation helpers | Persist usage without changing or deleting existing chat columns |
| `tools.py` | Read thread IDs from LangChain's injected `RunnableConfig` | Avoid the shared global thread value mixing up concurrent conversations |
| `tools.py` | Alias the database memory-search function and return its string directly | Fix the function-name collision and character-by-character joining |
| `rag.py` | Wrap text-based uploads in LangChain `Document` objects | Make TXT, Markdown, CSV, and DOCX inputs compatible with the existing splitter |

The old `set_current_thread` helper remains for compatibility, but the frontend route no longer relies on it. No existing conversations are deleted. The additive `message_usage` table is created by the existing `init_db()` flow.

## Latest iteration: minimal approval integration, block by block

Only **`app.py`** changed in the Python backend during the portfolio-theme/approval iteration. There are no new database tables, changes to the agent graph, or edits to the existing `buy_stocks` tool in this iteration.

1. **Checkpoint reading — `pending_interrupts` and the history route.** Read `graph.get_state(...)` using the conversation's thread ID and return each pending interrupt's ID and payload. SQLite checkpoints remain the source of truth, so an approval survives a page refresh or server restart.
2. **Request fields — `ChatRequest`.** Add an optional strict Boolean `approval` and an `interrupt_id`. A normal chat still requires nonblank text; a decision does not need a new message.
3. **Resume validation — the start of `chat_stream`.** Under the existing per-conversation guard, check that the supplied ID is still pending. Reject stale/duplicate decisions and ordinary messages that would bypass a pending decision with HTTP 409. For resumes, use the last recorded model instead of a client-selected replacement.
4. **Graph input.** Ordinary messages still use `HumanMessage`. Decisions use `Command(resume={interrupt_id: {"approved": "yes" or "no"}})`, matching your existing tool's contract. The original user message is not added again. LangGraph resumes the saved execution; an interrupted node may execute again up to its interrupt point, so code before an interrupt must be safe to repeat.
5. **Tool event forwarding — the existing updates stream.** Read tool calls from agent updates and results from `ToolMessage`. Send plain `tool` SSE events for the UI and save a compact trace in the existing usage JSON. Results are truncated to 1,000 characters for display. No extra model requests are made for the trace.
6. **Pause completion and usage.** Let the graph finish saving its checkpoint, then emit a terminal `interrupt` event instead of treating the pause as a failure. Save the paused segment's measured usage and mark waiting tools as paused. A resumed segment records the human decision and its additional model usage separately. The existing conversation totals combine the segments.

These changes expose your existing LangGraph `interrupt()` mechanism to the frontend. They do not add arbitrary provider cancellation or change the lock implementation. The existing guard also protects resume requests from overlapping within the same conversation.

Approval/decline, durable checkpoint reload, stale IDs, strict Boolean validation, saved-model selection, and usage totals are covered by offline integration tests using the real agent graph. Frontend tests cover both buttons, restored pending state, visible tool output, and rejected resumes.

## Usage semantics

- A reply's usage covers its execution segment, including model calls before and after tools. A human approval pause ends one segment; resuming creates another. Conversation totals sum both segments.
- Counts and costs are provider-reported. There is no local token estimate or hard-coded price table.
- A missing cost is `null`, rendered as an em dash. An explicitly reported zero is displayed as `$0.00`.
- Incomplete provider reporting is labeled partial. Existing conversations have no retroactive billing data.
- Document embeddings and external tool fees are outside these chat totals.
- Completed calls on failed turns remain recorded. A disconnected or failed in-flight provider call may not report its usage; the UI cannot reconstruct unreported charges.
- OpenRouter documentation: [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

## Validation

`tests/test_api.py` exercises the actual LangChain streaming adapter, the real LangGraph tool loop using a mocked HTTP provider, SQLite history/usage persistence, failed replies, request validation, and text uploads. Tests use temporary runtime directories and an isolated SQLite database. API keys are placeholders and tracing is disabled.

`frontend/src/api.test.ts` covers fragmented UTF-8/SSE input, CRLF frames, truncated streams, and missing versus zero costs.

`frontend/src/App.test.tsx` exercises sending and rendering a reply, opening and resetting history, searching conversations, document attachment, and request-error recovery in a simulated DOM. These are automated interaction checks, not visual browser tests.

## Remaining boundaries

This remains a personal-workspace application without account authentication. Keep one Uvicorn worker with the current SQLite/checkpoint setup. The demonstration stock-purchase tool now pauses for an explicit Approve/Decline decision and resumes the saved checkpoint. No real brokerage action occurs. Model availability continues to depend on the configured provider.

Backend integration changes and frontend implementation were AI-assisted under Subramanian's supervision. The original backend was implemented by Subramanian.
