// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export default function QuestionListReadOnly({ input }) {
  const { questions } = input;
  const filled = questions.filter((q) => q.text.trim());

  return (
    <div className="ql-wrap">
      <div className="ql-header">
        <span className="ql-title">Your Questions</span>
        <span className="ql-count">
          {filled.length} question{filled.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="ql-list-scrollable">
        <ol className="ql-readonly-list">
          {filled.map((q, i) => (
            <li key={q.id} className="ql-readonly-item">
              <span className="ql-num">{i + 1}</span>
              <span className="ql-readonly-text">{q.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
