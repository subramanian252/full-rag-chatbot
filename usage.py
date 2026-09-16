"""Preserve provider billing metadata and collect usage for one agent turn."""

from decimal import Decimal
from threading import Lock

from langchain_core.callbacks import BaseCallbackHandler
from langchain_openai import ChatOpenAI


class UsageChatOpenAI(ChatOpenAI):
    """The pinned LangChain adapter otherwise drops OpenRouter's streaming cost."""

    def _convert_chunk_to_generation_chunk(self, chunk, default_chunk_class, base_generation_info):
        result = super()._convert_chunk_to_generation_chunk(chunk, default_chunk_class, base_generation_info)
        if result is not None and chunk.get("usage"):
            result.generation_info = {**(result.generation_info or {}), "provider_usage": chunk["usage"]}
        return result


class TurnUsage(BaseCallbackHandler):
    def __init__(self):
        self.calls = {}
        self.started = set()
        self.lock = Lock()

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):
        with self.lock:
            self.started.add(str(run_id))

    def on_llm_end(self, response, *, run_id, **kwargs):
        generation = response.generations[0][0]
        message = getattr(generation, "message", None)
        metadata = getattr(message, "response_metadata", {}) or {}
        raw = ((generation.generation_info or {}).get("provider_usage")
               or metadata.get("provider_usage")
               or (response.llm_output or {}).get("token_usage")
               or metadata.get("token_usage") or {})
        usage = getattr(message, "usage_metadata", None)
        if not usage and raw:
            usage = {"input_tokens": raw.get("prompt_tokens", 0),
                     "output_tokens": raw.get("completion_tokens", 0),
                     "total_tokens": raw.get("total_tokens", 0)}
        with self.lock:
            self.started.add(str(run_id))
            self.calls[str(run_id)] = {"usage": usage, "cost": raw.get("cost")}

    def summary(self):
        with self.lock:
            calls = list(self.calls.values())
            started = len(self.started)
        measured = [call for call in calls if call["usage"] is not None]
        costs = [Decimal(str(call["cost"])) for call in calls if call["cost"] is not None]
        return {
            **{key: sum(call["usage"].get(key, 0) for call in measured)
               for key in ("input_tokens", "output_tokens", "total_tokens")},
            "cost_usd": float(sum(costs)) if costs else None,
            "measured_calls": len(measured),
            "missing_calls": started - len(measured),
            "cost_complete": started > 0 and len(costs) == started,
        }
