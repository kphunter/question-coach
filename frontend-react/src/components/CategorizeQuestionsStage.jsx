// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useRef, useState } from 'react'

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
            badge={id}
            onQuestionClick={onQuestionClick}
          />
        ))}
      </div>
    </div>
  )
}

function UnassignedList({ items, onQuestionClick }) {
  const { setNodeRef } = useDroppable({ id: 'unassigned' })

  return (
    <div className="unassigned-list" ref={setNodeRef}>
      {items.map((question) => (
        <DraggableQuestion
          key={question.id}
          id={question.id}
          text={question.text}
          badge=""
          onQuestionClick={onQuestionClick}
        />
      ))}
    </div>
  )
}

const REWRITE_PHASES = [
  {
    label: 'Rewrite an Open Question',
    placeholder: 'Transform an OPEN question into a closed question and click submit',
    sendLabel: 'Rewrite (open → closed)',
  },
  {
    label: 'Rewrite a Closed Question',
    placeholder: 'Transform a CLOSED question into an open question and click submit',
    sendLabel: 'Rewrite (closed → open)',
  },
]

export default function CategorizeQuestionsStage({ input, onSubmit, onSend, onQuestionClick, onSendText }) {
  const { questions, classifications: initialClassifications } = input
  const [classifications, setClassifications] = useState(initialClassifications)
  const [activeId, setActiveId] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [rewriteText, setRewriteText] = useState('')
  const [rewritePhase, setRewritePhase] = useState(0)
  const rewriteRef = useRef(null)
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

  // Focus the rewrite textarea as soon as it appears
  useEffect(() => {
    if (submitted) rewriteRef.current?.focus()
  }, [submitted])

  function handleClassifySubmit() {
    setSubmitted(true)
    onSend()
  }

  function handleRewriteSubmit() {
    const text = rewriteText.trim()
    if (!text) return
    onSendText?.(text, phase.sendLabel)
    setRewriteText('')
    setRewritePhase((p) => Math.min(p + 1, REWRITE_PHASES.length - 1))
    rewriteRef.current?.focus()
  }

  // After submitting classifications, tapping a question fills the rewrite box
  const effectiveQuestionClick = submitted
    ? (text) => { setRewriteText(text); rewriteRef.current?.focus() }
    : onQuestionClick

  const activeQuestion = questions.find((q) => q.id === activeId)
  const phase = REWRITE_PHASES[rewritePhase]

  return (
    <div className="dnd-stage-wrap">
      <div className="dnd-stage-header">
        <h3>Classify questions</h3>
        <p>
          Drag each question into Open or Closed.{' '}
          {!submitted && onQuestionClick && <span className="hint-inline">Tap a question to copy it to the chat box.</span>}
        </p>
      </div>

      <div className="dnd-scroll-body">
        <DndContext
          collisionDetection={pointerWithin}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <div className="categorize-wrap">
            <div className="categorize-grid">
              <DroppableColumn id="open" title="Open" items={grouped.open} onQuestionClick={effectiveQuestionClick} />
              <DroppableColumn id="closed" title="Closed" items={grouped.closed} onQuestionClick={effectiveQuestionClick} />
            </div>
            {!submitted && (
              <UnassignedList items={grouped.unassigned} onQuestionClick={effectiveQuestionClick} />
            )}
          </div>
          <DragOverlay>
            {activeQuestion ? <div className="question-chip overlay">{activeQuestion.text}</div> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {submitted && (
        <div className="rewrite-box">
          <label className="rewrite-label" htmlFor="rewrite-input">{phase.label}</label>
          <textarea
            className="md-textarea rewrite-textarea"
            id="rewrite-input"
            ref={rewriteRef}
            placeholder={phase.placeholder}
            value={rewriteText}
            onChange={(e) => setRewriteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRewriteSubmit() }
            }}
            rows={4}
          />
          <p className="rewrite-hint">Tap a question above to copy it to this box.</p>
          <div className="rewrite-actions">
            <button
              className="md-tonal-btn"
              onClick={handleRewriteSubmit}
              type="button"
              disabled={!rewriteText.trim()}
            >
              Submit
              <span className="material-symbols-rounded mini-icon">send</span>
            </button>
          </div>
        </div>
      )}

      {!submitted && (
        <div className="stage-actions">
          <button className="md-tonal-btn" onClick={handleClassifySubmit} type="button">
            Submit classifications
            <span className="material-symbols-rounded mini-icon">send</span>
          </button>
        </div>
      )}
    </div>
  )
}
