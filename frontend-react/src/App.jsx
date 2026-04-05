// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
  gemini_model: "gemini-2.5-flash-lite",
};


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

// ── Stage pip groups (merged display for multi-part stages) ───────────────
const PIP_GROUPS = [
  { label: "1", ids: ["question-focus"] },
  { label: "2", ids: ["produce-questions-a", "produce-questions-b"] },
  { label: "3", ids: ["improve-questions"] },
  { label: "4", ids: ["prioritize-questions-a", "prioritize-questions-b"] },
  { label: "5", ids: ["next-steps"] },
  { label: "6", ids: ["reflect"] },
];

// ── Welcome card content (from welcome.md) ────────────────────────────────
const welcomeLines = rawWelcome.split("\n").filter((l) => l.trim());
const welcomeTitle = welcomeLines[0].replace(/^#+\s*/, "");
const welcomeBody = welcomeLines.slice(1).join(" ").trim();

const MEMORY_KEY = "qc-memory";

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

function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return initialMemory();
}

function saveMemory(mem) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
  } catch {
    // ignore
  }
}

function hasStoredChat(stageId) {
  try {
    const raw = localStorage.getItem(`qc-chat-${stageId}`);
    if (!raw) return false;
    const msgs = JSON.parse(raw);
    // Only consider a stage "stored" if it has more than just the initial
    // instruction message — otherwise the intro sequence hasn't played yet.
    return Array.isArray(msgs) && msgs.length > 1;
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

/** Returns the last coach message from Stage 1, used to pass the question focus forward. */
function getStage1Focus() {
  try {
    const raw = localStorage.getItem('qc-chat-question-focus');
    if (!raw) return null;
    const msgs = JSON.parse(raw);
    // API responses have role "assistant" but no isCoach flag.
    // Skip intro bubbles (isCoach: true) and the final "click Next stage"
    // instruction, to land on the transition message containing the focus.
    const focus = [...msgs].reverse().find(
      (m) => m.role === "assistant" && !m.isCoach && !/next stage/i.test(m.text)
    );
    if (!focus) return null;
    // Keep only the focus sentence; drop the "Does this feel…" confirmation.
    let text = focus.text.split(/does this feel/i)[0].trim().replace(/[.,!?]+$/, "").trim();
    // Strip common preamble prefixes the model adds before the statement.
    text = text.replace(/^(your\s+)?(?:question\s+)?focus\s+(?:is\s*(?:on\s*)?|on\s*)?[:\-–]?\s*/i, "");
    // Capitalise first letter.
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return text || focus.text;
  } catch {
    return null;
  }
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
  const [memory, setMemory] = useState(loadMemory);
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
      isInstruction: true,
      createdAt: new Date().toISOString(),
    };
    return loadStageChat(s0.id, [defaultMsg]);
  });
  const [settings] = useState(defaultSettings);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [highlightNextBtn, setHighlightNextBtn] = useState(false);
  const [highlightPips, setHighlightPips] = useState(false);

  const stage = stages[stageIndex];
  const hasWorkspace = stage.inputType !== "textarea";

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const introTimers = useRef([]);
  // Track whether stage 0 was a fresh (first-visit) load before messages were saved
  const initialWasFresh = useRef(!hasStoredChat(stages[0].id));

  function clearIntroTimers() {
    introTimers.current.forEach(clearTimeout);
    introTimers.current = [];
  }

  /** Flash the Next Stage button twice when Stage 1's Message 2 appears. */
  function scheduleStage0Highlight(parts) {
    if (parts.length < 2) return;
    let elapsed = 0;
    const timings = parts.map((raw) => {
      elapsed += raw.startsWith("[slow]") ? SECONDARY_DELAY_MS : INTRO_DELAY_MS;
      return elapsed;
    });
    const showAt = timings[1]; // when Message 2 appears
    // Flash Next Stage button three times at 0.5s intervals starting at Message 2
    [
      [showAt,          true],
      [showAt +  500,   false],
      [showAt + 1000,   true],
      [showAt + 1500,   false],
      [showAt + 2000,   true],
      [showAt + 2500,   false],
    ].forEach(([delay, value]) => {
      introTimers.current.push(setTimeout(() => setHighlightNextBtn(value), delay));
    });

    // Flash all stage pips three times at 0.5s intervals starting at Message 3
    const pipsAt = timings[2];
    if (pipsAt != null) {
      [
        [pipsAt,          true],
        [pipsAt +  500,   false],
        [pipsAt + 1000,   true],
        [pipsAt + 1500,   false],
        [pipsAt + 2000,   true],
        [pipsAt + 2500,   false],
      ].forEach(([delay, value]) => {
        introTimers.current.push(setTimeout(() => setHighlightPips(value), delay));
      });
    }
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
      scheduleStage0Highlight(stages[0].messageParts);
    }
    return () => clearIntroTimers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist current stage chat to localStorage ────────────────────────────
  useEffect(() => {
    saveStageChat(stage.id, messages);
  }, [messages, stage.id]);

  // ── Persist workspace memory (questions, classifications, etc.) ────────────
  useEffect(() => {
    saveMemory(memory);
  }, [memory]);

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
    const interval = window.setInterval(checkHealth, 60000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [API]);

  // ── Refocus chat input after response ────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) inputRef.current?.focus();
  }, [isProcessing]);

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
      isInstruction: true,
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

    // Capture history BEFORE pushing the new user message
    const history = messages
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.isCoach || m.role === "assistant" ? "model" : "user", text: m.text }));

    pushMessage({ role: "user", text: bodyText, stageIndex });
    setIsProcessing(true);
    try {
      let systemPrompt = stagePrompts[stage.promptId] ?? null;
      if (stage.id !== 'question-focus') {
        const focus = getStage1Focus();
        if (focus) {
          const prefix = `CONTEXT — Student's question focus from Stage 1:\n${focus}\n\n---\n\n`;
          systemPrompt = systemPrompt ? prefix + systemPrompt : prefix.trim();
        }
      }
      if (stage.id === 'next-steps') {
        const top3 = memory.priorities
          .slice(0, 3)
          .map((id) => memory.questions.find((q) => q.id === id))
          .filter((q) => q?.text?.trim())
          .map((q, i) => `${i + 1}. ${q.text.trim()}`)
          .join('\n');
        if (top3) {
          const prefix = `CONTEXT — Student's top 3 questions from Stage 4:\n${top3}\n\n---\n\n`;
          systemPrompt = systemPrompt ? prefix + systemPrompt : prefix.trim();
        }
      }

      const payload = {
        message: contextualMsg,
        history,
        search_limit: Number(settings.search_limit),
        search_strategy: settings.search_strategy,
        use_gemini: settings.use_gemini,
        gemini_model: settings.gemini_model,
        system_prompt: systemPrompt,
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
      // Strip any [QFT ...] stage-prefix artifacts the model occasionally echoes
      const cleanedResponse = data.response.replace(/\[QFT[^\]]*\]/gi, "").trim();
      const parts = cleanedResponse
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
    localStorage.removeItem(MEMORY_KEY);
    const s0 = stages[0];
    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: s0.instruction,
      stageIndex: 0,
      isCoach: true,
      isInstruction: true,
      createdAt: new Date().toISOString(),
    };
    setStageIndex(0);
    setMessages([defaultMsg]);
    setMemory(initialMemory());
    setHighlightNextBtn(false);
    setHighlightPips(false);
    if (s0.messageParts?.length > 0) {
      scheduleIntroParts(s0.messageParts, 0, INTRO_DELAY_MS);
      scheduleStage0Highlight(s0.messageParts);
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
      lines.push(`## ${s.heading}`, "");

      // Workspace output per stage
      if (s.id === "produce-questions-a" && filled.length) {
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
      if (s.id === "prioritize-questions-b" && filled.length) {
        const ranked = memory.priorities
          .map((id) => filled.find((q) => q.id === id))
          .filter(Boolean)
          .slice(0, 3);
        lines.push("### Priority Ranking", "");
        ranked.forEach((q, i) => lines.push(`${i + 1}. ${q.text}`));
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
          <div className="app-bar-title-group">
            <span className="app-bar-title">Question Coach</span>
            <span className="app-bar-subtitle">A guide for structured brainstorming</span>
          </div>
        </div>

        <div className="app-bar-trailing">
          <span
            className={`status-dot ${isConnected ? "connected" : ""}`}
            aria-hidden="true"
          />
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
          <div className={`stage-pips${highlightPips ? " pips-highlighted" : ""}`} aria-label="Stage progress">
            {PIP_GROUPS.map((group) => {
              const indices = group.ids.map((id) =>
                stages.findIndex((s) => s.id === id),
              );
              const minIdx = Math.min(...indices);
              const maxIdx = Math.max(...indices);
              const isActive = stageIndex >= minIdx && stageIndex <= maxIdx;
              const isCompleted = stageIndex > maxIdx;
              const state = isCompleted ? "completed" : isActive ? "active" : "";
              const firstStage = stages[minIdx];
              return (
                <div
                  key={group.label}
                  className={`stage-pip ${state}`}
                  title={firstStage?.heading ?? group.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => goToStage(minIdx)}
                  onKeyDown={(e) => e.key === "Enter" && goToStage(minIdx)}
                >
                  {isCompleted ? (
                    <span
                      className="material-symbols-rounded"
                      style={{ fontSize: 13 }}
                    >
                      check
                    </span>
                  ) : (
                    group.label
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

            {stageIndex > 0 && (() => {
              const isLateStage = stage.id === 'next-steps';
              if (isLateStage) {
                const top3 = memory.priorities
                  .slice(0, 3)
                  .map((id) => memory.questions.find((q) => q.id === id))
                  .filter((q) => q?.text?.trim());
                if (!top3.length) return null;
                return (
                  <div className="focus-bubble">
                    <span className="focus-bubble-label">Top questions</span>
                    <ol className="focus-bubble-list">
                      {top3.map((q) => (
                        <li key={q.id}>{q.text}</li>
                      ))}
                    </ol>
                  </div>
                );
              }
              if (stage.id === 'reflect') return null;
              const focus = getStage1Focus();
              return focus ? (
                <div className="focus-bubble">
                  <span className="focus-bubble-label">Question focus</span>
                  <span className="focus-bubble-text">{focus}</span>
                </div>
              ) : null;
            })()}

            {messages.map((message) => {
              const msgStage = stages[message.stageIndex];
              const isInstruction = message.isInstruction && msgStage?.image;
              return (
              <div
                className={`msg-row ${message.role}`}
                key={message.id}
                data-msg-id={message.id}
              >
                <div className="msg-body">
                  <div className="msg-bubble">
                    {isInstruction && (
                      <img
                        src={msgStage.image}
                        alt={msgStage.imageAlt}
                        className="msg-stage-image"
                      />
                    )}
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
              );
            })}

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

          {/* A/B part navigation (Stage 2 and Stage 4) */}
          {[
            ["produce-questions-a", "produce-questions-b"],
            ["prioritize-questions-a", "prioritize-questions-b"],
          ].find((pair) => pair.includes(stage.id)) && (() => {
            const pair = [
              ["produce-questions-a", "produce-questions-b"],
              ["prioritize-questions-a", "prioritize-questions-b"],
            ].find((p) => p.includes(stage.id));
            return (
              <div className="chat-history-pill-row">
                {pair.map((id, i) => (
                  <button
                    key={id}
                    className={`chat-history-pill ${stage.id === id ? "active" : "outline"}`}
                    title={`Part ${i === 0 ? "A" : "B"}`}
                    onClick={() =>
                      goToStage(stages.findIndex((s) => s.id === id))
                    }
                    type="button"
                  >
                    {i === 0 ? "A" : "B"}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Input — always at bottom of chat frame */}
          <div className="chat-input-area">
            <div className="input-row">
              <div className="input-field-wrap">
                <textarea
                  className="md-textarea"
                  id="msgInput"
                  ref={inputRef}
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
              {hasWorkspace && (
                <stage.Component
                  input={stage.input(memory)}
                  onSubmit={handleStageResult}
                  onSend={handleSubmitStage}
                  {...(stage.inputType === "categorize" && {
                    onQuestionClick: (text) => setDraftText(text),
                    onSendText: (text) => sendToBackend(text),
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
                  className={`md-tonal-btn${highlightNextBtn && stageIndex === 0 ? " next-stage-highlighted" : ""}`}
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
