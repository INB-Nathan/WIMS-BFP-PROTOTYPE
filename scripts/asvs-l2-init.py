#!/usr/bin/env python3
"""
ASVS 5.0 L2 Audit State Initializer

Replaces the broken jq -s | CSV pipeline in the wims-bfp-asvs-l2 skill.
Reads the canonical ASVS 5.0 CSV (now properly quoted RFC 4180 from OWASP),
filters to L1 + L2 requirements, and writes the state JSON.

Usage:
    python scripts/asvs-l2-init.py [--force]
    
Environment variables (optional):
    AUDITOR       - auditor name (default: "pi-agent")
    PROJECT_NAME  - project name (default: "wims-bfp")
    ASVS_STATE_FILE - output path (default: system-wiki/security/asvs-l2-state.json)
"""

import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL_CSV = os.path.expanduser(
    "~/.pi/agent/skills/wims-bfp-asvs-l2/asvs-5.0-requirements.csv"
)
DEFAULT_PROJECT = "wims-bfp"
DEFAULT_STATE = "system-wiki/security/asvs-l2-state.json"
AUDITOR = os.environ.get("AUDITOR", "pi-agent")


def get_git_info():
    """Get current commit and branch from git, or use defaults."""
    repo = os.environ.get("PWD", os.getcwd())
    commit = "HEAD"
    branch = "main"
    try:
        commit = (
            subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, cwd=repo
            )
            .stdout.strip()
        )
    except Exception:
        pass
    try:
        branch = (
            subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True, text=True, cwd=repo
            )
            .stdout.strip()
        )
    except Exception:
        pass
    return repo, commit, branch


def read_catalog(path):
    """Read the ASVS CSV and return list of (req_id, level) for L<=2."""
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            req_id = row.get("req_id", "").strip()
            level_str = row.get("L", "").strip()
            if not req_id or not level_str:
                continue
            try:
                level = int(level_str)
            except ValueError:
                continue
            if level <= 2:
                rows.append((req_id, level))
    return rows


def build_state(requirements):
    """Build the full state JSON structure matching the skill's schema."""
    project = os.environ.get("PROJECT_NAME", DEFAULT_PROJECT)
    repo, commit, branch = get_git_info()
    now = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    audit_id = f"asvs-l2-{today}-{project}"

    reqs = {}
    for req_id, level in requirements:
        key = f"v5.0.0-{req_id}"
        reqs[key] = {
            "verdict": "PENDING",
            "type": "S",
            "level": level,
            "evidence": None,
            "risk": None,
            "remediation": None,
            "gap_register_entry": None,
            "last_reviewed_at": None,
            "review_history": [],
        }

    n = len(reqs)
    state = {
        "schema_version": "1.0.0",
        "audit_id": audit_id,
        "target": {
            "project": project,
            "repo": repo,
            "commit": commit,
            "branch": branch,
            "stack_state": "unknown",
            "asvs_version": "5.0.0",
            "asvs_level": 2,
        },
        "started_at": today,
        "last_updated": today,
        "auditor": AUDITOR,
        "method": "static+runtime",
        "scope": {
            "chapters": [
                "V1","V2","V3","V4","V5","V6","V7","V8",
                "V9","V10","V11","V12","V13","V14","V15","V16","V17"
            ],
            "exclude_chapters": [],
            "exclude_requirements": [],
        },
        "requirements": reqs,
        "summary": {
            "total_in_scope": n,
            "audited": 0,
            "compliant": 0,
            "non_compliant": 0,
            "not_applicable": 0,
            "not_verified": 0,
            "pending": n,
            "compliance_rate": 0.0,
            "last_calculated_at": today,
        },
        "audit_log": [
            {
                "at": now,
                "by": AUDITOR,
                "action": "init",
                "note": "Initial audit — init rewritten to Python (csv module) because jq -s cannot parse CSV. Catalog sourced from OWASP ASVS v5.0 release CSV (RFC 4180).",
            }
        ],
    }
    return state


def main():
    force = "--force" in sys.argv

    state_path = os.environ.get("ASVS_STATE_FILE", DEFAULT_STATE)

    # Check existing state
    if os.path.exists(state_path):
        if force:
            print(f"Overwriting existing state file: {state_path}")
        else:
            print(
                f"State file already exists: {state_path}\n"
                "Use --force to overwrite or remove the existing file first."
            )
            sys.exit(1)

    # Read catalog
    if not os.path.exists(SKILL_CSV):
        print(f"Catalog not found at: {SKILL_CSV}\n"
              "Expected at the wims-bfp-asvs-l2 skill path. "
              "Has the CSV been replaced with the official OWASP ASVS v5.0 export?")
        sys.exit(1)

    requirements = read_catalog(SKILL_CSV)
    print(f"Read {len(requirements)} L1+L2 requirements from {SKILL_CSV}")

    # Build and write state
    state = build_state(requirements)

    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)

    print(f"State written to {state_path}")
    print(f"  Audit ID: {state['audit_id']}")
    print(f"  Total L1+L2 in scope: {state['summary']['total_in_scope']}")
    print(f"  Project: {state['target']['project']}")
    print(f"  Branch: {state['target']['branch']} @ {state['target']['commit']}")
    print(f"  Auditor: {state['auditor']}")


if __name__ == "__main__":
    main()
