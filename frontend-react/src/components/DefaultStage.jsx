// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Panel displayed for textarea-based stages (1, 5, 6).
 * Shows a live summary of shared memory.
 *
 * @param {{ input: { memory: import('../stages').SharedMemory, instruction: string } }} props
 */
export default function DefaultStage({ input }) {
  const { memory } = input
  const filled = (memory.questions ?? []).filter((q) => q.text.trim())
  const openCount = filled.filter((q) => memory.classifications?.[q.id] === 'open').length
  const closedCount = filled.filter((q) => memory.classifications?.[q.id] === 'closed').length
  const topQuestion = memory.priorities?.[0]
    ? filled.find((q) => q.id === memory.priorities[0])
    : null

  return (
    <div className="default-stage-panel">
      <h3>Stage workspace</h3>
      <div className="memory-summary">
        <div>
          <strong>Questions:</strong> {filled.length}
        </div>
        <div>
          <strong>Open:</strong> {openCount}
        </div>
        <div>
          <strong>Closed:</strong> {closedCount}
        </div>
        {topQuestion && (
          <div>
            <strong>Top priority:</strong> {topQuestion.text}
          </div>
        )}
      </div>
    </div>
  )
}
