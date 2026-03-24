import { useEffect, useMemo, useState } from 'react'
import { stages } from './stages'
import { uid } from './utils'

const defaultSettings = {
  use_gemini: true,
  search_strategy: 'auto',
  search_limit: 5,
  gemini_model: 'gemini-2.5-flash'
}

function buildApiBase() {
  if (window.location.hostname === 'localhost') return 'http://localhost:8000'
  return `${window.location.protocol}//${window.location.hostname}:8000`
}

/** @returns {import('./stages').SharedMemory} */
function initialMemory() {
  return {
    questions: [{ id: uid(), text: '' }],
    classifications: {},
    priorities: [],
    stageNotes: {}
  }
}

export default function App() {
  const API = useMemo(buildApiBase, [])

  // ── Core pipeline state ────────────────────────────────────────────────────
  const [memory, setMemory] = useState(initialMemory)
  const [stageIndex, setStageIndex] = useState(0)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [stagePrompts, setStagePrompts] = useState({})
  const [statusText, setStatusText] = useState('Connecting…')
  const [snackbar, setSnackbar] = useState('')
  const [messages, setMessages] = useState(() => [
    {
      id: uid(),
      role: 'assistant',
      text: stages[0].instruction,
      stageIndex: 0,
      isCoach: true,
      createdAt: new Date().toISOString()
    }
  ])
  const [settings, setSettings] = useState(defaultSettings)

  const stage = stages[stageIndex]

  // ── Reset draft when changing stages ──────────────────────────────────────
  useEffect(() => {
    setDraftText('')
  }, [stageIndex])

  // ── Fetch stage prompts + poll health ─────────────────────────────────────
  useEffect(() => {
    let active = true

    async function fetchStages() {
      try {
        const response = await fetch(`${API}/stages`)
        if (!response.ok) return
        const data = await response.json()
        if (!active) return
        const next = {}
        data.forEach((item) => {
          if (item.id && item.system_prompt) next[item.id] = item.system_prompt
        })
        setStagePrompts(next)
      } catch {
        // non-fatal
      }
    }

    async function checkHealth() {
      try {
        const response = await fetch(`${API}/health`)
        const data = await response.json()
        const ok = data.status === 'healthy' || data.status === 'degraded'
        if (!active) return
        setIsConnected(ok)
        if (ok) {
          const count = data.collection_count
          setStatusText(count != null ? `Connected · ${count} vectors indexed` : 'Connected')
        } else {
          setStatusText('Disconnected — check API server')
        }
      } catch {
        if (!active) return
        setIsConnected(false)
        setStatusText('Disconnected — check API server')
      }
    }

    fetchStages()
    checkHealth()
    const interval = window.setInterval(checkHealth, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [API])

  // ── Snackbar auto-dismiss ─────────────────────────────────────────────────
  useEffect(() => {
    if (!snackbar) return undefined
    const timer = window.setTimeout(() => setSnackbar(''), 3500)
    return () => window.clearTimeout(timer)
  }, [snackbar])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pushMessage(message) {
    setMessages((prev) => [...prev, { id: uid(), createdAt: new Date().toISOString(), ...message }])
  }

  function goToStage(nextIndex) {
    if (nextIndex < 0 || nextIndex >= stages.length || nextIndex === stageIndex) return
    const dir = nextIndex > stageIndex ? 1 : -1
    const next = stages[nextIndex]
    setStageIndex(nextIndex)
    pushMessage({
      role: 'assistant',
      text: `${dir > 0 ? 'Moving to' : 'Back to'} ${next.heading}`,
      stageIndex: nextIndex,
      isMarker: true
    })
    pushMessage({ role: 'assistant', text: next.instruction, stageIndex: nextIndex, isCoach: true })
  }

  function updateSettings(name, value) {
    setSettings((prev) => ({ ...prev, [name]: value }))
  }

  /**
   * Called by stage components on every live edit.
   * Merges the result into shared memory via the stage's output transformer.
   */
  function handleStageResult(result) {
    setMemory((prev) => stage.output(result, prev))
  }

  async function handleSend() {
    const bodyText = stage.serialize(memory, draftText)
    if (!bodyText) {
      setSnackbar(stage.inputType === 'textarea' ? 'Enter a message first.' : 'Add at least one question first.')
      return
    }

    if (!isConnected || isProcessing) return

    const contextualMsg = `[QFT ${stage.heading}]\n\n${bodyText}`
    pushMessage({ role: 'user', text: bodyText, stageIndex })
    setIsProcessing(true)

    try {
      const payload = {
        message: contextualMsg,
        search_limit: Number(settings.search_limit),
        search_strategy: settings.search_strategy,
        use_gemini: settings.use_gemini,
        gemini_model: settings.gemini_model,
        system_prompt: stagePrompts[stage.number] ?? null
      }

      const response = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        let detail = 'Request failed'
        try {
          const errorBody = await response.json()
          detail = errorBody.detail || detail
        } catch {
          // ignore
        }
        throw new Error(detail)
      }

      const data = await response.json()
      pushMessage({ role: 'assistant', text: data.response, sources: data.sources || [], stageIndex })
      if (stage.inputType === 'textarea') setDraftText('')
    } catch (error) {
      pushMessage({ role: 'assistant', text: `Sorry, I ran into an error: ${error.message}`, stageIndex })
      setSnackbar(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  // ── Derived views ─────────────────────────────────────────────────────────
  const filledQuestions = memory.questions.filter((q) => q.text.trim())

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="app-bar-leading">
          <span className="material-symbols-rounded app-bar-icon">psychology_alt</span>
          <span className="app-bar-title">Question Coach</span>
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} aria-hidden="true" />
        </div>

        <div className="app-bar-actions">
          <button
            className={`icon-btn ${settingsOpen ? 'active' : ''}`}
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
                  <div className="settings-row-sub">Generate a response using Gemini</div>
                </div>
                <label className="switch-label">
                  <span className="md-switch">
                    <input
                      type="checkbox"
                      id="geminiToggle"
                      checked={settings.use_gemini}
                      onChange={(event) => updateSettings('use_gemini', event.target.checked)}
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
                  <div className="settings-row-sub">How the knowledge base is queried</div>
                </div>
                <select
                  className="md-select"
                  id="searchStrategy"
                  value={settings.search_strategy}
                  onChange={(event) => updateSettings('search_strategy', event.target.value)}
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
                  <div className="settings-row-sub">Number of knowledge base chunks</div>
                </div>
                <select
                  className="md-select"
                  id="searchLimit"
                  value={String(settings.search_limit)}
                  onChange={(event) => updateSettings('search_limit', Number(event.target.value))}
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

      <nav className="stage-stepper">
        <div className="stepper-track">
          {stages.map((item, index) => {
            const state = index < stageIndex ? 'completed' : index === stageIndex ? 'active' : ''
            return (
              <div className="step-cluster" key={item.id}>
                {index > 0 && <div className={`step-connector ${index <= stageIndex ? 'done' : ''}`} />}
                <button className={`stage-step ${state}`} onClick={() => goToStage(index)} type="button">
                  <span className="step-circle">
                    {state === 'completed' ? (
                      <span className="material-symbols-rounded step-check">check</span>
                    ) : (
                      item.number
                    )}
                  </span>
                  <span className="step-label">{item.name}</span>
                </button>
              </div>
            )
          })}
        </div>
      </nav>

      <section className="stage-info">
        <div className="stage-info-body">
          <div className="stage-info-heading">{stage.heading}</div>
          <div className="stage-info-text">{stage.description}</div>
        </div>
        <div className="stage-nav">
          <button className="md-text-btn" onClick={() => goToStage(stageIndex - 1)} disabled={stageIndex === 0} type="button">
            <span className="material-symbols-rounded mini-icon">arrow_back</span>
            Back
          </button>
          <button className="md-tonal-btn" onClick={() => goToStage(stageIndex + 1)} disabled={stageIndex === stages.length - 1} type="button">
            Next stage
            <span className="material-symbols-rounded mini-icon">arrow_forward</span>
          </button>
        </div>
      </section>

      <main className="content-grid">
        <section className="chat-area">
          <div className="welcome-card">
            <div className="material-symbols-rounded welcome-icon">psychology_alt</div>
            <h2>Welcome to Question Coach</h2>
            <p>
              This React scaffold preserves the original QFT flow and backend integration, while adding shared
              memory, drag-and-drop categorization, and drag-and-drop prioritization.
            </p>
          </div>

          {messages.map((message) => {
            if (message.isMarker) {
              return (
                <div className="stage-marker" key={message.id}>
                  <span className="material-symbols-rounded">compare_arrows</span>
                  <span className="stage-marker-text">{message.text}</span>
                </div>
              )
            }

            return (
              <div className={`msg-row ${message.role}`} key={message.id}>
                <div className={`msg-avatar ${message.role}`}>{message.role === 'user' ? 'You' : 'QC'}</div>
                <div className="msg-body">
                  <div className="msg-bubble">{message.text}</div>
                  {message.sources?.length > 0 && (
                    <div className="source-chips">
                      {message.sources.map((source, index) => (
                        <a
                          className="source-chip"
                          href={source.url || '#'}
                          key={`${message.id}-${index}`}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          <span className="material-symbols-rounded">description</span>
                          {source.title || 'Source'}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="msg-time">
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
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
        </section>

        <aside className="stage-panel">
          <div className="panel-card">
            <stage.Component
              input={stage.input(memory)}
              onSubmit={handleStageResult}
            />
          </div>
        </aside>
      </main>

      <footer className="input-area">
        {stage.inputType === 'textarea' && (
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
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSend()
                  }
                }}
              />
            </div>
            <button
              className="send-fab"
              id="sendBtn"
              disabled={!isConnected || isProcessing}
              title="Send"
              onClick={handleSend}
              type="button"
            >
              <span className="material-symbols-rounded">send</span>
            </button>
          </div>
        )}

        {stage.inputType !== 'textarea' && (
          <div className="stage-submit-row">
            <div className="input-hint stage-submit-hint">{statusText}</div>
            <button
              className="md-tonal-btn submit-stage-btn"
              disabled={!isConnected || isProcessing || !filledQuestions.length}
              onClick={handleSend}
              type="button"
            >
              Submit stage
              <span className="material-symbols-rounded mini-icon">send</span>
            </button>
          </div>
        )}

        <div className="input-hint">{statusText} · Enter to send · Shift+Enter for new line</div>
      </footer>

      <div className={`snackbar ${snackbar ? 'show' : ''}`}>{snackbar}</div>
    </div>
  )
}
