import { useEffect, useRef, useState } from 'react'
import { uid } from '../utils'

export default function QuestionProductionStage({ input, onSubmit, onSend }) {
  const [questions, setQuestions] = useState(() =>
    input.questions.length ? input.questions : [{ id: uid(), text: '' }]
  )

  const inputRefs = useRef({})
  const pendingFocusId = useRef(null)

  // Focus the first field on mount
  useEffect(() => {
    const firstId = questions[0]?.id
    if (firstId) inputRefs.current[firstId]?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus newly added field after render
  useEffect(() => {
    if (pendingFocusId.current) {
      inputRefs.current[pendingFocusId.current]?.focus()
      pendingFocusId.current = null
    }
  }, [questions])

  function commit(next) {
    setQuestions(next)
    onSubmit({ questions: next })
  }

  function updateQuestion(id, text) {
    commit(questions.map((q) => (q.id === id ? { ...q, text } : q)))
  }

  function appendQuestion(afterIndex = null) {
    const next = { id: uid(), text: '' }
    const list = [...questions]
    if (afterIndex == null || afterIndex >= list.length - 1) list.push(next)
    else list.splice(afterIndex + 1, 0, next)
    pendingFocusId.current = next.id
    commit(list)
  }

  function removeQuestion(id) {
    const idx = questions.findIndex((q) => q.id === id)
    const next = questions.filter((q) => q.id !== id)
    const replacement = next.length ? next : [{ id: uid(), text: '' }]
    // Focus the question before the removed one, or the new first field
    const focusTarget = replacement[Math.max(0, idx - 1)]
    pendingFocusId.current = focusTarget?.id ?? null
    commit(replacement)
  }

  const filledCount = questions.filter((q) => q.text.trim()).length

  return (
    <div className="ql-wrap">
      <div className="ql-header">
        <span className="ql-title">Your questions</span>
        <span className="ql-count">
          {filledCount} question{filledCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="ql-list-scrollable">
        <ul className="ql-list">
          {questions.map((question, index) => (
            <li className="ql-item" key={question.id}>
              <span className="ql-num">{index + 1}</span>
              <input
                className="ql-input"
                placeholder="Your question…"
                ref={(el) => { inputRefs.current[question.id] = el }}
                type="text"
                value={question.text}
                onChange={(event) => updateQuestion(question.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    appendQuestion(index)
                  }
                  if (event.key === 'Backspace' && question.text === '' && questions.length > 1) {
                    event.preventDefault()
                    removeQuestion(question.id)
                  }
                }}
              />
              <button className="ql-del" onClick={() => removeQuestion(question.id)} title="Remove" type="button">
                <span className="material-symbols-rounded">close</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ql-submit-row">
          <span className="input-hint">Enter to add question</span>
          <button
            className="md-tonal-btn"
            disabled={filledCount === 0}
            onClick={onSend}
            type="button"
          >
            Submit questions
            <span className="material-symbols-rounded mini-icon">send</span>
          </button>
        </div>
      </div>
    </div>
  )
}
