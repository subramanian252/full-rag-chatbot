# LazyChat

LazyChat is a single-user AI engineering portfolio application built with FastAPI, LangGraph, React, Amazon RDS for PostgreSQL, Pinecone, and OpenRouter. It demonstrates streaming chat, visible tool calls, document retrieval, provider-reported usage, durable checkpoints, and human approval before a simulated stock purchase.

## Features

- Streams model output from FastAPI to React with server-sent events.
- Supports multiple OpenRouter chat models without exposing API keys to the browser.
- Stores conversations, messages, usage, memories, and LangGraph checkpoints in Amazon RDS for PostgreSQL.
- Stores document embeddings in a conversation-specific Pinecone namespace.
- Restores pending human approvals from the saved LangGraph checkpoint after a reload.
- Shows tool arguments, results, token totals, and reported cost in the interface.
- Accepts PDF, TXT, Markdown, CSV, and DOCX documents up to 4 MB.

The stock-purchase tool is a simulation and never places a real trade.

## Project structure

```text
app.py                 FastAPI entrypoint and API routes
agent.py               LangGraph agent, prompt, and model allowlist
database.py            RDS PostgreSQL-backed application data
memory.py              RDS PostgreSQL-backed LangGraph checkpoints
rag.py                 Pinecone document ingestion and retrieval
tools.py               Agent tools and HITL demonstration
usage.py               Provider usage collection
frontend/              React and Vite source
public/                Generated frontend build; not committed
tests/                 Backend integration tests
vercel.json            Vercel Function configuration
pyproject.toml          Python dependencies and Vercel build command
```

## Required environment variables

Copy `.env.example` to `.env` for local development and fill in the values. Do not expose these values through `VITE_` variables.

| Variable | Purpose |
| --- | --- |
| `EXTERNAL_DATABASE_URL` | Amazon RDS PostgreSQL connection string for application data and checkpoints |
| `OPENROUTER_API_KEY` | Chat completions and document embeddings |
| `PINECONE_DB` | Pinecone API key |
| `TAVILY_API_KEY` | Web-search tool |
| `OPENWEATHER_API_KEY` | Optional current-weather tool |
| `ALPHAVANTAGE_API_KEY` | Optional stock-price tool |

Configure every required value in the Vercel project's Environment Variables settings. The RDS instance must accept TLS connections from the deployed application.

The Pinecone index is named `llmrag` and uses 1,536-dimensional cosine vectors. The application creates it in AWS `us-east-1` when it does not already exist.

## Run locally

Requirements: Python 3.13, `uv`, Node.js, and npm.

```powershell
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. The frontend build is written to `public/` and served by FastAPI. For frontend development, keep FastAPI running and use:

```powershell
npm --prefix frontend run dev
```

Vite runs at `http://127.0.0.1:5173` and proxies API requests to FastAPI.

## Deploy to Vercel

Vercel detects the `app` exported from `app.py` as one FastAPI Function. The build command in `pyproject.toml` installs the frontend packages and writes the production UI to Vercel's `public/` directory.

1. Create a Vercel project from this repository with the repository root as the Root Directory.
2. Leave the Framework Preset and Output Directory on their automatically detected defaults.
3. Add the required environment variables listed above for Production and Preview.
4. Deploy from the dashboard, or deploy from the project root with:

```powershell
vercel
vercel --prod
```

`vercel.json` enables Fluid compute and includes the generated frontend in the FastAPI Function, while `.vercelignore` keeps local and development files out of the deployment.

Vercel Functions accept request bodies up to 4.5 MB, so LazyChat enforces a 4 MB document limit to leave room for multipart encoding. Uploaded bytes are sent to Pinecone after parsing; no durable upload directory is used.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/` | Built React application |
| GET | `/models` | Available OpenRouter models |
| GET | `/conversations` | Saved conversations |
| GET | `/chat/{thread_id}` | Messages, usage, and pending interrupts |
| POST | `/chat/stream` | Stream a chat turn or resume an approval |
| POST | `/upload?thread_id=<id>` | Parse and index a document |
| GET | `/usage` | Workspace usage totals |

During a live request, an HITL pause arrives in the streamed `interrupt` event and renders immediately. `GET /chat/{thread_id}` restores that pending interrupt only when an existing conversation is opened or the page is reloaded.

## Models

- GPT-4o
- GPT-4o mini
- GPT-4 Turbo
- GPT-3.5 Turbo
- Gemini 3.1 Flash Lite
- Qwen3 30B A3B
- Mistral Small 3.2
- DeepSeek V3.1

Actual availability and pricing are controlled by OpenRouter.

## Checks

```powershell
python -m py_compile app.py agent.py database.py memory.py rag.py tools.py usage.py
npm --prefix frontend test -- --run
npm --prefix frontend run build
```

## Deployment boundary

This is intentionally a single-user demonstration without authentication. Durable state is externalized to Amazon RDS for PostgreSQL and Pinecone, but the in-process overlap guard is instance-local and is not a distributed lock. Add authentication, per-user ownership, rate limiting, and a distributed request lock before turning it into a multi-user service.
