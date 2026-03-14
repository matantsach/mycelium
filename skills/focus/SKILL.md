---
name: focus
description: Fire-and-forget single task delegation — spawns one arm to handle a task autonomously
---

# Focus Mode

Delegate a single task to an autonomous arm. Fire-and-forget.

## Usage

```
/focus <instruction>
```

Examples:
- `/focus run integration tests and fix failures`
- `/focus investigate ADX logs for bug PROJ-1234`
- `/focus add unit tests for src/payments/`

## Workflow

When invoked:

1. **Create mission** — call `mycelium/create_team` with:
   - `goal`: the user's instruction
   - `config`: `{ "review_required": false, "max_arms": 1 }`

2. **Create task file + DB row** — write a task file to `~/.mycelium/missions/{id}/tasks/001-focus.md` with:
   - Frontmatter: `id: 1`, `status: pending`, `assigned_to: null`, `blocked_by: []`, `scope: []`
   - Body: the user's instruction as the task description
   - Also insert the task row in SQLite via the DB (the MCP server handles this internally)

3. **Spawn arm** — use the runtime adapter to spawn a teammate:
   - Agent ID: `arm-1`
   - Task ref: `001-focus`
   - The spawned arm will claim the task, do the work, and complete it

4. **Return control** — immediately return control to the human with:
   ```
   [mycelium] Focus mode started: "<instruction>"
   Mission: {id} | Arm: arm-1
   The arm is working autonomously. Check back anytime.
   ```

## What the arm does

The spawned arm follows the teammate agent prompt:
1. Claims the task via `mycelium/claim_task`
2. Does the work (code edits, tests, etc.)
3. Completes the task via `mycelium/complete_task`
4. Writes progress to `~/.mycelium/missions/{id}/progress/arm-1.md`

## Key properties

- **No decomposition** — single task, single arm
- **No approval** — review_required is false by default
- **Fire-and-forget** — human gets control back immediately
- **Daily driver** — designed for 5-10x/day use
