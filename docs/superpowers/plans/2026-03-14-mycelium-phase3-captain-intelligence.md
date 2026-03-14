# Phase 3: Captain Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add captain intelligence to Mycelium — a skill-based judgment engine that decomposes work, spawns arms, resolves arm questions, and manages mission lifecycles.

**Architecture:** Pure prompt-based captain. Two new skills (`captain`, `team-review`), one hook enhancement (context-loader loads `captain.md`), one MCP tool enhancement (`claim_task` reconciles filesystem-only tasks into SQLite). No new TypeScript modules for judgment — all decision logic lives in skill markdown.

**Tech Stack:** TypeScript (strict), Vitest, Markdown skills, YAML frontmatter, SQLite (existing)

**Spec:** `docs/superpowers/specs/2026-03-14-mycelium-phase3-captain-intelligence-design.md`

---

## Chunk 1: claim_task Reconciliation

The captain creates task files on the filesystem. Arms claim them via MCP. Currently `claim_task` fails if no SQLite row exists. This task makes `claim_task` auto-create the SQLite row from the filesystem task file when one doesn't exist yet.

### Task 1: claim_task Filesystem Reconciliation

**Files:**
- Modify: `src/mcp-server/db.ts:92-120` (claimTask method)
- Modify: `src/mcp-server/tools/tasks.ts:11-35` (claim_task handler)
- Test: `src/mcp-server/__tests__/tools-tasks.test.ts`

- [ ] **Step 1: Write the failing test — claim_task reconciles filesystem-only task**

Add to `src/mcp-server/__tests__/tools-tasks.test.ts` inside the `claim_task` describe block:

```typescript
it("reconciles filesystem-only task into SQLite on claim", async () => {
  const missionPath = join(tmpDir, "missions", missionId);
  // Write task file to filesystem WITHOUT inserting into SQLite
  writeTaskFile(missionPath, {
    id: 1,
    status: "pending",
    assigned_to: null,
    blocked_by: [],
    scope: ["src/foo.ts"],
    prior_tasks: [],
    created_at: Date.now(),
    claimed_at: null,
    completed_at: null,
  }, "Filesystem Only Task", "This task exists only on filesystem");

  const result = await client.callTool({
    name: "claim_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
  });
  const task = JSON.parse(
    (result.content as Array<{ text: string }>)[0].text
  );
  expect(task.status).toBe("in_progress");
  expect(task.assigned_to).toBe("arm-1");
  expect(task.claimed_at).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts -t "reconciles filesystem-only task"`
Expected: FAIL with "Task 1 not found"

- [ ] **Step 3: Write the failing test — reconciles blocked_by from filesystem**

```typescript
it("reconciles filesystem-only blocked task and rejects claim", async () => {
  const missionPath = join(tmpDir, "missions", missionId);
  // Task 1: unblocked
  writeTaskFile(missionPath, {
    id: 1, status: "pending", assigned_to: null, blocked_by: [],
    scope: [], prior_tasks: [], created_at: Date.now(),
    claimed_at: null, completed_at: null,
  }, "Task One", "First task");

  // Task 2: blocked by task 1
  writeTaskFile(missionPath, {
    id: 2, status: "pending", assigned_to: null, blocked_by: [1],
    scope: [], prior_tasks: [1], created_at: Date.now(),
    claimed_at: null, completed_at: null,
  }, "Task Two", "Blocked by task one");

  const result = await client.callTool({
    name: "claim_task",
    arguments: { mission_id: missionId, task_id: 2, agent_id: "arm-1" },
  });
  expect(result.isError).toBe(true);
  const text = (result.content as Array<{ text: string }>)[0].text;
  expect(text).toContain("blocked");
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts -t "reconciles filesystem-only blocked task"`
Expected: FAIL with "Task 2 not found"

- [ ] **Step 5: Add `reconcileAndClaimTask` method to `TeamDB`**

The reconciliation MUST happen inside the same `BEGIN IMMEDIATE` transaction as the claim to prevent race conditions (two arms seeing no SQLite row and both trying to insert). Add this method to `src/mcp-server/db.ts` after the `claimTask` method (after line 120):

```typescript
/**
 * Reconciles a filesystem-only task into SQLite and claims it atomically.
 * If the task already exists in SQLite, behaves identically to claimTask.
 * All operations happen within a single BEGIN IMMEDIATE transaction.
 */
reconcileAndClaimTask(
  missionId: string,
  taskId: number,
  agentId: string,
  fsData?: { blockedBy: number[] }
): Task {
  this.db.exec("BEGIN IMMEDIATE");
  try {
    // Reconcile: insert if not in SQLite
    let task = this.getTask(missionId, taskId);
    if (!task && fsData) {
      this.insertTask(missionId, taskId, fsData.blockedBy);
      // Also reconcile any blocker tasks that are filesystem-only
      for (const blockerId of fsData.blockedBy) {
        if (!this.getTask(missionId, blockerId)) {
          // Insert blocker as pending with no dependencies (best-effort —
          // its own blocked_by will be reconciled when it's claimed)
          this.insertTask(missionId, blockerId, []);
        }
      }
      task = this.getTask(missionId, taskId);
    }
    if (!task) throw new Error(`Task ${taskId} not found in mission ${missionId}`);
    if (task.status !== "pending") throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);

    // Check blockers
    if (task.blocked_by.length > 0) {
      for (const bid of task.blocked_by) {
        const blocker = this.getTask(missionId, bid);
        if (blocker && blocker.status !== "completed") {
          throw new Error(`Task ${taskId} is blocked by task ${bid}`);
        }
      }
    }

    const now = Date.now();
    this.db.run(
      "UPDATE tasks SET status = 'in_progress', assigned_to = ?, claimed_at = ? WHERE mission_id = ? AND task_id = ?",
      [agentId, now, missionId, taskId]
    );
    this.db.exec("COMMIT");
    return this.getTask(missionId, taskId)!;
  } catch (e) {
    this.db.exec("ROLLBACK");
    throw e;
  }
}
```

- [ ] **Step 6: Update the `claim_task` handler to use reconciliation**

Modify `src/mcp-server/tools/tasks.ts`. First, update the import on line 6 to add `readTaskFile`:

```typescript
import { findTaskFile, updateTaskFileFrontmatter, readTaskFile } from "../../protocol/mission.js";
```

Then replace the `claim_task` handler body (the async function inside `server.tool`, lines 15-34):

```typescript
async ({ mission_id, task_id, agent_id }) => {
  try {
    db.getActiveMission(mission_id);
    const missionPath = join(basePath, "missions", mission_id);

    // Read filesystem data for reconciliation if task isn't in SQLite yet
    let fsData: { blockedBy: number[] } | undefined;
    if (!db.getTask(mission_id, task_id)) {
      const filePath = findTaskFile(missionPath, task_id);
      if (!filePath) {
        return { content: [{ type: "text", text: `Task ${task_id} not found in mission ${mission_id}` }], isError: true };
      }
      const { data } = readTaskFile(filePath);
      fsData = { blockedBy: Array.isArray(data.blocked_by) ? data.blocked_by : [] };
    }

    const task = db.reconcileAndClaimTask(mission_id, task_id, agent_id, fsData);
    try {
      const filePath = findTaskFile(missionPath, task_id);
      if (filePath) {
        updateTaskFileFrontmatter(filePath, {
          status: "in_progress", assigned_to: agent_id, claimed_at: task.claimed_at,
        });
      }
      appendAuditEntry(missionPath, { ts: Date.now(), agent: agent_id, action: "task_claim", task_id });
    } catch { /* Filesystem write failure is non-fatal */ }
    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
```

**Note:** There is a small TOCTOU gap between the `getTask` check in the handler and the `BEGIN IMMEDIATE` in `reconcileAndClaimTask`. If two arms race, both may compute `fsData`, but the `BEGIN IMMEDIATE` serializes the actual insert+claim. `reconcileAndClaimTask` handles the case where the task already exists in SQLite (skips insert), so concurrent calls are safe.

- [ ] **Step 7: Write the test — claim works when task exists in both SQLite and filesystem (idempotency)**

```typescript
it("claims normally when task exists in both SQLite and filesystem", async () => {
  const missionPath = join(tmpDir, "missions", missionId);
  // Insert into SQLite AND write filesystem
  db.insertTask(missionId, 1, []);
  writeTaskFile(missionPath, {
    id: 1, status: "pending", assigned_to: null, blocked_by: [],
    scope: [], prior_tasks: [], created_at: Date.now(),
    claimed_at: null, completed_at: null,
  }, "Both Places Task", "Exists in SQLite and filesystem");

  const result = await client.callTool({
    name: "claim_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
  });
  const task = JSON.parse(
    (result.content as Array<{ text: string }>)[0].text
  );
  expect(task.status).toBe("in_progress");
  expect(task.assigned_to).toBe("arm-1");
});
```

- [ ] **Step 8: Run all task tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: ALL PASS (existing tests + 3 new tests)

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/tools/tasks.ts src/mcp-server/__tests__/tools-tasks.test.ts
git commit -m "feat: claim_task reconciles filesystem-only tasks into SQLite"
```

---

## Chunk 2: Context-Loader Captain Enhancement

Extend the context-loader hook to load `captain.md` in captain mode (no `MYCELIUM_AGENT_ID` env var).

### Task 2: Context-Loader Loads captain.md

**Files:**
- Modify: `src/hooks/context-loader.ts:111-138` (captain session block)
- Test: `src/hooks/__tests__/context-loader.test.ts`

- [ ] **Step 1: Write the failing test — captain mode loads captain.md**

Add to `src/hooks/__tests__/context-loader.test.ts` inside the first `describe("context-loader hook")` block:

```typescript
it("loads captain.md attention queue in captain mode", () => {
  // Create an active mission so we enter captain output
  const mPath = join(tmpBase, "missions", "m1");
  initMissionDir(mPath);
  writeMissionFile(mPath, {
    id: "m1",
    status: "active",
    created_at: Date.now(),
  }, "Test mission");

  // Write captain.md at base path
  writeFileSync(join(tmpBase, "captain.md"), [
    "---",
    `updated_at: ${Date.now()}`,
    "---",
    "",
    "## Active Missions",
    "- [m1](missions/m1/) — Test mission — 0/1 tasks done",
    "",
    "## Attention Queue",
    "1. m1: arm-1 stale >5 min",
  ].join("\n"), "utf-8");

  const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
    encoding: "utf-8",
    cwd: process.cwd(),
    env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
  });
  expect(output).toContain("Attention Queue");
  expect(output).toContain("arm-1 stale");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts -t "loads captain.md"`
Expected: FAIL — output does not contain "Attention Queue"

- [ ] **Step 3: Write the failing test — captain mode without captain.md is silent**

```typescript
it("is silent about captain.md when file does not exist", () => {
  const mPath = join(tmpBase, "missions", "m1");
  initMissionDir(mPath);
  writeMissionFile(mPath, {
    id: "m1",
    status: "active",
    created_at: Date.now(),
  }, "Test mission");

  const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
    encoding: "utf-8",
    cwd: process.cwd(),
    env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
  });
  expect(output).toContain("m1");
  expect(output).not.toContain("Attention Queue");
});
```

- [ ] **Step 4: Implement captain.md loading in context-loader**

In `src/hooks/context-loader.ts`, add after the active missions listing (after line 137, inside the else block, after the `if (active.length > 0)` block):

```typescript
// Load captain.md if it exists
const captainFile = join(basePath, "captain.md");
if (existsSync(captainFile)) {
  const captainContent = readFileSync(captainFile, "utf-8");
  // Extract body (after frontmatter)
  const bodyMatch = captainContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (bodyMatch && bodyMatch[1].trim()) {
    console.log("\n--- Captain State ---");
    console.log(bodyMatch[1].trim());
  }
}
```

- [ ] **Step 5: Run all context-loader tests**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/context-loader.ts src/hooks/__tests__/context-loader.test.ts
git commit -m "feat: context-loader loads captain.md in captain mode"
```

---

## Chunk 3: Captain Skill

The core of Phase 3. A skill markdown file containing the judgment engine, decomposition protocol, spawn orchestration, monitoring behavior, and question resolution logic.

### Task 3: Write Captain Skill

**Files:**
- Create: `skills/captain/SKILL.md`

- [ ] **Step 1: Verify skills directory structure**

Run: `ls skills/`
Expected: `focus/` and `team-coordinate/` directories exist

- [ ] **Step 2: Create the captain skill directory**

Run: `mkdir -p skills/captain`

- [ ] **Step 3: Write the captain skill**

Create `skills/captain/SKILL.md`. This is the full captain prompt — judgment engine, decomposition, monitoring, question resolution. Reference existing docs for protocol details rather than duplicating.

The skill must cover:
- Frontmatter: name, description
- When the captain activates vs. defers (judgment table)
- How to use the user's existing workflow tools for design/brainstorming
- Decomposition protocol (parse intent, define scope, validate DAG, max 4-5 arms)
- Spawn orchestration (create_team MCP, write task files, spawn via adapter)
- captain.md lifecycle (create, update, read on recovery)
- Monitoring (react to passive-monitor signals)
- Question resolution (read context, answer via inbox, or escalate)
- Multi-mission awareness

Key references to include in the skill:
- `@team-coordinate` — filesystem protocol conventions
- `@focus` — for single-arm fire-and-forget routing
- `@team-review` — for mission completion

```markdown
---
name: captain
description: Multi-arm mission orchestration — decomposes work, spawns arms, monitors progress, resolves questions, manages mission lifecycle
---

# Captain

You are the captain — an orchestrator that decomposes complex work into parallel tasks, delegates to autonomous arms, and manages the mission lifecycle. You do not write code directly. You coordinate.

## When to Activate

Use this judgment table to decide how to handle the user's request:

| Signal | Action |
|---|---|
| Complex feature request (multiple files/components) | Decompose into task DAG, spawn arms |
| Simple/routine task ("run tests and fix", "add a test for X") | Invoke @focus — single arm, fire-and-forget |
| Bug investigation | Assess complexity — simple → @focus, complex → decompose into investigation + fix tasks |
| Refactoring request | Decompose directly (pattern is clear), spawn arms |
| Passive-monitor: arm sent message to lead | Check inbox, resolve question or escalate to human |
| Passive-monitor: arm stale >5 min | Check arm's progress file, send nudge or escalate |
| Passive-monitor: needs_review | Read completed work, summarize for human |
| Passive-monitor: all tasks complete | Invoke @team-review |

**Important:** You defer to the user's existing workflow tools. If the task requires design collaboration before decomposition, use whatever brainstorming/planning tools the user has (their brainstorming skill, plan mode, or just conversation). You add coordination, not methodology.

## Decomposition Protocol

When you decompose work into a task DAG:

1. **Identify distinct units of work.** Each task should be independently completable by one arm.

2. **Define scope per task.** List specific file paths and globs each arm is allowed to touch.
   ```yaml
   scope:
     - src/routes/payments.ts
     - src/middleware/rateLimit.ts
     - tests/payments/**
   ```

3. **Validate non-overlapping scope.** No two tasks touch the same files unless one explicitly depends on the other via `blocked_by`.

4. **Validate DAG integrity:**
   - No cycles (task A blocked by B, B blocked by A)
   - All `blocked_by` references point to tasks that exist
   - All `prior_tasks` references point to tasks whose output is needed

5. **Max 4-5 arms per mission.** Research shows performance saturates at ~4 agents. If you need more tasks, sequence them — some arms can pick up new tasks after completing their first.

6. **Set `prior_tasks`** for tasks that need to read an earlier task's output section.

7. **Identify parallelism.** Tasks with no `blocked_by` can start immediately.

## Spawn Orchestration

After decomposition and user approval of the task DAG:

### Step 1: Create the mission

Call the `create_team` MCP tool:
```
create_team({ goal: "<mission description>", config: { review_required: true, max_arms: <N> }, repo: "<repo path>" })
```

This returns `{ id: "<mission_id>" }` and creates the mission directory at `~/.mycelium/missions/<mission_id>/`.

### Step 2: Write task files

For each task in the DAG, write a task file to the filesystem. The file format:

**Path:** `~/.mycelium/missions/<mission_id>/tasks/<NNN>-<slug>.md`

```markdown
---
id: <number>
status: pending
assigned_to: null
blocked_by: [<dependency task IDs>]
scope:
  - <file paths/globs>
prior_tasks: [<IDs of tasks whose Output to read>]
created_at: <timestamp>
claimed_at: null
completed_at: null
---

# <Task Title>

<Task description — what the arm should do>

## Context
<Additional context: patterns to follow, decisions from other tasks, codebase conventions>

## Output
<!-- filled by teammate on completion -->

### Files Changed
### Tests Added
### Decisions Made
### Open Questions

## Checkpoint
<!-- written by sessionEnd hook on crash/timeout -->
```

**Important:** You do NOT need to insert these tasks into SQLite. The `claim_task` MCP tool will automatically reconcile the filesystem task into SQLite when an arm claims it.

### Step 3: Write captain.md

Create or update `~/.mycelium/captain.md`:

```markdown
---
updated_at: <timestamp>
---

## Active Missions
- [<mission_id>](missions/<mission_id>/) — <goal> — 0/<N> tasks done

## Attention Queue
<empty or items from other active missions>
```

### Step 4: Spawn arms

For each unblocked task (no `blocked_by` dependencies), spawn an arm. Communicate to the user which arms you are spawning and for which tasks.

The spawned arms will:
1. Load their task via the `sessionStart` context-loader hook
2. Claim the task via `claim_task` MCP
3. Do the work within their defined scope
4. Complete the task via `complete_task` MCP

### Step 5: Return control

Tell the user:
```
[mycelium] Mission started: "<goal>"
Mission: <mission_id> | Arms: <N> spawned, <M> queued
Monitoring via passive-monitor. I'll handle signals as they appear.
```

### Step 6: Monitor and react

As the mission progresses, you'll see passive-monitor signals after tool calls. React per the monitoring behavior section below.

When tasks complete and unblock downstream tasks, spawn the next batch of arms.

## Monitoring Behavior

The `postToolUse` passive-monitor hook surfaces signals in your session output. React to them:

- **`[octopus] mission-X: arm-Y stale (Nm)`** — Read `~/.mycelium/missions/<mission_id>/progress/<arm_id>.md`. If the arm is making progress (recent entries), wait. If stuck or no recent progress, send a nudge message to the arm's inbox. If unresponsive after nudge, escalate to the human.

- **`[octopus] mission-X: arm-Y needs_review`** — Read the completed task file's Output section. Summarize for the human: what was done, what decisions were made, any open questions. The human decides approve/reject, and you execute it via `approve_task` or `reject_task` MCP.

- **`[octopus] mission-X: all tasks complete`** — Invoke @team-review to generate retrospective and guide merges.

- **`[octopus] N unread message in inbox`** — Read messages from `~/.mycelium/missions/<mission_id>/inbox/lead/`. Apply question resolution.

## Question Resolution

When an arm sends a question to your inbox:

1. **Read the arm's task file** — understand what it's working on and its scope
2. **Read the arm's progress file** — understand where it is
3. **If the question relates to another arm's work**, read that arm's task file and progress
4. **Read relevant codebase files** if needed to answer the question
5. **Formulate your answer** and write it to the arm's inbox:

   Write a file to `~/.mycelium/missions/<mission_id>/inbox/<arm_id>/<timestamp>-lead.md`:
   ```markdown
   ---
   from: lead
   priority: false
   timestamp: <Date.now()>
   ---

   <Your answer>
   ```

6. **If the question is strategic/architectural** (you can't resolve from task context + codebase), surface it to the human:
   > "arm-1 asks: '<question>'. I checked <what you checked> but this seems like a strategic decision. My recommendation: <recommendation>. What do you think?"

7. Move processed inbox messages to `inbox/lead/_read/`.

## Crash Recovery

If you're starting a new session and `captain.md` exists (loaded by context-loader), you're resuming from a previous session:

1. Read each active mission's current state — check task statuses, member statuses, inbox
2. For stale/dead arms: check if the arm's task has a Checkpoint section. If so, the arm can be re-spawned and will resume from the checkpoint.
3. Update `captain.md` with refreshed state
4. Continue monitoring

## Multi-Mission Awareness

You can manage multiple concurrent missions. Maintain `captain.md` with all active missions and an attention queue ordered by priority:

1. Arms with priority messages (blocked)
2. Stale arms (>5 min without progress)
3. Tasks needing review
4. Queued missions not yet started

Handle the highest-priority item first. Update `captain.md` after every significant action.

## Key Principles

- **You do not write code.** You decompose, delegate, monitor, and resolve.
- **Defer to user's tools.** Don't prescribe brainstorming or debugging methodology.
- **Filesystem first.** Task files, inbox messages, progress — all filesystem. Only atomic transitions use MCP.
- **Max 4-5 arms.** More is not better. Research proves this.
- **Escalate what you can't resolve.** Better to ask the human than guess wrong on architecture.
- **Update captain.md.** Every action, every state change. This is your crash recovery.
```

- [ ] **Step 4: Run typecheck and build to verify no issues**

Run: `npm run typecheck && npm run build`
Expected: PASS (skill is markdown only, no code changes)

- [ ] **Step 5: Commit**

```bash
git add skills/captain/SKILL.md
git commit -m "feat: add captain skill — judgment engine and mission orchestration"
```

---

## Chunk 4: Team-Review Skill

The skill invoked when all tasks in a mission complete. Generates a retrospective and guides merge workflow.

### Task 4: Write Team-Review Skill

**Files:**
- Create: `skills/team-review/SKILL.md`

- [ ] **Step 1: Create the team-review skill directory**

Run: `mkdir -p skills/team-review`

- [ ] **Step 2: Write the team-review skill**

Create `skills/team-review/SKILL.md`:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add skills/team-review/SKILL.md
git commit -m "feat: add team-review skill — retrospective and merge workflow"
```

---

## Chunk 5: Build, CLAUDE.md Update, and Final Verification

### Task 5: Rebuild dist/ and Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Rebuild: `dist/`

- [ ] **Step 1: Rebuild dist/**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Update CLAUDE.md roadmap**

In `CLAUDE.md`, update the roadmap section to reflect Phase 3 progress. Change:

```
- **Phase 3**: Captain intelligence — judgment engine, attention management
```

To:

```
- **Phase 3** (shipped): Captain intelligence — captain skill, team-review skill, claim_task reconciliation, captain.md lifecycle
```

Also add to the Architecture section under Skills:

```
- `skills/captain/SKILL.md` — Captain judgment engine, decomposition, monitoring, question resolution
- `skills/team-review/SKILL.md` — Mission retrospective and merge workflow
```

And update the "Adding a New MCP Tool" or relevant section to note the `claim_task` reconciliation behavior.

- [ ] **Step 5: Rebuild dist/ after CLAUDE.md changes**

Run: `npm run build`
Expected: Build succeeds (dist/ is committed)

- [ ] **Step 6: Commit**

```bash
git add dist/ CLAUDE.md
git commit -m "chore: rebuild dist, update CLAUDE.md for Phase 3"
```

- [ ] **Step 7: Final verification**

Run: `npm test && npm run typecheck`
Expected: ALL PASS, no type errors
