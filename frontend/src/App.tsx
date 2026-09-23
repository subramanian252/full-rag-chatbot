import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Asterisk,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  FileText,
  Globe2,
  Lightbulb,
  Loader2,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  SquarePen,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  count,
  emptyUsage,
  money,
  readEvents,
  request,
  type Conversation,
  type Message,
  type Model,
  type Usage,
  type PendingInterrupt,
  type ToolCall,
} from "./api";
import { ToolActivity } from "./ToolActivity";
import { LazyBot } from "./LazyBot";

const starters = [
  {
    icon: Lightbulb,
    label: "See a tool in action",
    text: "Watch the agent call its calculator.",
    prompt:
      "Use your calculator to compute (1250 * 1.18) / 12 and explain the result.",
    className: "peach",
  },
  {
    icon: Globe2,
    label: "Search the web",
    text: "Follow a live search from call to answer.",
    prompt:
      "Search the web for three interesting recent breakthroughs in technology and explain why they matter.",
    className: "blue",
  },
  {
    icon: FileText,
    label: "Chat with a document",
    text: "Upload a file. Explore document retrieval.",
    prompt: "",
    className: "green",
  },
  {
    icon: Terminal,
    label: "Try human approval",
    text: "Pause, approve or decline, then resume.",
    prompt:
      "Use the demonstration buy_stocks tool to buy 2 shares of AAPL. Pause for my approval before completing the simulated purchase.",
    className: "lilac",
  },
];
const initialModels: Model[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    description: "A versatile thinking partner",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    description: "Small, quick, and capable",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    description: "Fast, efficient, and tool-ready",
  },
  {
    id: "qwen/qwen3-30b-a3b-instruct-2507",
    name: "Qwen3 30B A3B",
    description: "Low-cost agent and document work",
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    name: "Mistral Small 3.2",
    description: "Affordable and reliable tool use",
  },
  {
    id: "deepseek/deepseek-chat-v3.1",
    name: "DeepSeek V3.1",
    description: "Budget reasoning and coding",
  },
];

function conversationTitle(message: string) {
  const title = message.slice(0, 40);
  return message.length > 40 ? `${title}...` : title;
}

function addUsageSummary(current: Usage, turn: Usage): Usage {
  const hasCurrentUsage =
    current.total_tokens > 0 ||
    current.measured_calls > 0 ||
    current.missing_calls > 0 ||
    current.cost_usd !== null;
  const cost =
    current.cost_usd === null && turn.cost_usd === null
      ? null
      : (current.cost_usd || 0) + (turn.cost_usd || 0);

  return {
    input_tokens: current.input_tokens + turn.input_tokens,
    output_tokens: current.output_tokens + turn.output_tokens,
    total_tokens: current.total_tokens + turn.total_tokens,
    measured_calls: current.measured_calls + turn.measured_calls,
    missing_calls: current.missing_calls + turn.missing_calls,
    cost_usd: cost,
    cost_complete:
      (hasCurrentUsage ? current.cost_complete : true) && turn.cost_complete,
  };
}

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`}>
      <Asterisk strokeWidth={2.4} />
    </span>
  );
}

function UsagePanel({
  usage,
  scope,
  setScope,
  close,
}: {
  usage: Usage;
  scope: "conversation" | "workspace";
  setScope: (scope: "conversation" | "workspace") => void;
  close: () => void;
}) {
  const total = usage.total_tokens;
  const fraction = total ? usage.input_tokens / total : 0;
  return (
    <aside className="insights" aria-label="Conversation usage">
      <div className="section-title">
        <span>05 / THE RECEIPTS</span>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close usage panel"
        >
          <X size={17} />
        </button>
      </div>
      <div className="insight-intro">
        <span className="tiny-spark">
          <Asterisk size={25} />
        </span>
        <h2>Numbers, no mystery.</h2>
        <p>Your {scope}, with the tiny receipts attached.</p>
      </div>
      <div className="usage-tabs" aria-label="Usage scope">
        <button
          aria-pressed={scope === "conversation"}
          onClick={() => setScope("conversation")}
        >
          This chat
        </button>
        <button
          aria-pressed={scope === "workspace"}
          onClick={() => setScope("workspace")}
        >
          Workspace
        </button>
      </div>
      <div className="usage-card">
        <div className="usage-card-heading">
          <span>
            {scope === "conversation" ? "Conversation" : "Workspace"} usage
          </span>
          <BarChart3 size={16} />
        </div>
        <div
          className="token-ring"
          style={{
            background: total
              ? `conic-gradient(var(--accent) ${fraction * 100}%, var(--accent-secondary) 0)`
              : undefined,
          }}
        >
          <div>
            <strong>{count(total)}</strong>
            <span>tokens tracked</span>
          </div>
        </div>
        <div className="token-key">
          <span>
            <i />
            Input <b>{count(usage.input_tokens)}</b>
          </span>
          <span>
            <i />
            Output <b>{count(usage.output_tokens)}</b>
          </span>
        </div>
        <div className="cost-total">
          <span>
            Recorded cost <small>USD</small>
          </span>
          <strong>{money(usage.cost_usd)}</strong>
        </div>
        <p className="usage-note">
          {usage.measured_calls === 0
            ? usage.missing_calls > 0
              ? "The provider did not report token usage for this request."
              : "Usage appears here after your first reply."
            : !usage.cost_complete || usage.missing_calls > 0
              ? "Partial reporting. Some model calls did not include usage or cost."
              : "Reported by the model provider, including tool-call reasoning."}
        </p>
      </div>
      <div className="detail-row">
        <span>
          <Zap size={15} /> Model calls tracked
        </span>
        <b>{usage.measured_calls}</b>
      </div>
      <div className="insight-footnote">
        <CircleHelp size={15} />
        <p>
          Chat model usage only. Document embeddings and external tools may have
          separate charges. Older chats may have no usage records.
        </p>
      </div>
      <div className="slow-note">
        <span>LAZYBOT’S FIELD NOTE</span>
        <p>
          The tools. The pauses.
          <br />
          The human in the loop.
        </p>
        <Asterisk size={30} strokeWidth={1.2} />
      </div>
    </aside>
  );
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<Model[]>(initialModels);
  const [model, setModel] = useState("openai/gpt-4o");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedDocument, setUploadedDocument] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInterrupt[]>([]);
  const [usage, setUsage] = useState<Usage>(emptyUsage);
  const [allUsage, setAllUsage] = useState<Usage>(emptyUsage);
  const [insights, setInsights] = useState(false);
  const [usageScope, setUsageScope] = useState<"conversation" | "workspace">(
    "conversation",
  );
  const [sidebar, setSidebar] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [modal, setModal] = useState<"search" | "about" | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState(false);
  const [status, setStatus] = useState("Thinking it through");
  const [copied, setCopied] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const activeThread = useRef(thread);
  const nearBottom = useRef(true);
  const selectedModel =
    models.find((item) => item.id === model) || initialModels[0];
  const current = conversations.find((item) => item.thread_id === thread);
  const locked = busy || uploading || loading;

  async function refreshConversations() {
    try {
      const data = await request<{ conversations: Conversation[] }>(
        "/conversations",
      );
      setConversations(data.conversations);
      setListError(false);
    } catch {
      setListError(true);
    }
  }
  async function refreshWorkspaceUsage() {
    try {
      const data = await request<{ summary: Usage }>("/usage");
      setAllUsage(data.summary);
    } catch {
      // Workspace usage is supplemental; keep the last known summary.
    }
  }
  async function refresh() {
    await Promise.all([refreshConversations(), refreshWorkspaceUsage()]);
  }
  function markConversationUpdated(threadId: string, firstMessage?: string) {
    setConversations((previous) => {
      const existing = previous.find((item) => item.thread_id === threadId);
      const updated = {
        thread_id: threadId,
        title:
          existing?.title ||
          (firstMessage ? conversationTitle(firstMessage) : "New Conversation"),
        updated_at: new Date().toISOString(),
      };
      return [updated, ...previous.filter((item) => item.thread_id !== threadId)];
    });
  }
  useEffect(() => {
    refresh();
    const savedThread = new URLSearchParams(window.location.search).get("chat");
    if (savedThread && /^[A-Za-z0-9_-]{1,128}$/.test(savedThread))
      openChat(savedThread);
    request<{ models: Model[] }>("/models")
      .then((data) => setModels(data.models))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (sidebar)
      sidebarRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [sidebar]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setModal("search");
      }
      if (event.key === "Escape") {
        setModelMenu(false);
        setSidebar(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);
  useEffect(() => {
    if ((messages.length > 0 || pending.length > 0) && nearBottom.current)
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "instant",
      });
  }, [messages, status, pending]);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [draft]);
  useEffect(() => {
    if (!uploadedDocument) return;
    const timer = window.setTimeout(() => setUploadedDocument(null), 3000);
    return () => window.clearTimeout(timer);
  }, [uploadedDocument]);

  function newChat() {
    if (locked) return;
    window.history.replaceState(null, "", window.location.pathname);
    const id = crypto.randomUUID();
    activeThread.current = id;
    setThread(id);
    setMessages([]);
    setUsage(emptyUsage);
    setUploadedDocument(null);
    setPending([]);
    setDraft("");
    setError("");
    setSidebar(false);
    setModal(null);
    inputRef.current?.focus();
  }
  async function openChat(id: string) {
    if (locked) return;
    window.history.replaceState(null, "", `?chat=${encodeURIComponent(id)}`);
    activeThread.current = id;
    setThread(id);
    setLoading(true);
    setSidebar(false);
    setModal(null);
    setError("");
    setDraft("");
    setMessages([]);
    setUploadedDocument(null);
    setPending([]);
    setUsage(emptyUsage);
    try {
      const data = await request<{
        messages: Message[];
        usage: Usage;
        interrupts?: PendingInterrupt[];
      }>(`/chat/${encodeURIComponent(id)}`);
      if (activeThread.current !== id) return;
      setMessages(
        data.messages.map((message) => ({
          ...message,
          error: message.usage?.status === "incomplete",
          tool_calls: message.usage?.tool_calls || [],
        })),
      );
      setUsage(data.usage || emptyUsage);
      setPending(data.interrupts || []);
      nearBottom.current = true;
      const lastModel = [...data.messages]
        .reverse()
        .find((message) => message.model)?.model;
      if (lastModel) setModel(lastModel);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function upload(file?: File) {
    if (!file || locked || pending.length > 0) return;
    if (!/\.(pdf|txt|md|csv|docx)$/i.test(file.name)) {
      setError("Choose a PDF, TXT, Markdown, CSV, or DOCX document.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("That file is a little large. Choose a document under 4 MB.");
      return;
    }
    setUploading(true);
    setUploadedDocument(null);
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      await request(`/upload?thread_id=${encodeURIComponent(thread)}`, {
        method: "POST",
        body,
      });
      setUploadedDocument(file.name);
      setDraft(
        (value) =>
          value ||
          "Give me a clear summary of this document and its key takeaways.",
      );
      refreshConversations();
      inputRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function send(decision?: { id: string; approved: boolean }) {
    const text = draft.trim();
    if (locked || (!decision && (!text || pending.length > 0))) return;
    window.history.replaceState(
      null,
      "",
      `?chat=${encodeURIComponent(thread)}`,
    );
    setError("");
    setBusy(true);
    if (!decision) setDraft("");
    setModelMenu(false);
    setStatus(decision ? "Resuming the saved graph…" : "Thinking it through");
    nearBottom.current = true;
    setMessages((previous) => [
      ...previous,
      ...(!decision ? [{ role: "user", content: text }] : []),
      { role: "assistant", content: "", model, tool_calls: [] },
    ]);
    let answer = "";
    let finished = false;
    try {
      const response = await fetch("/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          decision
            ? {
                thread_id: thread,
                model,
                interrupt_id: decision.id,
                approval: decision.approved,
              }
            : { message: text, thread_id: thread, model },
        ),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.detail || "Your message could not be sent. Please try again.",
        );
      }
      if (decision) setPending([]);
      await readEvents(response, (event) => {
        if (event.error || event.type === "error")
          throw new Error(event.error || event.content);
        if (event.type === "status") setStatus(event.content);
        if (event.type === "tool") {
          const tool = event.tool as ToolCall;
          setStatus(
            `${tool.name} · ${tool.status === "running" ? "running" : "returned"}`,
          );
          setMessages((previous) => {
            const last = previous[previous.length - 1];
            const calls = last.tool_calls || [];
            return [
              ...previous.slice(0, -1),
              {
                ...last,
                tool_calls: [
                  ...calls.filter((call) => call.id !== tool.id),
                  tool,
                ],
              },
            ];
          });
        }
        if (event.type === "token") {
          answer += event.content;
          setMessages((previous) => [
            ...previous.slice(0, -1),
            { ...previous[previous.length - 1], content: answer },
          ]);
        }
        if (event.type === "done" || event.type === "interrupt") {
          finished = true;
          setMessages((previous) => [
            ...previous.slice(0, -1),
            {
              ...previous[previous.length - 1],
              id: event.message_id,
              content: answer,
              usage: event.usage,
              model: event.model || model,
              tool_calls:
                event.usage?.tool_calls ||
                previous[previous.length - 1].tool_calls,
            },
          ]);
          if (event.thread_usage) setUsage(event.thread_usage);
          if (event.usage)
            setAllUsage((currentUsage) =>
              addUsageSummary(currentUsage, event.usage as Usage),
            );
          setPending(event.interrupts || []);
          markConversationUpdated(thread, decision ? undefined : text);
        }
      });
      if (!finished)
        throw new Error(
          "The connection ended before the reply finished. Reopen this conversation to check what was saved.",
        );
    } catch (err) {
      setError((err as Error).message);
      setMessages((previous) => [
        ...previous.slice(0, -1),
        { ...previous[previous.length - 1], content: answer, error: true },
      ]);
      if (!answer && !decision) setDraft(text);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
      if (!finished) refresh();
    }
  }
  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(
        "Clipboard access is unavailable. You can select and copy the response directly.",
      );
    }
  }
  function exportChat() {
    const content =
      `# ${current?.title || "LazyChat conversation"}\n\n` +
      messages
        .filter((message) => message.content)
        .map(
          (message) =>
            `## ${message.role === "user" ? "You" : "LazyChat"}\n\n${message.content}\n`,
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "lazychat-conversation.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`app-shell ${insights ? "with-insights" : ""}`}>
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebar ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            newChat();
          }}
        >
          <Mark />
          <span>
            lazychat<span className="brand-dot">.</span>
          </span>
        </a>
        <button className="new-chat" onClick={newChat} disabled={locked}>
          <Plus size={19} />
          <span>New conversation</span>
          <SquarePen size={16} />
        </button>
        <button className="nav-search" onClick={() => setModal("search")}>
          <Search size={17} />
          <span>Search chats</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="history-heading">
          <span>THE CHAT TRAIL</span>
          <MessageSquare size={13} />
        </div>
        <nav className="conversation-list" aria-label="Conversations">
          {listError ? (
            <div className="history-empty">
              <p>Couldn't load your conversations.</p>
              <button onClick={refresh}>
                Try again <ArrowUpRight size={14} />
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="history-empty">
              <MessageSquare size={22} strokeWidth={1.3} />
              <p>
                A fresh start.
                <br />
                Your conversations will live here.
              </p>
            </div>
          ) : (
            conversations.map((item) => (
              <button
                disabled={locked}
                className={`conversation ${thread === item.thread_id ? "active" : ""}`}
                key={item.thread_id}
                onClick={() => openChat(item.thread_id)}
              >
                <MessageSquare size={15} />
                <span>{item.title}</span>
                {thread === item.thread_id && <span className="active-dot" />}
              </button>
            ))
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="workspace-usage"
            onClick={() => {
              setUsageScope("workspace");
              setInsights(true);
              setSidebar(false);
            }}
          >
            <div>
              <BarChart3 size={16} />
              <span>Token field notes</span>
              <ArrowUpRight size={14} />
            </div>
            <strong>
              {count(allUsage.total_tokens)} <small>tokens tracked</small>
            </strong>
            <div className="workspace-usage-footer">
              <span>Recorded model cost</span>
              <b>{money(allUsage.cost_usd)}</b>
            </div>
          </button>
          <button className="profile" onClick={() => setModal("about")}>
            <span className="avatar">S</span>
            <span>
              <strong>Subramanian</strong>
              <small>Backend &amp; project author</small>
            </span>
            <MoreHorizontal size={19} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb-home">Portfolio</span>
            <ChevronRight size={14} />
            <span className="breadcrumb-current">
              {current?.title || "Agent playground"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className="workspace-label">
              <span />
              Live agent playground
            </span>
            {messages.length > 0 && (
              <button
                className="icon-button"
                onClick={exportChat}
                aria-label="Export conversation"
                title="Export as Markdown"
              >
                <Download size={18} />
              </button>
            )}
            <button
              className={`icon-button usage-toggle ${insights ? "selected" : ""}`}
              aria-label="Toggle conversation usage"
              aria-pressed={insights}
              onClick={() => {
                setUsageScope("conversation");
                setInsights((value) => !value);
              }}
            >
              <BarChart3 size={19} />
            </button>
            <span className="topbar-avatar">S</span>
          </div>
        </header>
        <div className="work-area">
          <section
            className={`chat-area ${messages.length ? "has-messages" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!locked && !pending.length) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              upload(event.dataTransfer.files[0]);
            }}
          >
            {dragging && (
              <div className="drop-zone">
                <Paperclip size={38} />
                <h2>Drop a little knowledge.</h2>
                <p>PDF, TXT, Markdown, CSV, or DOCX · up to 4 MB</p>
              </div>
            )}
            <div
              className="chat-scroll"
              ref={scrollRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {loading ? (
                <div className="loading-state">
                  <Loader2 className="spin" />
                  <p>Picking up where you left off…</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-stage">
                    <div className="welcome-copy">
                      <div className="welcome-eyebrow">
                        <span>01</span>
                        THE THINKING CORNER
                      </div>
                      <h1>
                        Big questions.
                        <br />
                        <em>Tiny robot energy.</em>
                        <span className="headline-dot">✦</span>
                      </h1>
                      <p className="welcome-description">
                        Bring a question, a document, or a gloriously messy
                        idea.
                        <br className="desktop-break" /> LazyBot will show every
                        tool, pause, token, and human decision along the way.
                      </p>
                    </div>
                    <LazyBot />
                  </div>
                  <div className="starter-grid">
                    {starters.map(({ icon: Icon, ...item }) => (
                      <button
                        key={item.label}
                        className="starter"
                        disabled={locked}
                        onClick={() => {
                          if (!item.prompt) fileRef.current?.click();
                          else {
                            setDraft(item.prompt);
                            inputRef.current?.focus();
                          }
                        }}
                      >
                        <span className={`starter-icon ${item.className}`}>
                          <Icon size={20} strokeWidth={1.6} />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.text}</small>
                        </span>
                        <ArrowUpRight className="starter-arrow" size={16} />
                      </button>
                    ))}
                  </div>
                  <a
                    className="portfolio-credit"
                    href="https://portfolio-subramanian-007.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Built by Subramanian <ArrowUpRight size={14} />
                    <span>
                      Backend authored by me · frontend AI-assisted under my
                      supervision
                    </span>
                  </a>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((message, index) => (
                    <article
                      className={`message ${message.role}`}
                      key={message.id ?? `pending-${index}`}
                    >
                      {message.role === "assistant" && <Mark small />}
                      <div className="message-body">
                        {message.role === "assistant" && (
                          <div className="message-author">
                            LazyChat{" "}
                            <span>
                              {models.find((item) => item.id === message.model)
                                ?.name || ""}
                            </span>
                          </div>
                        )}
                        {message.usage?.decision && (
                          <p className="human-decision">
                            Human decision ·{" "}
                            {message.usage.decision.approved
                              ? "Approved"
                              : "Declined"}
                            . Graph resumed from its checkpoint.
                          </p>
                        )}
                        <ToolActivity
                          calls={
                            message.tool_calls ||
                            message.usage?.tool_calls ||
                            []
                          }
                        />
                        {message.content ? (
                          <div className="markdown">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: (props) => (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                ),
                                pre: (props) => <pre tabIndex={0} {...props} />,
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : busy && index === messages.length - 1 ? (
                          <div className="thinking">
                            <span>
                              <i />
                              <i />
                              <i />
                            </span>
                            {status}
                          </div>
                        ) : message.usage?.status === "interrupted" ? (
                          <p className="interrupt-note">
                            Graph paused here for human approval. Checkpoint
                            saved.
                          </p>
                        ) : (
                          <p className="message-error">
                            {message.error
                              ? "This reply didn’t come through."
                              : "No text returned."}
                          </p>
                        )}
                        {message.role === "assistant" &&
                          (message.content || message.usage) &&
                          !(busy && index === messages.length - 1) && (
                            <div className="message-footer">
                              <button
                                className="icon-button"
                                title="Copy response"
                                aria-label="Copy response"
                                disabled={!message.content}
                                onClick={() => copy(message.content, index)}
                              >
                                {copied === index ? (
                                  <Check size={15} />
                                ) : (
                                  <Copy size={15} />
                                )}
                              </button>
                              {message.usage ? (
                                <button
                                  className="message-usage"
                                  onClick={() => {
                                    setUsageScope("conversation");
                                    setInsights(true);
                                  }}
                                >
                                  <Zap size={12} />
                                  {count(message.usage.total_tokens)} tokens
                                  <span>·</span>
                                  {money(message.usage.cost_usd)}
                                  {!message.usage.cost_complete && (
                                    <span>(partial)</span>
                                  )}
                                </button>
                              ) : (
                                <span className="untracked">
                                  Usage not recorded
                                </span>
                              )}
                              {message.error && (
                                <span className="message-error">
                                  Incomplete reply
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {pending.length > 0 && (
                <div className="approval-stack">
                  {pending.map((item) => (
                    <section
                      className="approval-card"
                      key={item.id}
                      aria-label="Pending tool approval"
                    >
                      <div className="approval-eyebrow">
                        <span /> HUMAN WISDOM REQUESTED
                      </div>
                      <h3>LazyBot hit the big red pause button.</h3>
                      <p>
                        {item.value.message ||
                          "The agent is waiting for your decision."}
                      </p>
                      <div className="approval-action">
                        <code>buy_stocks</code>
                        <span>
                          {item.value.quantity ?? "—"} shares of{" "}
                          <strong>{item.value.symbol || "—"}</strong>
                        </span>
                      </div>
                      <p className="approval-explanation">
                        Simulation only. No real trade is placed. Approve or
                        decline to resume the saved graph.
                      </p>
                      <div className="approval-buttons">
                        <button
                          disabled={locked}
                          className="approve-button"
                          onClick={() => send({ id: item.id, approved: true })}
                        >
                          <Check size={16} /> Approve
                        </button>
                        <button
                          disabled={locked}
                          className="decline-button"
                          onClick={() => send({ id: item.id, approved: false })}
                        >
                          <X size={16} /> Decline
                        </button>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-area">
              {error && (
                <div className="error-banner" role="alert">
                  <CircleHelp size={17} />
                  <span>{error}</span>
                  <button
                    className="icon-button"
                    onClick={() => setError("")}
                    aria-label="Dismiss error"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <form
                className={`composer ${busy ? "is-thinking" : ""}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                {(uploading || uploadedDocument) && (
                  <div
                    className={`attachment ${uploadedDocument ? "is-success" : ""}`}
                    role="status"
                    aria-live="polite"
                    aria-label="Document upload status"
                  >
                    {uploading ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    <span>
                      {uploading
                        ? `Reading ${fileRef.current?.files?.[0]?.name || "your document"}…`
                        : `${uploadedDocument} uploaded successfully`}
                    </span>
                  </div>
                )}
                <label htmlFor="message-input" className="sr-only">
                  Message LazyChat
                </label>
                <textarea
                  id="message-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    pending.length
                      ? "Resolve the approval above to continue…"
                      : "Ask a question. Put the agent to work."
                  }
                  rows={1}
                  maxLength={32000}
                  disabled={loading || pending.length > 0}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <div className="composer-left">
                    <button
                      className="icon-button attach-button"
                      type="button"
                      aria-label="Attach a document"
                      title="Attach a document"
                      disabled={locked || pending.length > 0}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Paperclip size={19} />
                    </button>
                    <span className="toolbar-divider" />
                    <div className="model-select">
                      <button
                        type="button"
                        className="model-button"
                        disabled={locked || pending.length > 0}
                        aria-haspopup="listbox"
                        aria-expanded={modelMenu}
                        onClick={() => setModelMenu((value) => !value)}
                      >
                        <span className="model-symbol">
                          <Asterisk size={17} />
                        </span>
                        {selectedModel.name}
                        <ChevronDown size={13} />
                      </button>
                      {modelMenu && (
                        <>
                          <button
                            type="button"
                            className="menu-dismiss"
                            aria-label="Close model menu"
                            onClick={() => setModelMenu(false)}
                          />
                          <div
                            className="model-menu"
                            role="listbox"
                            aria-label="Choose a model"
                          >
                            <span className="menu-label">
                              CHOOSE YOUR THINKING PARTNER
                            </span>
                            {models.map((item) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={model === item.id}
                                key={item.id}
                                onClick={() => {
                                  setModel(item.id);
                                  setModelMenu(false);
                                }}
                              >
                                <span>
                                  <strong>{item.name}</strong>
                                  <small>{item.description}</small>
                                </span>
                                {model === item.id && <Check size={16} />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="composer-right">
                    <span className="enter-hint">
                      {busy ? "Making room for a good answer" : "Enter to send"}
                    </span>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={!draft.trim() || locked || pending.length > 0}
                      aria-label={busy ? "Generating response" : "Send message"}
                    >
                      {busy ? (
                        <Loader2 size={20} className="spin" />
                      ) : (
                        <ArrowUp size={23} />
                      )}
                    </button>
                  </div>
                </div>
              </form>
              <div className="composer-footnote">
                <span>
                  <Sparkles size={12} /> Tools visible. Human still in charge.
                </span>
                <span>AI can make mistakes. Stay curious.</span>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              accept=".pdf,.txt,.md,.csv,.docx"
              onChange={(event) => upload(event.target.files?.[0])}
            />
          </section>
          {insights && (
            <>
              <button
                className="insights-scrim"
                aria-label="Close usage panel"
                onClick={() => setInsights(false)}
              />
              <UsagePanel
                usage={usageScope === "workspace" ? allUsage : usage}
                scope={usageScope}
                setScope={setUsageScope}
                close={() => setInsights(false)}
              />
            </>
          )}
        </div>
      </main>
      <dialog
        ref={dialogRef}
        className="app-dialog"
        onCancel={() => setModal(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setModal(null);
        }}
      >
        <div className="dialog-content">
          <button
            className="icon-button dialog-close"
            onClick={() => setModal(null)}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
          {modal === "search" ? (
            <>
              <h2>Pick up a thought.</h2>
              <label className="search-input">
                <Search size={19} />
                <input
                  autoFocus
                  placeholder="Search your conversations…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search conversations"
                />
              </label>
              <div className="search-results">
                {conversations
                  .filter((item) =>
                    item.title.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((item) => (
                    <button
                      disabled={locked}
                      key={item.thread_id}
                      onClick={() => openChat(item.thread_id)}
                    >
                      <MessageSquare size={17} />
                      <span>{item.title}</span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                {!conversations.some((item) =>
                  item.title.toLowerCase().includes(query.toLowerCase()),
                ) && (
                  <p>
                    No conversations found. A new thought is always welcome.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <LazyBot compact />
              <h2>Built to show the work.</h2>
              <p>
                A working demonstration of a FastAPI and LangGraph backend:
                tools, document retrieval, saved checkpoints, and human
                approval.
              </p>
              <div className="credits">
                <span>BACKEND & PROJECT</span>
                <strong>Subramanian</strong>
                <span>FRONTEND DESIGN & IMPLEMENTATION</span>
                <strong>AI-assisted, under Subramanian’s supervision</strong>
              </div>
              <p className="about-note">
                Portfolio project · Conversations are stored on this server.
              </p>
            </>
          )}
        </div>
      </dialog>
      <div className="sr-only" role="status" aria-live="polite">
        {busy ? status : uploading ? "Processing document" : ""}
      </div>
    </div>
  );
}
