# Full Chatbot

A Python chatbot backend built with FastAPI, LangGraph, and LangChain. It connects to language models through OpenRouter, stores conversations in SQLite, and uses FAISS to retrieve information from uploaded documents.

The project is under development. The homepage is currently a placeholder, and several backend paths need fixes before the full chat workflow works. See [Current limitations](#current-limitations).

## Capabilities

- A LangGraph agent that can call tools and retain conversation checkpoints.
- A chat endpoint designed to stream responses using server-sent events (SSE).
- Conversation history and long-term memory stored in SQLite.
- Document upload and retrieval using embeddings and a FAISS index per conversation.
- Tools for Tavily web search, weather, stock quotes, calculations, and local date/time.
- A demonstration stock-purchase tool with an approval interrupt; it does not place real trades.

## Project structure

```text
full-chatbot/
|-- app.py                    # FastAPI application and HTTP endpoints
|-- agent.py                  # Model configuration and LangGraph tool loop
|-- tools.py                  # Agent tools and current-conversation context
|-- database.py               # SQLAlchemy models and database helpers
|-- memory.py                 # SQLite-backed LangGraph checkpoints
|-- rag.py                    # Document loading, embeddings, and FAISS retrieval
|-- templates/
|   `-- index.html            # Placeholder homepage
|-- src/
|   `-- full_chatbot/
|       `-- __init__.py       # Starter package / console entry point
|-- pyproject.toml            # Project metadata and dependencies
|-- uv.lock                   # Locked dependency versions for uv
|-- requirements.txt          # Separate dependency list; less complete than pyproject.toml
|-- .python-version           # Python 3.13
|-- .gitignore
`-- README.md
```

The application creates local runtime directories as needed:

| Location | Contents |
| --- | --- |
| `data/chatbot_memory.db` | Conversations, messages, and long-term memories |
| `<CHATBOT_DATA_DIR>/checkpointer.db` | LangGraph conversation checkpoints |
| `uploads/` | Uploaded documents |
| `faiss/FAISS_<thread_id>/` | Saved document indexes |

These generated files are excluded from Git. `CHATBOT_DATA_DIR` only changes the checkpoint location; it does not move the conversation database, uploads, or indexes.

## Local setup

### Requirements

- Python 3.13 or later; the repository selects 3.13.
- The `uv` package manager.
- An OpenRouter API key for chat and document embeddings.
- A Tavily API key for the search tool, which is initialized when the app starts.

Run all commands from the project root so the application can locate its templates and runtime files.

### Install dependencies

```powershell
uv sync --locked
```

This creates the `.venv` environment using `pyproject.toml` and `uv.lock`. Use this dependency set for the FastAPI application; `requirements.txt` does not list all of its direct dependencies.

### Configure environment variables

Create a local `.env` file in the project root with your own values:

```dotenv
OPENROUTER_API_KEY=your_openrouter_api_key
TAVILY_API_KEY=your_tavily_api_key
CHATBOT_DATA_DIR=./data

# Optional: needed only for the corresponding tools
OPENWEATHER_API_KEY=your_openweather_api_key
ALPHAVANTAGE_API_KEY=your_alphavantage_api_key
```

The app loads this file with `python-dotenv`. `.env` is ignored by Git. If `CHATBOT_DATA_DIR` is omitted, checkpoints are stored in `checkpointer.db` in the working directory.

### Start the development server

```powershell
uv run uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

- Homepage: <http://127.0.0.1:8000/>
- Interactive API documentation: <http://127.0.0.1:8000/docs>

The homepage does not yet provide a chat interface. The `full-chatbot` console command currently prints a greeting; use the Uvicorn command above to start the server.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serve the placeholder HTML page |
| `GET` | `/conversations` | List conversations ordered by most recently updated |
| `GET` | `/chat/{thread_id}` | Retrieve message history; currently needs a function-name fix |
| `POST` | `/chat/stream` | Stream an agent reply; currently needs missing imports |
| `POST` | `/upload?thread_id=<id>` | Upload a document as a multipart `file` field and build its index |

### Chat request

Send JSON to `POST /chat/stream`:

```json
{
  "message": "Hello! What can you help me with?",
  "thread_id": "demo-001",
  "model": "openai/gpt-4o"
}
```

The client supplies `thread_id`. Reuse it for subsequent messages and document uploads in the same conversation.

The intended successful SSE response contains token events followed by a completion event:

```text
data: {"type": "token", "content": "Hello"}

data: {"type": "done"}
```

The model allowlist in `agent.py` currently contains `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/gpt-4-turbo`, `openai/gpt-3.5-turbo`, and `google/gemini-2.0-flash-exp`. Unrecognized model names fall back to `openai/gpt-4o`. These are application configuration values; actual availability depends on the provider.

### Document upload

In the interactive API documentation, open `POST /upload`, supply a `thread_id`, and select a file for the multipart `file` field.

The endpoint accepts `.pdf`, `.txt`, `.md`, `.csv`, and `.docx`. PDF loading produces document objects; the other formats need the conversion fix described below. Retrieval uses the index associated with the current conversation. A new upload for the same thread rebuilds that thread's index rather than appending to it.

## Current limitations

The following issues are visible in the current source. The setup instructions have not been validated with live API calls.

- **Streaming:** `app.py` uses `json` and `StreamingResponse` without importing them.
- **History retrieval:** the route function `get_chat_history` shadows the imported database helper and calls itself instead of querying the database.
- **Long-term memory search:** the tool named `search_memory` shadows the database helper with the same name. The helper also returns a string, which the tool currently treats as a sequence to join.
- **Non-PDF documents:** TXT, Markdown, CSV, and DOCX loaders pass strings to `split_documents`; these need to be wrapped in LangChain `Document` objects.
- **Concurrent conversations:** tools share a module-level `current_thread_id`, so overlapping requests can use the wrong conversation context.
- **Purchase approval:** the demonstration tool requests a LangGraph interrupt, but the API does not yet expose an approval/resume workflow.
- **Frontend:** the HTML template contains a greeting, not a complete chat interface.

## Commit and push changes

After reviewing your changes:

```powershell
git add .
git status
git commit -m "Document chatbot setup and structure"
```

For the first push, create an empty repository on your Git hosting service, replace the placeholders below with its URL, and run:

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

If `origin` is already configured and the branch has an upstream, use `git push` for later commits. Pushing publishes the repository; running the application on the web requires a separate deployment.
