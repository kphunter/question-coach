# Gemini-optimized Question Formulation Technique prompt pack

This package contains:

- `SYSTEM_PROMPT.md` — Gemini-optimized global system prompt (loaded once at server startup)
- `EXAMPLES.md` — few-shot examples appended to every system prompt (migrated from prompts2)
- `STATE_SCHEMA.json` — lightweight state schema for stage handoff and UI integration
- `stages/` — stage-specific instruction files (one per stage/sub-stage)
- `stages/manifest.yaml` — maps stage IDs to their prompt files; read by the API server

## Design notes

Optimized around current Gemini prompting patterns:

- clear system instructions with persona, rules, and guardrails kept distinct
- direct, concise instructions over sprawling prose
- prompt chaining instead of one giant prompt
- explicit stage boundaries
- structured state where helpful

## Runtime architecture

The full context sent to Gemini has two parts: the **system instruction** (static per stage) and the **user turn** (assembled per request).

```
┌─────────────────────────────────────────────────────┐
│  SYSTEM INSTRUCTION  (assembled once per stage)     │
│                                                     │
│  1. SYSTEM_PROMPT.md      (global agent rules)      │
│  2. Tone defaults         (from agents/CONFIG.json) │
│  3. Stage prompt          (from stages/manifest)    │
│  4. EXAMPLES.md           (few-shot anchors)        │
├─────────────────────────────────────────────────────┤
│  USER TURN  (assembled per request)                 │
│                                                     │
│  5. Question focus        (from Stage 1, injected   │
│                            by the frontend)         │
│  6. Knowledge base chunks (Qdrant → user turn)      │
│  7. User message                                    │
└─────────────────────────────────────────────────────┘
```

### How it works

1. At server startup, `api/server.py` reads `SYSTEM_PROMPT.md` into `GLOBAL_AGENT_PROMPT`.
2. Tone defaults from `agents/CONFIG.json` are appended if present.
3. `EXAMPLES.md` is read into `EXAMPLES_PROMPT`.
4. The `/stages` endpoint reads `stages/manifest.yaml` and loads each stage's prompt file.
5. The frontend fetches stage prompts via `GET /stages` and sends the active stage's prompt
   in the `system_prompt` field of each `POST /chat` request.
6. At request time, `build_system_prompt(stage_prompt)` concatenates:
   ```
   GLOBAL_AGENT_PROMPT + stage_prompt + EXAMPLES_PROMPT
   ```
   This becomes Gemini's `system_instruction`.
7. Also at request time, the frontend prepends the student's confirmed question focus
   (from Stage 1) to the stage system prompt for all downstream stages (2–6).
8. If the knowledge base is running, the server queries Qdrant and injects retrieved
   chunks into the user turn.

### Stage manifest IDs

IDs are non-sequential by design: `1, 2, 7, 3, 8, 4, 5, 6`. The frontend maps each stage
to its prompt via `promptId`, not by array position. Stages 2 and 4 are split into A/B
parts with separate IDs (2A=2, 2B=7, 4A=8, 4B=4).

## Editing guidelines

| To change …                    | Edit this file                              |
|--------------------------------|---------------------------------------------|
| Global agent rules / guardrails | `SYSTEM_PROMPT.md`                         |
| Few-shot examples               | `EXAMPLES.md`                              |
| Stage-specific instructions     | `stages/STAGE_*.md`                        |
| Stage→file mapping              | `stages/manifest.yaml`                     |
| Tone and config defaults        | `agents/CONFIG.json`                       |
| Knowledge base content          | ingest documents into Qdrant               |
| Chunks retrieved per request    | `search_limit` (frontend settings, default 5) |

## State schema

`STATE_SCHEMA.json` defines the recommended state object for richer stage handoff. The
minimum fields passed each turn are:

- `stage_id` — active stage identifier
- `question_focus` — topic, angle, context, and draft focus statement from Stage 1
- `top_questions` — up to 3 prioritized questions (available from Stage 4B onward)
- `ui_capabilities` — which UI controls are active (next_stage_button, b_icon, etc.)
- `student_progress` — boolean flags for each stage completion milestone

Currently, `question_focus` is injected by the frontend for all stages after Stage 1.
Full state serialization per turn is a planned enhancement.

## Important implementation note

Instruction files use **STRICT RULE** and **STAGE BOUNDARY RULE** language deliberately.
That wording is intentional for stronger compliance in Gemini-style models.
