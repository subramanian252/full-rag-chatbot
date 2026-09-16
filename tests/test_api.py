"""Offline integration tests: isolated SQLite, mocked provider transport, no paid calls."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGeneration, LLMResult
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from usage import TurnUsage, UsageChatOpenAI


class UsageTests(unittest.TestCase):
    def test_multiple_calls_and_missing_cost(self):
        tracker = TurnUsage()
        for index, cost in enumerate([0.001, None]):
            tracker.on_chat_model_start({}, [], run_id=index)
            result = LLMResult(generations=[[ChatGeneration(
                message=AIMessageChunk(content="ok", usage_metadata={"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}),
                generation_info={"provider_usage": {"cost": cost}},
            )]])
            tracker.on_llm_end(result, run_id=index)
            tracker.on_llm_end(result, run_id=index)  # Callback replay cannot double count.
        tracker.on_chat_model_start({}, [], run_id="failed")
        summary = tracker.summary()
        self.assertEqual(summary["total_tokens"], 24)
        self.assertEqual(summary["cost_usd"], 0.001)
        self.assertEqual(summary["missing_calls"], 1)
        self.assertFalse(summary["cost_complete"])

    def test_adapter_preserves_real_streamed_provider_usage(self):
        def transport(request):
            data = [
                {"id": "gen-test", "object": "chat.completion.chunk", "model": "openai/gpt-4o", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}, "finish_reason": None}]},
                {"id": "gen-test", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                {"id": "gen-test", "object": "chat.completion.chunk", "choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15, "cost": 0.000123}},
            ]
            body = ''.join(f'data: {json.dumps(item)}\n\n' for item in data) + 'data: [DONE]\n\n'
            return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})
        with httpx.Client(transport=httpx.MockTransport(transport)) as client:
            model = UsageChatOpenAI(api_key="test-only", base_url="https://provider.invalid/v1", model="openai/gpt-4o", http_client=client, stream_usage=True)
            tracker = TurnUsage()
            chunks = list(model.stream("Hi", config={"callbacks": [tracker]}))
        self.assertEqual(''.join(chunk.content for chunk in chunks), 'Hello')
        self.assertEqual(tracker.summary()["total_tokens"], 15)
        self.assertEqual(tracker.summary()["cost_usd"], 0.000123)
        self.assertTrue(tracker.summary()["cost_complete"])


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.previous_cwd = os.getcwd()
        cls.temp = tempfile.TemporaryDirectory()
        os.chdir(cls.temp.name)
        # Imported configuration uses placeholders, never the developer's API keys.
        cls.env = patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-only", "TAVILY_API_KEY": "test-only", "CHATBOT_DATA_DIR": cls.temp.name, "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false", "LANGSMITH_API_KEY": "test-only"})
        cls.env.start()
        import app
        import database
        cls.app_module, cls.database = app, database
        cls.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        database.Base.metadata.create_all(cls.engine)
        cls.db_patch = patch.object(database, "SessionLocal", sessionmaker(bind=cls.engine, expire_on_commit=False))
        cls.db_patch.start()
        cls.client = TestClient(app.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.db_patch.stop()
        cls.engine.dispose()
        cls.database.engine.dispose()
        import memory
        memory.memory.conn.close()
        cls.env.stop()
        os.chdir(cls.previous_cwd)
        cls.temp.cleanup()

    def test_history_and_persistent_turn_usage(self):
        tracker_result = LLMResult(generations=[[ChatGeneration(message=AIMessageChunk(content="Hello", usage_metadata={"input_tokens": 20, "output_tokens": 5, "total_tokens": 25}), generation_info={"provider_usage": {"cost": 0.0002}})]])
        class FakeGraph:
            def get_state(self, config):
                return SimpleNamespace(interrupts=())
            def stream(self, inputs, config, stream_mode):
                tracker = config["callbacks"][0]
                tracker.on_chat_model_start({}, [], run_id="test")
                yield "messages", (AIMessageChunk(content="Hello"), {"langgraph_node": "chatbot"})
                tracker.on_llm_end(tracker_result, run_id="test")
        with patch.object(self.app_module, "get_agent", return_value=FakeGraph()):
            response = self.client.post('/chat/stream', json={"message": "Hi", "thread_id": "history-test"})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
        self.assertEqual(events[-1]["type"], "done")
        history = self.client.get('/chat/history-test').json()
        self.assertEqual([message["content"] for message in history["messages"]], ["Hi", "Hello"])
        self.assertEqual(history["messages"][-1]["usage"]["total_tokens"], 25)
        self.assertEqual(history["usage"]["cost_usd"], 0.0002)
        self.assertNotIn("history-test", self.app_module.active_threads)

    def test_invalid_requests_and_overlap(self):
        self.assertEqual(self.client.post('/chat/stream', json={"message": "  ", "thread_id": "valid"}).status_code, 400)
        self.assertEqual(self.client.post('/chat/stream', json={"message": "hi", "thread_id": "../escape"}).status_code, 400)
        self.assertEqual(self.client.post('/chat/stream', json={"message": None, "thread_id": "valid"}).status_code, 422)
        self.app_module.claim_thread("in-progress")
        try:
            self.assertEqual(self.client.post('/chat/stream', json={"message": "hi", "thread_id": "in-progress"}).status_code, 409)
        finally:
            self.app_module.release_thread("in-progress")

    def test_real_graph_tool_loop_keeps_usage_from_both_model_calls(self):
        import agent
        from langgraph.checkpoint.memory import InMemorySaver
        calls = []

        def transport(request):
            calls.append(json.loads(request.content))
            if len(calls) == 1:
                delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": "call-calc", "type": "function", "function": {"name": "calculator", "arguments": '{"expression":"2+2"}'}}]}
                reason = "tool_calls"
            else:
                delta = {"role": "assistant", "content": "The answer is 4."}
                reason = "stop"
            data = [
                {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "model": "openai/gpt-4o", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": reason}]},
                {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14, "cost": 0.0001}},
            ]
            return httpx.Response(200, content=(''.join(f'data: {json.dumps(item)}\n\n' for item in data) + 'data: [DONE]\n\n').encode(), headers={"content-type": "text/event-stream"})

        with httpx.Client(transport=httpx.MockTransport(transport)) as client:
            model = UsageChatOpenAI(api_key="test-only", base_url="https://provider.invalid/v1", model="openai/gpt-4o", http_client=client, stream_usage=True)
            with patch.object(agent, "UsageChatOpenAI", return_value=model), patch.object(agent, "memory", InMemorySaver()):
                graph = agent.build_agent()
            with patch.object(self.app_module, "get_agent", return_value=graph):
                response = self.client.post('/chat/stream', json={"message": "What is 2+2?", "thread_id": "graph-test"})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
        self.assertEqual(events[-1]['type'], 'done', response.text)
        self.assertEqual(events[-1]['usage']['total_tokens'], 28)
        self.assertEqual(events[-1]['usage']['cost_usd'], 0.0002)
        self.assertEqual(events[-1]['usage']['measured_calls'], 2)
        self.assertTrue(any(event['type'] == 'tool' for event in events))
        trace = events[-1]['usage']['tool_calls'][0]
        self.assertEqual(trace['name'], 'calculator')
        self.assertEqual(trace['args'], {'expression': '2+2'})
        self.assertEqual(trace['status'], 'complete')
        self.assertIn('4', trace['result'])
        self.assertTrue(any(message.get('role') == 'tool' for message in calls[-1]['messages']))

    def test_real_graph_approval_and_decline_survive_checkpoint_reload(self):
        import agent
        from langgraph.checkpoint.sqlite import SqliteSaver

        for approved in (True, False):
            with self.subTest(approved=approved):
                thread = f"approval-{approved}"
                calls = []

                def transport(request):
                    calls.append(json.loads(request.content))
                    if len(calls) == 1:
                        delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": "call-buy", "type": "function", "function": {"name": "buy_stocks", "arguments": '{"symbol":"AAPL","quantity":2}'}}]}
                        reason = "tool_calls"
                    else:
                        delta = {"role": "assistant", "content": "Simulation complete."}
                        reason = "stop"
                    data = [
                        {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "model": "openai/gpt-4o", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                        {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": reason}]},
                        {"id": f"gen-{len(calls)}", "object": "chat.completion.chunk", "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14, "cost": 0.0001}},
                    ]
                    body = ''.join(f'data: {json.dumps(item)}\n\n' for item in data) + 'data: [DONE]\n\n'
                    return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

                with httpx.Client(transport=httpx.MockTransport(transport)) as client:
                    model = UsageChatOpenAI(api_key="test-only", base_url="https://provider.invalid/v1", model="openai/gpt-4o", http_client=client, stream_usage=True)
                    with SqliteSaver.from_conn_string(f"{thread}.db") as saver:
                        with patch.object(agent, "UsageChatOpenAI", return_value=model), patch.object(agent, "memory", saver):
                            graph = agent.build_agent()
                        with patch.object(self.app_module, "get_agent", return_value=graph):
                            response = self.client.post('/chat/stream', json={"message": "Simulate buying AAPL", "thread_id": thread})
                            events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
                            self.assertEqual(events[-1]['type'], 'interrupt', response.text)
                            self.assertEqual(len(calls), 1)
                            self.assertEqual(events[-1]['usage']['tool_calls'][0]['status'], 'paused')
                            interrupt_id = events[-1]['interrupts'][0]['id']
                    # Reopen the SQLite connection and rebuild the graph: no in-memory pause state.
                    with SqliteSaver.from_conn_string(f"{thread}.db") as saver:
                        with patch.object(agent, "UsageChatOpenAI", return_value=model), patch.object(agent, "memory", saver):
                            graph = agent.build_agent()
                        with patch.object(self.app_module, "get_agent", return_value=graph) as get:
                            history = self.client.get(f'/chat/{thread}').json()
                            self.assertEqual(history['interrupts'][0]['id'], interrupt_id)
                            self.assertEqual(history['usage']['total_tokens'], 14)
                            self.assertEqual(self.client.post('/chat/stream', json={"message": "skip", "thread_id": thread}).status_code, 409)
                            self.assertEqual(self.client.post('/chat/stream', json={"approval": approved, "interrupt_id": "stale", "thread_id": thread}).status_code, 409)
                            self.assertEqual(self.client.post('/chat/stream', json={"approval": "yes", "interrupt_id": interrupt_id, "thread_id": thread}).status_code, 422)
                            decision = {"approval": approved, "interrupt_id": interrupt_id, "thread_id": thread, "model": "openai/gpt-4o-mini"}
                            response = self.client.post('/chat/stream', json=decision)
                            get.assert_called_with("openai/gpt-4o")
                            events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
                            self.assertEqual(events[-1]['type'], 'done', response.text)
                            expected = 'Buying 2 shares of AAPL' if approved else 'Purchase cancelled'
                            self.assertTrue(any(e.get('tool', {}).get('result') == expected for e in events), response.text)
                            self.assertEqual(events[-1]['usage']['decision']['approved'], approved)
                            history = self.client.get(f'/chat/{thread}').json()
                            self.assertEqual(history['interrupts'], [])
                            self.assertEqual(history['usage']['total_tokens'], 28)
                            self.assertEqual(history['usage']['cost_usd'], 0.0002)
                            self.assertEqual(sum(m['role'] == 'user' for m in history['messages']), 1)
                            self.assertEqual(self.client.post('/chat/stream', json=decision).status_code, 409)
                            self.assertEqual(len(calls), 2)
                            self.assertNotIn(thread, self.app_module.active_threads)

    def test_upload_formats_and_metadata(self):
        with patch.object(self.app_module, "add_document_to_rag") as add:
            response = self.client.post('/upload?thread_id=upload-test', files={"file": ("notes.txt", b'A useful note.', 'text/plain')})
            self.assertEqual(response.status_code, 200)
            add.assert_called_once()
        self.assertEqual(self.client.get('/chat/upload-test').json()["document"], "notes.txt")
        self.assertEqual(self.client.post('/upload?thread_id=bad-file', files={"file": ("code.exe", b'no')}).status_code, 400)
        self.assertEqual(self.client.post('/upload?thread_id=empty-file', files={"file": ("empty.txt", b'')}).status_code, 400)
        self.assertNotIn("empty-file", self.app_module.active_threads)

    def test_failed_stream_keeps_partial_usage(self):
        class FailedGraph:
            def get_state(self, config):
                return SimpleNamespace(interrupts=())
            def stream(self, inputs, config, stream_mode):
                config['callbacks'][0].on_chat_model_start({}, [], run_id='unfinished')
                yield 'messages', (AIMessageChunk(content='Partial'), {'langgraph_node': 'chatbot'})
                raise RuntimeError('provider failed')
        with patch.object(self.app_module, 'get_agent', return_value=FailedGraph()):
            response = self.client.post('/chat/stream', json={"message": "Hi", "thread_id": "failed-test"})
        self.assertIn('"type": "error"', response.text)
        history = self.client.get('/chat/failed-test').json()
        self.assertEqual(history['messages'][-1]['content'], 'Partial')
        self.assertEqual(history['messages'][-1]['usage']['status'], 'incomplete')
        self.assertEqual(history['usage']['missing_calls'], 1)
        self.assertNotIn('failed-test', self.app_module.active_threads)

    def test_text_loader_builds_document_objects(self):
        import rag
        path = Path('uploads/plain.txt')
        path.write_text('A document about a calm workspace.', encoding='utf-8')
        with patch.object(rag.FAISS, 'from_documents') as create:
            rag.add_document_to_rag('loader-test', str(path))
            documents = create.call_args.args[0]
            self.assertEqual(documents[0].page_content, 'A document about a calm workspace.')


if __name__ == '__main__':
    unittest.main()
