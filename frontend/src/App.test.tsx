// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { emptyUsage } from "./api";

const usage = {
  ...emptyUsage,
  input_tokens: 90,
  output_tokens: 10,
  total_tokens: 100,
  cost_usd: 0.0003,
  measured_calls: 1,
  cost_complete: true,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Element.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/conversations")
      return json({
        conversations: [
          {
            thread_id: "saved-chat",
            title: "A good idea",
            updated_at: "2026-01-01",
          },
        ],
      });
    if (url === "/models")
      return json({
        models: [
          { id: "openai/gpt-4o", name: "GPT-4o", description: "Versatile" },
          {
            id: "openai/gpt-4o-mini",
            name: "GPT-4o mini",
            description: "Quick",
          },
        ],
      });
    if (url === "/usage") return json({ summary: usage });
    if (url.startsWith("/upload")) return json({ message: "Document ready" });
    if (url === "/chat/stream") {
      const body = JSON.parse(options?.body as string);
      expect(body.message).toBe("Hello there");
      const text =
        'data: {"type":"token","content":"A thoughtful **answer**."}\n\n' +
        `data: ${JSON.stringify({ type: "done", message_id: 2, usage, thread_usage: usage })}\n\n`;
      return new Response(text, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url.startsWith("/chat/"))
      return json({
        messages: [
          { id: 1, role: "user", content: "An earlier question" },
          {
            id: 2,
            role: "assistant",
            content: "An earlier answer",
            model: "openai/gpt-4o-mini",
            usage,
          },
        ],
        usage,
        document: null,
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("workspace interactions", () => {
  it("sends a real request shape, renders Markdown, and shows measured usage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/usage"),
      ).toHaveLength(1),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Message LazyChat" }),
      "Hello there",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("answer", { selector: "strong" });
    expect(screen.getByRole("button", { name: /^100 tokens/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^100 tokens/ }));
    expect(screen.getByLabelText("Conversation usage")).toBeTruthy();
    expect(window.location.search).toContain("chat=");
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/conversations"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/usage"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url.startsWith("/chat/") && url !== "/chat/stream",
      ),
    ).toHaveLength(0);
  });

  it("restores saved history and starts a clean new conversation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "A good idea" }),
    );
    await screen.findByText("An earlier answer");
    expect(screen.getByRole("button", { name: "GPT-4o mini" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByText("An earlier answer")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("searches titles and opens the selected conversation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "A good idea" });
    await user.click(screen.getByRole("button", { name: /Search chats/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Search conversations" }),
      "good",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "A good idea",
      }),
    );
    await screen.findByText("An earlier answer");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uploads a document and prepares a relevant prompt", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const file = new File(["A helpful note"], "notes.txt", {
      type: "text/plain",
    });
    await user.upload(
      container.querySelector("input[type=file]") as HTMLInputElement,
      file,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Message LazyChat",
          }) as HTMLTextAreaElement
        ).value,
      ).toContain("summary"),
    );
    expect(
      await screen.findByText("notes.txt uploaded successfully"),
    ).toBeTruthy();
    expect(screen.queryByText("Ready to chat")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.startsWith("/upload?thread_id="),
      ),
    ).toBe(true);
  });

  it("shows a useful error and restores the draft after a rejected request", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) =>
      url === "/chat/stream"
        ? json({ detail: "This model is unavailable." }, 503)
        : original(url, options),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("textbox", { name: "Message LazyChat" }),
      "Hello there",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("alert");
    expect(screen.getByText("This model is unavailable.")).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Message LazyChat",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("Hello there"),
    );
  });
});

describe("human approval", () => {
  const interrupt = {
    id: "interrupt-1",
    value: {
      message: "Approve stock purchase (yes/no)?",
      symbol: "AAPL",
      quantity: 2,
    },
  };
  const tool = {
    id: "call-buy",
    name: "buy_stocks",
    args: { symbol: "AAPL", quantity: 2 },
    status: "paused",
  };

  it.each([true, false])(
    "restores a checkpoint and submits approved=%s without another user message",
    async (approved) => {
      window.history.replaceState(null, "", "/?chat=saved-chat");
      let resolved = false;
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(
        async (url: string, options?: RequestInit) => {
          if (url === "/chat/saved-chat")
            return json({
              messages: [
                { id: 1, role: "user", content: "Simulate a stock purchase" },
                {
                  id: 2,
                  role: "assistant",
                  content: "",
                  usage: {
                    ...usage,
                    status: "interrupted",
                    tool_calls: [tool],
                  },
                },
              ],
              usage,
              interrupts: resolved ? [] : [interrupt],
            });
          if (url === "/chat/stream") {
            const body = JSON.parse(options?.body as string);
            expect(body.approval).toBe(approved);
            expect(body.interrupt_id).toBe(interrupt.id);
            expect(body.thread_id).toBe("saved-chat");
            expect(body).not.toHaveProperty("message");
            resolved = true;
            const complete = {
              ...tool,
              status: "complete",
              result: approved
                ? "Buying 2 shares of AAPL"
                : "Purchase cancelled",
            };
            return new Response(
              [
                { type: "tool", tool: complete },
                { type: "token", content: "Simulation complete." },
                {
                  type: "done",
                  message_id: 3,
                  interrupts: [],
                  usage: {
                    ...usage,
                    tool_calls: [complete],
                    decision: { id: interrupt.id, approved },
                  },
                  thread_usage: usage,
                },
              ]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
            );
          }
          return original(url, options);
        },
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("region", { name: "Pending tool approval" });
      expect(
        (
          screen.getByRole("textbox", {
            name: "Message LazyChat",
          }) as HTMLTextAreaElement
        ).disabled,
      ).toBe(true);
      expect(screen.getByText('{"symbol":"AAPL","quantity":2}')).toBeTruthy();
      await user.click(
        screen.getByRole("button", {
          name: approved ? "Approve" : "Decline",
        }),
      );
      await screen.findByText("Simulation complete.");
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "Pending tool approval" }),
        ).toBeNull(),
      );
      expect(
        screen.getByText(
          approved ? /Human decision · Approved/ : /Human decision · Declined/,
        ),
      ).toBeTruthy();
      expect(screen.getByText("Returned")).toBeTruthy();
      expect(screen.getAllByText("Simulate a stock purchase")).toHaveLength(1);
    },
  );

  it("keeps a pending decision actionable after a rejected resume", async () => {
    window.history.replaceState(null, "", "/?chat=saved-chat");
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/chat/saved-chat")
        return json({
          messages: [
            {
              id: 2,
              role: "assistant",
              content: "",
              usage: { ...usage, status: "interrupted", tool_calls: [tool] },
            },
          ],
          usage,
          interrupts: [interrupt],
        });
      if (url === "/chat/stream")
        return json(
          { detail: "This conversation is still working on a request." },
          409,
        );
      return original(url, options);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Approve",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      screen.getByRole("region", { name: "Pending tool approval" }),
    ).toBeTruthy();
  });
});
