import type { ToolCall } from "./api";

/** A readable execution trace for interview demos; only actual graph events. */
export function ToolActivity({ calls }: { calls: ToolCall[] }) {
  if (!calls.length) return null;
  return (
    <div className="tool-activity" aria-label="Tool activity">
      <div className="activity-label">LAZYBOT’S TOOL TRAIL</div>
      {calls.map((call) => (
        <div className="tool-row" key={call.id}>
          <div className="tool-row-heading">
            <span
              className={`tool-status-dot ${call.status}`}
              aria-hidden="true"
            />
            <code>{call.name}</code>
            <span>
              {
                {
                  running: "Calling tool",
                  complete: "Returned",
                  error: "Tool error",
                  paused: "Paused for approval",
                }[call.status]
              }
            </span>
          </div>
          {call.args && (
            <code className="tool-args">{JSON.stringify(call.args)}</code>
          )}
          {call.result && (
            <details>
              <summary>Tool result</summary>
              <pre>{call.result}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
