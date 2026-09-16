import { describe, expect, it } from "vitest";
import { readEvents, money } from "./api";

function streamed(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

describe("chat event transport", () => {
  it("reads split UTF-8, multiple frames, and completion events", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"token","content":"Hello 🌱"}\n\ndata: {"type":"done"}\n\n',
    );
    const events: any[] = [];
    await readEvents(
      streamed([...bytes].map((byte) => new Uint8Array([byte]))),
      (event) => events.push(event),
    );
    expect(events).toEqual([
      { type: "token", content: "Hello 🌱" },
      { type: "done" },
    ]);
  });
  it("supports CRLF frames and ignores SSE comments", async () => {
    const bytes = new TextEncoder().encode(
      ': keepalive\r\n\r\ndata: {"type":"done"}\r\n\r\n',
    );
    const events: any[] = [];
    await readEvents(
      streamed([...bytes].map((byte) => new Uint8Array([byte]))),
      (event) => events.push(event),
    );
    expect(events).toEqual([{ type: "done" }]);
  });
  it("reports truncated responses instead of silently completing", async () => {
    await expect(
      readEvents(
        streamed([new TextEncoder().encode('data: {"type":')]),
        () => {},
      ),
    ).rejects.toThrow("ended early");
  });
  it("distinguishes unreported cost from zero and small charges", () => {
    expect(money(null)).toBe("—");
    expect(money(0)).toBe("$0.00");
    expect(money(0.000001)).toBe("< $0.00001");
  });
});
