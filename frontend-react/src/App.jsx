import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stages } from "./stages";
import { uid } from "./utils";
import rawWelcome from "./welcome.md?raw";

// ── Configuration ─────────────────────────────────────────────────────────
/** Delay between sequential intro/response message bubbles, in milliseconds. */
const INTRO_DELAY_MS = 4000;
/** Longer delay for messages marked [slow] in stages.md. */
const SECONDARY_DELAY_MS = 10000;

const defaultSettings = {
  use_gemini: true,
  search_strategy: "auto",
  search_limit: 5,
  gemini_model: "gemini-2.5-flash",
};

const QFT_STEPS = [
  {
    number: 1,
    title: "Question Focus",
    body: "A statement, image, or scenario can spark curiosity without dictating a direction.",
  },
  {
    number: 2,
    title: "Produce Questions",
    body: "Generate as many questions as you can. Don't stop to judge or answer, write every question as asked, and change any statements into questions.",
  },
  {
    number: 3,
    title: "Improve Questions",
    body: "Label each question as open-ended (requires explanation, discussion, or exploration) or closed (can be answered with a single word or fact). Practice converting between types and reflecting on the qualities of each type.",
  },
  {
    number: 4,
    title: "Prioritize Questions",
    body: "Choose your most important questions based on a defined set of criteria.",
  },
  {
    number: 5,
    title: "Next Steps",
    body: "What comes next? Research, writing, an experiment, a conversation, or another stage of inquiry?",
  },
  {
    number: 6,
    title: "Reflect",
    body: "Look back at the process itself. What changed in your thinking? Which step helped you most? How might you use the QFT in future?",
  },
];

function QFTInfoPanel() {
  const [openSteps, setOpenSteps] = useState(() => new Set([1]));
  const [panelOpen, setPanelOpen] = useState(false);
  return (
    <div className="qft-info-panel">
      <div className={`qft-outer-accordion${panelOpen ? " open" : ""}`}>
        <button
          className="qft-outer-btn"
          onClick={() => setPanelOpen((v) => !v)}
          type="button"
        >
          <span className="qft-info-title">What is QFT?</span>
          <span className="material-symbols-rounded qft-chevron">
            {panelOpen ? "expand_less" : "expand_more"}
          </span>
        </button>
        {panelOpen && (
          <>
            <p className="qft-description">
              The Question Formulation Technique (QFT) is a six-stage structured
              process developed by the Right Question Institute to teach
              learners how to formulate, refine, and prioritize their own
              questions.
            </p>
            <ol className="qft-steps qft-steps-nested">
              {QFT_STEPS.map((step) => {
                const isOpen = openSteps.has(step.number);
                return (
                  <li
                    key={step.number}
                    className={`qft-step${isOpen ? " open" : ""}`}
                  >
                    <button
                      className="qft-step-btn"
                      onClick={() =>
                        setOpenSteps((prev) => {
                          const next = new Set(prev);
                          if (next.has(step.number)) next.delete(step.number);
                          else next.add(step.number);
                          return next;
                        })
                      }
                      type="button"
                    >
                      <span className="qft-step-num">{step.number}</span>
                      <span className="qft-step-title">{step.title}</span>
                      <span className="material-symbols-rounded qft-chevron">
                        {isOpen ? "expand_less" : "expand_more"}
                      </span>
                    </button>
                    {isOpen && <div className="qft-step-body">{step.body}</div>}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
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

function buildApiBase() {
  return import.meta.env.VITE_API_URL ?? "http://localhost:8000";
}

// ── Welcome card content (from welcome.md) ────────────────────────────────
const welcomeLines = rawWelcome.split("\n").filter((l) => l.trim());
const welcomeTitle = welcomeLines[0].replace(/^#+\s*/, "");
const welcomeBody = welcomeLines.slice(1).join(" ").trim();

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

function hasStoredChat(stageId) {
  try {
    return localStorage.getItem(`qc-chat-${stageId}`) !== null;
  } catch {
    return false;
  }
}

function loadStageChat(stageId, defaultMessages) {
  try {
    const raw = localStorage.getItem(`qc-chat-${stageId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return defaultMessages;
}

function saveStageChat(stageId, msgs) {
  try {
    localStorage.setItem(`qc-chat-${stageId}`, JSON.stringify(msgs));
  } catch {
    // ignore storage errors
  }
}

export default function App() {
  const API = useMemo(buildApiBase, []);

  // ── Core pipeline state ────────────────────────────────────────────────────
  const [memory, setMemory] = useState(initialMemory);
  const [stageIndex, setStageIndex] = useState(0);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [stagePrompts, setStagePrompts] = useState({});
  const [statusText, setStatusText] = useState("Connecting…");
  const [snackbar, setSnackbar] = useState("");
  const [messages, setMessages] = useState(() => {
    const s0 = stages[0];
    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: s0.instruction,
      stageIndex: 0,
      isCoach: true,
      createdAt: new Date().toISOString(),
    };
    return loadStageChat(s0.id, [defaultMsg]);
  });
  const [settings] = useState(defaultSettings);
  const [showFinishModal, setShowFinishModal] = useState(false);

  const stage = stages[stageIndex];
  const hasWorkspace = stage.inputType !== "textarea";
  const hasInfoPanel = stage.id === "question-focus" || stage.id === "reflect";

  const messagesRef = useRef(null);
  const introTimers = useRef([]);
  // Track whether stage 0 was a fresh (first-visit) load before messages were saved
  const initialWasFresh = useRef(!hasStoredChat(stages[0].id));

  function clearIntroTimers() {
    introTimers.current.forEach(clearTimeout);
    introTimers.current = [];
  }

  function scheduleIntroParts(parts, stageIdx, delayMs) {
    let elapsed = 0;
    parts.forEach((raw) => {
      const slow = raw.startsWith("[slow]");
      const text = slow ? raw.slice(6).trimStart() : raw;
      const wait = slow ? SECONDARY_DELAY_MS : delayMs;
      elapsed += wait;
      const id = setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            text,
            stageIndex: stageIdx,
            isCoach: true,
            createdAt: new Date().toISOString(),
          },
        ]);
      }, elapsed);
      introTimers.current.push(id);
    });
  }

  // ── Scroll to bottom when messages change ─────────────────────────────────
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isProcessing]);

  // ── Schedule delayed intro parts for stage 0 on first visit ──────────────
  useEffect(() => {
    if (initialWasFresh.current && stages[0].messageParts?.length > 0) {
      scheduleIntroParts(stages[0].messageParts, 0, INTRO_DELAY_MS);
    }
    return () => clearIntroTimers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist current stage chat to localStorage ────────────────────────────
  useEffect(() => {
    saveStageChat(stage.id, messages);
  }, [messages, stage.id]);

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
          setStatusText(count != null ? `${count} vectors indexed` : "");
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

    clearIntroTimers();
    saveStageChat(stage.id, messages);

    const next = stages[nextIndex];
    const isFresh = !hasStoredChat(next.id);
    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: next.instruction,
      stageIndex: nextIndex,
      isCoach: true,
      createdAt: new Date().toISOString(),
    };

    setStageIndex(nextIndex);
    setMessages(loadStageChat(next.id, [defaultMsg]));

    if (isFresh && next.messageParts?.length > 0) {
      scheduleIntroParts(next.messageParts, nextIndex, INTRO_DELAY_MS);
    }
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
      const parts = data.response
        .split("\n\n")
        .map((p) => p.trim())
        .filter(Boolean);
      const sources = data.sources || [];

      // First part appears immediately
      pushMessage({
        role: "assistant",
        text: parts[0] ?? data.response,
        sources: parts.length <= 1 ? sources : [],
        stageIndex,
      });

      // Remaining parts arrive with a delay
      parts.slice(1).forEach((text, i) => {
        const isLast = i === parts.length - 2;
        const id = setTimeout(
          () => {
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                text,
                sources: isLast ? sources : [],
                stageIndex,
                createdAt: new Date().toISOString(),
              },
            ]);
          },
          INTRO_DELAY_MS * (i + 1),
        );
        introTimers.current.push(id);
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

  /** Clear all stage chats from localStorage and restart from stage 1. */
  function handleReset() {
    if (!window.confirm("Clear all chat history and start over?")) return;
    clearIntroTimers();
    stages.forEach((s) => localStorage.removeItem(`qc-chat-${s.id}`));
    const s0 = stages[0];
    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: s0.instruction,
      stageIndex: 0,
      isCoach: true,
      createdAt: new Date().toISOString(),
    };
    setStageIndex(0);
    setMessages([defaultMsg]);
    setMemory(initialMemory());
    if (s0.messageParts?.length > 0) {
      scheduleIntroParts(s0.messageParts, 0, INTRO_DELAY_MS);
    }
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

  function generateSessionMarkdown() {
    const lines = ["# Question Coach — Session Summary", ""];
    const filled = memory.questions.filter((q) => q.text.trim());

    stages.forEach((s, idx) => {
      lines.push(`## Stage ${s.number}: ${s.name}`, "");

      // Workspace output per stage
      if (s.id === "produce-questions" && filled.length) {
        lines.push("### Questions", "");
        filled.forEach((q, i) => lines.push(`${i + 1}. ${q.text.trim()}`));
        lines.push("");
      }
      if (s.id === "improve-questions" && filled.length) {
        const open = filled.filter(
          (q) => memory.classifications[q.id] === "open",
        );
        const closed = filled.filter(
          (q) => memory.classifications[q.id] === "closed",
        );
        const unsorted = filled.filter((q) => !memory.classifications[q.id]);
        lines.push("### Classifications", "");
        lines.push("**Open questions:**");
        (open.length ? open : []).forEach((q, i) =>
          lines.push(`${i + 1}. ${q.text}`),
        );
        if (!open.length) lines.push("*(none)*");
        lines.push("");
        lines.push("**Closed questions:**");
        (closed.length ? closed : []).forEach((q, i) =>
          lines.push(`${i + 1}. ${q.text}`),
        );
        if (!closed.length) lines.push("*(none)*");
        lines.push("");
        if (unsorted.length) {
          lines.push("**Unsorted:**");
          unsorted.forEach((q, i) => lines.push(`${i + 1}. ${q.text}`));
          lines.push("");
        }
      }
      if (s.id === "prioritize-questions" && filled.length) {
        const starredSet = new Set(memory.starred ?? []);
        const ranked = memory.priorities
          .map((id) => filled.find((q) => q.id === id))
          .filter(Boolean);
        lines.push("### Priority Ranking", "");
        ranked.forEach((q, i) =>
          lines.push(`${i + 1}. ${starredSet.has(q.id) ? "★ " : ""}${q.text}`),
        );
        lines.push("");
      }

      // Chat history for this stage
      let chat;
      try {
        const raw = localStorage.getItem(`qc-chat-${s.id}`);
        chat = raw ? JSON.parse(raw) : idx === stageIndex ? messages : [];
      } catch {
        chat = idx === stageIndex ? messages : [];
      }
      if (chat.length) {
        lines.push("### Chat", "");
        chat.forEach((msg) => {
          const who = msg.role === "user" ? "**You**" : "**Coach**";
          lines.push(`${who}: ${msg.text}`, "");
        });
      }
    });

    return lines.join("\n");
  }

  function downloadMarkdown() {
    const md = generateSessionMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "question-coach-session.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hintParts = [
    statusText,
    "Enter to send · Shift+Enter for new line",
  ].filter(Boolean);

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

        <div className="app-bar-trailing">
          <a
            className="md-text-btn app-bar-kb-link"
            href="https://etec51165a-knowledgebase-aicoach.figma.site/"
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="material-symbols-rounded mini-icon">
              menu_book
            </span>
            Knowledge Base
          </a>
          <div className="stage-pips" aria-label="Stage progress">
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
          <button
            className="icon-btn"
            title="Reset all chats"
            onClick={handleReset}
            type="button"
          >
            <span className="material-symbols-rounded">restart_alt</span>
          </button>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main className="content-grid">
        {/* Chat column — messages + input in one frame */}
        <section className="chat-column">
          <div className="chat-messages" ref={messagesRef}>
            {stageIndex === 0 && (
              <div className="welcome-card">
                <h2>{welcomeTitle}</h2>
                <p>{welcomeBody}</p>
              </div>
            )}

            {messages.map((message) => (
              <div
                className={`msg-row ${message.role}`}
                key={message.id}
                data-msg-id={message.id}
              >
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
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="msg-row assistant">
                <div className="msg-body">
                  <div className="typing-bubble">
                    <div className="t-dot" />
                    <div className="t-dot" />
                    <div className="t-dot" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input — always at bottom of chat frame */}
          <div className="chat-input-area">
            <div className="input-row">
              <div className="input-field-wrap">
                <textarea
                  className="md-textarea"
                  id="msgInput"
                  placeholder={
                    isConnected
                      ? stage.placeholder
                      : "Waiting for API connection…"
                  }
                  value={draftText}
                  disabled={!isConnected || isProcessing}
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
            <div className="input-hint">{hintParts.join(" · ")}</div>
          </div>
        </section>

        {/* Right panel — always present on all stages */}
        <aside className="stage-panel">
          <div className="panel-card">
            <div className="panel-content">
              {hasInfoPanel && <QFTInfoPanel />}
              {hasWorkspace && (
                <stage.Component
                  input={stage.input(memory)}
                  onSubmit={handleStageResult}
                  onSend={handleSubmitStage}
                  {...(stage.inputType === "categorize" && {
                    onQuestionClick: (text) => setDraftText(text),
                  })}
                />
              )}
            </div>
            <div className="panel-nav">
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
              {stageIndex === stages.length - 1 ? (
                <button
                  className="md-tonal-btn"
                  onClick={() => setShowFinishModal(true)}
                  type="button"
                >
                  Finish
                  <span className="material-symbols-rounded mini-icon">
                    check
                  </span>
                </button>
              ) : (
                <button
                  className="md-tonal-btn"
                  onClick={() => goToStage(stageIndex + 1)}
                  type="button"
                >
                  Next stage
                  <span className="material-symbols-rounded mini-icon">
                    arrow_forward
                  </span>
                </button>
              )}
            </div>
          </div>
        </aside>
      </main>

      {showFinishModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowFinishModal(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="material-symbols-rounded modal-icon">
                celebration
              </span>
              <h2 className="modal-title">Well done!</h2>
            </div>
            <p className="modal-body">
              You've completed all six stages of the Question Formulation
              Technique. Download a summary of your session — including your
              chat history and question workspace — as a Markdown file.
            </p>
            <div className="modal-actions">
              <button
                className="md-tonal-btn"
                onClick={downloadMarkdown}
                type="button"
              >
                <span className="material-symbols-rounded mini-icon">
                  download
                </span>
                Download session
              </button>
              <button
                className="md-text-btn"
                onClick={() => {
                  setShowFinishModal(false);
                  handleReset();
                }}
                type="button"
              >
                <span className="material-symbols-rounded mini-icon">
                  restart_alt
                </span>
                Start over
              </button>
              <button
                className="md-text-btn"
                onClick={() => setShowFinishModal(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`snackbar ${snackbar ? "show" : ""}`}>{snackbar}</div>
    </div>
  );
}
