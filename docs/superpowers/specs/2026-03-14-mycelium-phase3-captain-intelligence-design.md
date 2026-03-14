# Design: Mycelium Phase 3 — Captain Intelligence

**Date**: 2026-03-14
**Status**: Draft
**Depends on**: Phase 2 (Protocol Migration) — shipped
**Parent spec**: `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md`

## Goal

Give the captain a brain. Phase 2 shipped the protocol layer — hooks that surface signals, MCP tools for atomic transitions, filesystem-first coordination. Phase 3 adds the intelligence layer that acts on those signals: judgment, decomposition, monitoring, question resolution, and mission lifecycle management.

The captain is pure prompt — no TypeScript judgment code. Decision logic lives in skill markdown. Mechanical operations (MCP calls, filesystem writes) use existing infrastructure.

## Scope

**In scope:**
- Captain skill with judgment engine and decomposition protocol
- Team-review skill for retrospective and merge workflow
- Persistent `captain.md` for crash recovery and attention management
- Context-loader hook enhancement for captain mode
- Multi-arm mission orchestration (end-to-end)
- Intelligent question resolution (arm → captain → human escalation)

**Out of scope:**
- Knowledge layer (reads or writes) — Phase 4
- Budget tracking — deferred
- New runtime adapters (Claude Code, Codex CLI) — Phase 4
- Templates for reusable mission patterns — Phase 4
- Captain-specific brainstorming/debugging skills — captain uses the user's existing workflow tools

## Key Decisions

1. **Captain is a skill, not an agent.** The captain operates in the human's main session (not spawned), so it's a skill (`skills/captain/SKILL.md`), not an agent definition. The spec's `agents/captain.agent.md` becomes this skill.

2. **Pure prompt-based judgment.** No TypeScript decision engine. The judgment table, decomposition protocol, monitoring behavior, and question resolution logic all live in the captain skill markdown. This enables rapid iteration via prompt editing, not code deploys. Trade-off: DAG validation (cycle detection, scope overlap) is LLM-dependent, not programmatic. The scope-enforcer hook provides a runtime safety net for scope violations.

3. **Captain uses existing tools.** No new MCP tools or TypeScript modules. The captain uses `create_team` MCP for mission creation, filesystem writes for task files, existing runtime adapters for spawning, and inbox protocol for communication. All orchestration is prompt-driven.

4. **Captain defers to user's workflow.** The captain does not prescribe brainstorming or debugging methodology. If the user has a brainstorming skill, the captain uses it. If they use plan mode, the captain uses that. The captain adds coordination, not methodology.

5. **No knowledge layer.** Captain resolves arm questions from task context, other arms' progress/output, and codebase only. No Tier 2/3 knowledge reads or writes. Phase 4 builds the full knowledge lifecycle. (The parent spec's escalation model includes Tier 2/3 knowledge as step 3 — that step is deferred to Phase 4.)

6. **No budget tracking.** CLI agents don't expose standardized token/cost counters. Deferred until runtimes provide better metrics. (The parent spec's `captain.md` format includes a Budget section — omitted in Phase 3.)

## Deviations from Parent Spec

The parent spec (`2026-03-13-octopus-on-mycelium-design.md`) defines the full system vision. Phase 3 deviates in these areas:

| Parent spec says | Phase 3 does instead | Rationale |
|---|---|---|
| `agents/captain.agent.md` (agent file) | `skills/captain/SKILL.md` (skill) | Captain operates in human's session, not spawned — skill is the correct delivery mechanism |
| Captain invokes `brainstorming` and `debugging` skills | Captain uses whatever workflow tools the user already has | Avoids duplicating skills that may already exist in the user's setup; captain adds coordination, not methodology |
| Escalation checks Tier 2/3 knowledge | Escalation checks task context + codebase only | Knowledge layer is Phase 4 |
| `captain.md` includes Budget section | `captain.md` has no Budget section | Budget tracking deferred |

## Architecture

### Two-Layer Separation (Unchanged)

**Layer 1: The Protocol** — filesystem-based coordination. Agent-agnostic. Files on disk + 5 atomic MCP operations. Shipped in Phase 1/2.

**Layer 2: The Captain** — intelligent orchestration in the human's session. Reads/writes the same protocol files as any arm. Intelligence comes from skills and prompt engineering, not privileged access.

Phase 3 implements Layer 2.

### Execution Model

The captain skill is loaded into the human's main session. It is not a background process — it operates within the session's normal tool-call loop. This means:

1. **Captain activates on user request.** The user invokes `/captain` explicitly, or the captain skill is loaded and recognizes work that needs delegation. The captain then drives the session (decomposition, spawning, etc.).

2. **Captain reacts to hook signals passively.** The `postToolUse` passive-monitor hook prints signals (stale arm, needs_review, all-complete) into the session's output after every tool call. When the captain skill is loaded, the agent sees these signals and acts on them per the judgment table. Between captain actions, the human can do their own work — the hook signals appear regardless and the captain addresses them when it sees them.

3. **Captain is not always-on.** If the human starts a new session without loading the captain skill, they still see passive-monitor signals but won't get captain intelligence acting on them. The human would need to invoke `/captain` or load the skill to re-engage. Crash recovery via `captain.md` ensures the captain can pick up state from a previous session.

This model matches how skills work in general: they're loaded into the session context and guide the agent's behavior, but they don't run autonomously outside the session.

### New Files

| File | Purpose |
|---|---|
| `skills/captain/SKILL.md` | Captain skill — judgment engine, decomposition, monitoring, question resolution |
| `skills/team-review/SKILL.md` | Retrospective generation, merge workflow, mission completion |

### Modified Files

| File | Change |
|---|---|
| `src/hooks/context-loader.ts` | Captain mode additionally loads `captain.md` (attention queue + crash recovery) |
| `src/mcp-server/tools/tasks.ts` | `claim_task` reconciles filesystem-only tasks into SQLite on first claim |
| `plugin.json` | Register captain and team-review skills |

### Runtime Artifacts (Written by Captain, Not Code)

| File | Purpose |
|---|---|
| `~/.mycelium/captain.md` | Active missions index, attention queue |
| `~/.mycelium/missions/{id}/retrospective.md` | Written by team-review skill on mission completion |

## Captain Skill (`skills/captain/SKILL.md`)

### Judgment Engine

The captain's core intelligence is recognizing what kind of response each signal needs. This table is embedded in the skill prompt:

| Signal | Captain Action |
|---|---|
| User says "implement feature X" | Use user's existing design/brainstorming workflow if available, then decompose into task DAG, spawn arms |
| User says "investigate/fix bug X" | Assess complexity — simple → invoke `/focus`, complex → decompose into investigation + fix arms |
| User says "refactor X to Y" | Decompose directly (pattern is clear), spawn arms |
| User says "run tests and fix" | Invoke `/focus` skill (single arm, fire-and-forget) |
| Arm sends question about its own task | Captain resolves from task context + codebase |
| Arm sends question about another arm's work | Captain reads other arm's progress + output, synthesizes answer |
| Arm says "approach won't work, need arch change" | Captain escalates to human — strategic decision |
| Passive-monitor: arm stale >5 min | Captain checks arm's progress file, sends nudge or escalates |
| Passive-monitor: needs_review | Captain reads completed work, prepares summary for human |
| Passive-monitor: all tasks complete | Captain invokes team-review skill |

### Escalation Model (Intelligent Buffer)

The captain tries to resolve arm questions before bothering the human:

```
Arm hits a problem
  → Captain checks:
    1. Task context + codebase understanding
    2. Other arms' progress/output files (cross-arm context within mission)
  → If resolved → reply to arm's inbox
  → If not → prompt human with context + recommended action
```

The human experiences: "I gave a goal, kept working, occasionally the captain asked a strategic question, then I got the result."

### Decomposition Protocol

When the captain decomposes work into a task DAG, it follows these rules (embedded in the skill prompt):

1. **Parse user intent** — identify distinct units of work
2. **Define scope per task** — file paths/globs each arm is allowed to touch
3. **Validate non-overlapping scope** — no two tasks touch the same files without explicit `blocked_by` dependency
4. **Validate DAG** — no cycles, all `blocked_by` references exist
5. **Max 4-5 arms** — research-backed performance saturation ceiling
6. **Set `prior_tasks`** — chain sequential tasks so later arms read earlier arms' output
7. **Identify parallelism** — which tasks can start immediately (no blockers)

### Spawn Orchestration

After decomposition, the captain orchestrates arm spawning using existing infrastructure:

1. `create_team` MCP call → gets mission_id, creates directory structure
2. Write task files to `missions/{id}/tasks/` via filesystem
3. Write/update `captain.md` with new mission entry
4. Spawn arms for unblocked tasks via runtime adapter (worktrees + tmux)
5. Arms load context via `sessionStart` hook, claim tasks via `claim_task` MCP
6. As tasks complete and unblock downstream tasks, captain spawns next batch

### Task Creation and Dual-Write

The parent spec defines a dual-write rule: SQLite is authority for status transitions, filesystem is authority for content. Task creation presents a challenge: the captain writes task files to filesystem (prompt-driven), but `claim_task` MCP needs the task to exist in SQLite.

**Resolution:** `claim_task` reconciles on first claim. If a task file exists on filesystem but has no SQLite row, `claim_task` reads the task file's frontmatter and creates the SQLite row before processing the claim — all within the same `BEGIN IMMEDIATE` transaction. This keeps task creation as a filesystem-only operation (no new MCP tools) while maintaining SQLite atomicity for claims.

This is consistent with the parent spec's principle: "the filesystem remains the source of truth for full task content, but SQLite provides the atomicity layer." SQLite lazily picks up tasks from the filesystem when atomicity is first needed (at claim time).

### Monitoring Behavior

The captain reacts to passive-monitor signals (surfaced by `postToolUse` hook):

- **Stale arm (>5 min)**: Read arm's progress file. If making progress, wait. If stuck, send nudge via inbox. If unresponsive, escalate to human.
- **needs_review**: Read the completed task's Output section. Summarize for human. Human decides approve/reject via captain.
- **All complete**: Invoke `/team-review` skill.
- **Arm question (inbox message to lead)**: Apply escalation model — resolve from context or escalate.

### Question Resolution

When an arm sends a question to the captain's inbox:

1. Read the arm's task file — understand what it's working on
2. Read the arm's progress file — understand where it is
3. If question relates to another arm's work, read that arm's task file + progress
4. Read relevant codebase files if needed
5. Formulate answer and write to arm's inbox
6. If the question is strategic/architectural (captain can't resolve from context), surface to human with:
   - The original question
   - What the captain checked
   - Recommended action

### Multi-Mission Awareness

The captain can manage multiple concurrent missions. It maintains awareness via `captain.md`:

- Active missions with progress summary
- Attention queue ordered by priority (blocked arms > stale arms > pending starts)
- Updated after every captain action

When multiple missions need attention, the captain handles the highest-priority item first from the attention queue.

## `captain.md` Format

```markdown
---
updated_at: 1741000000
---

## Active Missions
- [mission-001](missions/mission-001/) — Payment refactor (repo-a) — 2/5 tasks done
- [mission-002](missions/mission-002/) — Investigate ADX bug — in progress

## Attention Queue
1. mission-002: arm-1 sent priority message (blocked)
2. mission-001: arm-3 stale >5 min
```

**Lifecycle:**
- Created when captain skill first activates and spawns a mission
- Updated after every captain action
- Read by `sessionStart` context-loader in captain mode
- Read by captain on resume after crash/terminal close (crash recovery)

**Captain crash recovery flow:**
1. Human's terminal closes or session ends while missions are active
2. Human starts a new session — `sessionStart` hook loads `captain.md` (attention queue + active missions)
3. Human invokes `/captain` or sees hook signals and re-engages
4. Captain reads each active mission's current state (task statuses, member statuses, inbox)
5. For stale/dead arms: captain checks if arm's task has a checkpoint (written by `sessionEnd` hook) — if so, the arm can be re-spawned and will resume from checkpoint
6. Captain updates `captain.md` with refreshed state and continues monitoring

`captain.md` is human-readable markdown — the captain reads it as context, not parsed by code. The context-loader hook outputs its contents verbatim into the session.

## Team-Review Skill (`skills/team-review/SKILL.md`)

Invoked when all tasks in a mission complete.

**What it does:**

1. Reads each completed task file's Output section (files changed, tests added, decisions made, open questions)
2. Generates a retrospective summary for the human — what was done, what decisions were made, any open questions across arms
3. Writes `retrospective.md` to the mission directory
4. Presents merge plan to the human:
   - Lists worktrees in DAG dependency order (merge upstream tasks first)
   - For each worktree: summarizes changes, flags potential conflicts with other worktrees
   - Human performs the actual merges (captain suggests order, human executes)
   - If conflicts arise, captain can help resolve based on task context
5. Updates `mission.md` status to `completed`
6. Updates `captain.md` to remove the mission from active list

**What it does NOT do (Phase 4):**
- Knowledge promotion (Tier 1 → 2 → 3)
- Pattern extraction for future missions

**Trigger:** Captain detects all-complete (via passive-monitor) and invokes `/team-review`. Also manually invocable if the human wants to review mid-mission or stop a mission early.

## Context-Loader Enhancement

### Current Behavior (Phase 2)

- **Captain mode** (no `MYCELIUM_AGENT_ID` env var): Lists active missions from `~/.mycelium/missions/`
- **Arm mode** (has env var): Loads task details, inbox messages, checkpoint for crash recovery

### Phase 3 Change

**Captain mode additionally loads `captain.md`:**
- Reads `~/.mycelium/captain.md` if it exists
- Outputs the attention queue so the captain knows what needs action immediately
- Enables crash recovery — if the human closed their terminal mid-mission, the captain can pick up where it left off

**Arm mode unchanged.** Arms already get everything they need from Phase 2.

## End-to-End Workflow

### Full Mission (the 20% case)

```
1. User: "implement payment processing with Stripe"

2. Captain skill activates (recognizes complex multi-task work)

3. Captain uses user's existing design workflow if available
   (brainstorming skill, plan mode, or conversation)
   → Collaborates with human on approach

4. Captain decomposes into task DAG:
   - Task 1: Add Stripe SDK + config (scope: src/config/stripe.ts)
   - Task 2: Payment routes (scope: src/routes/payments.ts, blocked_by: [1])
   - Task 3: Rate limiting middleware (scope: src/middleware/rateLimit.ts)
   - Task 4: Tests (scope: tests/payments/**, blocked_by: [1,2,3])

5. Captain validates:
   - No scope overlaps without explicit blockers ✓
   - DAG has no cycles ✓
   - ≤5 arms ✓

6. Captain creates mission:
   - create_team MCP call → gets mission_id
   - Writes task files to missions/{id}/tasks/
   - Writes captain.md with new mission entry

7. Captain spawns arms for unblocked tasks (1 and 3):
   - Runtime adapter creates worktrees + tmux sessions
   - Arms get MYCELIUM_AGENT_ID + MYCELIUM_MISSION_ID env vars
   - Arms load context via sessionStart hook, claim tasks via MCP

8. Captain monitors (via passive-monitor signals):
   - Arm question → reads context, replies via inbox
   - Arm stale → checks progress, nudges
   - Task complete → spawns newly-unblocked arms (task 2 after 1 completes)

9. All tasks complete → captain invokes /team-review:
   - Reads all Output sections
   - Writes retrospective.md
   - Guides human through merge order
   - Marks mission completed
```

### Focus Mode (the 80% case)

Unchanged from Phase 1. Single arm, fire-and-forget, no decomposition, no review. The captain skill recognizes simple tasks and routes them to `/focus`.

## Testing Strategy

The parent spec suggests "captain judgment tests via skill invocation patterns." Since Phase 3 defers to the user's existing workflow tools rather than shipping captain-specific brainstorming/debugging skills (Key Decision #4), testing is adapted accordingly.

Since the captain is pure prompt (no TypeScript modules), testing is focused on:

1. **Context-loader enhancement** — test that captain mode loads `captain.md` content alongside mission listings. Same pattern as existing hook tests: `execSync("npx tsx src/hooks/...")` with real data in temp dir.

2. **Skill content validation** — manual review that the judgment table, decomposition rules, and escalation model are complete and consistent with the protocol layer.

3. **Integration testing** — end-to-end runs of the captain skill with Focus Mode and multi-arm missions to validate the workflow.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Captain prompt too large for context window | Keep skill focused on decision logic. Decomposition rules and protocol details reference existing docs rather than duplicating. |
| Captain decomposes poorly (overlapping scopes, bad DAG) | Decomposition checklist embedded in skill. Scope enforcer hook catches violations at runtime. |
| Captain resolves arm questions incorrectly | Captain explains its resolution to the arm. Arm can re-escalate. Human sees all in retrospective. |
| Captain doesn't activate when it should | Judgment table covers common patterns. User can always invoke `/captain` explicitly. |
| Crash recovery incomplete | `captain.md` + existing checkpoint system cover both captain and arm recovery paths. |
| User's existing skills conflict with captain flow | Captain defers to user's tools. It orchestrates around them, not over them. |
| DAG validation is LLM-dependent (not programmatic) | Decomposition checklist provides structured rules. Scope enforcer catches file-level violations at runtime. If LLM reliability proves insufficient, targeted validation code can be added later without changing the architecture. |
| Captain requires active session to monitor | `captain.md` persists state across sessions. Passive-monitor signals accumulate. Human can re-engage captain at any time and it catches up from filesystem state. |
