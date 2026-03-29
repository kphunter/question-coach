import { DndContext, DragOverlay, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'

function DraggableQuestion({ id, text, badge, onQuestionClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      className={`question-chip${onQuestionClick ? ' clickable' : ''}`}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onQuestionClick ? () => onQuestionClick(text) : undefined}
    >
      <span>{text}</span>
      {badge ? <span className={`chip-badge ${badge}`}>{badge}</span> : null}
    </div>
  )
}

function DroppableColumn({ id, title, items, onQuestionClick }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div className="drop-column">
      <div className="drop-column-title">{title}</div>
      <div className={`drop-zone ${isOver ? 'is-over' : ''}`} ref={setNodeRef}>
        {items.length === 0 && <div className="drop-empty">Drop here</div>}
        {items.map((question) => (
          <DraggableQuestion
            key={question.id}
            id={question.id}
            text={question.text}
            badge={id === 'unassigned' ? '' : id}
            onQuestionClick={onQuestionClick}
          />
        ))}
      </div>
    </div>
  )
}

export default function CategorizeQuestionsStage({ input, onSubmit, onSend, onQuestionClick }) {
  const { questions, classifications: initialClassifications } = input
  const [classifications, setClassifications] = useState(initialClassifications)
  const [activeId, setActiveId] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleChange(next) {
    setClassifications(next)
    onSubmit({ classifications: next })
  }

  const grouped = useMemo(() => {
    const open = []
    const closed = []
    const unassigned = []
    questions.forEach((question) => {
      const group = classifications[question.id]
      if (group === 'open') open.push(question)
      else if (group === 'closed') closed.push(question)
      else unassigned.push(question)
    })
    return { unassigned, open, closed }
  }, [questions, classifications])

  function getContainer(questionId) {
    if (grouped.unassigned.some((q) => q.id === questionId)) return 'unassigned'
    if (grouped.open.some((q) => q.id === questionId)) return 'open'
    if (grouped.closed.some((q) => q.id === questionId)) return 'closed'
    return null
  }

  function handleDragEnd(event) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const activeQuestionId = String(active.id)
    const overId = String(over.id)
    const destination = ['unassigned', 'open', 'closed'].includes(overId) ? overId : getContainer(overId)
    if (!destination) return
    const next = { ...classifications }
    if (destination === 'open' || destination === 'closed') next[activeQuestionId] = destination
    else delete next[activeQuestionId]
    handleChange(next)
  }

  const activeQuestion = questions.find((q) => q.id === activeId)

  return (
    <div className="dnd-stage-wrap">
      <div className="dnd-stage-header">
        <h3>Classify questions</h3>
        <p>
          Drag each question into Open or Closed.{' '}
          {onQuestionClick && <span className="hint-inline">Tap a question to copy it to the chat box.</span>}
        </p>
      </div>

      <DndContext
        collisionDetection={closestCenter}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <div className="categorize-wrap">
          <DroppableColumn id="unassigned" title="Unsorted" items={grouped.unassigned} onQuestionClick={onQuestionClick} />
          <div className="categorize-grid">
            <DroppableColumn id="open" title="Open" items={grouped.open} onQuestionClick={onQuestionClick} />
            <DroppableColumn id="closed" title="Closed" items={grouped.closed} onQuestionClick={onQuestionClick} />
          </div>
        </div>
        <DragOverlay>
          {activeQuestion ? <div className="question-chip overlay">{activeQuestion.text}</div> : null}
        </DragOverlay>
      </DndContext>

      <div className="stage-actions">
        <button className="md-tonal-btn" onClick={() => { setSubmitted(true); onSend() }} type="button">
          {submitted ? 'Resubmit classifications' : 'Submit classifications'}
          <span className="material-symbols-rounded mini-icon">send</span>
        </button>
      </div>
    </div>
  )
}
