from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    JSON, Column, DateTime, Integer, String, Text, case, create_engine, func,
    select,
)
from sqlalchemy.orm import declarative_base, sessionmaker
import os
from langgraph.checkpoint.postgres import PostgresSaver

from dotenv import load_dotenv
load_dotenv()

DATABASE_URL = os.getenv("EXTERNAL_DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("EXTERNAL_DATABASE_URL environment variable is not set")

if "sslmode=" not in DATABASE_URL:
    sep = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL += f"{sep}sslmode=require"

SQLALCHEMY_DATABASE_URL = DATABASE_URL.replace(
    "postgresql://",
    "postgresql+psycopg://",
    1,
)

engine = create_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String, index=True, unique=True)
    title = Column(String, index=True, default="New Conversation")
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String, index=True)
    role = Column(String, index=True)
    content = Column(Text)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

class LongTermMemory(Base):
    __tablename__ = "long_term_memory"
    
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String, index=True)
    memory = Column(Text)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )


class MessageUsage(Base):
    """Additive table: existing chat rows and schemas stay intact."""
    __tablename__ = "message_usage"

    id = Column(Integer, primary_key=True)
    thread_id = Column(String, index=True, nullable=False)
    message_id = Column(Integer, unique=True, nullable=False)
    model = Column(String, nullable=False)
    usage = Column(JSON, nullable=False)


def save_message_usage(thread_id: str, message_id: int, model: str, usage: dict):
    with SessionLocal() as db:
        db.add(MessageUsage(thread_id=thread_id, message_id=message_id, model=model, usage=usage))
        db.commit()


def get_usage_records(thread_id: str | None = None):
    with SessionLocal() as db:
        query = db.query(MessageUsage)
        if thread_id is not None:
            query = query.filter(MessageUsage.thread_id == thread_id)
        return query.all()


def get_workspace_usage_summary():
    """Aggregate workspace usage in the database instead of loading every row."""
    usage = MessageUsage.usage
    statement = select(
        func.count(MessageUsage.id).label("record_count"),
        func.coalesce(func.sum(usage["input_tokens"].as_integer()), 0)
        .label("input_tokens"),
        func.coalesce(func.sum(usage["output_tokens"].as_integer()), 0)
        .label("output_tokens"),
        func.coalesce(func.sum(usage["total_tokens"].as_integer()), 0)
        .label("total_tokens"),
        func.coalesce(func.sum(usage["measured_calls"].as_integer()), 0)
        .label("measured_calls"),
        func.coalesce(func.sum(usage["missing_calls"].as_integer()), 0)
        .label("missing_calls"),
        func.sum(usage["cost_usd"].as_float()).label("cost_usd"),
        func.coalesce(
            func.sum(
                case(
                    (usage["cost_complete"].as_boolean().is_(True), 1),
                    else_=0,
                )
            ),
            0,
        ).label("complete_records"),
    )

    with SessionLocal() as db:
        row = db.execute(statement).one()

    record_count = row.record_count
    return {
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "total_tokens": row.total_tokens,
        "measured_calls": row.measured_calls,
        "missing_calls": row.missing_calls,
        "cost_usd": float(row.cost_usd) if row.cost_usd is not None else None,
        "cost_complete": record_count > 0 and row.complete_records == record_count,
    }


def summarize_usage(records):
    from decimal import Decimal

    usages = [record.usage for record in records]
    costs = [Decimal(str(usage["cost_usd"])) for usage in usages if usage.get("cost_usd") is not None]
    return {
        **{key: sum(usage.get(key, 0) for usage in usages)
           for key in ("input_tokens", "output_tokens", "total_tokens", "measured_calls", "missing_calls")},
        "cost_usd": float(sum(costs)) if costs else None,
        "cost_complete": bool(usages) and all(usage.get("cost_complete", False) for usage in usages),
    }

def init_db():
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully!")

def create_or_update_conversation(thread_id: str, first_message: str | None = None):
    db = SessionLocal()
    try:
        conversation = db.query(Conversation).filter(Conversation.thread_id == thread_id).first()
        if not conversation:
            title = first_message[:40] if first_message else "New Conversation"
            if first_message:
                title = title + "..." if len(first_message) > 40 else title
            conversation = Conversation(thread_id=thread_id, title=title)
            db.add(conversation)
        else:
            conversation.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(conversation)
        return conversation
    finally:
        db.close()


def list_conversations():
    db = SessionLocal()
    try:
        conversations = db.query(Conversation).order_by(Conversation.updated_at.desc()).all()
        return conversations
    finally:
        db.close()


def save_chat_message(thread_id: str, role: str, content: str):
    db = SessionLocal()
    try:
        message = ChatMessage(thread_id=thread_id, role=role, content=content)
        db.add(message)

        conversation = db.query(Conversation).filter(Conversation.thread_id == thread_id).first()
        if conversation:
            conversation.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(message)
        return message
    finally:
        db.close()


def get_chat_history(thread_id: str):
    db = SessionLocal()
    try:
        messages = db.query(ChatMessage).filter(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at.asc()).all()
        return messages
    finally:
        db.close()

def save_memory(thread_id: str, memory: str):
    db = SessionLocal()
    try:
        memory = LongTermMemory(thread_id=thread_id, memory=memory)
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return "memory saved"
    finally:
        db.close()

def search_memory(thread_id: str):
    db = SessionLocal()
    try:
        memories = db.query(LongTermMemory).filter(LongTermMemory.thread_id == thread_id).order_by(LongTermMemory.created_at.desc()).limit(10).all()
        if not memories:
            return "No memories found"
        return "\n".join([memory.memory for memory in memories])
    finally:
        db.close()
