# LazyChat — Stateful AI Assistant with Visible Tool Use

[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Stateful_Agent-1C3C3C)](https://langchain-ai.github.io/langgraph/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?logo=vercel)](https://full-rag-chatbot.vercel.app/)

LazyChat is a full-stack AI engineering portfolio project built around a stateful LangGraph agent. It streams responses and tool activity to a React interface, retrieves information from uploaded documents, records provider-reported token usage and cost, preserves conversations in PostgreSQL, and pauses sensitive tool actions for explicit human approval.

**Live application:** [full-rag-chatbot.vercel.app](https://full-rag-chatbot.vercel.app/)

The stock-purchase workflow is a demonstration. It never places a real trade.

## Highlights

- Token-by-token responses over Server-Sent Events (SSE).
- Visible tool calls, arguments, status, and results while the graph runs.
- Durable Human-in-the-Loop approval powered by LangGraph `interrupt()`.
- Pending approvals restored from PostgreSQL checkpoints after a reload.
- Retrieval-Augmented Generation (RAG) for PDF, TXT, Markdown, CSV, and DOCX files.
- Conversation-isolated Pinecone namespaces for document vectors.
- Amazon RDS for PostgreSQL for conversations, messages, memories, usage, and graph checkpoints.
- Multiple OpenRouter chat models selectable from the browser.
- Provider-reported input tokens, output tokens, total tokens, and cost.
- Conversation and workspace usage summaries.
- Responsive React interface with Markdown rendering, chat history, search, copy, and export.
- Vercel deployment with the compiled frontend bundled into the FastAPI Function.

## Architecture

```text
Browser / React UI
  │
  ├── POST /chat/stream ─────────────── SSE tokens, tools, usage, interrupts
  ├── POST /upload ──────────────────── document ingestion
  └── GET history / usage / models ─── persisted application state
          │
          ▼
FastAPI application
  │
  ├── LangGraph agent
  │     ├── OpenRouter chat model
  │     ├── ToolNode
  │     └── Human approval interrupt
  │
  ├── Amazon RDS for PostgreSQL
  │     ├── conversations and messages
  │     ├── usage and long-term memories
  │     └── LangGraph checkpoints
  │
  └── Document RAG pipeline
        ├── OpenRouter embeddings
        └── Pinecone vector index
```

### Chat request flow

```mermaid
sequenceDiagram
    participant U as User / React
    participant API as FastAPI
    participant G as LangGraph
    participant LLM as OpenRouter
    participant DB as Amazon RDS

    U->>API: POST /chat/stream
    API->>DB: Save user message
    API->>G: Stream graph with thread_id
    G->>LLM: Generate or select a tool
    LLM-->>G: Tokens / tool call / usage
    G-->>API: Message and graph updates
    API-->>U: SSE token and tool events
    G->>DB: Save graph checkpoint
    API->>DB: Save assistant message and usage
    API-->>U: done event with usage summary
```

### Human approval flow

```mermaid
flowchart TD
    A[User requests a simulated stock purchase] --> B[Agent calls buy_stocks]
    B --> C{{LangGraph interrupt}}
    C --> D[Checkpoint saved in PostgreSQL]
    D --> E[React renders Approve and Decline]
    E -->|Approve| F[Resume the named interrupt with yes]
    E -->|Decline| G[Resume the named interrupt with no]
    F --> H[Return simulated purchase result]
    G --> I[Return cancellation result]
```

## How the agent works

The agent is a compact LangGraph loop with two nodes:

1. `chatbot` sends the system prompt and conversation state to the selected OpenRouter model.
2. `tools` executes requested tools through LangGraph's `ToolNode`.
3. `tools_condition` either routes the result back to the model or ends the turn.
4. `PostgresSaver` checkpoints the graph under the browser's conversation `thread_id`.

Compiled graphs are cached per model. Every request supplies its `thread_id` as LangGraph configurable state, keeping conversations, RAG namespaces, memories, and approvals isolated from one another.

## Tools

| Tool | Purpose |
| --- | --- |
| Tavily search | Researches current or changing information on the web. |
| Weather | Reads current city weather from OpenWeather. |
| Calculator | Evaluates exact arithmetic and supported math operations. |
| Date and time | Returns the server's current date or time. |
| Stock price | Reads market data from Alpha Vantage. |
| Document retriever | Searches the current conversation's Pinecone namespace. |
| Simulated stock purchase | Demonstrates a durable Human-in-the-Loop interrupt. |
| Save memory | Stores a conversation-scoped memory in PostgreSQL. |
| Search memory | Retrieves recent stored memories for the conversation. |

Tool activity is not hidden behind a loading spinner. The API emits tool events containing the tool name, arguments, running/completed state, and a bounded result preview; the frontend renders that trail above the final answer.

## Document RAG pipeline

```mermaid
flowchart LR
    A[PDF / TXT / MD / CSV / DOCX] --> B[FastAPI upload validation]
    B --> C[Extract text]
    C --> D[Recursive text splitting]
    D --> E[OpenRouter embeddings]
    E --> F[(Pinecone index: llmrag)]
    F --> G[Namespace = conversation thread_id]
    G --> H[Similarity search]
    H --> I[Retriever tool]
    I --> J[Grounded answer]
```

- Maximum upload size: **4 MB**.
- Chunk size: **1,000 characters** with **200 characters** of overlap.
- Vector index: `llmrag`.
- Vector dimensions: **1,536**.
- Similarity metric: **cosine**.
- Pinecone serverless region: AWS `us-east-1`.
- Default retrieval count: **3 chunks**.

The uploaded file is processed from request bytes. PDF and DOCX parsing uses a temporary file only for extraction; the temporary file is removed immediately. No durable local upload directory is required. Embeddings are stored under the conversation `thread_id`, so document retrieval remains scoped to the active chat.

## Persistence model

Amazon RDS for PostgreSQL is the application's source of durable state.

| Data | Storage | Purpose |
| --- | --- | --- |
| Conversation metadata | `conversations` table | Thread title and created/updated timestamps. |
| Chat history | `chat_messages` table | Ordered user and assistant messages. |
| Long-term memory | `long_term_memory` table | Conversation-scoped memories available to agent tools. |
| Usage | `message_usage` table | Model, tokens, cost, tool calls, and completion status per turn. |
| Agent state | LangGraph checkpoint tables | Graph messages, pending interrupts, and resumable state. |
| Document vectors | Pinecone | Embedded chunks in a namespace matching the thread ID. |

Database connections require TLS. If the RDS URL does not already include `sslmode`, the application appends `sslmode=require`.

## Streaming event contract

`POST /chat/stream` responds with `text/event-stream`. The frontend handles these event types:

| Event | Meaning |
| --- | --- |
| `status` | Short progress text, such as tool-call preparation. |
| `tool` | Tool name, arguments, result, and running/completed/error/paused status. |
| `token` | A streamed assistant text fragment. |
| `interrupt` | The graph paused and supplied one or more approval requests. |
| `done` | The turn completed with message ID, model, and usage totals. |
| `error` | The turn stopped before a complete response was produced. |

The backend filters tool-call chunks out of the visible assistant text while preserving them as structured tool events. If a turn fails or the client disconnects, measured usage and partial response data are still saved as an incomplete turn when possible.

## Usage accounting

LazyChat preserves the billing metadata returned by OpenRouter during streaming. A callback aggregates every model call made during one agent turn, including additional calls after a tool result.

Stored metrics include:

- input tokens;
- output tokens;
- total tokens;
- provider-reported cost in USD;
- measured and missing model-call counts;
- whether cost information is complete;
- tool calls and their final status;
- HITL approval or decline decision.

Conversation totals are calculated from that thread's usage rows. Workspace totals are aggregated directly in PostgreSQL rather than loading every row into Python.

## Models

The current model allowlist is exposed through `GET /models`:

| Provider | Model |
| --- | --- |
| OpenAI | GPT-4o |
| OpenAI | GPT-4o mini |
| OpenAI | GPT-4 Turbo |
| OpenAI | GPT-3.5 Turbo |
| Google | Gemini 3.1 Flash Lite |
| Qwen | Qwen3 30B A3B Instruct |
| Mistral AI | Mistral Small 3.2 |
| DeepSeek | DeepSeek Chat V3.1 |

Availability, routing, and pricing are controlled by OpenRouter and may change independently of this repository.

## Technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Agent runtime | LangGraph + LangChain | Stateful model/tool loop, streaming, checkpoints, and interrupts. |
| Model gateway | OpenRouter | Chat completions, streaming usage metadata, and embeddings. |
| Backend | FastAPI + Uvicorn | HTTP routes, validation, SSE, file upload, and static frontend serving. |
| Relational persistence | Amazon RDS for PostgreSQL | Chat data, memories, usage, and graph checkpoints. |
| ORM / driver | SQLAlchemy + Psycopg | Application queries and PostgreSQL connectivity. |
| Vector store | Pinecone | Conversation-scoped document embeddings and similarity search. |
| Frontend | React 19 + TypeScript | Conversation UI, streaming updates, approvals, and usage views. |
| Build tooling | Vite | Frontend development server and optimized production build. |
| Markdown | React Markdown + remark-gfm | Assistant response and table rendering. |
| Icons | Lucide React | Interface icon system. |
| Deployment | Vercel FastAPI runtime | Git-connected production deployment. |
| Testing | unittest + Vitest + Testing Library | Backend and frontend behavior checks. |

## Project structure

```text
.
├── app.py                     # FastAPI routes, SSE stream, upload, and HITL resume
├── agent.py                   # LangGraph agent, system prompt, and model allowlist
├── database.py                # SQLAlchemy models and RDS-backed application data
├── memory.py                  # PostgreSQL LangGraph checkpointer
├── rag.py                     # Parsing, embeddings, Pinecone indexing, and retrieval
├── tools.py                   # Agent tools and simulated approval workflow
├── usage.py                   # OpenRouter streaming usage and cost collection
├── db_test.py                 # Simple database round-trip timing utility
├── frontend/
│   ├── src/App.tsx            # Main React application and client state
│   ├── src/api.ts             # HTTP and SSE helpers plus shared API types
│   ├── src/ToolActivity.tsx   # Visible tool trail
│   ├── src/LazyBot.tsx        # Assistant brand component
│   └── vite.config.ts         # Dev proxy and production output configuration
├── tests/test_api.py          # Backend integration and graph behavior tests
├── pyproject.toml             # Python dependencies and Vercel build command
├── vercel.json                # FastAPI function and frontend bundle settings
└── uv.lock                    # Locked Python dependency graph
```

The generated `public/` frontend build is intentionally not committed. Vite writes it during local or Vercel builds.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serves the compiled React application. |
| `GET` | `/favicon.svg` | Serves the application icon. |
| `GET` | `/models` | Returns the selectable model allowlist. |
| `GET` | `/conversations` | Returns saved conversations ordered by recent activity. |
| `GET` | `/usage` | Returns database-aggregated workspace usage. |
| `GET` | `/chat/{thread_id}` | Restores messages, usage, model, and pending interrupts. |
| `POST` | `/upload?thread_id={id}` | Parses and indexes one supported document. |
| `POST` | `/chat/stream` | Starts a chat turn or resumes a pending approval over SSE. |

### Start a chat turn

```http
POST /chat/stream
Content-Type: application/json

{
  "message": "Use your calculator to compute (1250 * 1.18) / 12.",
  "thread_id": "7e952f60-1f51-4ec5-a68c-8dd17a4abfe1",
  "model": "openai/gpt-4o-mini"
}
```

### Resume an approval

```http
POST /chat/stream
Content-Type: application/json

{
  "thread_id": "7e952f60-1f51-4ec5-a68c-8dd17a4abfe1",
  "model": "openai/gpt-4o",
  "interrupt_id": "interrupt-id-returned-by-the-stream",
  "approval": true
}
```

The backend verifies that the supplied interrupt ID is still pending. A stale or repeated click cannot accidentally approve a different action.

## Quick start

### Prerequisites

- Python 3.13+
- [`uv`](https://docs.astral.sh/uv/)
- Node.js and npm
- An accessible PostgreSQL database
- OpenRouter, Pinecone, and Tavily credentials

### 1. Install dependencies

```powershell
uv sync --locked
npm --prefix frontend ci
```

### 2. Configure environment variables

Create a local `.env` file. Do not expose server credentials through `VITE_` variables.

```dotenv
EXTERNAL_DATABASE_URL=postgresql://user:password@host:5432/database
OPENROUTER_API_KEY=your_openrouter_key
PINECONE_DB=your_pinecone_key
TAVILY_API_KEY=your_tavily_key

# Optional tools
OPENWEATHER_API_KEY=your_openweather_key
ALPHAVANTAGE_API_KEY=your_alphavantage_key
```

| Variable | Required | Used for |
| --- | --- | --- |
| `EXTERNAL_DATABASE_URL` | Yes | Amazon RDS PostgreSQL application data and LangGraph checkpoints. |
| `OPENROUTER_API_KEY` | Yes | Chat completions and document embeddings. |
| `PINECONE_DB` | Yes | Pinecone vector index access. |
| `TAVILY_API_KEY` | Yes | Web-search tool. |
| `OPENWEATHER_API_KEY` | No | Current-weather tool. |
| `ALPHAVANTAGE_API_KEY` | No | Stock-price tool. |

### 3. Build the frontend

```powershell
npm --prefix frontend run build
```

Vite writes the production application to `public/`, where FastAPI serves it.

### 4. Start FastAPI

```powershell
uv run uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Frontend development mode

Keep FastAPI running, then start Vite in a second terminal:

```powershell
npm --prefix frontend run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies application API routes to FastAPI on port `8000`.

## Deploy to Vercel

The repository is configured for Vercel's FastAPI runtime. The deployment process is:

```text
Push to GitHub main
  → Vercel detects the FastAPI project
  → uv installs the locked Python environment
  → npm builds the React application into public/
  → public/** is included in the FastAPI function bundle
  → Vercel promotes the deployment to the production alias
```

To deploy another project instance:

1. Import the GitHub repository into Vercel.
2. Use the repository root as the project Root Directory.
3. Select the FastAPI framework preset if it is not detected automatically.
4. Add all required environment variables for Production and Preview.
5. Ensure the RDS instance accepts TLS connections from the deployed runtime.
6. Deploy from GitHub, the Vercel dashboard, or the CLI:

```powershell
vercel
vercel --prod
```

`vercel.json` enables Fluid compute, sets the FastAPI Function duration, and includes `public/**` in the function bundle. `.vercelignore` excludes local and development-only files.

Vercel request bodies are limited, so LazyChat caps document uploads at 4 MB to leave room for multipart encoding.

## Testing and verification

Run the complete local checks:

```powershell
uv run python -m unittest discover -s tests -v
npm --prefix frontend test -- --run
npm --prefix frontend run build
python -m py_compile app.py agent.py database.py memory.py rag.py tools.py usage.py
```

The test suite covers:

- multi-call usage aggregation and missing-cost handling;
- preservation of streamed provider usage;
- persisted chat history and per-message usage;
- invalid requests and overlapping-request protection;
- tool-loop usage across multiple model calls;
- approval and decline after checkpoint reload;
- supported upload formats and validation;
- partial usage retention on failed streams;
- document construction before vector indexing;
- frontend document-upload behavior and success feedback.

For a direct database latency check:

```powershell
python db_test.py
```

## Frontend behavior

- A new browser chat starts with a generated UUID thread ID.
- Opening a saved conversation loads messages, usage, the previous model, and pending approvals once.
- The active URL uses `?chat={thread_id}` so a conversation can be restored after reload.
- SSE updates append assistant tokens without polling the full conversation.
- Tool calls are shown as structured activity rather than mixed into assistant prose.
- A successful document upload displays a temporary confirmation and prepares a suggested summary prompt.
- While an approval is pending, regular input is locked until the user approves or declines.
- Conversations can be exported as Markdown.
- The usage panel can switch between the current conversation and the complete workspace.

## Design boundaries

This repository is intentionally a **single-user demonstration**, not a multi-tenant SaaS product.

- There is no authentication or authorization layer.
- Conversation IDs are treated as application identifiers, not security boundaries.
- The active-request guard is process-local and is not a distributed lock.
- External API availability and model behavior are outside the application's control.
- The stock-purchase tool is simulation-only.
- Before adapting this into a multi-user service, add identity, per-user ownership, rate limiting, distributed coordination, audit logging, and explicit data-retention controls.

## License

No license has been added yet. Add an appropriate license before redistributing the project.
