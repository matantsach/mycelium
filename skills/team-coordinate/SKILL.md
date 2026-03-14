---
name: team-coordinate
description: Filesystem protocol conventions for Mycelium multi-agent coordination. Loaded for all arm sessions.
---

# Team Coordinate

Conventions for working within a Mycelium mission. Your mission directory is at `~/.mycelium/missions/{MYCELIUM_MISSION_ID}/`.

## Discovering Tasks

Read task files from `tasks/*.md`. Each file has YAML frontmatter with `id`, `status`, `assigned_to`, `scope`, `blocked_by`, and `prior_tasks`. The body contains the task description and context.

If your task lists `prior_tasks`, read those task files' **Output** sections before starting — they contain context from previous work.

## MCP Tools (Atomic Operations Only)

Only these operations require MCP tool calls:

| Operation | MCP Tool |
|-----------|----------|
| Claim a task | `claim_task` |
| Complete a task | `complete_task` |
| Approve a task (lead only) | `approve_task` |
| Reject a task (lead only) | `reject_task` |

Everything else is filesystem reads/writes — free, no MCP call needed.

## Sending Messages

Write a markdown file to the recipient's inbox:

**Path:** `inbox/{recipient}/{timestamp}-{your-agent-id}.md`

```markdown
---
from: {your-agent-id}
priority: false
timestamp: {Date.now()}
---

Your message here.
```

## Reading Messages

1. List files in `inbox/{your-agent-id}/` (ignore `_read/` directory and `_broadcast_cursor`)
2. Read each file
3. After processing, move the file to `inbox/{your-agent-id}/_read/`

## Priority Messages

If you see a message with `priority: true` from the lead, **stop your current approach and follow the directive immediately**. Priority messages indicate the lead is steering your work.

## Updating Progress

Append timestamped entries to your progress file:

**Path:** `progress/{your-agent-id}.md`

```markdown
## HH:MM — Brief summary
1-3 lines: what you did, what you found, what you're doing next.
```

## Writing Knowledge

Record discoveries as you work:

**Path:** `knowledge/{your-agent-id}.md`

Categories: Gotchas, Tips, Decisions. Example:

```markdown
## Gotchas
- stripe.webhooks.constructEvent needs raw body buffer, not parsed JSON

## Tips
- Run tests with STRIPE_TEST_KEY=sk_test_xxx or they skip

## Decisions
- Used Express router pattern (consistent with existing routes)
```

## Self-Unblock

If you become blocked and later resolve the issue yourself, write `status: in_progress` to your task file's frontmatter. Do NOT use an MCP tool for this.

## Reading Other Arms' Output

To understand what other arms have done, read completed task files' **Output** sections. These contain structured completion artifacts: files changed, tests added, decisions made, and open questions.

## Scope

Your task file's `scope` field lists the files/directories you are expected to work on. Stay within scope — a `preToolUse` hook enforces this as a guard rail.
