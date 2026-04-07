# Tests

## Student Driver (`student_driver.py`)

An end-to-end test that simulates a student working through the full QFT
workflow. Claude (Anthropic API) plays the student; the local QC FastAPI
server plays the coach.

Three personas are included, each with a distinct topic and behavioural style:

| Persona | Name | Style | Topic |
|---|---|---|---|
| `keen` | Alex | Thoughtful, reads everything carefully | AI ethics in medical diagnosis |
| `skeptical` | Jordan | Casual, shortcuts, mildly resistant | Social media and teen mental health |
| `action` | Sam | Practical, time-pressured, no philosophising | Food waste in university dining |

Each persona runs the full session — Stage 1 through Stage 6 — and maintains
a continuous memory of everything they typed in earlier stages, mirroring how
a real student would work through the tool.

### Setup

```bash
pip install -r tests/requirements.txt
export ANTHROPIC_API_KEY=your-key-here
export QC_API_URL=http://localhost:8000   # optional, this is the default
```

The QC API server must be running before you start.

### Usage

```bash
# Run all three personas sequentially
python tests/student_driver.py

# Run a single persona
python tests/student_driver.py --persona keen
python tests/student_driver.py --persona skeptical
python tests/student_driver.py --persona action

# Point at a non-local server
python tests/student_driver.py --api https://your-vm-host

# Test a prompt edit without deploying — runs the full session but
# uses the local file as the system prompt for that stage only
python tests/student_driver.py \
  --stage improve-questions \
  --prompt-file agents/prompts/stages/STAGE_3_IMPROVE_QUESTIONS.md
```

`--stage` and `--prompt-file` must be used together. The full session always
runs — prerequisite stages execute normally so workspace state (questions,
classifications, etc.) is realistic when the overridden stage is reached.

Exits `0` if all selected personas complete without error, `1` otherwise.

---

## Token Pre-flight Check (`verify_tokens.py`)

Verifies that the required tokens are set and have the correct permissions
before running the stack. Uses only Python stdlib — no installation needed.

```bash
# Check SESSIONS_REPO_TOKEN (run from question-coach repo)
python3 tests/verify_tokens.py

# Point at the production API instead of localhost
python3 tests/verify_tokens.py --api https://your-vm-host

# Check QC_ANALYSIS_WRITER (run from either repo)
python3 tests/verify_tokens.py --mode analysis
```

Exits `0` if all checks pass, `1` otherwise.

---

## Divergence Detector (`flag_sessions.py`)

A lightweight heuristic scanner that reads session JSON files and flags
anomalous sessions without making any API calls. Use it to triage which
sessions are most worth sending to the analysis agent.

### Checks performed

| Code | Severity | Description |
|---|---|---|
| `incomplete_session` | warn | Session was never completed |
| `api_error` | error | An API error was recorded during the session |
| `fast_stage` | warn | A stage completed in under 20 seconds |
| `zero_user_turns` | warn | A conversational stage had no user messages |
| `low_question_count` | warn | Fewer than 3 questions generated in Stage 2A |
| `no_new_questions_2b` | warn | No new questions added after the divergent thinking card |
| `card_picker_not_used` | warn | Student completed a card stage without opening the picker |
| `short_coach_response` | error | Coach response under 8 words |
| `placeholder_leakage` | error | Coach response contains `{`, `undefined`, or similar artifacts |

### Usage

```bash
# Scan a directory of session files
python tests/flag_sessions.py path/to/sessions/

# Scan a specific month
python tests/flag_sessions.py path/to/sessions/2026-04/

# Single file
python tests/flag_sessions.py path/to/session-abc123.json

# Only print flagged sessions
python tests/flag_sessions.py path/to/sessions/ --errors-only

# Machine-readable output (e.g. to pipe into the analysis agent)
python tests/flag_sessions.py path/to/sessions/ --json
```

Exits `0` if no error-severity flags were found, `1` otherwise.

---

## Manual UX Reference (`ux-test-questions.md`)

A hand-curated set of 20 questions on mixed topics for manual UX testing.
Use them as sample input during Stage 2 to exercise the classification,
prioritisation, and discussion stages. Questions are pre-labelled `[O]` or
`[C]` to help verify the Stage 3 drag-and-drop UI.
