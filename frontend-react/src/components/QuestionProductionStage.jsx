import { useState } from 'react'
import { uid } from '../utils'

/**
 * @param {{ input: { questions: {id: string, text: string}[] }, onSubmit: (result: {questions: {id: string, text: string}[]}) => void }} props
 */
export default function QuestionProductionStage({ input, onSubmit }) {
  const [questions, setQuestions] = useState(() =>
    input.questions.length ? input.questions : [{ id: uid(), text: '' }]
  )

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
    commit(list)
  }

  function removeQuestion(id) {
    const next = questions.filter((q) => q.id !== id)
    commit(next.length ? next : [{ id: uid(), text: '' }])
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

      <ul className="ql-list">
        {questions.map((question, index) => (
          <li className="ql-item" key={question.id}>
            <span className="ql-num">{index + 1}</span>
            <input
              className="ql-input"
              placeholder="Your question…"
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

      <button className="ql-add-btn" onClick={() => appendQuestion()} type="button">
        <span className="material-symbols-rounded">add</span>
        Add question
      </button>
    </div>
  )
}
