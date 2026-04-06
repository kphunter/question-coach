# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""
Divergence detector for QC session JSON files.

Scans session files and flags anomalous sessions using lightweight heuristics —
no LLM required. Useful for triaging which sessions are most worth sending to
the analysis agent.

Usage:
    python tests/flag_sessions.py sessions/          # scan a directory
    python tests/flag_sessions.py sessions/2026-04/  # scan a specific month
    python tests/flag_sessions.py path/to/session.json  # single file
    python tests/flag_sessions.py sessions/ --json   # machine-readable output
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ── Thresholds ─────────────────────────────────────────────────────────────────

# Stages expected to involve real conversation (not just a workspace submit)
CONVERSATIONAL_STAGES = {
    "question-focus",
    "produce-questions-b",
    "prioritize-questions-a",
    "next-steps",
    "reflect",
}

# Stages where the card picker should ideally have been used
CARD_STAGES = {"produce-questions-b", "prioritize-questions-a"}

# Minimum expected questions after Stage 2A
MIN_QUESTIONS_AFTER_2A = 3

# A stage that took less than this is suspiciously fast (ms)
MIN_STAGE_DURATION_MS = 20_000  # 20 seconds

# A coach response shorter than this word count is suspicious
MIN_COACH_RESPONSE_WORDS = 8

# Strings that suggest placeholder leakage or template artifacts in coach text
PLACEHOLDER_PATTERNS = [
    "{",
    "[PLACEHOLDER]",
    "[INSERT",
    "undefined",
    "null",
    "TODO",
    "<stage",
    "{{",
]

# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class Flag:
    severity: str           # "warn" | "error"
    stage_id: Optional[str]
    code: str
    detail: str


@dataclass
class SessionReport:
    session_id: str
    file_path: str
    completed: bool
    flags: list[Flag] = field(default_factory=list)

    @property
    def has_errors(self):
        return any(f.severity == "error" for f in self.flags)

    @property
    def has_warnings(self):
        return any(f.severity == "warn" for f in self.flags)


# ── Heuristic checks ───────────────────────────────────────────────────────────

def check_stage_duration(stage: dict, report: SessionReport):
    entered = stage.get("entered_at")
    completed = stage.get("completed_at")
    if not entered or not completed:
        return
    try:
        from datetime import datetime, timezone
        fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
        def parse(s):
            s = s.replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        duration_ms = (parse(completed) - parse(entered)).total_seconds() * 1000
        if duration_ms < MIN_STAGE_DURATION_MS:
            report.flags.append(Flag(
                severity="warn",
                stage_id=stage["stage_id"],
                code="fast_stage",
                detail=f"Stage completed in {duration_ms / 1000:.1f}s — may indicate skipping",
            ))
    except Exception:
        pass


def check_coach_responses(stage: dict, report: SessionReport):
    chat = stage.get("chat", [])
    for msg in chat:
        if msg.get("isCoach") and not msg.get("ui_hint") and not msg.get("isInstruction"):
            text = msg.get("text", "")
            word_count = len(text.split())
            if word_count < MIN_COACH_RESPONSE_WORDS:
                report.flags.append(Flag(
                    severity="error",
                    stage_id=stage["stage_id"],
                    code="short_coach_response",
                    detail=f"Coach response has only {word_count} words: {text!r}",
                ))
            for pattern in PLACEHOLDER_PATTERNS:
                if pattern in text:
                    report.flags.append(Flag(
                        severity="error",
                        stage_id=stage["stage_id"],
                        code="placeholder_leakage",
                        detail=f"Coach response contains {pattern!r}: {text[:120]!r}",
                    ))


def check_zero_turns(stage: dict, report: SessionReport):
    stage_id = stage["stage_id"]
    if stage_id not in CONVERSATIONAL_STAGES:
        return
    chat = stage.get("chat", [])
    user_turns = [m for m in chat if m.get("role") == "user"]
    if stage.get("completed_at") and len(user_turns) == 0:
        report.flags.append(Flag(
            severity="warn",
            stage_id=stage_id,
            code="zero_user_turns",
            detail="Stage was completed with no user messages",
        ))


def check_question_count(stages: list[dict], report: SessionReport):
    stage_2a = next((s for s in stages if s["stage_id"] == "produce-questions-a"), None)
    stage_2b = next((s for s in stages if s["stage_id"] == "produce-questions-b"), None)

    if stage_2a:
        questions_2a = stage_2a.get("data", {}).get("questions", [])
        if stage_2a.get("completed_at") and len(questions_2a) < MIN_QUESTIONS_AFTER_2A:
            report.flags.append(Flag(
                severity="warn",
                stage_id="produce-questions-a",
                code="low_question_count",
                detail=f"Only {len(questions_2a)} question(s) generated in Stage 2A",
            ))

    if stage_2a and stage_2b:
        questions_2a = set(stage_2a.get("data", {}).get("questions", []))
        questions_2b = set(stage_2b.get("data", {}).get("questions", []))
        new_in_2b = questions_2b - questions_2a
        if stage_2b.get("completed_at") and len(new_in_2b) == 0:
            report.flags.append(Flag(
                severity="warn",
                stage_id="produce-questions-b",
                code="no_new_questions_2b",
                detail="No new questions added after the divergent thinking card",
            ))


def check_card_picker_usage(session: dict, report: SessionReport):
    events = session.get("error_events", [])
    opened_stages = {
        e["stage_id"] for e in events if e.get("type") == "card_picker_opened"
    }
    stages_visited = {
        s["stage_id"] for s in session.get("stages", [])
        if s.get("completed_at")
    }
    for stage_id in CARD_STAGES:
        if stage_id in stages_visited and stage_id not in opened_stages:
            report.flags.append(Flag(
                severity="warn",
                stage_id=stage_id,
                code="card_picker_not_used",
                detail="Student completed this stage without opening the card picker",
            ))


def check_api_errors(session: dict, report: SessionReport):
    for event in session.get("error_events", []):
        if event.get("type") == "api_error":
            report.flags.append(Flag(
                severity="error",
                stage_id=event.get("stage_id"),
                code="api_error",
                detail=event.get("message", "unknown error"),
            ))


def check_incomplete(session: dict, report: SessionReport):
    if not session.get("completed"):
        last_stage = session.get("current_stage_id", "unknown")
        report.flags.append(Flag(
            severity="warn",
            stage_id=last_stage,
            code="incomplete_session",
            detail=f"Session was not completed (last stage: {last_stage})",
        ))


# ── Session analyser ───────────────────────────────────────────────────────────

def analyse_session(path: str) -> SessionReport:
    with open(path) as f:
        session = json.load(f)

    report = SessionReport(
        session_id=session.get("session_id", Path(path).stem),
        file_path=path,
        completed=session.get("completed", False),
    )

    stages = session.get("stages", [])

    check_incomplete(session, report)
    check_api_errors(session, report)
    check_card_picker_usage(session, report)
    check_question_count(stages, report)

    for stage in stages:
        if not stage.get("entered_at"):
            continue
        check_stage_duration(stage, report)
        check_zero_turns(stage, report)
        check_coach_responses(stage, report)

    return report


def collect_paths(target: str) -> list[str]:
    p = Path(target)
    if p.is_file():
        return [str(p)]
    return sorted(str(f) for f in p.rglob("*.json")
                  if not f.name.startswith(".") and "summary" not in f.name)


# ── Output ─────────────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[31m"
YELLOW = "\033[33m"
GREEN  = "\033[32m"
CYAN   = "\033[36m"


def print_report(report: SessionReport):
    if not report.flags:
        print(f"{GREEN}✓{RESET} {report.session_id}  {DIM}{report.file_path}{RESET}")
        return

    status = f"{RED}✗{RESET}" if report.has_errors else f"{YELLOW}△{RESET}"
    print(f"{status} {BOLD}{report.session_id}{RESET}  {DIM}{report.file_path}{RESET}")
    for flag in report.flags:
        colour = RED if flag.severity == "error" else YELLOW
        stage = f"[{flag.stage_id}] " if flag.stage_id else ""
        print(f"   {colour}{flag.severity.upper()}{RESET}  {stage}{flag.code}: {flag.detail}")


def print_summary(reports: list[SessionReport]):
    total   = len(reports)
    errors  = sum(1 for r in reports if r.has_errors)
    warns   = sum(1 for r in reports if r.has_warnings and not r.has_errors)
    clean   = total - errors - warns
    print(f"\n{BOLD}{'─' * 56}{RESET}")
    print(f"{BOLD}Sessions:{RESET} {total}   "
          f"{RED}errors: {errors}{RESET}   "
          f"{YELLOW}warnings: {warns}{RESET}   "
          f"{GREEN}clean: {clean}{RESET}")


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="QC session divergence detector")
    parser.add_argument("target",
                        help="Session JSON file, or directory to scan recursively")
    parser.add_argument("--json", action="store_true",
                        help="Output machine-readable JSON instead of terminal report")
    parser.add_argument("--errors-only", action="store_true",
                        help="Only print sessions that have at least one flag")
    args = parser.parse_args()

    paths = collect_paths(args.target)
    if not paths:
        print(f"No session JSON files found at: {args.target}", file=sys.stderr)
        sys.exit(1)

    reports = [analyse_session(p) for p in paths]

    if args.json:
        out = []
        for r in reports:
            if args.errors_only and not r.flags:
                continue
            out.append({
                "session_id": r.session_id,
                "file_path": r.file_path,
                "completed": r.completed,
                "flags": [
                    {"severity": f.severity, "stage_id": f.stage_id,
                     "code": f.code, "detail": f.detail}
                    for f in r.flags
                ],
            })
        print(json.dumps(out, indent=2))
    else:
        for r in reports:
            if args.errors_only and not r.flags:
                continue
            print_report(r)
        print_summary(reports)

    any_errors = any(r.has_errors for r in reports)
    sys.exit(1 if any_errors else 0)


if __name__ == "__main__":
    main()
