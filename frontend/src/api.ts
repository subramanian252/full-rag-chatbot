export type ToolCall = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error" | "paused";
  result?: string;
};
export type PendingInterrupt = {
  id: string;
  value: { message?: string; symbol?: string; quantity?: number };
};
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  measured_calls: number;
  missing_calls: number;
  cost_complete: boolean;
  status?: string;
  tool_calls?: ToolCall[];
  decision?: { id: string; approved: boolean } | null;
};
export type Message = {
  id?: number;
  role: string;
  content: string;
  created_at?: string;
  usage?: Usage | null;
  model?: string;
  error?: boolean;
  tool_calls?: ToolCall[];
};
export type Conversation = {
  thread_id: string;
  title: string;
  updated_at: string;
};
export type Model = { id: string; name: string; description: string };
export const emptyUsage: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cost_usd: null,
  measured_calls: 0,
  missing_calls: 0,
  cost_complete: false,
};

export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : data.error || "Something went wrong. Please try again.",
    );
  }
  return response.json();
}

// Network chunks can split an SSE frame or a multibyte character anywhere.
export async function readEvents(
  response: Response,
  onEvent: (event: Record<string, any>) => void,
) {
  if (!response.body)
    throw new Error("Streaming is not available in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function drain(final = false) {
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") onEvent(JSON.parse(data));
    }
    if (final && buffer.trim())
      throw new Error(
        "The response ended early. Your saved conversation is still available.",
      );
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain(true);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const count = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export const money = (value: number | null) =>
  value == null
    ? "—"
    : value === 0
      ? "$0.00"
      : value < 0.00001
        ? "< $0.00001"
        : `$${value.toFixed(5)}`;
