// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'

function SortablePriorityItem({ id, rank, text }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div className="priority-item" ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="priority-rank">{rank}</div>
      <div className="priority-text">{text}</div>
      <span className="material-symbols-rounded drag-indicator">drag_indicator</span>
    </div>
  )
}

export default function PrioritizeQuestionsStage({ input, onSubmit, onSend }) {
  const { questions, priorities: initialPriorities } = input
  const [priorities, setPriorities] = useState(initialPriorities)
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const orderedIds = useMemo(() => {
    const seen = new Set(priorities)
    const missing = questions.map((q) => q.id).filter((id) => !seen.has(id))
    return [...priorities, ...missing].filter((id) => questions.some((q) => q.id === id))
  }, [questions, priorities])

  const orderedQuestions = orderedIds.map((id) => questions.find((q) => q.id === id)).filter(Boolean)

  function handleDragEnd(event) {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    const oldIndex = orderedIds.indexOf(String(active.id))
    const newIndex = orderedIds.indexOf(String(over.id))
    const next = arrayMove(orderedIds, oldIndex, newIndex)
    setPriorities(next)
    onSubmit({ priorities: next })
  }

  const activeQuestion = questions.find((q) => q.id === activeId)

  return (
    <div className="dnd-stage-wrap">
      <div className="dnd-stage-header">
        <h3>Prioritize questions</h3>
        <p>Drag questions into priority order — most important at the top.</p>
      </div>

      <div className="dnd-scroll-body">
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div className="priority-column">
              {orderedQuestions.map((question, index) => (
                <SortablePriorityItem
                  key={question.id}
                  id={question.id}
                  rank={index + 1}
                  text={question.text}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeQuestion ? (
              <div className="priority-item overlay">
                <div className="priority-rank">•</div>
                <div className="priority-text">{activeQuestion.text}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="stage-actions">
        <button className="md-tonal-btn" onClick={onSend} disabled={orderedQuestions.length === 0} type="button">
          Submit priorities
          <span className="material-symbols-rounded mini-icon">send</span>
        </button>
      </div>
    </div>
  )
}
