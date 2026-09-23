import json
import logging
from pathlib import Path
from threading import Lock

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langgraph.types import Command
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agent import ALLOWED_MODELS, get_agent
from database import (
    create_or_update_conversation, get_chat_history, get_usage_records,
    get_workspace_usage_summary, init_db,
    list_conversations, save_chat_message, save_message_usage, summarize_usage,
)
from rag import add_document_to_rag
from usage import TurnUsage

app = FastAPI(title="LazyChat", version="1.0.0")
logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "public"
init_db()
app.mount("/assets", StaticFiles(directory=str(FRONTEND / "assets"), check_dir=False), name="assets")

# One Uvicorn worker: protect a conversation's checkpoint and index from overlap.
active_threads = set()
active_lock = Lock()


def claim_thread(thread_id):
    import re
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", thread_id):
        raise HTTPException(400, "Use a conversation ID containing letters, numbers, underscores, or hyphens.")
    with active_lock:
        if thread_id in active_threads:
            raise HTTPException(409, "This conversation is still working on a request. Please wait for it to finish.")
        active_threads.add(thread_id)


def release_thread(thread_id):
    with active_lock:
        active_threads.discard(thread_id)


@app.get("/")
def read_root():
    if (FRONTEND / "index.html").exists():
        return FileResponse(FRONTEND / "index.html")
    return JSONResponse(
        status_code=503,
        content={"error": "Frontend build not found. Run npm --prefix frontend run build."},
    )


@app.get("/favicon.svg")
def favicon():
    return FileResponse(FRONTEND / "favicon.svg", media_type="image/svg+xml")


@app.get("/models")
def models():
    descriptions = {
        "openai/gpt-4o": ("GPT-4o", "A versatile thinking partner"),
        "openai/gpt-4o-mini": ("GPT-4o mini", "Small, quick, and capable"),
        "openai/gpt-4-turbo": ("GPT-4 Turbo", "For a deeper dive"),
        "openai/gpt-3.5-turbo": ("GPT-3.5 Turbo", "For everyday questions"),
        "google/gemini-3.1-flash-lite": ("Gemini 3.1 Flash Lite", "Fast, efficient, and tool-ready"),
        "qwen/qwen3-30b-a3b-instruct-2507": ("Qwen3 30B A3B", "Low-cost agent and document work"),
        "mistralai/mistral-small-3.2-24b-instruct": ("Mistral Small 3.2", "Affordable and reliable tool use"),
        "deepseek/deepseek-chat-v3.1": ("DeepSeek V3.1", "Budget reasoning and coding"),
    }
    return {"models": [{"id": model, "name": descriptions.get(model, (model, ""))[0],
                        "description": descriptions.get(model, (model, ""))[1]} for model in ALLOWED_MODELS]}


@app.get("/conversations")
def get_conversations():
    return {"conversations": [{"thread_id": item.thread_id, "title": item.title,
                                "created_at": item.created_at, "updated_at": item.updated_at}
                               for item in list_conversations()]}


@app.get("/usage")
def workspace_usage():
    return {"summary": get_workspace_usage_summary()}


@app.get("/chat/{thread_id}")
def chat_history(thread_id: str):
    records = get_usage_records(thread_id)
    by_message = {record.message_id: record for record in records}
    messages = []
    for message in get_chat_history(thread_id):
        record = by_message.get(message.id)
        messages.append({"id": message.id, "role": message.role, "content": message.content,
                         "created_at": message.created_at, "usage": record.usage if record else None,
                         "model": record.model if record else None})
    model = max(records, key=lambda record: record.id).model if records else "openai/gpt-4o"
    interrupts = pending_interrupts(get_agent(model), thread_id)
    return {"messages": messages, "usage": summarize_usage(records),
            "interrupts": interrupts}


def pending_interrupts(graph, thread_id):
    """The existing checkpointer is the source of truth, including after refresh."""
    snapshot = graph.get_state({"configurable": {"thread_id": thread_id}})
    return [{"id": item.id, "value": item.value} for item in snapshot.interrupts]


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), thread_id: str = ""):
    claim_thread(thread_id)

    try:
        filename = file.filename or "uploaded_file"
        suffix = Path(filename).suffix.lower()

        if suffix not in {".pdf", ".txt", ".md", ".csv", ".docx"}:
            raise HTTPException(400, "Choose a PDF, TXT, Markdown, CSV, or DOCX document.")

        size = 0
        chunks=[]

        while chunk := await file.read(1024 * 1024):
            size += len(chunk)

            if size > 4 * 1024 * 1024:
                raise HTTPException(
                    413,
                    "Choose a document under 4 MB.",
                )

            chunks.append(chunk)

        if size == 0:
            raise HTTPException(400, "This document is empty.")

        file_bytes = b"".join(chunks)

        await add_document_to_rag(thread_id, filename, file_bytes)

        create_or_update_conversation(thread_id, "Uploaded document")

        return {"message": "Document ready", "name": filename}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Document processing failed")
        return JSONResponse(status_code=500, content={"error": "We couldn't process this document. Check the file and your embedding provider configuration, then try again."})
    finally:
        await file.close()
        release_thread(thread_id)


def should_stream_chunk(chunk, metadata) -> bool:
    node_name = str((metadata or {}).get("langgraph_node", (metadata or {}).get("node_name", ""))).lower()
    if "tool" in node_name or isinstance(chunk, ToolMessage):
        return False
    if not isinstance(chunk, (AIMessage, AIMessageChunk)):
        return False
    return not (getattr(chunk, "tool_calls", None)
                or getattr(chunk, "invalid_tool_calls", None)
                or getattr(chunk, "additional_kwargs", {}).get("tool_calls"))


def extract_text_from_chunk(chunk) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    parts = []
    for item in content or []:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


class ChatRequest(BaseModel):
    message: str = Field(default="", max_length=32000)
    thread_id: str = Field(min_length=1, max_length=128)
    model: str = "openai/gpt-4o"
    approval: bool | None = Field(default=None, strict=True)
    interrupt_id: str | None = Field(default=None, max_length=128)


@app.post("/chat/stream")
def chat_stream(data: ChatRequest):
    if data.approval is None and not data.message.strip():
        raise HTTPException(400, "Write a message first.")
    claim_thread(data.thread_id)
    model = data.model if data.model in ALLOWED_MODELS else "openai/gpt-4o"
    try:
        if data.approval is not None:
            records = get_usage_records(data.thread_id)
            if records:
                model = max(records, key=lambda record: record.id).model
        graph = get_agent(model)
        pending = pending_interrupts(graph, data.thread_id)
        if data.approval is not None:
            if data.interrupt_id not in {item["id"] for item in pending}:
                raise HTTPException(409, "This approval is no longer pending. Reopen the conversation to get its current state.")
            # Match the existing buy_stocks tool's yes/no contract. Resume only
            # the named interrupt; a stale or duplicate click cannot approve another.
            graph_input = Command(resume={data.interrupt_id: {"approved": "yes" if data.approval else "no"}})
            user_message = None
        else:
            if pending:
                raise HTTPException(409, "Approve or decline the pending action before sending another message.")
            create_or_update_conversation(data.thread_id, data.message)
            user_message = save_chat_message(data.thread_id, "user", data.message)
            graph_input = {"messages": [HumanMessage(content=data.message)]}
    except HTTPException:
        release_thread(data.thread_id)
        raise
    except Exception:
        release_thread(data.thread_id)
        logger.exception("Could not start chat")
        raise HTTPException(503, "Chat couldn't start. Check the server's model configuration and try again.") from None

    def event(payload):
        return f"data: {json.dumps(payload)}\n\n"

    def event_generator():
        final_answer = ""
        tracker = TurnUsage()
        saved = False
        assistant_message = None
        tool_calls = {}
        interrupts = []

        def turn_usage(status):
            return {**tracker.summary(), "status": status, "tool_calls": list(tool_calls.values()),
                    "decision": {"id": data.interrupt_id, "approved": data.approval} if data.approval is not None else None}

        try:
            config = {"configurable": {"thread_id": data.thread_id}, "callbacks": [tracker]}
            for mode, payload in graph.stream(graph_input,
                                              config=config, stream_mode=["messages", "updates"]):
                if mode == "updates":
                    if "__interrupt__" in payload:
                        interrupts = [{"id": item.id, "value": item.value} for item in payload["__interrupt__"]]
                    for update in payload.values():
                        if not isinstance(update, dict):
                            continue
                        for message in update.get("messages", []):
                            for call in getattr(message, "tool_calls", []):
                                tool_calls[call["id"]] = {"id": call["id"], "name": call["name"], "args": call["args"], "status": "running"}
                                yield event({"type": "tool", "tool": tool_calls[call["id"]]})
                            if isinstance(message, ToolMessage):
                                result = extract_text_from_chunk(message)
                                failed = message.status == "error" or result.lower().startswith("error")
                                tool_calls[message.tool_call_id] = {**tool_calls.get(message.tool_call_id, {}),
                                    "id": message.tool_call_id, "name": message.name or "tool",
                                    "status": "error" if failed else "complete", "result": result[:1000]}
                                yield event({"type": "tool", "tool": tool_calls[message.tool_call_id]})
                    continue
                chunk, metadata = payload
                if getattr(chunk, "tool_call_chunks", None):
                    yield event({"type": "status", "content": "Checking a few things"})
                if should_stream_chunk(chunk, metadata):
                    text = extract_text_from_chunk(chunk)
                    if text:
                        final_answer += text
                        yield event({"type": "token", "content": text})
            if not final_answer and not interrupts:
                raise RuntimeError("empty_response")
            message = save_chat_message(data.thread_id, "assistant", final_answer)
            assistant_message = message
            if interrupts:
                for call in tool_calls.values():
                    if call["status"] == "running":
                        call["status"] = "paused"
            usage = turn_usage("interrupted" if interrupts else "complete")
            save_message_usage(data.thread_id, message.id, model, usage)
            saved = True
            yield event({"type": "interrupt" if interrupts else "done", "interrupts": interrupts,
                         "message_id": message.id, "model": model, "usage": usage,
                         "thread_usage": summarize_usage(get_usage_records(data.thread_id))})
        except Exception as exc:
            logger.exception("Chat stream failed")
            yield event({"type": "error", "error": "This reply didn't finish. Check your model's availability and API configuration, then try again."})
        finally:
            try:
                if not saved:
                    # Keep measured usage on failed/disconnected turns, too.
                    message = assistant_message or (save_chat_message(data.thread_id, "assistant", final_answer)
                                                   if final_answer or user_message is None else user_message)
                    save_message_usage(data.thread_id, message.id, model, turn_usage("incomplete"))
            finally:
                release_thread(data.thread_id)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
