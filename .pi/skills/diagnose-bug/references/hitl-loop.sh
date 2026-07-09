#!/usr/bin/env bash
# Human-in-the-loop reproduction loop for WIMS bugs.
# Copy this file, edit the steps below, and run it.
# The agent runs the script; the user follows prompts in their terminal.
#
# Usage:
#   bash references/hitl-loop.sh
#
# Two helpers:
#   step "<instruction>"          → show instruction, wait for Enter
#   capture VAR "<question>"      → show question, read response into VAR
#
# At the end, captured values are printed as KEY=VALUE for the agent to parse.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open the app at http://localhost:3000 and sign in as a regional encoder."

capture AFOR_IMPORT "Click 'Import AFOR' and select a test workbook. Did it succeed? (y/n)"

capture ERROR_MSG "Paste any error message shown (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'AFOR_IMPORT=%s\n' "$AFOR_IMPORT"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
