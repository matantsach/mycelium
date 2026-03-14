#!/usr/bin/env bash
# Usage: spawn-teammate-codex.sh <mission_id> <agent_id> <task_ref> [model]
# Spawns a Codex CLI teammate in a tmux pane with a git worktree for file isolation.

set -euo pipefail

MISSION_ID="$1"
AGENT_ID="$2"
TASK_REF="$3"
MODEL="${4:-${TEAMMATE_MODEL:-o4-mini}}"

PROMPT="You are $AGENT_ID on mission $MISSION_ID. Claim task $TASK_REF via mycelium/claim_task, do the work, then complete it via mycelium/complete_task."

is_git_repo() {
  git rev-parse --is-inside-work-tree &>/dev/null
}

can_use_tmux() {
  [ -n "${TMUX:-}" ] && return 0
  tmux list-clients -F '#{client_session}' 2>/dev/null | grep -q .
}

if command -v tmux &>/dev/null && can_use_tmux; then
  PROJECT_ROOT="$(pwd)"
  WORKTREE_INFO=""
  WORKTREE_DIR_ABS=""

  if is_git_repo; then
    WORKTREE_DIR=".mycelium-worktrees/${MISSION_ID}/${AGENT_ID}"
    BRANCH_NAME="mycelium/${MISSION_ID}/${AGENT_ID}"
    if [ ! -d "$WORKTREE_DIR" ]; then
      mkdir -p "$(dirname "$WORKTREE_DIR")"
      if git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" 2>/dev/null || \
         git worktree add "$WORKTREE_DIR" "$BRANCH_NAME" 2>/dev/null; then
        WORKTREE_DIR_ABS="$(cd "$WORKTREE_DIR" && pwd)"
        WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
      else
        echo "WARNING: worktree creation failed — teammates will share the working directory" >&2
      fi
    else
      WORKTREE_DIR_ABS="$(cd "$WORKTREE_DIR" && pwd)"
      WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
    fi
  fi

  WORK_DIR="${WORKTREE_DIR_ABS:-$PROJECT_ROOT}"
  PROMPT_FILE="$(mktemp)"
  printf '%s\n' "$PROMPT" > "$PROMPT_FILE"

  SHELL_CMD="${SHELL:-/bin/bash}"
  tmux split-window -h -c "$WORK_DIR" \
    "$SHELL_CMD -lc 'export MYCELIUM_AGENT_ID=\"$AGENT_ID\" MYCELIUM_MISSION_ID=\"$MISSION_ID\" MYCELIUM_PROJECT_ROOT=\"$PROJECT_ROOT\"; trap \"rm -f $PROMPT_FILE\" EXIT; codex --model \"$MODEL\" --approval-mode full-auto \"\$(cat \"$PROMPT_FILE\")\"; echo \"[pane exited — press any key to close]\"; read -n1'"

  tmux select-layout tiled 2>/dev/null || true
  echo "WORK_DIR=$WORK_DIR"
  echo "Spawned $AGENT_ID in tmux pane${WORKTREE_INFO} (model: $MODEL, runtime: codex-cli)"
else
  echo "NOT_IN_TMUX"
fi
