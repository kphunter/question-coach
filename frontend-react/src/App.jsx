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

// ── Session management ─────────────────────────────────────────────────────
const SESSION_KEY = "qc-session";

/** Navigation-only coach messages are flagged ui_hint:true for the analysis agent. */
const NAV_HINT_RE = /click.*(?:next\s+stage|the\s+["']?[bB]["']?\s+icon|finish\s+button|the\s+["']?b["'])/i;

function initialMemory() {
  return {
    questions: [{ id: uid(), text: "" }],
    classifications: {},
    priorities: [],
    stageNotes: {},
  };
}

function newSession() {
  const now = new Date().toISOString();
  return {
    schema_version: "1",
    session_id: uid(),
    started_at: now,
    completed_at: null,
    completed: false,
    model: defaultSettings.gemini_model,
    question_focus: null,
    error_events: [],
    current_stage_id: stages[0].id,
    memory: initialMemory(),
    stages: stages.map((s, i) => ({
      stage_id: s.id,
      entered_at: i === 0 ? now : null,
      completed_at: null,
      data: {},
      chat: [],
    })),
  };
}

// Module-level cache so loadSession() is only called once per page load.
let _initialSession = null;

function getInitialSession() {
  if (_initialSession) return _initialSession;

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure every current stage has an entry (handles stages added after session was created).
      const knownIds = new Set(parsed.stages?.map((s) => s.stage_id) ?? []);
      const missing = stages
        .filter((s) => !knownIds.has(s.id))
        .map((s) => ({ stage_id: s.id, entered_at: null, completed_at: null, data: {}, chat: [] }));
      _initialSession = { ...newSession(), ...parsed, stages: [...(parsed.stages ?? []), ...missing] };
      return _initialSession;
    }
  } catch { /* ignore */ }

  // ── Migrate from old per-key localStorage format ──────────────────────────
  const sess = newSession();
  let migrated = false;
  try {
    const raw = localStorage.getItem("qc-memory");
    if (raw) { sess.memory = JSON.parse(raw); migrated = true; }
  } catch { /* ignore */ }
  stages.forEach((s, i) => {
    try {
      const raw = localStorage.getItem(`qc-chat-${s.id}`);
      if (raw) {
        const chat = JSON.parse(raw);
        if (Array.isArray(chat)) { sess.stages[i].chat = chat; migrated = true; }
      }
    } catch { /* ignore */ }
  });
  if (migrated) {
    stages.forEach((s) => localStorage.removeItem(`qc-chat-${s.id}`));
    localStorage.removeItem("qc-memory");
  }

  _initialSession = sess;
  return _initialSession;
}

function saveSession(data) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Extract question focus from Stage 1 messages — no localStorage regex needed. */
function extractQuestionFocus(msgs) {
  const focus = [...msgs]
    .reverse()
    .find((m) => m.role === "assistant" && !m.isCoach && !/next stage/i.test(m.text));
  if (!focus) return null;
  let text = focus.text.split(/does this feel/i)[0].trim().replace(/[.,!?]+$/, "").trim();
  text = text.replace(/^(your\s+)?(?:question\s+)?focus\s+(?:is\s*(?:on\s*)?|on\s*)?[:\-–]?\s*/i, "");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return text || focus.text;
}

/** Snapshot structured outputs when leaving a stage, for the analysis agent. */
function captureStageData(stageId, memory, msgs) {
  const filled = memory.questions.filter((q) => q.text.trim());
  const firstUserText = msgs.find((m) => m.role === "user")?.text ?? null;
  switch (stageId) {
    case "produce-questions-a":
      return { questions: filled.map((q) => q.text) };
    case "produce-questions-b":
      return { questions: filled.map((q) => q.text), card_reported: firstUserText };
    case "improve-questions": {
      const open = filled.filter((q) => memory.classifications[q.id] === "open").map((q) => q.text);
      const closed = filled.filter((q) => memory.classifications[q.id] === "closed").map((q) => q.text);
      return { classifications: { open, closed } };
    }
    case "prioritize-questions-a":
      return { card_reported: firstUserText };
    case "prioritize-questions-b": {
      const top = memory.priorities
        .slice(0, 3)
        .map((id) => filled.find((q) => q.id === id))
        .filter(Boolean)
        .map((q) => q.text);
      return { top_questions: top };
    }
    default:
      return {};
  }
}

/**
 * Fire-and-forget: submit the current session JSON to the analysis backend.
 * Reads directly from localStorage so it's always current (safe for beforeunload).
 */
function submitSession(completed) {
  const api = buildApiBase();
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      session: {
        ...session,
        completed,
        completed_at: completed ? now : null,
      },
    });
    const url = `${api}/api/sessions`;
    // sendBeacon is reliable during page unload; fall back to keepalive fetch otherwise
    const blob = new Blob([payload], { type: "application/json" });
    if (!navigator.sendBeacon(url, blob)) {
      fetch(url, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // non-fatal
  }
}

export default function App() {
  const API = useMemo(buildApiBase, []);

  // ── Session metadata state ─────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState(() => getInitialSession().session_id);
  const [startedAt, setStartedAt] = useState(() => getInitialSession().started_at);
  const [errorEvents, setErrorEvents] = useState(() => getInitialSession().error_events ?? []);
  const [questionFocus, setQuestionFocus] = useState(() => getInitialSession().question_focus ?? null);

  // Per-stage chat arrays for all non-current stages.
  const [savedChats, setSavedChats] = useState(() =>
    Object.fromEntries(getInitialSession().stages.map((s) => [s.stage_id, s.chat ?? []]))
  );

  // Per-stage timestamps and structured data snapshots.
  const [stageState, setStageState] = useState(() =>
    Object.fromEntries(
      getInitialSession().stages.map((s) => [
        s.stage_id,
        { entered_at: s.entered_at, completed_at: s.completed_at, data: s.data ?? {} },
      ])
    )
  );

  // ── Core pipeline state ────────────────────────────────────────────────────
  const [memory, setMemory] = useState(() => getInitialSession().memory ?? initialMemory());
  const [stageIndex, setStageIndex] = useState(() => {
    const idx = stages.findIndex((s) => s.id === getInitialSession().current_stage_id);
    return Math.max(0, idx);
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [stagePrompts, setStagePrompts] = useState({});
  const [statusText, setStatusText] = useState("Connecting…");
  const [snackbar, setSnackbar] = useState("");
  const [messages, setMessages] = useState(() => {
    const sess = getInitialSession();
    const currentIdx = Math.max(0, stages.findIndex((s) => s.id === sess.current_stage_id));
    const currentStage = stages[currentIdx];
    const savedChat = sess.stages.find((s) => s.stage_id === currentStage.id)?.chat;
    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: currentStage.instruction,
      stageIndex: currentIdx,
      isCoach: true,
      isInstruction: true,
      createdAt: new Date().toISOString(),
    };
    return savedChat?.length > 1 ? savedChat : [defaultMsg];
  });
  const [settings] = useState(defaultSettings);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const [highlightNextBtn, setHighlightNextBtn] = useState(false);
  const [highlightPips, setHighlightPips] = useState(false);

  const stage = stages[stageIndex];
  const hasWorkspace = stage.inputType !== "textarea";

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const introTimers = useRef([]);
  // Set to true in goToStage so the next scroll effect scrolls to top, not bottom.
  const scrollToTopOnNextRender = useRef(false);
  // Holds { parts, stageIdx } for card stages — fires when the modal is closed.
  const pendingCardIntro = useRef(null);

  // True only when the very first page load lands on Stage 0 with no prior chat.
  const initialWasFresh = useRef(
    (() => {
      const sess = getInitialSession();
      const isStage0 = sess.current_stage_id === stages[0].id;
      const s0Chat = sess.stages.find((s) => s.stage_id === stages[0].id)?.chat;
      return isStage0 && (!s0Chat || s0Chat.length <= 1);
    })()
  );

  function clearIntroTimers() {
    introTimers.current.forEach(clearTimeout);
    introTimers.current = [];
  }

  /** Flash the Next Stage button and pips when Stage 1's messages 2 and 3 appear. */
  function scheduleStage0Highlight(parts) {
    if (parts.length < 2) return;
    let elapsed = 0;
    const timings = parts.map((raw) => {
      elapsed += raw.startsWith("[slow]") ? SECONDARY_DELAY_MS : INTRO_DELAY_MS;
      return elapsed;
    });
    const showAt = timings[1];
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
            ui_hint: NAV_HINT_RE.test(text),
            createdAt: new Date().toISOString(),
          },
        ]);
      }, elapsed);
      introTimers.current.push(id);
    });
  }

  // ── Scroll on message change — top on stage switch, bottom otherwise ────────
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    if (scrollToTopOnNextRender.current) {
      el.scrollTop = 0;
      scrollToTopOnNextRender.current = false;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isProcessing]);

  // ── Schedule delayed intro parts for stage 0 on first visit ──────────────
  useEffect(() => {
    if (initialWasFresh.current && stages[0].messageParts?.length > 0) {
      scheduleIntroParts(stages[0].messageParts, 0, INTRO_DELAY_MS);
      scheduleStage0Highlight(stages[0].messageParts);
    }
    return () => clearIntroTimers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist entire session to a single localStorage key ───────────────────
  useEffect(() => {
    const session = {
      schema_version: "1",
      session_id: sessionId,
      started_at: startedAt,
      completed_at: null,
      completed: false,
      model: defaultSettings.gemini_model,
      question_focus: questionFocus,
      error_events: errorEvents,
      current_stage_id: stage.id,
      memory,
      stages: stages.map((s) => ({
        stage_id: s.id,
        ...(stageState[s.id] ?? { entered_at: null, completed_at: null, data: {} }),
        chat: s.id === stage.id ? messages : (savedChats[s.id] ?? []),
      })),
    };
    saveSession(session);
  }, [messages, memory, savedChats, questionFocus, errorEvents, stage.id, sessionId, startedAt, stageState]);

  // ── Reset draft + close card picker when changing stages ──────────────────
  useEffect(() => {
    setDraftText("");
    setShowCardPicker(false);
    pendingCardIntro.current = null;
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

  // ── Submit session on page unload (incomplete) ────────────────────────────
  useEffect(() => {
    function onUnload() { submitSession(false); }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

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
    scrollToTopOnNextRender.current = true;

    const now = new Date().toISOString();
    const nextStage = stages[nextIndex];
    const nextChat = savedChats[nextStage.id];
    const isFresh = !nextChat || nextChat.length <= 1;

    // Commit current stage chat to savedChats
    setSavedChats((prev) => ({ ...prev, [stage.id]: messages }));

    // Mark current stage completed; mark next stage entered; snapshot data
    setStageState((prev) => ({
      ...prev,
      [stage.id]: {
        ...prev[stage.id],
        completed_at: prev[stage.id]?.completed_at ?? now,
        data: { ...prev[stage.id]?.data, ...captureStageData(stage.id, memory, messages) },
      },
      [nextStage.id]: {
        ...prev[nextStage.id],
        entered_at: prev[nextStage.id]?.entered_at ?? now,
      },
    }));

    // Extract and store question focus when leaving Stage 1
    if (stage.id === "question-focus") {
      const focus = extractQuestionFocus(messages);
      if (focus) setQuestionFocus(focus);
    }

    const defaultMsg = {
      id: uid(),
      role: "assistant",
      text: nextStage.instruction,
      stageIndex: nextIndex,
      isCoach: true,
      isInstruction: true,
      createdAt: now,
    };

    setStageIndex(nextIndex);
    setMessages(isFresh ? [defaultMsg] : nextChat);

    if (isFresh && nextStage.messageParts?.length > 0) {
      if (nextStage.cardPickerUrl) {
        // Hold back — schedule when the card picker modal is closed
        pendingCardIntro.current = { parts: nextStage.messageParts, stageIdx: nextIndex };
      } else {
        scheduleIntroParts(nextStage.messageParts, nextIndex, INTRO_DELAY_MS);
      }
    }
  }

  /** Close the card picker and fire any pending intro message sequence. */
  function handleCardPickerClose() {
    setShowCardPicker(false);
    if (pendingCardIntro.current) {
      const { parts, stageIdx } = pendingCardIntro.current;
      pendingCardIntro.current = null;
      scheduleIntroParts(parts, stageIdx, INTRO_DELAY_MS);
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

      // Inject question focus from session state (no localStorage regex needed)
      if (stage.id !== "question-focus" && questionFocus) {
        const prefix = `CONTEXT — Student's question focus from Stage 1:\n${questionFocus}\n\n---\n\n`;
        systemPrompt = systemPrompt ? prefix + systemPrompt : prefix.trim();
      }

      if (stage.id === "next-steps") {
        const filled = memory.questions.filter((q) => q.text.trim());
        const top3 = memory.priorities
          .slice(0, 3)
          .map((id) => filled.find((q) => q.id === id))
          .filter((q) => q?.text?.trim())
          .map((q, i) => `${i + 1}. ${q.text.trim()}`)
          .join("\n");
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
      setErrorEvents((prev) => [
        ...prev,
        { stage_id: stage.id, type: "api_error", message: error.message, at: new Date().toISOString() },
      ]);
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

  /** Clear session and restart from stage 1. */
  function handleReset() {
    if (!window.confirm("Clear all chat history and start over?")) return;
    clearIntroTimers();

    // Submit the current session before clearing
    submitSession(false);

    // Invalidate the module-level session cache
    _initialSession = null;
    const freshSession = newSession();
    saveSession(freshSession);

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

    setSessionId(freshSession.session_id);
    setStartedAt(freshSession.started_at);
    setErrorEvents([]);
    setQuestionFocus(null);
    setSavedChats(Object.fromEntries(stages.map((s) => [s.id, []])));
    setStageState(
      Object.fromEntries(
        freshSession.stages.map((s) => [
          s.stage_id,
          { entered_at: s.entered_at, completed_at: null, data: {} },
        ])
      )
    );
    setStageIndex(0);
    setMemory(initialMemory());
    setMessages([defaultMsg]);
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
    // Merge all stage chats: saved chats + current stage messages
    const allChats = { ...savedChats, [stage.id]: messages };
    const lines = ["# Question Coach — Session Summary", ""];
    const filled = memory.questions.filter((q) => q.text.trim());

    stages.forEach((s) => {
      lines.push(`## ${s.heading}`, "");

      // Workspace output per stage
      if (s.id === "produce-questions-a" && filled.length) {
        lines.push("### Questions", "");
        filled.forEach((q, i) => lines.push(`${i + 1}. ${q.text.trim()}`));
        lines.push("");
      }
      if (s.id === "improve-questions" && filled.length) {
        const open = filled.filter((q) => memory.classifications[q.id] === "open");
        const closed = filled.filter((q) => memory.classifications[q.id] === "closed");
        const unsorted = filled.filter((q) => !memory.classifications[q.id]);
        lines.push("### Classifications", "");
        lines.push("**Open questions:**");
        (open.length ? open : []).forEach((q, i) => lines.push(`${i + 1}. ${q.text}`));
        if (!open.length) lines.push("*(none)*");
        lines.push("");
        lines.push("**Closed questions:**");
        (closed.length ? closed : []).forEach((q, i) => lines.push(`${i + 1}. ${q.text}`));
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

      const chat = allChats[s.id] ?? [];
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
          <span
            className={`status-dot ${isConnected ? "connected" : ""}`}
            aria-hidden="true"
          />
        </div>

        <div className="app-bar-trailing">
          <a
            className="md-text-btn app-bar-kb-link"
            href={`${import.meta.env.BASE_URL}qc-cards-complete-print-set.pdf`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="material-symbols-rounded mini-icon">
              style
            </span>
            Cards
          </a>
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
              if (stage.id === "next-steps") {
                const filled = memory.questions.filter((q) => q.text.trim());
                const top3 = memory.priorities
                  .slice(0, 3)
                  .map((id) => filled.find((q) => q.id === id))
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
              if (stage.id === "reflect") return null;
              return questionFocus ? (
                <div className="focus-bubble">
                  <span className="focus-bubble-label">Question focus</span>
                  <span className="focus-bubble-text">{questionFocus}</span>
                </div>
              ) : null;
            })()}

            {messages.map((message) => {
              const msgStage = stages[message.stageIndex];
              const isInstruction = message.isInstruction && msgStage?.image;
              const hasCardPicker = message.isInstruction && msgStage?.cardPickerUrl;
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
                    {hasCardPicker && (
                      <button
                        className="draw-card-btn"
                        type="button"
                        onClick={() => setShowCardPicker(true)}
                      >
                        <span className="material-symbols-rounded mini-icon">style</span>
                        Draw a card
                      </button>
                    )}
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
                  onClick={() => { submitSession(true); setShowFinishModal(true); }}
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

      {showCardPicker && stage.cardPickerUrl && (
        <div
          className="modal-overlay card-picker-overlay"
          onClick={handleCardPickerClose}
        >
          <div
            className="card-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-picker-header">
              <span className="material-symbols-rounded modal-icon">style</span>
              <span className="modal-title">Card Picker</span>
              <button
                className="icon-btn card-picker-close"
                type="button"
                aria-label="Close card picker"
                onClick={handleCardPickerClose}
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <iframe
              className="card-picker-iframe"
              src={stage.cardPickerUrl}
              title="Card Picker"
            />
          </div>
        </div>
      )}

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
