# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""
LLM-based student driver for QC end-to-end testing.

Simulates three student personas working through the full QFT workflow.
The student is played by Claude (Anthropic API); responses go to the local
QC FastAPI server, which uses Gemini as the coach.

Usage:
    python tests/student_driver.py                       # all three personas
    python tests/student_driver.py --persona keen
    python tests/student_driver.py --persona skeptical
    python tests/student_driver.py --persona action
    python tests/student_driver.py --api http://host:8000

Requirements:
    pip install -r tests/requirements.txt
    export ANTHROPIC_API_KEY=...
    export QC_API_URL=http://localhost:8000   # optional
"""

import argparse
import dataclasses
import datetime
import json
import os
import sys
import textwrap
import uuid
from pathlib import Path
from typing import Optional

import yaml

import anthropic
import httpx

# ── Configuration ──────────────────────────────────────────────────────────────

DEFAULT_API = os.environ.get("QC_API_URL", "http://localhost:8000")
STUDENT_MODEL = "claude-sonnet-4-6"
COACH_GEMINI_MODEL = "gemini-2.5-flash-lite"

MAX_CHAT_MSG = 1950  # stay under the API's max_input_length (2000)

DIVERGENT_CARDS = [
    "What if the opposite were true?",
    "How would this look from a completely different culture?",
    "What if this happened 100 years from now?",
    "What would a 5-year-old ask about this?",
    "Reverse it: what questions does this topic ask of you?",
]

REFLECTIVE_CARDS = [
    "Personal Connection: How does this topic connect to your own experiences?",
    "Missing Voice: Whose perspective is absent from your questions so far?",
    "Assumptions: What are you taking for granted in how you framed these questions?",
    "Impact: Which of your questions, if answered, would change the most?",
]

# ── Workspace state ────────────────────────────────────────────────────────────

@dataclasses.dataclass
class WorkspaceState:
    question_focus: str = ""
    questions: list = dataclasses.field(default_factory=list)        # list[str]
    classifications: dict = dataclasses.field(default_factory=dict)  # str -> 'open'|'closed'
    priorities: list = dataclasses.field(default_factory=list)       # list[str], top 3
    card_divergent: str = ""
    card_reflective: str = ""


def serialize_questions(state: WorkspaceState) -> str:
    return "\n".join(f"{i + 1}. {q}" for i, q in enumerate(state.questions))


def serialize_classifications(state: WorkspaceState) -> str:
    open_qs   = [q for q in state.questions if state.classifications.get(q) == "open"]
    closed_qs = [q for q in state.questions if state.classifications.get(q) == "closed"]
    unsorted  = [q for q in state.questions if q not in state.classifications]
    lines = (
        ["Open questions:"]
        + ([f"  {q}" for q in open_qs] or ["  (none)"])
        + ["", "Closed questions:"]
        + ([f"  {q}" for q in closed_qs] or ["  (none)"])
    )
    if unsorted:
        lines += ["", "Unsorted:"] + [f"  {q}" for q in unsorted]
    return "\n".join(lines)


def serialize_priorities(state: WorkspaceState) -> str:
    top3 = state.priorities[:3]
    lines = ["My top 3 questions:"] + (
        [f"{i + 1}. {q}" for i, q in enumerate(top3)] or ["(none)"]
    )
    return "\n".join(lines)


# ── Student personas (loaded from personas.yaml) ────────────────────────────────

_PERSONAS_FILE = Path(__file__).parent / "personas.yaml"

def _load_personas() -> dict:
    with open(_PERSONAS_FILE) as f:
        return yaml.safe_load(f)

PERSONAS = _load_personas()

VERBOSITY_INSTRUCTIONS = {
    1: "VERBOSITY: Respond in as few words as possible — single words or fragments are fine.",
    2: "VERBOSITY: 1 terse sentence per response. Be brief.",
    3: "VERBOSITY: 1-2 sentences per response. Be concise but complete.",
    4: "VERBOSITY: 2-3 sentences per response. Elaborate where it adds value.",
    5: "VERBOSITY: 3-4 sentences per response. Be thorough and detailed.",
}

CONFIDENCE_INSTRUCTIONS = {
    1: "CONFIDENCE: You are hesitant and unsure. Hedge every statement, seek reassurance, and defer to the coach on all decisions.",
    2: "CONFIDENCE: You are mildly uncertain. You express mild doubt and occasionally ask whether you're on the right track.",
    3: "CONFIDENCE: You are moderately confident. You proceed steadily but welcome guidance.",
    4: "CONFIDENCE: You are fairly confident. You make decisions independently and only check in when genuinely stuck.",
    5: "CONFIDENCE: You are highly assertive. You push back on instructions you disagree with and advocate strongly for your own choices.",
}

COMPLIANCE_INSTRUCTIONS = {
    1: "COMPLIANCE: You largely ignore detailed instructions. You skim, skip steps, and do the minimum to seem engaged.",
    2: "COMPLIANCE: You follow the main thrust of instructions but miss details and take shortcuts when you can.",
    3: "COMPLIANCE: You follow instructions reasonably well, with occasional minor omissions.",
    4: "COMPLIANCE: You follow instructions carefully and completely, rarely missing a step.",
    5: "COMPLIANCE: You follow every instruction precisely and thoroughly, even restating them back to confirm understanding.",
}

PRIOR_KNOWLEDGE_INSTRUCTIONS = {
    1: "PRIOR KNOWLEDGE: You know almost nothing about the topic. Questions are naive, surface-level, and may reveal basic misconceptions.",
    2: "PRIOR KNOWLEDGE: You have a little background knowledge — enough to ask sensible questions but not to go deep.",
    3: "PRIOR KNOWLEDGE: You have moderate familiarity with the topic from coursework or general reading.",
    4: "PRIOR KNOWLEDGE: You are well-read on the topic and bring specific concepts, terminology, and examples into your questions.",
    5: "PRIOR KNOWLEDGE: You are a near-expert. Questions are sophisticated, reference specific literature or debates, and may be difficult for a generalist coach to handle.",
}

CREATIVITY_INSTRUCTIONS = {
    1: "CREATIVITY: Your questions are literal and conventional. You ask the obvious things and stick closely to the stated topic.",
    2: "CREATIVITY: Your questions are mostly straightforward with occasional minor variations in angle.",
    3: "CREATIVITY: You show moderate creativity — a mix of conventional and unexpected questions.",
    4: "CREATIVITY: You regularly find unexpected angles, reframe the topic, or draw in surprising connections.",
    5: "CREATIVITY: Your questions are highly lateral and unconventional. You challenge premises, invert assumptions, and explore tangential territory.",
}

_KNOB_MAPS = {
    "verbosity":      VERBOSITY_INSTRUCTIONS,
    "confidence":     CONFIDENCE_INSTRUCTIONS,
    "compliance":     COMPLIANCE_INSTRUCTIONS,
    "prior_knowledge": PRIOR_KNOWLEDGE_INSTRUCTIONS,
    "creativity":     CREATIVITY_INSTRUCTIONS,
}

# ── Terminal output ────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
GREEN  = "\033[32m"
BLUE   = "\033[34m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
RED    = "\033[31m"


def _wrap(text: str, indent: int) -> str:
    return textwrap.fill(text, width=76, subsequent_indent=" " * indent)


def print_header(text: str):
    bar = "─" * 64
    print(f"\n{BOLD}{CYAN}{bar}{RESET}")
    print(f"{BOLD}{CYAN}  {text}{RESET}")
    print(f"{BOLD}{CYAN}{bar}{RESET}")


def print_stage(stage_id: str, heading: str):
    print(f"\n{BOLD}{YELLOW}▶ {heading}{RESET}  {DIM}({stage_id}){RESET}")


def print_coach(text: str):
    print(f"{BLUE}Coach:{RESET} {_wrap(text, 7)}")


def print_student(name: str, text: str):
    indent = len(name) + 2
    print(f"{GREEN}{name}:{RESET} {_wrap(text, indent)}")


def print_info(text: str):
    print(f"{DIM}  ℹ {text}{RESET}")


def print_error(text: str):
    print(f"{RED}  ✗ {text}{RESET}", file=sys.stderr)


def print_pass(text: str):
    print(f"{GREEN}  ✓ {text}{RESET}")


# ── QC API client ──────────────────────────────────────────────────────────────

class QCClient:
    def __init__(self, base_url: str, prompt_override: Optional[tuple[str, str]] = None,
                 verify_ssl: bool = True):
        """
        prompt_override: (stage_id, file_path) — replaces the server's prompt for
        that stage with the contents of the local file. Useful for testing a prompt
        edit without deploying.
        verify_ssl: set False to skip certificate verification (e.g. raw IP endpoints).
        """
        self.base = base_url.rstrip("/")
        self._http = httpx.Client(timeout=60.0, verify=verify_ssl)
        self.stage_prompts: dict[str, str] = {}
        self._prompt_override = prompt_override

    def health(self) -> dict:
        return self._http.get(f"{self.base}/health").raise_for_status().json()

    def fetch_stage_prompts(self):
        data = self._http.get(f"{self.base}/stages").raise_for_status().json()
        self.stage_prompts = {
            item["id"]: item.get("system_prompt", "") for item in data
        }
        print_info(f"Fetched prompts for {len(self.stage_prompts)} stages")

        if self._prompt_override:
            stage_id, file_path = self._prompt_override
            with open(file_path) as f:
                self.stage_prompts[stage_id] = f.read().strip()
            print_info(f"Overriding prompt for '{stage_id}' from {file_path}")

    def _build_system_prompt(self, stage_id: str, state: WorkspaceState) -> Optional[str]:
        parts = []
        if state.question_focus and stage_id != "question-focus":
            parts.append(
                f"CONTEXT — Student's question focus from Stage 1:\n{state.question_focus}"
            )
        if stage_id == "next-steps" and state.priorities:
            top3 = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(state.priorities[:3]))
            parts.append(f"CONTEXT — Student's top 3 questions from Stage 4:\n{top3}")
        stage_prompt = self.stage_prompts.get(stage_id, "")
        if stage_prompt:
            parts.append(stage_prompt)
        return "\n\n---\n\n".join(parts) or None

    def chat(self, message: str, stage_id: str, state: WorkspaceState,
             history: list[dict]) -> str:
        payload = {
            "message": f"[QFT {stage_id}]\n\n{message}",
            "history": [{"role": m["role"], "text": m["text"]} for m in history],
            "use_gemini": True,
            "gemini_model": COACH_GEMINI_MODEL,
            "search_strategy": "auto",
            "search_limit": 5,
            "system_prompt": self._build_system_prompt(stage_id, state),
        }
        resp = self._http.post(f"{self.base}/chat", json=payload).raise_for_status()
        return resp.json()["response"]

    def submit_session(self, session: dict) -> None:
        resp = self._http.post(f"{self.base}/api/sessions", json={"session": session})
        result = resp.json()
        print_info(f"Session submitted: {result.get('status', '?')}")

    def close(self):
        self._http.close()


# ── Student agent ──────────────────────────────────────────────────────────────

class StudentAgent:
    def __init__(self, persona: dict):
        self.name = persona["name"]
        self.topic = persona["topic"]
        knob_notes = []
        for knob, mapping in _KNOB_MAPS.items():
            level = max(1, min(5, int(persona.get(knob, 3))))
            knob_notes.append(mapping[level])
        self._system = persona["system"].rstrip() + "\n\n" + "\n".join(knob_notes)
        self._client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self._history: list[dict] = []

    def _call(self, prompt: str, *, json_mode: bool = False) -> str:
        system = self._system
        if json_mode:
            system += "\n\nRespond ONLY with a valid JSON object. No prose, no code fences."
        self._history.append({"role": "user", "content": prompt})
        msg = self._client.messages.create(
            model=STUDENT_MODEL,
            max_tokens=1024,
            system=system,
            messages=self._history,
        )
        text = msg.content[0].text.strip()
        self._history.append({"role": "assistant", "content": text})
        return text

    def respond(self, coach_message: str, *, context: str = "") -> str:
        """Natural conversational response to a coach message."""
        prompt = f"The coach said:\n\n{coach_message}"
        if context:
            prompt += f"\n\n{context}"
        prompt += "\n\nRespond naturally as yourself."
        return self._call(prompt)

    def generate_questions(self, n: int, *, context: str = "") -> list[str]:
        prompt = (
            f"Generate exactly {n} questions about your assignment topic: {self.topic}.\n"
            f"Follow the QFT rules: ask questions only — no statements.\n"
            f"Keep each question under 12 words.\n"
        )
        if context:
            prompt += f"\nAdditional context / inspiration: {context}\n"
        prompt += f'\nRespond with JSON: {{"questions": ["...", ...]}}'
        raw = self._call(prompt, json_mode=True)
        try:
            return json.loads(raw)["questions"][:n]
        except Exception:
            return [ln.strip().lstrip("0123456789.-) ") for ln in raw.splitlines()
                    if "?" in ln][:n]

    def classify_questions(self, questions: list[str]) -> dict[str, str]:
        qs = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
        prompt = (
            "Classify each question as 'open' (requires explanation / discussion to answer) "
            "or 'closed' (yes/no or a single fact).\n\n"
            f"Questions:\n{qs}\n\n"
            'Respond with JSON: {"classifications": {"<exact question text>": "open"|"closed", ...}}'
        )
        raw = self._call(prompt, json_mode=True)
        try:
            return json.loads(raw)["classifications"]
        except Exception:
            return {q: "open" for q in questions}

    def pick_priorities(self, questions: list[str], card: str) -> list[str]:
        qs = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
        prompt = (
            f"You drew this reflective thinking card: '{card}'\n\n"
            f"From these questions:\n{qs}\n\n"
            "Pick your top 3 in priority order, consistent with your personality and "
            "how the card applies to your topic.\n"
            'Respond with JSON: {"top3": ["<question text>", "<question text>", "<question text>"]}'
        )
        raw = self._call(prompt, json_mode=True)
        try:
            return json.loads(raw)["top3"]
        except Exception:
            return questions[:3]

    def pick_card(self, card_list: list[str]) -> str:
        options = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(card_list))
        prompt = (
            "Pick one of these cards. Choose the one that fits your personality "
            f"best, or feels most relevant to your topic.\n\n{options}\n\n"
            f'Respond with JSON: {{"choice": <number 1-{len(card_list)}> }}'
        )
        raw = self._call(prompt, json_mode=True)
        try:
            idx = int(json.loads(raw)["choice"]) - 1
            return card_list[max(0, min(idx, len(card_list) - 1))]
        except Exception:
            return card_list[0]

    def reset_history(self):
        """Clear conversation memory between stage groups."""
        self._history = []


# ── Stage runners ──────────────────────────────────────────────────────────────

def _exchange(student_msg: str, stage_id: str,
              student: StudentAgent, coach: QCClient,
              state: WorkspaceState, history: list[dict]) -> str:
    """Send one student message, receive one coach reply; update history."""
    full_msg = f"[QFT {stage_id}]\n\n{student_msg}"
    if len(full_msg) > MAX_CHAT_MSG:
        raise RuntimeError(
            f"Message too long for API ({len(full_msg)} chars > {MAX_CHAT_MSG}). "
            f"Reduce questions_2a/2b in the persona or shorten question text."
        )
    print_student(student.name, student_msg)
    coach_reply = coach.chat(student_msg, stage_id, state, history)
    history += [
        {"role": "user",  "text": student_msg, "stage_id": stage_id},
        {"role": "model", "text": coach_reply, "stage_id": stage_id},
    ]
    print_coach(coach_reply)
    return coach_reply


def run_stage_1(persona: dict, student: StudentAgent, coach: QCClient,
                state: WorkspaceState, history: list[dict]):
    print_stage("question-focus", "Stage 1 · Question Focus")

    opening = student.respond(
        "",
        context=f"Introduce your assignment topic to the coach. Your topic: {student.topic}"
    )
    state.question_focus = opening.split(".")[0].strip()
    coach_reply = _exchange(opening, "question-focus", student, coach, state, history)

    follow_up = student.respond(
        coach_reply,
        context="Continue the conversation briefly, then signal you are ready by ending with READY."
    )
    follow_up_clean = follow_up.replace("READY", "").strip()
    if follow_up_clean:
        _exchange(follow_up_clean, "question-focus", student, coach, state, history)


def run_stage_2a(persona: dict, student: StudentAgent, coach: QCClient,
                 state: WorkspaceState, history: list[dict]):
    print_stage("produce-questions-a", "Stage 2A · Produce Questions")

    n = persona["questions_2a"]
    print_info(f"Generating {n} questions…")
    state.questions = student.generate_questions(n)
    print_info("Questions:\n" + textwrap.indent(serialize_questions(state), "    "))

    submit = f"Here are my questions:\n{serialize_questions(state)}"
    coach_reply = _exchange(submit, "produce-questions-a", student, coach, state, history)

    follow_up = student.respond(coach_reply)
    if follow_up.strip():
        _exchange(follow_up, "produce-questions-a", student, coach, state, history)


def run_stage_2b(persona: dict, student: StudentAgent, coach: QCClient,
                 state: WorkspaceState, history: list[dict]):
    print_stage("produce-questions-b", "Stage 2B · Produce Questions (Card)")

    card = student.pick_card(DIVERGENT_CARDS)
    state.card_divergent = card
    print_info(f"Card drawn: {card}")

    card_reply = student.respond(
        "What card did you draw?",
        context=f"You drew this divergent thinking card: '{card}'. Tell the coach and react briefly."
    )
    coach_reply = _exchange(card_reply, "produce-questions-b", student, coach, state, history)

    n = persona["questions_2b"]
    print_info(f"Generating {n} additional questions inspired by card…")
    extra = student.generate_questions(n, context=f"Be inspired by this card: {card}")
    state.questions = list(dict.fromkeys(state.questions + extra))  # deduplicate, preserve order
    print_info("Updated questions:\n" + textwrap.indent(serialize_questions(state), "    "))

    submit = f"Here are my updated questions:\n{serialize_questions(state)}"
    _exchange(submit, "produce-questions-b", student, coach, state, history)


def run_stage_3(persona: dict, student: StudentAgent, coach: QCClient,
                state: WorkspaceState, history: list[dict]):
    print_stage("improve-questions", "Stage 3 · Improve Questions")

    print_info("Classifying questions…")
    state.classifications = student.classify_questions(state.questions)
    print_info("Classifications:\n" + textwrap.indent(serialize_classifications(state), "    "))

    submit = f"Here are my classifications:\n{serialize_classifications(state)}"
    coach_reply = _exchange(submit, "improve-questions", student, coach, state, history)

    # Rewrite turn — coach typically asks for one open→closed and one closed→open
    rewrite = student.respond(
        coach_reply,
        context="The coach may be asking you to rewrite a question. Do so naturally and briefly."
    )
    if rewrite.strip():
        _exchange(rewrite, "improve-questions", student, coach, state, history)


def run_stage_4a(persona: dict, student: StudentAgent, coach: QCClient,
                 state: WorkspaceState, history: list[dict]):
    print_stage("prioritize-questions-a", "Stage 4A · Prioritize Questions (Card)")

    card = student.pick_card(REFLECTIVE_CARDS)
    state.card_reflective = card
    print_info(f"Card drawn: {card}")

    card_reply = student.respond(
        "What card did you draw?",
        context=(
            f"You drew this reflective thinking card: '{card}'. "
            "Tell the coach which card you drew and briefly react to it."
        )
    )
    coach_reply = _exchange(card_reply, "prioritize-questions-a", student, coach, state, history)

    follow_up = student.respond(coach_reply)
    if follow_up.strip():
        _exchange(follow_up, "prioritize-questions-a", student, coach, state, history)


def run_stage_4b(persona: dict, student: StudentAgent, coach: QCClient,
                 state: WorkspaceState, history: list[dict]):
    print_stage("prioritize-questions-b", "Stage 4B · Prioritize Questions")

    print_info("Selecting top 3 questions…")
    state.priorities = student.pick_priorities(state.questions, state.card_reflective)
    print_info("Priorities:\n" + textwrap.indent(serialize_priorities(state), "    "))

    coach_reply = _exchange(
        serialize_priorities(state),
        "prioritize-questions-b", student, coach, state, history
    )

    follow_up = student.respond(coach_reply)
    if follow_up.strip():
        _exchange(follow_up, "prioritize-questions-b", student, coach, state, history)


def run_stage_5(persona: dict, student: StudentAgent, coach: QCClient,
                state: WorkspaceState, history: list[dict]):
    print_stage("next-steps", "Stage 5 · Discuss Next Steps")

    opening = student.respond(
        "",
        context=(
            "Discuss how your top 3 questions will shape the next steps in your assignment. "
            f"Your top 3: {'; '.join(state.priorities[:3])}"
        )
    )
    coach_reply = _exchange(opening, "next-steps", student, coach, state, history)

    for _ in range(2):
        follow_up = student.respond(
            coach_reply,
            context="Continue the conversation. If you have nothing to add, respond with just: DONE"
        )
        if "DONE" in follow_up.upper() or len(follow_up.strip()) < 10:
            break
        coach_reply = _exchange(follow_up, "next-steps", student, coach, state, history)


def run_stage_6(persona: dict, student: StudentAgent, coach: QCClient,
                state: WorkspaceState, history: list[dict]):
    print_stage("reflect", "Stage 6 · Reflect")

    opening = student.respond(
        "",
        context="The coach will ask you 3 reflection questions about this process. Engage genuinely."
    )
    coach_reply = _exchange(opening, "reflect", student, coach, state, history)

    # Coach asks 3 reflection questions; respond to each
    for _ in range(3):
        reply = student.respond(coach_reply)
        if not reply.strip():
            break
        coach_reply = _exchange(reply, "reflect", student, coach, state, history)


# ── Session orchestrator ───────────────────────────────────────────────────────

def _build_session_payload(persona_key: str, state: WorkspaceState,
                           history: list[dict], completed: bool) -> dict:
    """Build a session dict compatible with the /api/sessions endpoint."""
    from collections import defaultdict
    now = datetime.datetime.now(datetime.UTC).isoformat()

    # Group history messages by stage_id to produce per-stage chat arrays.
    stage_chats: dict[str, list] = defaultdict(list)
    for msg in history:
        sid = msg.get("stage_id", "unknown")
        stage_chats[sid].append({"role": msg["role"], "text": msg["text"]})

    stages = [
        {"stage_id": sid, "chat": chat, "entered_at": now, "completed_at": now}
        for sid, chat in stage_chats.items()
    ]

    return {
        "schema_version": "1",
        "session_id": uuid.uuid4().hex[:8],
        "started_at": now,
        "completed_at": now if completed else None,
        "completed": completed,
        "model": COACH_GEMINI_MODEL,
        "persona": persona_key,
        "question_focus": state.question_focus or None,
        "error_events": [],
        "stages": stages,
        "questions": state.questions,
        "classifications": state.classifications,
        "priorities": state.priorities,
        "card_divergent": state.card_divergent,
        "card_reflective": state.card_reflective,
    }


def run_session(persona_key: str, api_base: str,
                prompt_override: Optional[tuple[str, str]] = None,
                verify_ssl: bool = True) -> bool:
    persona = PERSONAS[persona_key]
    student = StudentAgent(persona)
    coach = QCClient(api_base, prompt_override=prompt_override, verify_ssl=verify_ssl)
    state = WorkspaceState()
    history: list[dict] = []
    completed = False

    print_header(f"Session: {persona['display']}  ·  Topic: {persona['topic']}")

    try:
        data = coach.health()
        print_info(f"API health: {data.get('status')}  "
                   f"({data.get('collection_count', '?')} vectors)")
        coach.fetch_stage_prompts()

        run_stage_1(persona, student, coach, state, history)
        run_stage_2a(persona, student, coach, state, history)
        run_stage_2b(persona, student, coach, state, history)
        run_stage_3(persona, student, coach, state, history)
        run_stage_4a(persona, student, coach, state, history)
        run_stage_4b(persona, student, coach, state, history)
        run_stage_5(persona, student, coach, state, history)
        run_stage_6(persona, student, coach, state, history)

        completed = True
        print_pass(f"Session complete for {persona['display']}")
        return True

    except Exception as exc:
        print_error(f"Session failed: {exc}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        try:
            session = _build_session_payload(persona_key, state, history, completed)
            coach.submit_session(session)
        except Exception as exc:
            print_error(f"Session submission failed: {exc}")
        coach.close()


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="QC LLM student driver",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Personas: keen, skeptical, action  (default: all three)",
    )
    parser.add_argument("--persona", choices=list(PERSONAS.keys()),
                        help="Run a single persona")
    parser.add_argument("--api", default=DEFAULT_API,
                        help=f"QC API base URL (default: {DEFAULT_API})")
    parser.add_argument("--no-verify", action="store_true",
                        help="Skip SSL certificate verification (use with raw IP endpoints)")
    parser.add_argument("--stage",
                        help="Stage ID whose prompt you want to override "
                             "(e.g. improve-questions)")
    parser.add_argument("--prompt-file",
                        help="Local .md file to use as the system prompt for --stage")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print_error("ANTHROPIC_API_KEY is not set")
        sys.exit(1)

    if bool(args.stage) != bool(args.prompt_file):
        print_error("--stage and --prompt-file must be used together")
        sys.exit(1)

    prompt_override = (args.stage, args.prompt_file) if args.stage else None

    to_run = [args.persona] if args.persona else list(PERSONAS.keys())
    results = {key: run_session(key, args.api, prompt_override,
                                verify_ssl=not args.no_verify) for key in to_run}

    print_header("Results")
    all_passed = all(results.values())
    for key, passed in results.items():
        fn = print_pass if passed else print_error
        fn(PERSONAS[key]["display"])

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
