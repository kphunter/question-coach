import { useEffect, useMemo, useState } from 'react'
import QuestionProductionStage from './components/QuestionProductionStage'
import CategorizeQuestionsStage from './components/CategorizeQuestionsStage'
import PrioritizeQuestionsStage from './components/PrioritizeQuestionsStage'

const STAGES = [
  {
    id: 1,
    name: 'Question Focus',
    icon: 'center_focus_strong',
    heading: 'Stage 1 · Question Focus',
    description:
      "You'll be given a prompt or stimulus that sparks curiosity — without dictating a direction.",
    instruction:
      "Let's start. Have you been given a question focus by your teacher, or do you need to develop one? Tell me about your topic or assignment.",
    placeholder: 'Share your question focus or describe your assignment topic…',
    component: 'default'
  },
  {
    id: 2,
    name: 'Produce Questions',
    icon: 'add_circle',
    heading: 'Stage 2 · Produce Questions',
    description:
      'Generate as many questions as possible. No judging, no stopping to answer — just write them all.',
    instruction:
      "Now let's generate questions. Ask as many as you can about your topic. Don't evaluate or answer them — just list them. When you're ready, submit your list and I'll respond.",
    placeholder: 'Add a question and press Enter…',
    component: 'question-list'
  },
  {
    id: 3,
    name: 'Improve Questions',
    icon: 'tune',
    heading: 'Stage 3 · Improve Questions',
    description:
      'Categorize your questions as open or closed, then practise converting between the two types.',
    instruction:
      "Sort each question into open or closed. When you're done, submit the classification so we can discuss patterns and possible revisions.",
    placeholder: 'Review your categorized questions…',
    component: 'categorize'
  },
  {
    id: 4,
    name: 'Prioritize Questions',
    icon: 'filter_list',
    heading: 'Stage 4 · Prioritize Questions',
    description:
      'Select your top questions by dragging them into an intentional ranking order.',
    instruction:
      'Drag your questions into priority order. Put the most important one at the top, then submit your ranked list.',
    placeholder: 'Describe your prioritization criteria…',
    component: 'prioritize'
  },
  {
    id: 5,
    name: 'Next Steps',
    icon: 'rocket_launch',
    heading: 'Stage 5 · Discuss Next Steps',
    description:
      'Map out how your prioritized questions will guide your research, writing, or inquiry.',
    instruction:
      'You have your questions — now what? Tell me how you will use them in the next part of your assignment or inquiry.',
    placeholder: 'Describe how your questions will shape your next steps…',
    component: 'default'
  },
  {
    id: 6,
    name: 'Reflect',
    icon: 'self_improvement',
    heading: 'Stage 6 · Reflect',
    description:
      'Consider what you learned, how your thinking changed, and how you will apply the QFT going forward.',
    instruction:
      'Reflect on the process. What changed in your thinking? Which stage helped you the most?',
    placeholder: 'Share your reflections on the question formulation process…',
    component: 'default'
  }
]

const defaultSettings = {
  use_gemini: true,
  search_strategy: 'auto',
  search_limit: 5,
  gemini_model: 'gemini-2.5-flash'
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function buildApiBase() {
  if (window.location.hostname === 'localhost') return 'http://localhost:8000'
  return `${window.location.protocol}//${window.location.hostname}:8000`
}

function serializeQuestions(questions) {
  return questions
    .map((q, index) => `${index + 1}. ${q.text.trim()}`)
    .join('\n')
}

function serializeCategorizedQuestions(memory) {
  const { questions, classifications } = memory
  const open = []
  const closed = []

  questions.forEach((question, index) => {
    const group = classifications[question.id] || 'unassigned'
    const line = `${index + 1}. ${question.text}`
    if (group === 'open') open.push(line)
    else if (group === 'closed') closed.push(line)
  })

  return [
    'Open questions:',
    ...(open.length ? open : ['(none)']),
    '',
    'Closed questions:',
    ...(closed.length ? closed : ['(none)'])
  ].join('\n')
}

function serializePriorities(memory) {
  const ranked = memory.priorities
    .map((id, index) => memory.questions.find((q) => q.id === id))
    .filter(Boolean)
    .map((question, index) => `${index + 1}. ${question.text}`)

  return ['Priority ranking:', ...(ranked.length ? ranked : ['(none)'])].join('\n')
}

function getStageSubmissionText(stage, memory, draftText) {
  switch (stage.component) {
    case 'question-list':
      return serializeQuestions(memory.questions)
    case 'categorize':
      return serializeCategorizedQuestions(memory)
    case 'prioritize':
      return serializePriorities(memory)
    default:
      return draftText.trim()
  }
}

function getDisplayText(stage, memory, draftText) {
  const text = getStageSubmissionText(stage, memory, draftText)
  return text.trim()
}

function addQuestion(memory, text = '') {
  const nextQuestion = { id: uid(), text }
  const nextQuestions = [...memory.questions, nextQuestion]
  const nextPriorities = [...memory.priorities, nextQuestion.id]
  return {
    ...memory,
    questions: nextQuestions,
    priorities: nextPriorities
  }
}

export default function App() {
  const API = useMemo(buildApiBase, [])
  const [currentStage, setCurrentStage] = useState(1)
  const [isConnected, setIsConnected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [stagePrompts, setStagePrompts] = useState({})
  const [statusText, setStatusText] = useState('Connecting…')
  const [snackbar, setSnackbar] = useState('')
  const [messages, setMessages] = useState([
    {
      id: uid(),
      role: 'assistant',
      text: STAGES[0].instruction,
      stageId: 1,
      isCoach: true,
      createdAt: new Date().toISOString()
    }
  ])
  const [settings, setSettings] = useState(defaultSettings)
  const [memory, setMemory] = useState({
    questions: [{ id: uid(), text: '' }],
    classifications: {},
    priorities: [],
    stageNotes: {}
  })

  const stage = STAGES[currentStage - 1]

  useEffect(() => {
    setDraftText('')
  }, [currentStage])

  useEffect(() => {
    if (memory.priorities.length === 0 && memory.questions.length > 0) {
      setMemory((prev) => ({
        ...prev,
        priorities: prev.questions.map((question) => question.id)
      }))
    }
  }, [memory.priorities.length, memory.questions])

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
    const interval = window.setInterval(() => {
      checkHealth()
    }, 5000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [API])

  useEffect(() => {
    if (!snackbar) return undefined
    const timer = window.setTimeout(() => setSnackbar(''), 3500)
    return () => window.clearTimeout(timer)
  }, [snackbar])

  function pushMessage(message) {
    setMessages((prev) => [...prev, { id: uid(), createdAt: new Date().toISOString(), ...message }])
  }

  function moveStage(direction) {
    goToStage(currentStage + direction)
  }

  function goToStage(nextStage) {
    if (nextStage < 1 || nextStage > STAGES.length || nextStage === currentStage) return
    const dir = nextStage > currentStage ? 1 : -1
    const next = STAGES[nextStage - 1]
    setCurrentStage(nextStage)
    pushMessage({
      role: 'assistant',
      text: `${dir > 0 ? 'Moving to' : 'Back to'} ${next.heading}`,
      stageId: nextStage,
      isMarker: true
    })
    pushMessage({ role: 'assistant', text: next.instruction, stageId: nextStage, isCoach: true })
  }

  function updateSettings(name, value) {
    setSettings((prev) => ({ ...prev, [name]: value }))
  }

  function updateQuestion(id, text) {
    setMemory((prev) => ({
      ...prev,
      questions: prev.questions.map((question) => (question.id === id ? { ...question, text } : question))
    }))
  }

  function appendQuestion(afterIndex = null) {
    setMemory((prev) => {
      const nextQuestion = { id: uid(), text: '' }
      const nextQuestions = [...prev.questions]
      if (afterIndex == null || afterIndex >= nextQuestions.length - 1) nextQuestions.push(nextQuestion)
      else nextQuestions.splice(afterIndex + 1, 0, nextQuestion)

      const nextPriorities = [...prev.priorities]
      if (!nextPriorities.includes(nextQuestion.id)) nextPriorities.push(nextQuestion.id)

      return {
        ...prev,
        questions: nextQuestions,
        priorities: nextPriorities
      }
    })
  }

  function removeQuestion(id) {
    setMemory((prev) => {
      const nextQuestions = prev.questions.filter((question) => question.id !== id)
      const fallbackQuestions = nextQuestions.length ? nextQuestions : [{ id: uid(), text: '' }]
      const nextClassifications = { ...prev.classifications }
      delete nextClassifications[id]
      const nextPriorities = prev.priorities.filter((item) => item !== id)
      const normalizedPriorities = fallbackQuestions.map((question) => question.id).filter((qid) => nextPriorities.includes(qid) || fallbackQuestions.length === 1)
      const withMissing = fallbackQuestions.map((question) => question.id).filter((qid) => !normalizedPriorities.includes(qid))

      return {
        ...prev,
        questions: fallbackQuestions,
        classifications: nextClassifications,
        priorities: [...normalizedPriorities, ...withMissing]
      }
    })
  }

  function updateClassifications(nextClassifications) {
    setMemory((prev) => ({ ...prev, classifications: nextClassifications }))
  }

  function updatePriorities(nextPriorities) {
    setMemory((prev) => ({ ...prev, priorities: nextPriorities }))
  }

  async function handleSend() {
    const bodyText = getDisplayText(stage, memory, draftText)
    if (!bodyText) {
      setSnackbar(stage.component === 'default' ? 'Enter a message first.' : 'Add at least one question first.')
      return
    }

    if (!isConnected || isProcessing) return

    const contextualMsg = `[QFT ${stage.heading}]\n\n${bodyText}`
    pushMessage({ role: 'user', text: bodyText, stageId: currentStage })
    setIsProcessing(true)

    try {
      const payload = {
        message: contextualMsg,
        search_limit: Number(settings.search_limit),
        search_strategy: settings.search_strategy,
        use_gemini: settings.use_gemini,
        gemini_model: settings.gemini_model,
        system_prompt: stagePrompts[currentStage] || null
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
      pushMessage({ role: 'assistant', text: data.response, sources: data.sources || [], stageId: currentStage })
      setMemory((prev) => ({
        ...prev,
        stageNotes: {
          ...prev.stageNotes,
          [currentStage]: bodyText
        }
      }))
      if (stage.component === 'default') setDraftText('')
    } catch (error) {
      pushMessage({ role: 'assistant', text: `Sorry, I ran into an error: ${error.message}`, stageId: currentStage })
      setSnackbar(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  const filledQuestions = memory.questions.filter((question) => question.text.trim())

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
          {STAGES.map((item, index) => {
            const stepNumber = index + 1
            const state = stepNumber < currentStage ? 'completed' : stepNumber === currentStage ? 'active' : ''
            return (
              <div className="step-cluster" key={item.id}>
                {index > 0 && <div className={`step-connector ${stepNumber <= currentStage ? 'done' : ''}`} />}
                <button className={`stage-step ${state}`} onClick={() => goToStage(stepNumber)} type="button">
                  <span className="step-circle">
                    {state === 'completed' ? <span className="material-symbols-rounded step-check">check</span> : item.id}
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
          <button className="md-text-btn" onClick={() => moveStage(-1)} disabled={currentStage === 1} type="button">
            <span className="material-symbols-rounded mini-icon">arrow_back</span>
            Back
          </button>
          <button className="md-tonal-btn" onClick={() => moveStage(1)} disabled={currentStage === STAGES.length} type="button">
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
            {stage.component === 'question-list' && (
              <QuestionProductionStage
                questions={memory.questions}
                onAdd={appendQuestion}
                onChange={updateQuestion}
                onRemove={removeQuestion}
              />
            )}

            {stage.component === 'categorize' && (
              <CategorizeQuestionsStage
                questions={filledQuestions}
                classifications={memory.classifications}
                onChange={updateClassifications}
              />
            )}

            {stage.component === 'prioritize' && (
              <PrioritizeQuestionsStage
                questions={filledQuestions}
                priorities={memory.priorities.filter((id) => filledQuestions.some((question) => question.id === id))}
                onChange={updatePriorities}
              />
            )}

            {stage.component === 'default' && (
              <div className="default-stage-panel">
                <h3>Stage workspace</h3>
                <p>{stage.instruction}</p>
                <div className="memory-summary">
                  <div><strong>Questions:</strong> {filledQuestions.length}</div>
                  <div>
                    <strong>Open:</strong>{' '}
                    {filledQuestions.filter((question) => memory.classifications[question.id] === 'open').length}
                  </div>
                  <div>
                    <strong>Closed:</strong>{' '}
                    {filledQuestions.filter((question) => memory.classifications[question.id] === 'closed').length}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      <footer className="input-area">
        {stage.component === 'default' && (
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
            <button className="send-fab" id="sendBtn" disabled={!isConnected || isProcessing} title="Send" onClick={handleSend} type="button">
              <span className="material-symbols-rounded">send</span>
            </button>
          </div>
        )}

        {stage.component !== 'default' && (
          <div className="stage-submit-row">
            <div className="input-hint stage-submit-hint">{statusText}</div>
            <button className="md-tonal-btn submit-stage-btn" disabled={!isConnected || isProcessing} onClick={handleSend} type="button">
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
