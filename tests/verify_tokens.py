#!/usr/bin/env python3
"""
Token and connectivity pre-flight check.

No third-party packages required — uses only Python stdlib.

Run from question-coach repo (default):
    python tests/verify_tokens.py

Run from qc-analysis-prompt-improvement-bot repo:
    python tests/verify_tokens.py --mode analysis

Checks (coach mode):
  1. SESSIONS_REPO_TOKEN is set in the shell
  2. SESSIONS_REPO_TOKEN can read the analysis repo and question-coach repo
  3. Stage files are readable (mirrors what analyze.py fetches)
  4. API server is reachable and healthy
  5. Docker container has SESSIONS_REPO_TOKEN set
  6. Required GitHub Actions secrets exist in the analysis repo

Checks (analysis mode):
  1. QC_ANALYSIS_WRITER is set in the shell
  2. QC_ANALYSIS_WRITER can read and write to the analysis repo
  3. QC_ANALYSIS_WRITER can read stage files from question-coach
  4. ANTHROPIC_API_KEY is set in the shell
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ANALYSIS_REPO = "kphunter/qc-analysis-prompt-improvement-bot"
QC_REPO       = "kphunter/question-coach"
REQUIRED_SECRETS = ["ANTHROPIC_API_KEY", "QC_ANALYSIS_WRITER"]

RESET  = "\033[0m"
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BOLD   = "\033[1m"

passed = 0
failed = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  {GREEN}✓{RESET} {msg}")


def fail(msg):
    global failed
    failed += 1
    print(f"  {RED}✗{RESET} {msg}")


def warn(msg):
    print(f"  {YELLOW}⚠{RESET}  {msg}")


def section(title):
    print(f"\n{BOLD}{title}{RESET}")


def _gh_request(token: str, path: str, timeout: int = 10):
    """Make a GitHub API request. Returns (status_code, parsed_json)."""
    url = f"https://api.github.com/{path}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:
            body = {}
        return e.code, body
    except Exception as e:
        return None, str(e)


def check_env_var(name: str, hint: str = "") -> str | None:
    value = os.environ.get(name, "")
    if not value:
        msg = f"{name} is not set"
        if hint:
            msg += f" — {hint}"
        fail(msg)
        return None
    ok(f"{name} is set ({value[:10]}...)")
    return value


def check_repo_access(token: str, repo: str, label: str) -> bool:
    status, body = _gh_request(token, f"repos/{repo}")
    if status is None:
        fail(f"{label}: request failed — {body}")
        return False
    if status == 200:
        ok(f"{label}: accessible ({body.get('visibility', '?')})")
        return True
    fail(f"{label}: {status} — {body.get('message', '')}")
    return False


def check_contents_access(token: str, repo: str, path: str, label: str) -> bool:
    status, body = _gh_request(token, f"repos/{repo}/contents/{path}")
    if status is None:
        fail(f"{label}: request failed — {body}")
        return False
    if status == 200:
        ok(f"{label}: readable")
        return True
    fail(f"{label}: {status} — {body.get('message', '')}")
    return False


def check_write_access(token: str, repo: str, label: str):
    """Check push permission via the repo permissions field."""
    status, body = _gh_request(token, f"repos/{repo}")
    if status is None:
        fail(f"{label}: request failed — {body}")
        return
    if status == 200:
        perms = body.get("permissions", {})
        if perms.get("push"):
            ok(f"{label}: write permission confirmed")
        else:
            fail(f"{label}: token can read but NOT write — check repo access scope")
    else:
        fail(f"{label}: {status} — {body.get('message', '')}")


def check_api(api_base: str):
    section(f"4. API server ({api_base})")
    url = f"{api_base}/health"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        ok(f"Reachable — status: {data.get('status', '?')}  "
           f"vectors: {data.get('collection_count', '?')}")
    except Exception as e:
        fail(f"Cannot reach API: {e}")
        warn("Start it with: docker compose up -d api")


def check_docker_container_token():
    section("5. Docker container environment")
    try:
        result = subprocess.run(
            ["docker", "exec", "rag-api", "printenv", "SESSIONS_REPO_TOKEN"],
            capture_output=True, text=True, timeout=5,
        )
        value = result.stdout.strip()
        if value:
            ok(f"Container has SESSIONS_REPO_TOKEN ({value[:10]}...)")
        else:
            fail("Container SESSIONS_REPO_TOKEN is empty — "
                 "export it and run: docker compose up -d --no-deps api")
    except FileNotFoundError:
        warn("docker not found — skipping container check")
    except subprocess.TimeoutExpired:
        warn("docker exec timed out — is the container running?")
    except Exception as e:
        warn(f"Container check skipped: {e}")


def check_actions_secrets(token: str):
    section(f"6. GitHub Actions secrets in {ANALYSIS_REPO}")
    status, body = _gh_request(token, f"repos/{ANALYSIS_REPO}/actions/secrets")
    if status != 200:
        warn(f"Cannot list secrets ({status}) — "
             "token may lack 'secrets' read permission; check manually in repo Settings")
        return
    names = {s["name"] for s in body.get("secrets", [])}
    for secret in REQUIRED_SECRETS:
        if secret in names:
            ok(f"Secret {secret} is set")
        else:
            fail(f"Secret {secret} is MISSING — add it in repo Settings → Secrets")


def run_coach_mode(api_base: str):
    print(f"{BOLD}Mode: question-coach (coach){RESET}")

    section("1. Shell environment")
    token = check_env_var("SESSIONS_REPO_TOKEN",
                          "export it before running docker compose")

    section("2. GitHub repo access (SESSIONS_REPO_TOKEN)")
    if token:
        check_repo_access(token, ANALYSIS_REPO, ANALYSIS_REPO)
        check_repo_access(token, QC_REPO, QC_REPO)

    section("3. Stage file access (mirrors analyze.py fetch)")
    if token:
        check_contents_access(token, QC_REPO, "agents/prompts/stages",
                               f"{QC_REPO}/agents/prompts/stages")

    check_api(api_base)
    check_docker_container_token()

    if token:
        check_actions_secrets(token)


def run_analysis_mode():
    print(f"{BOLD}Mode: qc-analysis-prompt-improvement-bot (analysis){RESET}")

    section("1. Shell environment")
    writer_token = check_env_var("QC_ANALYSIS_WRITER",
                                 "set this to a classic token with repo scope")
    check_env_var("ANTHROPIC_API_KEY",
                  "set this to your Anthropic API key")

    section("2. Analysis repo access (QC_ANALYSIS_WRITER)")
    if writer_token:
        check_repo_access(writer_token, ANALYSIS_REPO, ANALYSIS_REPO)
        check_write_access(writer_token, ANALYSIS_REPO,
                           f"{ANALYSIS_REPO} write")

    section("3. Stage file access from question-coach (QC_ANALYSIS_WRITER)")
    if writer_token:
        check_contents_access(writer_token, QC_REPO, "agents/prompts/stages",
                               f"{QC_REPO}/agents/prompts/stages")


def main():
    parser = argparse.ArgumentParser(description="QC token pre-flight check")
    parser.add_argument("--mode", choices=["coach", "analysis"], default="coach",
                        help="'coach' for question-coach repo, 'analysis' for analysis bot repo")
    parser.add_argument("--api", default=os.environ.get("QC_API_URL", "http://localhost:8000"),
                        help="QC API base URL (coach mode only)")
    args = parser.parse_args()

    print(f"{BOLD}QC token pre-flight check{RESET}")

    if args.mode == "analysis":
        run_analysis_mode()
    else:
        run_coach_mode(args.api)

    print(f"\n{BOLD}Results:{RESET} {GREEN}{passed} passed{RESET}  {RED}{failed} failed{RESET}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
