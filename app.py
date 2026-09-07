import token
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates

import agent
from database import init_db
from agent import get_agent
from tools import set_current_thread
import uvicorn
from database import list_conversations, save_chat_message, get_chat_history, create_or_update_conversation
from pathlib import Path
from fastapi import UploadFile, File
from fastapi.responses import JSONResponse
from rag import add_document_to_rag
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage, HumanMessage

app = FastAPI()

Path("uploads").mkdir(exist_ok=True)
Path("data").mkdir(exist_ok=True)

# Initialize database
init_db()

templates = Jinja2Templates(directory="templates")

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )


@app.get("/conversations")
async def get_conversations():
    items  = list_conversations()
    return {"conversations": [{"thread_id": item.thread_id, "title": item.title, "created_at": item.created_at, "updated_at": item.updated_at} for item in items]}


@app.get("/chat/{thread_id}")
async def get_chat_history(thread_id: str):
    messages = get_chat_history(thread_id)
    return {"messages": [{"role": message.role, "content": message.content, "created_at": message.created_at} for message in messages]}
    
@app.post("/upload")
async def upload_file(file: UploadFile = File(...), thread_id: str = ""):
    try:
        allowed_extensions = [".pdf", ".txt", ".md", ".csv", ".docx"]
        suffix = Path(file.filename).suffix.lower()
        if suffix not in allowed_extensions:
            return JSONResponse(status_code=400, content={"error": "Invalid file type"})
        
        file_path = f"uploads/{thread_id}{suffix}"
        with open(file_path, "wb") as f:
            f.write(await file.read())

        # Add document to RAG
        add_document_to_rag(thread_id, file_path)
        
        # Update conversation title if not already set
        create_or_update_conversation(thread_id, "Uploaded document")
        
        return {"message": "File uploaded successfully", "file_path": file_path}
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})



def should_stream_chunk(chunk, metadata) -> bool:

    metadata = metadata or {}
    node_name = str(metadata.get("node_name", "")).lower()
    
    if "tool" in node_name:
        return False
    
    if(isinstance(chunk, ToolMessage)):
        return False
    
    if not isinstance(chunk, (AIMessage, AIMessageChunk)):
        return False
    
    if getattr(chunk, "tool_calls", None):
        return False
    
    if getattr(chunk, "invalid_tool_calls", None):
        return False
    
    additional_kwargs = getattr(chunk, "additional_kwargs", {}) or {}
    if additional_kwargs.get("tool_calls"):
        return False
    
    return True


def extract_text_from_chunk(chunk) -> str:
    content = getattr(chunk, "content", "")
    
    if not content:
        return ""
    
    if isinstance(content, str):
        return content
    
    if isinstance(content, list):
        text_parts = []
        for item in content:
           if isinstance(item, str):
               text_parts.append(item)
           elif isinstance(item, dict):
               if (item.get("type") == "text"):
                   text_parts.append(item.get("text", ""))
               elif isinstance(item.get("text"), str):
                   text_parts.append(item.get("text", ""))
               elif isinstance(item.get("content"), dict):
                   text_parts.append(item.get("content", {}).get("text", ""))
        return "".join(text_parts)
    
    return ""

@app.post("/chat/stream")
async def chat_stream(request: Request):
    # TODO: Implement streaming chat endpoint
    try:
        data = await request.json()
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})
    
    user_message = data.get("message", "")
    thread_id = data.get("thread_id", "")
    model = data.get("model", "gpt-4")
    
    if not user_message or not thread_id:
        return JSONResponse(status_code=400, content={"error": "Missing message or thread_id"})
    
    agent = get_agent(model)
    create_or_update_conversation(thread_id, user_message)
    save_chat_message(thread_id, "user", user_message)

    set_current_thread(thread_id)
    
    config = {"configurable": {"thread_id": thread_id}}
    
    def event_generator():
        final_answer = ""

        try:
            inputs = {"messages": [HumanMessage(content=user_message)]}
        
            for chunk, metadata in agent.stream(inputs, config=config, stream_mode="messages"):
                if not should_stream_chunk(chunk, metadata):
                    continue
                    
                text = extract_text_from_chunk(chunk)
                
                if text:
                    final_answer += text
                    yield f"data: {json.dumps({'type': 'token', 'content': text})}\n\n"
            
            if final_answer:
                save_chat_message(thread_id, "assistant", final_answer)

            yield f"data: {json.dumps({'type': 'done'})}\n\n"
               
                
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
        
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
