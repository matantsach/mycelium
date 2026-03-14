---
name: team-review
description: Mission retrospective, merge workflow, and completion — invoked when all arms finish their tasks
---

# Team Review

Generate a retrospective and guide the merge workflow when a mission completes.

## When to Invoke

- **Automatically:** The captain invokes this when passive-monitor signals all tasks complete.
- **Manually:** The user can invoke `/team-review` to review a mission mid-flight or wrap up early.

## Workflow

### Step 1: Gather completed work

Read all task files in `~/.mycelium/missions/<mission_id>/tasks/`. For each completed task, extract the **Output** section:

- Files Changed
- Tests Added
- Decisions Made
- Open Questions

### Step 2: Generate retrospective

Write `~/.mycelium/missions/<mission_id>/retrospective.md`:

```markdown
---
mission_id: <mission_id>
generated_at: <timestamp>
---

# Retrospective: <mission goal>

## Summary
<1-3 sentence overview of what was accomplished>

## Tasks Completed

### Task <id>: <title>
**Arm:** <assigned_to>
**Files Changed:** <list>
**Tests Added:** <list>
**Decisions:** <list>
**Open Questions:** <list>

<repeat for each task>

## Cross-Task Decisions
<Decisions that affect multiple tasks or the project as a whole>

## Open Questions
<Unresolved questions from any task that need human attention>

## Merge Order
<See Step 3>
```

### Step 3: Present merge plan

Arms worked in git worktrees. Present the merge order to the human:

1. **List worktrees in DAG dependency order.** Merge upstream tasks first (tasks with no `blocked_by` first, then tasks that depend on them).

2. **For each worktree:**
   - Summarize what changed (from Output section)
   - Flag potential conflicts with other worktrees (overlapping file paths)
   - Provide the worktree path for easy navigation

3. **The human performs the actual merges.** You suggest order and help resolve conflicts if asked.

Example output:
```
Merge order for mission <id>:

1. arm-1 worktree (.mycelium/worktrees/<mission_id>/arm-1/)
   Task: "Add Stripe SDK + config"
   Files: src/config/stripe.ts (new)
   No conflicts expected.

2. arm-3 worktree (.mycelium/worktrees/<mission_id>/arm-3/)
   Task: "Rate limiting middleware"
   Files: src/middleware/rateLimit.ts (new)
   No conflicts expected.

3. arm-2 worktree (.mycelium/worktrees/<mission_id>/arm-2/)
   Task: "Payment routes"
   Files: src/routes/payments.ts (new)
   Depends on: Task 1 (Stripe config). Merge Task 1 first.

4. arm-4 worktree (.mycelium/worktrees/<mission_id>/arm-4/)
   Task: "Tests"
   Files: tests/payments/** (new)
   Depends on: Tasks 1, 2, 3. Merge all others first.
```

### Step 4: Complete the mission

After the human confirms merges are done:

1. Update `~/.mycelium/missions/<mission_id>/mission.md` frontmatter: set `status: completed`
2. Update `~/.mycelium/captain.md`: remove the mission from Active Missions, remove related items from Attention Queue

### What this skill does NOT do

- **Knowledge promotion** — Tier 1 → 2 → 3 knowledge flow is Phase 4
- **Pattern extraction** — Learning from missions for future use is Phase 4
- **Automatic merging** — The human controls git operations
