// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import rawContent from './stages.md?raw';
import DefaultStage from "./components/DefaultStage";
import QuestionProductionStage from "./components/QuestionProductionStage";
import CategorizeQuestionsStage from "./components/CategorizeQuestionsStage";
import PrioritizeQuestionsStage from "./components/PrioritizeQuestionsStage";
import QuestionListReadOnly from "./components/QuestionListReadOnly";
import divergentThinkingCard from "./divergent-thinking-card.png";
import reflectiveThinkingCard from "./reflective-thinking-card.png";

/**
 * @typedef {{ id: string, text: string }} Question
 * @typedef {{ questions: Question[], classifications: Record<string, 'open'|'closed'>, priorities: string[], stageNotes: Record<string, string> }} SharedMemory
 * @typedef {{ id: string, number: number, name: string, heading: string, instruction: string, placeholder: string, inputType: 'textarea'|'question-list'|'categorize'|'prioritize', input: (memory: SharedMemory) => any, output: (result: any, memory: SharedMemory) => SharedMemory, serialize: (memory: SharedMemory, draftText?: string) => string, Component: import('react').ComponentType<any> }} Stage
 */

// ── Markdown content parser ────────────────────────────────────────────────
// Each stage in stages.md is an H1 section with key:value metadata lines and
// ### sub-sections for Description, Instruction, and Message 1/2/3…
function parseStagesMarkdown(raw) {
  const blocks = raw.split(/(?=^# )/m).filter((b) => b.trim());

  return blocks.map((block, i) => {
    const lines = block.split('\n');
    const name = lines[0].slice(2).trim(); // "# Name" → "Name"

    // key:value meta lines (before the first ### heading)
    const meta = {};
    const firstH3 = lines.findIndex((l, idx) => idx > 0 && l.startsWith('### '));
    const metaLines = lines.slice(1, firstH3 >= 0 ? firstH3 : lines.length);
    for (const line of metaLines) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].trim();
    }

    // ### sub-sections → { SectionName: bodyText }
    const subsections = {};
    let currentSection = null;
    let currentLines = [];
    for (let j = firstH3 >= 0 ? firstH3 : lines.length; j < lines.length; j++) {
      const line = lines[j];
      if (line.startsWith('### ')) {
        if (currentSection !== null) {
          subsections[currentSection] = currentLines.join('\n').trim();
        }
        currentSection = line.slice(4).trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }
    if (currentSection !== null) {
      subsections[currentSection] = currentLines.join('\n').trim();
    }

    // Collect Message 1, Message 2, … into an ordered array
    const messageParts = [];
    let n = 1;
    while (`Message ${n}` in subsections) {
      messageParts.push(subsections[`Message ${n}`]);
      n++;
    }

    return {
      id: meta.id,
      number: i + 1,
      heading: meta.heading ?? '',
      placeholder: meta.placeholder ?? '',
      pipLabel: meta.pipLabel ?? null,
      name,
      instruction: subsections['Instruction'] ?? '',
      messageParts,
    };
  });
}

const stageContent = parseStagesMarkdown(rawContent);

// ── Per-stage logic (input/output/serialize/Component) ────────────────────
// Text content lives in stages.md; only pure logic belongs here.

/** Shared workspace logic for both produce-questions-a and produce-questions-b. */
const produceQuestionsLogic = {
  inputType: 'question-list',
  input: (memory) => ({ questions: memory.questions }),
  output: (result, memory) => {
    const questions = result.questions;
    // Re-sync priorities: keep existing order, append new IDs, drop removed ones
    const existingOrder = memory.priorities.filter((id) =>
      questions.some((q) => q.id === id),
    );
    const newIds = questions
      .map((q) => q.id)
      .filter((id) => !existingOrder.includes(id));
    return { ...memory, questions, priorities: [...existingOrder, ...newIds] };
  },
  serialize: (memory) => {
    const filled = memory.questions.filter((q) => q.text.trim());
    return filled.map((q, i) => `${i + 1}. ${q.text.trim()}`).join('\n');
  },
  Component: QuestionProductionStage,
};

const stageLogic = {
  'question-focus': {
    promptId: 1,
    inputType: 'textarea',
    input: null, // replaced at merge time with markdown instruction
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, 'question-focus': result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? '',
    Component: DefaultStage,
  },

  'produce-questions-a': {
    promptId: 2,
    ...produceQuestionsLogic,
  },

  'produce-questions-b': {
    promptId: 7,
    image: divergentThinkingCard,
    imageAlt: "Divergent Thinking Card",
    cardPickerUrl: "https://johnrose-ubc.github.io/question-coach-cards/Question%20Coach%20Card%20Picker%20v2.html",
    ...produceQuestionsLogic,
  },

  'improve-questions': {
    promptId: 3,
    inputType: 'categorize',
    input: (memory) => ({
      questions: memory.questions.filter((q) => q.text.trim()),
      classifications: memory.classifications,
    }),
    output: (result, memory) => ({
      ...memory,
      classifications: result.classifications,
    }),
    serialize: (memory) => {
      const filled = memory.questions.filter((q) => q.text.trim());
      // num() preserves the original question number from Stage 2
      const num = (q) => filled.indexOf(q) + 1;
      const open = filled.filter((q) => memory.classifications[q.id] === 'open');
      const closed = filled.filter((q) => memory.classifications[q.id] === 'closed');
      const unsorted = filled.filter((q) => !memory.classifications[q.id]);
      return [
        'Open questions:',
        ...(open.length ? open.map((q) => `${num(q)}. ${q.text}`) : ['(none)']),
        '',
        'Closed questions:',
        ...(closed.length ? closed.map((q) => `${num(q)}. ${q.text}`) : ['(none)']),
        '',
        'Unsorted questions:',
        ...(unsorted.length ? unsorted.map((q) => `${num(q)}. ${q.text}`) : ['(none)']),
      ].join('\n');
    },
    Component: CategorizeQuestionsStage,
  },

  'prioritize-questions-a': {
    promptId: 8,
    image: reflectiveThinkingCard,
    imageAlt: "Reflective Thinking Card",
    cardPickerUrl: "https://johnrose-ubc.github.io/question-coach-cards/Question%20Coach%20Card%20Picker%20v2.html",
    inputType: 'question-list-readonly',
    input: (memory) => ({ questions: memory.questions.filter((q) => q.text.trim()) }),
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, 'prioritize-questions-a': result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? '',
    Component: QuestionListReadOnly,
  },

  'prioritize-questions-b': {
    promptId: 4,
    inputType: 'prioritize',
    input: (memory) => ({
      questions: memory.questions.filter((q) => q.text.trim()),
      priorities: memory.priorities.filter((id) =>
        memory.questions.some((q) => q.id === id && q.text.trim()),
      ),
    }),
    output: (result, memory) => ({
      ...memory,
      priorities: result.priorities,
    }),
    serialize: (memory) => {
      const filled = memory.questions.filter((q) => q.text.trim());
      const top3 = memory.priorities
        .map((id) => filled.find((q) => q.id === id))
        .filter(Boolean)
        .slice(0, 3)
        .map((q, i) => {
          const originalNum = filled.indexOf(q) + 1;
          return `${i + 1}. ${q.text} [originally question ${originalNum}]`;
        });
      return ['My top 3 questions:', ...(top3.length ? top3 : ['(none)'])].join('\n');
    },
    Component: PrioritizeQuestionsStage,
  },

  'next-steps': {
    promptId: 5,
    inputType: 'textarea',
    input: null, // replaced at merge time with markdown instruction
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, 'next-steps': result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? '',
    Component: DefaultStage,
  },

  'reflect': {
    promptId: 6,
    inputType: 'textarea',
    input: null, // replaced at merge time with markdown instruction
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, reflect: result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? '',
    Component: DefaultStage,
  },
};

/** @type {Stage[]} */
export const stages = stageContent.map((content) => ({
  ...content,
  ...stageLogic[content.id],
}));
