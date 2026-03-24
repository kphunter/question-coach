import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stages } from "./stages";
import { uid } from "./utils";

const QFT_STEPS = [
  {
    number: 1,
    title: "Develop a Question Focus",
    body: "A statement, image, or scenario can spark curiosity without dictating a direction.",
  },
  {
    number: 2,
    title: "Produce Questions",
    body: "Generate as many questions as you can. Don't stop to judge or answer, write every question as asked, and change any statements into questions.",
  },
  {
    number: 3,
    title: "Categorize Questions",
    body: "Label each question as open-ended (requires explanation, discussion, or exploration) or closed (can be answered with a single word or fact).",
  },
  {
    number: 4,
    title: "Improve Questions",
    body: "Practice converting between types and reflecting on the qualities of each type.",
  },
  {
    number: 5,
    title: "Prioritize Questions",
    body: "Choose your most important questions based on a defined set of criteria.",
  },
  {
    number: 6,
    title: "Discuss Next Steps",
    body: "What comes next? Research, writing, an experiment, a conversation, or another stage of inquiry?",
  },
  {
    number: 7,
    title: "Reflect on QFT",
    body: "Look back at the process itself. What changed in your thinking? Which step helped you most? How might you use the QFT in future?",
  },
];

function QFTInfoPanel() {
  return (
    <div className="qft-info-panel">
      <div className="qft-info-header">
        <span className="qft-info-title">
          The Question Formulation Technique
        </span>
      </div>
      <ol className="qft-steps">
        {QFT_STEPS.map((step) => (
          <li key={step.number} className="qft-step">
            <div className="qft-step-title">{step.title}</div>
            <div className="qft-step-body">{step.body}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourcesToggle({ sources }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sources-toggle">
      <button
        className="sources-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
      >
        <span className="material-symbols-rounded">library_books</span>
        {sources.length} source{sources.length === 1 ? "" : "s"}
        <span className="material-symbols-rounded sources-chevron">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="sources-list">
          {sources.map((source, index) => (
            <a
              className="source-chip"
              href={source.url || "#"}
              key={index}
              rel="noreferrer noopener"
              target="_blank"
            >
              <span className="material-symbols-rounded">description</span>
              {source.title || "Source"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const defaultSettings = {
  use_gemini: true,
  search_strategy: "auto",
  search_limit: 5,
  gemini_model: "gemini-2.5-flash",
};

function buildApiBase() {
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

/** @returns {import('./stages').SharedMemory} */
function initialMemory() {
  return {
    questions: [{ id: uid(), text: "" }],
    classifications: {},
    priorities: [],
    starred: [],
    stageNotes: {},
  };
}

export default function App() {
  const API = useMemo(buildApiBase, []);

  // ── Core pipeline state ────────────────────────────────────────────────────
  const [memory, setMemory] = useState(initialMemory);
  const [stageIndex, setStageIndex] = useState(0);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [stagePrompts, setStagePrompts] = useState({});
  const [statusText, setStatusText] = useState("Connecting…");
  const [snackbar, setSnackbar] = useState("");
  const [messages, setMessages] = useState(() => [
    {
      id: uid(),
      role: "assistant",
      text: `**${stages[0].heading}**\n\n${stages[0].description}\n\n${stages[0].instruction}`,
      stageIndex: 0,
      isCoach: true,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [settings, setSettings] = useState(defaultSettings);

  const stage = stages[stageIndex];
  const hasWorkspace = stage.inputType !== "textarea";
  const hasInfoPanel = stage.id === "question-focus" || stage.id === "reflect";

  const chatAreaRef = useRef(null);
  const chatBottomRef = useRef(null);
  const pendingScrollToTopId = useRef(null);
  const [chatSpacerHeight, setChatSpacerHeight] = useState(0);

  // ── Keep spacer = 60% of container height — enough for any instruction bubble to reach the top
  useEffect(() => {
    const container = chatAreaRef.current;
    if (!container) return;
    const update = () =>
      setChatSpacerHeight(Math.round(container.clientHeight * 0.6));
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, []);

  // ── Scroll: pin new stage instruction to top; scroll down only when content overflows
  useEffect(() => {
    const container = chatAreaRef.current;
    if (!container) return;

    if (pendingScrollToTopId.current) {
      const el = container.querySelector(
        `[data-msg-id="${pendingScrollToTopId.current}"]`,
      );
      if (el) {
        pendingScrollToTopId.current = null;
        const CHAT_PADDING = 18;
        const relativeTop =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top;
        container.scrollTo({
          top: container.scrollTop + relativeTop - CHAT_PADDING,
          behavior: "smooth",
        });
        return;
      }
    }

    // Only scroll down if the bottom sentinel has gone below the visible area
    const bottomEl = chatBottomRef.current;
    if (bottomEl) {
      const overflow =
        bottomEl.getBoundingClientRect().bottom -
        container.getBoundingClientRect().bottom;
      if (overflow > 0) {
        container.scrollTo({
          top: container.scrollTop + overflow,
          behavior: "smooth",
        });
      }
    }
  }, [messages, isProcessing]);

  // ── Reset draft when changing stages ──────────────────────────────────────
  useEffect(() => {
    setDraftText("");
  }, [stageIndex]);

  // ── Fetch stage prompts + poll health ─────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function fetchStages() {
      try {
        const response = await fetch(`${API}/stages`);
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        const next = {};
        data.forEach((item) => {
          if (item.id && item.system_prompt) next[item.id] = item.system_prompt;
        });
        setStagePrompts(next);
      } catch {
        // non-fatal
      }
    }

    async function checkHealth() {
      try {
        const response = await fetch(`${API}/health`);
        const data = await response.json();
        const ok = data.status === "healthy" || data.status === "degraded";
        if (!active) return;
        setIsConnected(ok);
        if (ok) {
          const count = data.collection_count;
          setStatusText(
            count != null
              ? `Connected · ${count} vectors indexed`
              : "Connected",
          );
        } else {
          setStatusText("Disconnected — check API server");
        }
      } catch {
        if (!active) return;
        setIsConnected(false);
        setStatusText("Disconnected — check API server");
      }
    }

    fetchStages();
    checkHealth();
    const interval = window.setInterval(checkHealth, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [API]);

  // ── Snackbar auto-dismiss ─────────────────────────────────────────────────
  useEffect(() => {
    if (!snackbar) return undefined;
    const timer = window.setTimeout(() => setSnackbar(""), 3500);
    return () => window.clearTimeout(timer);
  }, [snackbar]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pushMessage(message) {
    setMessages((prev) => [
      ...prev,
      { id: uid(), createdAt: new Date().toISOString(), ...message },
    ]);
  }

  function goToStage(nextIndex) {
    if (nextIndex < 0 || nextIndex >= stages.length || nextIndex === stageIndex)
      return;
    const dir = nextIndex > stageIndex ? 1 : -1;
    const next = stages[nextIndex];
    setStageIndex(nextIndex);
    pushMessage({
      role: "assistant",
      text: `${dir > 0 ? "Moving to" : "Back to"} ${next.heading}`,
      stageIndex: nextIndex,
      isMarker: true,
    });
    const instructionId = uid();
    pendingScrollToTopId.current = instructionId;
    pushMessage({
      id: instructionId,
      role: "assistant",
      text: `**${next.heading}**\n\n${next.description}\n\n${next.instruction}`,
      stageIndex: nextIndex,
      isCoach: true,
    });
  }

  function updateSettings(name, value) {
    setSettings((prev) => ({ ...prev, [name]: value }));
  }

  /** Called by stage components on every live edit — merges into shared memory. */
  function handleStageResult(result) {
    setMemory((prev) => stage.output(result, prev));
  }

  /** Core send logic — takes already-resolved text. */
  async function sendToBackend(bodyText) {
    if (!isConnected || isProcessing) return;
    const contextualMsg = `[QFT ${stage.heading}]\n\n${bodyText}`;
    pushMessage({ role: "user", text: bodyText, stageIndex });
    setIsProcessing(true);
    try {
      const payload = {
        message: contextualMsg,
        search_limit: Number(settings.search_limit),
        search_strategy: settings.search_strategy,
        use_gemini: settings.use_gemini,
        gemini_model: settings.gemini_model,
        system_prompt: stagePrompts[stage.number] ?? null,
      };
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let detail = "Request failed";
        try {
          detail = (await response.json()).detail || detail;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const data = await response.json();
      pushMessage({
        role: "assistant",
        text: data.response,
        sources: data.sources || [],
        stageIndex,
      });
    } catch (error) {
      pushMessage({
        role: "assistant",
        text: `Sorry, I ran into an error: ${error.message}`,
        stageIndex,
      });
      setSnackbar(error.message);
    } finally {
      setIsProcessing(false);
    }
  }

  /** Send the free-form chat textarea. */
  function handleSendChat() {
    const text = draftText.trim();
    if (!text) {
      setSnackbar("Enter a message first.");
      return;
    }
    setDraftText("");
    sendToBackend(text);
  }

  /** Submit serialized stage data (questions / classifications / priorities). */
  function handleSubmitStage() {
    const text = stage.serialize(memory, draftText);
    if (!text) {
      setSnackbar("Add at least one question first.");
      return;
    }
    sendToBackend(text);
  }

  return (
    <div className="app-shell">
      {/* ── App bar ────────────────────────────────────────────────────── */}
      <header className="app-bar">
        <div className="app-bar-leading">
          <span className="material-symbols-rounded app-bar-icon">
            psychology_alt
          </span>
          <span className="app-bar-title">Question Coach</span>
          <span
            className={`status-dot ${isConnected ? "connected" : ""}`}
            aria-hidden="true"
          />
        </div>

        <div className="stage-pips-wrap" aria-label="Stage progress">
          <span className="stage-pips-label">Stages</span>
          <div className="stage-pips">
            {stages.map((item, index) => {
              const state =
                index < stageIndex
                  ? "completed"
                  : index === stageIndex
                    ? "active"
                    : "";
              return (
                <div
                  key={item.id}
                  className={`stage-pip ${state}`}
                  aria-label={item.name}
                  title={item.name}
                >
                  {state === "completed" ? (
                    <span
                      className="material-symbols-rounded"
                      style={{ fontSize: 13 }}
                    >
                      check
                    </span>
                  ) : (
                    item.number
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="app-bar-actions">
          <button
            className="md-text-btn"
            onClick={() => goToStage(stageIndex - 1)}
            disabled={stageIndex === 0}
            type="button"
          >
            <span className="material-symbols-rounded mini-icon">
              arrow_back
            </span>
            Back
          </button>
          <button
            className="md-tonal-btn"
            onClick={() => goToStage(stageIndex + 1)}
            disabled={stageIndex === stages.length - 1}
            type="button"
          >
            Next stage
            <span className="material-symbols-rounded mini-icon">
              arrow_forward
            </span>
          </button>
          <button
            className={`icon-btn ${settingsOpen ? "active" : ""}`}
            title="Settings"
            onClick={() => setSettingsOpen((prev) => !prev)}
            type="button"
          >
            <span className="material-symbols-rounded">settings</span>
          </button>

          {settingsOpen && (
            <div className="settings-panel open">
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">AI Responses</div>
                  <div className="settings-row-sub">
                    Generate a response using Gemini
                  </div>
                </div>
                <label className="switch-label">
                  <span className="md-switch">
                    <input
                      type="checkbox"
                      id="geminiToggle"
                      checked={settings.use_gemini}
                      onChange={(event) =>
                        updateSettings("use_gemini", event.target.checked)
                      }
                    />
                    <span className="switch-track" />
                    <span className="switch-thumb" />
                  </span>
                </label>
              </div>

              <div className="settings-divider" />

              <div className="settings-row">
                <div>
                  <div className="settings-row-label">Search strategy</div>
                  <div className="settings-row-sub">
                    How the knowledge base is queried
                  </div>
                </div>
                <select
                  className="md-select"
                  id="searchStrategy"
                  value={settings.search_strategy}
                  onChange={(event) =>
                    updateSettings("search_strategy", event.target.value)
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="semantic">Semantic</option>
                  <option value="exact">Exact</option>
                  <option value="hybrid_rrf">Hybrid</option>
                </select>
              </div>

              <div className="settings-row">
                <div>
                  <div className="settings-row-label">Sources returned</div>
                  <div className="settings-row-sub">
                    Number of knowledge base chunks
                  </div>
                </div>
                <select
                  className="md-select"
                  id="searchLimit"
                  value={String(settings.search_limit)}
                  onChange={(event) =>
                    updateSettings("search_limit", Number(event.target.value))
                  }
                >
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="7">7</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main
        className={`content-grid ${hasWorkspace ? "has-workspace" : ""}${hasInfoPanel ? " has-info-panel" : ""}`}
      >
        <section className="chat-area" ref={chatAreaRef}>
          <div className="welcome-card">
            <h2>Welcome!</h2>
            <p>
              This is a place to help get you started with refining your
              research question.
            </p>
          </div>

          {messages.map((message) => {
            if (message.isMarker) {
              return (
                <div className="stage-marker" key={message.id}>
                  <span className="material-symbols-rounded">
                    compare_arrows
                  </span>
                  <span className="stage-marker-text">{message.text}</span>
                </div>
              );
            }
            return (
              <div
                className={`msg-row ${message.role}`}
                key={message.id}
                data-msg-id={message.id}
              >
                <div className={`msg-avatar ${message.role}`}>
                  {message.role === "user" ? "You" : "QC"}
                </div>
                <div className="msg-body">
                  <div className="msg-bubble">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                  {message.sources?.length > 0 && (
                    <SourcesToggle sources={message.sources} />
                  )}
                  <div className="msg-time">
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {isProcessing && (
            <div className="msg-row assistant">
              <div className="msg-avatar assistant">QC</div>
              <div className="msg-body">
                <div className="typing-bubble">
                  <div className="t-dot" />
                  <div className="t-dot" />
                  <div className="t-dot" />
                </div>
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
          <div
            style={{ height: chatSpacerHeight, flexShrink: 0 }}
            aria-hidden="true"
          />
        </section>

        {hasInfoPanel && (
          <aside className="stage-panel">
            <div className="panel-card">
              <QFTInfoPanel />
            </div>
          </aside>
        )}

        {hasWorkspace && (
          <aside className="stage-panel">
            <div className="panel-card">
              <stage.Component
                input={stage.input(memory)}
                onSubmit={handleStageResult}
                onSend={handleSubmitStage}
                {...(stage.inputType === "categorize" && {
                  onQuestionClick: (text) => setDraftText(text),
                })}
              />
            </div>
          </aside>
        )}
      </main>

      {/* ── Footer — always-visible chat input ─────────────────────────── */}
      <footer className="input-area">
        <div className="input-row">
          <div className="input-field-wrap">
            <textarea
              className="md-textarea"
              id="msgInput"
              rows="1"
              placeholder={stage.placeholder}
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSendChat();
                }
              }}
            />
          </div>
          <button
            className="send-fab"
            id="sendBtn"
            disabled={!isConnected || isProcessing}
            title="Send"
            onClick={handleSendChat}
            type="button"
          >
            <span className="material-symbols-rounded">send</span>
          </button>
        </div>
        <div className="input-hint">
          {statusText} · Enter to send · Shift+Enter for new line
        </div>
      </footer>

      <div className={`snackbar ${snackbar ? "show" : ""}`}>{snackbar}</div>
    </div>
  );
}
