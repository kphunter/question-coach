---
description: Documents how the final system prompt is assembled at runtime.
---

# System Prompt Composition

The API server (`api/server.py`) builds the system prompt by concatenating
global components, the active stage prompt, and few-shot examples — in that
order. No manual assembly is required; the files listed below are loaded
automatically.

## Assembly order

```
┌─────────────────────────────────────┐
│  1. Global agent prompt             │
│     ├── QC-AGENT.md    (role, rules, core behaviours)
│     ├── IDENTITY.md    (persona, objectives, defaults)
│     ├── SOUL.md        (personality, values, tone)
│     ├── POLICIES.md    (guardrails, safety, format rules)
│     └── USER.md        (audience context)
│                                     │
│  2. Stage prompt (one of)           │
│     ├── stage-1-question-focus.md   │
│     ├── stage-2-produce-questions.md│
│     ├── stage-3-improve-questions.md│
│     ├── stage-4-prioritize-questions.md
│     ├── stage-5-next-steps.md       │
│     └── stage-6-reflect.md          │
│                                     │
│  3. Examples                        │
│     └── EXAMPLES.md                 │
│                                     │
│  4. Tone defaults (from CONFIG.json)│
└─────────────────────────────────────┘
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

5. The frontend fetches all stage prompts via `GET /stages` and sends the
   active stage's prompt in the `system_prompt` field of each
   `POST /chat` request.

## Editing guidelines

| To change …                  | Edit this file             |
|------------------------------|----------------------------|
| Agent role and non-negotiables | `QC-AGENT.md`            |
| Persona and identity         | `IDENTITY.md`              |
| Personality and values       | `SOUL.md`                  |
| Safety and format guardrails | `POLICIES.md`              |
| Audience context             | `USER.md`                  |
| Stage-specific instructions  | `stages/stage-*.md`        |
| Few-shot examples            | `EXAMPLES.md`              |
| Tone and config defaults     | `CONFIG.json`              |

Stage files should contain **only** stage-specific instructions — identity,
guardrails, and personality are inherited from the global components above.