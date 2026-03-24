---
description: Documents how the final system prompt is assembled at runtime.
---

# System Prompt Composition

The API server (`api/server.py`) builds the system prompt by concatenating
global components, the active stage prompt, and few-shot examples — in that
order. No manual assembly is required; the files listed below are loaded
automatically.

## Assembly order

The full context sent to Gemini has two distinct parts: the **system instruction**
(static per stage) and the **user turn** (assembled per request from live data).

```
┌─────────────────────────────────────────────────────┐
│  SYSTEM INSTRUCTION  (set once per stage)           │
│                                                     │
│  1. Global agent prompt                             │
│     ├── QC-AGENT.md    (role, rules, core behaviours)
│     ├── IDENTITY.md    (persona, objectives, defaults)
│     ├── SOUL.md        (personality, values, tone)  │
│     ├── POLICIES.md    (guardrails, safety, format rules)
│     └── USER.md        (audience context)           │
│                                                     │
│  2. Stage prompt (one of)                           │
│     ├── stage-1-question-focus.md                   │
│     ├── stage-2-produce-questions.md                │
│     ├── stage-3-improve-questions.md                │
│     ├── stage-4-prioritize-questions.md             │
│     ├── stage-5-next-steps.md                       │
│     └── stage-6-reflect.md                          │
│                                                     │
│  3. Examples                                        │
│     └── EXAMPLES.md                                 │
│                                                     │
│  4. Tone defaults (from CONFIG.json)                │
├─────────────────────────────────────────────────────┤
│  USER TURN  (assembled per request)                 │
│                                                     │
│  5. Retrieved knowledge (Qdrant → Gemini user turn) │
│     ├── CONTEXT FROM KNOWLEDGE BASE: <chunk_text×N> │
│     ├── SOURCES: <title list>                       │
│     └── USER MESSAGE: <frontend message>            │
└─────────────────────────────────────────────────────┘
```

## How it works

1. **Global files** are read once at server startup and joined with
   double newlines into `GLOBAL_AGENT_PROMPT`.
2. **Tone defaults** from `CONFIG.json` are appended to the global prompt
   if present.
3. **EXAMPLES.md** is read once at startup into `EXAMPLES_PROMPT`.
4. At request time, `build_system_prompt(stage_prompt)` concatenates:

   ```
   GLOBAL_AGENT_PROMPT + stage_prompt + EXAMPLES_PROMPT
   ```

   This becomes Gemini's `system_instruction`.

5. The frontend fetches all stage prompts via `GET /stages` and sends the
   active stage's prompt in the `system_prompt` field of each
   `POST /chat` request.

6. **Also at request time**, the server queries Qdrant with the user's message,
   retrieves the top-N chunk texts, and injects them into the Gemini **user
   turn** (not the system instruction):

   ```
   CONTEXT FROM KNOWLEDGE BASE:
   <chunk 1 text>

   <chunk 2 text> …

   SOURCES:
   [1] <title>  [2] <title> …

   USER MESSAGE:
   <message from frontend>

   Use the context above to inform your response where relevant.
   Cite sources using [1], [2], etc. when referencing retrieved content.
   ```

   The number of chunks is controlled by `search_limit` in the frontend
   settings (default 5). If no relevant chunks are found, Qdrant context
   is omitted and the user message is sent directly.

## Editing guidelines

| To change …                  | Edit this file / setting   |
|------------------------------|----------------------------|
| Agent role and non-negotiables | `QC-AGENT.md`            |
| Persona and identity         | `IDENTITY.md`              |
| Personality and values       | `SOUL.md`                  |
| Safety and format guardrails | `POLICIES.md`              |
| Audience context             | `USER.md`                  |
| Stage-specific instructions  | `stages/stage-*.md`        |
| Few-shot examples            | `EXAMPLES.md`              |
| Tone and config defaults     | `CONFIG.json`              |
| Knowledge base content       | ingest documents into Qdrant |
| Chunks retrieved per request | `search_limit` (frontend settings, default 5) |

Stage files should contain **only** stage-specific instructions — identity,
guardrails, and personality are inherited from the global components above.
