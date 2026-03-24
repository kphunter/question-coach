import DefaultStage from "./components/DefaultStage";
import QuestionProductionStage from "./components/QuestionProductionStage";
import CategorizeQuestionsStage from "./components/CategorizeQuestionsStage";
import PrioritizeQuestionsStage from "./components/PrioritizeQuestionsStage";

/**
 * @typedef {{ id: string, text: string }} Question
 * @typedef {{ questions: Question[], classifications: Record<string, 'open'|'closed'>, priorities: string[], stageNotes: Record<string, string> }} SharedMemory
 * @typedef {{ id: string, number: number, name: string, icon: string, heading: string, description: string, instruction: string, placeholder: string, inputType: 'textarea'|'question-list'|'categorize'|'prioritize', input: (memory: SharedMemory) => any, output: (result: any, memory: SharedMemory) => SharedMemory, serialize: (memory: SharedMemory, draftText?: string) => string, Component: import('react').ComponentType<any> }} Stage
 */

/** @type {Stage[]} */
export const stages = [
  {
    id: "question-focus",
    number: 1,
    name: "Question Focus",
    icon: "center_focus_strong",
    heading: "Stage 1 · Question Area of Focus",
    description:
      "Use the Question Formulation Technique (QFT) to develop and refine your research question.",
    instruction:
      "Let's start. Do you have a question focus, or do you need to develop one? Tell me about your topic or assignment.",
    placeholder: "Share your question focus or describe your assignment topic…",
    inputType: "textarea",
    input: (memory) => ({
      memory,
      instruction:
        "Let's start. Have you been given a question focus by your teacher, or do you need to develop one? Tell me about your topic or assignment.",
    }),
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, "question-focus": result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? "",
    Component: DefaultStage,
  },
  {
    id: "produce-questions",
    number: 2,
    name: "Produce Questions",
    icon: "add_circle",
    heading: "Stage 2 · Produce Questions",
    description:
      "Generate as many questions as possible. No judging, no stopping to answer...just type them all!",
    instruction:
      "Type as many questions as you can about your topic in the Question Workspace. Don't evaluate or answer them, just add them. When you're ready, submit your list and I'll respond. If you need help, ask in the chat.",
    placeholder: "Add a question and press Enter…",
    inputType: "question-list",
    input: (memory) => ({ questions: memory.questions }),
    output: (result, memory) => {
      const questions = result.questions;
      // Re-sync priorities: keep existing order, append any new IDs, drop removed ones
      const existingOrder = memory.priorities.filter((id) =>
        questions.some((q) => q.id === id),
      );
      const newIds = questions
        .map((q) => q.id)
        .filter((id) => !existingOrder.includes(id));
      return {
        ...memory,
        questions,
        priorities: [...existingOrder, ...newIds],
      };
    },
    serialize: (memory) => {
      const filled = memory.questions.filter((q) => q.text.trim());
      return filled.map((q, i) => `${i + 1}. ${q.text.trim()}`).join("\n");
    },
    Component: QuestionProductionStage,
  },
  {
    id: "improve-questions",
    number: 3,
    name: "Improve Questions",
    icon: "tune",
    heading: "Stage 3 · Improve Questions",
    description:
      "Categorize your questions as open or closed, then practise converting between the two types.",
    instruction:
      "Sort each question into open or closed. When you're done, submit the classification so we can discuss patterns and possible revisions.",
    placeholder: "Review your categorized questions…",
    inputType: "categorize",
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
      const open = filled.filter(
        (q) => memory.classifications[q.id] === "open",
      );
      const closed = filled.filter(
        (q) => memory.classifications[q.id] === "closed",
      );
      const unsorted = filled.filter((q) => !memory.classifications[q.id]);
      return [
        "Open questions:",
        ...(open.length
          ? open.map((q, i) => `${i + 1}. ${q.text}`)
          : ["(none)"]),
        "",
        "Closed questions:",
        ...(closed.length
          ? closed.map((q, i) => `${i + 1}. ${q.text}`)
          : ["(none)"]),
        "",
        "Unsorted questions:",
        ...(unsorted.length
          ? unsorted.map((q, i) => `${i + 1}. ${q.text}`)
          : ["(none)"]),
      ].join("\n");
    },
    Component: CategorizeQuestionsStage,
  },
  {
    id: "prioritize-questions",
    number: 4,
    name: "Prioritize Questions",
    icon: "filter_list",
    heading: "Stage 4 · Prioritize Questions",
    description:
      "Identify your criteria and rank questions based on that criteria.",
    instruction:
      "Drag your questions into priority order. Put the most important one at the top, then submit your ranked list.",
    placeholder: "Describe your prioritization criteria…",
    inputType: "prioritize",
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
        .map(
          (q, i) => `${i + 1}. ${starredSet.has(q.id) ? "★ " : ""}${q.text}`,
        );
      return [
        "Priority ranking:",
        ...(ranked.length ? ranked : ["(none)"]),
      ].join("\n");
    },
    Component: PrioritizeQuestionsStage,
  },
  {
    id: "next-steps",
    number: 5,
    name: "Next Steps",
    icon: "rocket_launch",
    heading: "Stage 5 · Discuss Next Steps",
    description:
      "Map out how your prioritized questions will guide your research, writing, or inquiry.",
    instruction:
      "You have your questions — now what? Tell me how you will use them in the next part of your assignment or inquiry.",
    placeholder: "Describe how your questions will shape your next steps…",
    inputType: "textarea",
    input: (memory) => ({
      memory,
      instruction:
        "You have your questions — now what? Tell me how you will use them in the next part of your assignment or inquiry.",
    }),
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, "next-steps": result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? "",
    Component: DefaultStage,
  },
  {
    id: "reflect",
    number: 6,
    name: "Reflect",
    icon: "self_improvement",
    heading: "Stage 6 · Reflect",
    description:
      "Consider what you learned, how your thinking changed, and how you will apply the QFT going forward.",
    instruction:
      "Reflect on the process. What changed in your thinking? Which stage helped you the most?",
    placeholder: "Share your reflections on the question formulation process…",
    inputType: "textarea",
    input: (memory) => ({
      memory,
      instruction:
        "Reflect on the process. What changed in your thinking? Which stage helped you the most?",
    }),
    output: (result, memory) => ({
      ...memory,
      stageNotes: { ...memory.stageNotes, reflect: result.text },
    }),
    serialize: (_memory, draftText) => draftText?.trim() ?? "",
    Component: DefaultStage,
  },
];
