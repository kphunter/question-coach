export default function QuestionProductionStage({ questions, onAdd, onChange, onRemove }) {
  const filledCount = questions.filter((question) => question.text.trim()).length

  return (
    <div className="ql-wrap">
      <div className="ql-header">
        <span className="ql-title">Your questions</span>
        <span className="ql-count">{filledCount} question{filledCount === 1 ? '' : 's'}</span>
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
              onChange={(event) => onChange(question.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onAdd(index)
                }
                if (event.key === 'Backspace' && question.text === '' && questions.length > 1) {
                  event.preventDefault()
                  onRemove(question.id)
                }
              }}
            />
            <button className="ql-del" onClick={() => onRemove(question.id)} title="Remove" type="button">
              <span className="material-symbols-rounded">close</span>
            </button>
          </li>
        ))}
      </ul>

      <button className="ql-add-btn" onClick={() => onAdd()} type="button">
        <span className="material-symbols-rounded">add</span>
        Add question
      </button>
    </div>
  )
}
