import rawContent from './stages.md?raw';
import DefaultStage from "./components/DefaultStage";
import QuestionProductionStage from "./components/QuestionProductionStage";
import CategorizeQuestionsStage from "./components/CategorizeQuestionsStage";
import PrioritizeQuestionsStage from "./components/PrioritizeQuestionsStage";

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
      name,
      instruction: subsections['Instruction'] ?? '',
      messageParts,
    };
  });
}

const stageContent = parseStagesMarkdown(rawContent);

// ── Per-stage logic (input/output/serialize/Component) ────────────────────
// Text content lives in stages.md; only pure logic belongs here.
const stageLogic = {
  'question-focus': {
    inputType: 'textarea',
    input: null, // replaced at merge time with markdown instruction
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, 'question-focus': result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? '',
    Component: DefaultStage,
  },

  'produce-questions': {
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
  },

  'improve-questions': {
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

  'prioritize-questions': {
    inputType: 'prioritize',
    input: (memory) => ({
      questions: memory.questions.filter((q) => q.text.trim()),
      priorities: memory.priorities.filter((id) =>
        memory.questions.some((q) => q.id === id && q.text.trim()),
      ),
      starred: memory.starred,
    }),
    output: (result, memory) => ({
      ...memory,
      priorities: result.priorities,
      starred: result.starred,
    }),
    serialize: (memory) => {
      const filled = memory.questions.filter((q) => q.text.trim());
      const starredSet = new Set(memory.starred);
      const ranked = memory.priorities
        .map((id) => filled.find((q) => q.id === id))
        .filter(Boolean)
        .map((q, i) => `${i + 1}. ${starredSet.has(q.id) ? '★ ' : ''}${q.text}`);
      return ['Priority ranking:', ...(ranked.length ? ranked : ['(none)'])].join('\n');
    },
    Component: PrioritizeQuestionsStage,
  },

  'next-steps': {
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
