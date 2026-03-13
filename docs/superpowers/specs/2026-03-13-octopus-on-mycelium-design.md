# Design: Mycelium — Protocol-First Multi-Mission Agent Orchestration

**Date**: 2026-03-13
**Status**: Approved
**Package name**: `mycelium`
**Supersedes**: 2026-03-13 Filesystem-First Coordination Design (incorporated and extended)

## Problem

A principal developer at an enterprise company launches 3-5 CLI agent sessions daily across multiple repositories. Today, the human IS the orchestration layer — decomposing work, assigning sessions, monitoring progress, resolving questions, merging results. This makes the human the bottleneck in a theoretically parallel system. Context switching between sessions costs 23 minutes per interruption (UC Irvine research) and drains up to 40% of daily productivity.

The current copilot-agent-teams architecture partially addresses this but has five limitations:

1. **Per-repo scope**: Coordination is scoped to a single repository. A developer working across 3 repos needs 3 separate team setups with no shared awareness.
2. **Tool call overhead**: 14 MCP tools, 6+ calls per task cycle. At $0.04/call, a 3-teammate run costs ~$1 in coordination overhead alone.
3. **No cross-session learning**: Every session starts from zero. Knowledge discovered by one agent dies with its context window.
4. **Platform lock-in**: Only agents with MCP support can participate. The coordination protocol is invisible to agents that can't call MCP tools.
5. **Captain as pass-through**: The team lead routes questions to the human instead of resolving them. The human remains the bottleneck.

### Research Foundations

**Competitive analysis** (15+ frameworks, March 2026): No production tool provides a vendor-agnostic, CLI-native "principal developer" experience where one session manages autonomous workers across repos with persistent learning. Closest competitors: Overstory (vendor-agnostic but no task board), Gastown (task board but Claude-only, $100/hr), GitHub /fleet (free built-in but no persistent state or messaging).

**Academic validation**:
- Multi-agent coordination reduces error amplification from 17x to 4.4x with centralized orchestration (ICLR 2025)
- Performance saturates at ~4 agents (Multi-Agent Collaboration survey, 2025)
- Multi-agent only outperforms single-agent when single-agent accuracy is below ~45% (Google/MIT, 2025)
- Trust escalation is measurable: auto-approve usage rises from 20% to 40%+ over 750 sessions (Anthropic, 2026)

**Persona convergence** (5 personas, 40 ideas scored): Focus Mode (52.5/57.5), Cross-Session Knowledge (49/57.5), and Crash Recovery (46/57.5) ranked highest across Tech Lead, Indie Developer, Product Manager, Platform Engineer, and AI-Native Builder personas.

## Design Model: Octopus-on-Mycelium

Two natural systems provide the coordination model:

### The Octopus (Active Orchestration)

The giant Pacific octopus has a central brain (500M neurons) and 8 arms, each with its own neural ganglion (~40M neurons). Each arm has ~280 suction cups with independent sensory neurons. The brain sets intent; the arm ganglion coordinates locally; suction cups execute independently.

| Octopus | System | Role |
|---|---|---|
| Brain | Captain | Allocates attention across missions, makes strategic decisions, talks to human |
| Arm | Mission | Semi-autonomous group of work with local coordination |
| Arm ganglion | Protocol (per-mission) | Task board, inbox, progress — coordinates suction cups without bothering the brain |
| Suction cups | Teammates (arms) | Individual workers, react to local context independently |
| Chromatophores (skin) | Hooks | Passive signaling — surface changes without active brain involvement |

### The Mycelium (Persistent Knowledge)

A mycelial network connects trees across a forest, sharing nutrients and warning signals through an underground substrate. The network persists across seasons. A tree under attack sends chemical warnings; distant trees pre-emptively produce defenses.

| Mycelium | System | Role |
|---|---|---|
| Underground network | Knowledge layer | Cross-mission, cross-session memory substrate |
| Chemical signals | Annotations | Gotchas, tips, patterns discovered during work |
| Mother tree | Captain | Hub that promotes and distributes knowledge |
| Nutrient flow | Knowledge promotion | Tier 1 (arm) → Tier 2 (mission) → Tier 3 (global) |

### Combined Model

The octopus lives on the mycelium. The octopus handles active orchestration (missions, arms, coordination). The mycelium handles persistent knowledge (survives across sessions, across missions). The octopus is ephemeral; the mycelium is permanent.

```
     Human (sets intent, answers strategic questions)
        │
        ▼
   Octopus Brain ─── CAPTAIN (per-human, multi-mission)
    /    |    \
  Arm   Arm   Arm ─── MISSIONS (semi-autonomous groups)
  /|\   /|    |
 s s s  s s   s ──── TEAMMATES (suction cups, independent)
  │     │     │
  ▼     ▼     ▼
 ═══════════════════ PROTOCOL (filesystem, the arm ganglia)
  │     │     │
  ▼     ▼     ▼
 ─────────────────── MYCELIUM (persistent knowledge substrate)
```

## Requirements

1. One captain per human, managing multiple concurrent missions across repos
2. Missions can be repo-bound or repo-independent (e.g., log investigation)
3. Protocol is agent-agnostic — any CLI agent that reads/writes files can participate
4. Only operations needing atomicity go through MCP (5 tools, down from 14)
5. All other coordination via filesystem reads/writes (free for agents)
6. Captain resolves arm questions from own context, other arms' outputs, or mycelium before escalating to human
7. Cross-session knowledge accumulates in three tiers (arm → mission → global)
8. Focus Mode for single-arm fire-and-forget tasks (the 80% case)
9. Hooks use only Node.js `fs` — no native dependencies
10. Use all 6 relevant hook events
11. Runtime adapters abstract the spawning mechanism per CLI agent
12. 4-phase migration path, each phase independently shippable

## Architecture

### Two-Layer Separation

**Layer 1: The Protocol** — filesystem-based coordination standard. Agent-agnostic. Knows nothing about which agent runs above it. Files on disk + 5 atomic MCP operations.

**Layer 2: The Captain** — intelligent orchestration layer in the human's main session. Reads/writes the same protocol files as any arm. Its intelligence comes from skills and prompt engineering, not privileged access.

These layers are cleanly separated: the protocol can be adopted without the captain (manual orchestration), and the captain can evolve (skill updates) without protocol changes (code deploys).

### Global Directory Structure

```
~/.mycelium/                              # Per-human, global
├── captain.md                                 # Active missions index, attention queue
├── config.md                                  # Global defaults (budget, max arms)
│
├── missions/
│   ├── {mission-id}/
│   │   ├── mission.md                         # Goal, status, repo path (optional)
│   │   ├── members/
│   │   │   ├── lead.md
│   │   │   ├── arm-1.md
│   │   │   └── arm-2.md
│   │   ├── tasks/
│   │   │   ├── 001-payment-routing.md
│   │   │   └── 002-stripe-billing.md
│   │   ├── inbox/
│   │   │   ├── lead/
│   │   │   │   ├── 1741000001-arm-1.md
│   │   │   │   └── _read/
│   │   │   ├── arm-1/
│   │   │   │   └── _read/
│   │   │   └── _broadcast/
│   │   ├── progress/
│   │   │   ├── arm-1.md
│   │   │   └── arm-2.md
│   │   ├── knowledge/                         # Tier 1 + Tier 2
│   │   │   ├── arm-1.md
│   │   │   └── _shared.md
│   │   ├── retrospective.md
│   │   └── audit.jsonl
│   └── ...
│
├── knowledge/                                 # Tier 3 — global mycelium
│   ├── _global.md                             # Cross-mission patterns
│   └── repos/
│       ├── repo-a.md                          # Per-repo accumulated knowledge
│       └── repo-b.md
│
├── templates/                                 # Reusable mission patterns
│   ├── test-and-fix.md
│   └── refactor-language.md
│
└── adapters/                                  # Runtime adapter configs
    ├── copilot-cli.md
    ├── claude-code.md
    └── codex-cli.md
```

**Repo-local convenience**: No symlinks. Agents and hooks always use absolute paths under `~/.mycelium/`. Arms receive their mission path via `MYCELIUM_MISSION_ID` env var and resolve paths as `~/.mycelium/missions/$MYCELIUM_MISSION_ID/`. A repo can have multiple active missions simultaneously.

### File Formats

All files use Markdown with YAML frontmatter. Structured metadata in frontmatter, free-form content in body. This is the most natural format for both agents and humans, and matches the project's existing conventions (skills, agent definitions, progress files).

#### captain.md

```markdown
---
updated_at: 1741000000
---

## Active Missions
- [mission-001](missions/mission-001/) — Payment refactor (repo-a) — 2/5 tasks done
- [mission-002](missions/mission-002/) — Investigate ADX bug — in progress
- [mission-003](missions/mission-003/) — Auth migration (repo-b) — pending

## Attention Queue
1. mission-002: arm-1 sent priority message (blocked)
2. mission-001: arm-3 stale >5 min
3. mission-003: not yet started

## Budget
Total active arms: 6 / max 8
MCP calls today: 47 / budget 200
```

#### mission.md

```markdown
---
id: mission-001
status: active
repo: /Users/matantsach/projects/api-gateway
config:
  review_required: true
  max_arms: 4           # per-mission limit (hard cap: 5, global cap: 8)
  max_depth: 2          # arms cannot spawn sub-agents
  budget: 80
  runtime: copilot-cli
created_at: 1741000000
---

# Implement payment processing

Refactor api-gateway to support Stripe payments with auth middleware
and rate limiting. See design spec at docs/payment-design.md.
```

Valid statuses: `active`, `completed`, `stopped`.

For non-repo missions, `repo: null` and a `workspace` field points to a scratch directory.

#### members/{agent_id}.md

```markdown
---
agent_id: arm-1
team_id: mission-001
role: teammate
status: active
runtime: copilot-cli
worktree: .mycelium/worktrees/mission-001/arm-1
registered_at: 1741000002
---
```

Valid roles: `lead`, `teammate`. Valid statuses: `active`, `idle`, `finished`.

#### tasks/{id}-{slug}.md

```markdown
---
id: 1
status: pending
assigned_to: null
blocked_by: []
scope:
  - src/routes/payments.ts
  - src/middleware/rateLimit.ts
  - tests/payments/**
prior_tasks: []
created_at: 1741000000
claimed_at: null
completed_at: null
---

# Add payment routing and middleware

Implement /payments route with auth middleware and rate limiting.

## Context
Follow the Express router pattern from existing routes in src/routes/.
Read task #0's output before starting — it set up the base middleware.

## Output
<!-- filled by teammate on completion -->

### Files Changed
### Tests Added
### Decisions Made
### Open Questions

## Checkpoint
<!-- written by sessionEnd hook on crash/timeout -->
```

**Status state machine** (unchanged from current):
```
pending → in_progress (claim_task MCP)
in_progress → completed | blocked | needs_review (complete_task MCP / file write for blocked)
blocked → pending (auto-unblock) | in_progress (self-unblock via file write)
needs_review → completed (approve_task MCP) | in_progress (reject_task MCP)
```

**`scope` field**: File paths and globs the teammate is allowed (and expected) to work on. Used by the `preToolUse` scope enforcer hook. Also used by captain for pre-flight conflict detection (no two tasks should have overlapping scope without explicit dependency).

**`prior_tasks` field**: IDs of tasks whose Output section should be read before starting. Enables knowledge flow between sequential tasks.

**`Output` section**: Structured completion artifacts, written alongside the result narrative.

**`Checkpoint` section**: Written by `sessionEnd` hook. Enables crash recovery — a re-spawned arm reads the checkpoint and resumes.

#### inbox/{recipient}/{timestamp}-{sender}.md

```markdown
---
from: arm-1
priority: false
timestamp: 1741000001
---

Should the auth middleware use JWT or session tokens?
The existing code uses both patterns.
```

Priority messages (from captain steering) set `priority: true`. The arm's agent prompt instructs: "If you see a priority message, stop current approach and follow the directive."

**Read convention**: After processing, move the file to `inbox/{recipient}/_read/`. Unread count = file count in the directory (excluding `_read/`).

**Broadcast convention**: Messages in `inbox/_broadcast/` are read by all agents. Each agent tracks read state via a `_broadcast_cursor` timestamp in their own inbox.

#### knowledge/{agent_id}.md (Tier 1)

```markdown
---
agent_id: arm-1
updated_at: 1741000500
---

## Gotchas
- stripe.webhooks.constructEvent needs raw body buffer, not parsed JSON
- The auth middleware at src/middleware/auth.ts silently swallows 401s

## Tips
- Run tests with STRIPE_TEST_KEY=sk_test_xxx or they skip

## Decisions
- Used Express router pattern (consistent with existing routes)
- Rate limit: 100 req/min per IP
```

#### knowledge/_shared.md (Tier 2)

```markdown
---
team_id: mission-001
updated_at: 1741001000
---

## Codebase Patterns
- Express routes use factory function pattern (see src/routes/users.ts)
- Auth middleware is JWT-based, token in Authorization header

## Known Issues
- stripe.webhooks.constructEvent needs raw body buffer
- tests/utils.ts requires STRIPE_TEST_KEY or tests silently skip

## What Worked
- Splitting billing API and billing UI into separate tasks avoided scope overlap
- Blocking billing-ui on stripe-billing prevented conflicting assumptions
```

#### knowledge/_global.md (Tier 3)

```markdown
---
updated_at: 1741500000
---

## Codebase Patterns
- Express routes: factory function pattern in src/routes/
- Auth: JWT-based, middleware at src/middleware/auth.ts
- Tests: require env vars or silently skip (always check)

## Decomposition Patterns
- Always separate API and UI tasks when both touch the same domain
- Always add explicit blocked_by when one task produces types another consumes
- Auth-related tasks need scope for both src/middleware/ and the target route

## Anti-Patterns
- Don't let two arms touch the same barrel export file (src/routes/index.ts)
- Don't decompose into more than 4 tasks — performance saturates
```

#### audit.jsonl

```
{"ts":1741000001,"agent":"lead","action":"mission_create","detail":"Payment processing"}
{"ts":1741000002,"agent":"lead","action":"task_create","task_id":1,"detail":"Payment routing"}
{"ts":1741000005,"agent":"arm-1","action":"register","detail":"teammate"}
{"ts":1741000006,"agent":"arm-1","action":"task_claim","task_id":1}
{"ts":1741000300,"agent":"arm-1","action":"task_complete","task_id":1,"detail":"Added /payments route"}
{"ts":1741000301,"agent":"lead","action":"task_approve","task_id":1}
```

Append-only. One JSON object per line. Single-line appends with `O_APPEND` are effectively atomic on local filesystems for writes within a single filesystem block (typically 4KB). This is a pragmatic assumption, not a POSIX guarantee.

### MCP Atomicity Layer (5 Tools)

Only operations where two agents acting simultaneously could corrupt state.

#### create_team

```
Input:  { goal: string, config?: object, repo?: string }
Output: { mission_id: string }
```

Creates mission directory structure, initializes SQLite tables, writes `mission.md`, registers the lead member, appends to audit log. Returns the generated mission ID.

#### claim_task

```
Input:  { mission_id: string, task_id: number, agent_id: string }
Output: { task: Task }
```

`BEGIN IMMEDIATE` transaction. Reads the task file to check status and blockers. If `pending` and all blockers resolved, atomically marks as `in_progress` and assigns. Updates the task file on disk. Appends to audit log.

**Why MCP**: Two arms calling simultaneously could both read `status: pending` and both claim. The SQLite transaction serializes this.

#### complete_task

```
Input:  { mission_id: string, task_id: number, agent_id: string, result: string, output?: object }
Output: { task: Task }
```

Validates the task is `in_progress` and assigned to the caller. If `review_required` config is set, routes to `needs_review` instead of `completed`. On completion, triggers auto-unblock cascade: reads all task files, finds those with `blocked_by` containing this task ID, checks if all blockers are now completed, and updates their status to `pending`. Updates the task file. Appends to audit log.

**Why MCP**: The auto-unblock cascade reads and writes multiple task files. Without atomicity, a race between two arms completing simultaneously could miss an unblock.

#### approve_task

```
Input:  { mission_id: string, task_id: number, agent_id: string }
Output: { task: Task }
```

Lead-only. Transitions `needs_review` → `completed`. Triggers auto-unblock cascade. Updates the task file. Appends to audit log.

**Why MCP**: Lead-only enforcement + auto-unblock cascade.

#### reject_task

```
Input:  { mission_id: string, task_id: number, agent_id: string, feedback: string }
Output: { task: Task }
```

Lead-only. Transitions `needs_review` → `in_progress`. Writes feedback as a message to the assigned arm's inbox. Updates the task file. Appends to audit log.

**Why MCP**: Lead-only enforcement + cross-concern operation (task update + message write).

### SQLite Schema

SQLite tracks the minimal state needed for atomic operations. The filesystem remains the source of truth for full task content, but SQLite provides the atomicity layer.

```sql
-- Missions table: ID generation and lead tracking
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','stopped')),
  lead_agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Tasks table: tracks status and assignment for atomic transitions
-- Full task content (description, context, output) lives in task markdown files.
-- This table exists so that claim, complete, approve, and reject operations
-- can validate state atomically without parsing filesystem YAML.
CREATE TABLE IF NOT EXISTS tasks (
  mission_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked','needs_review')),
  assigned_to TEXT,
  blocked_by TEXT DEFAULT '[]',
  claimed_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (mission_id, task_id),
  FOREIGN KEY (mission_id) REFERENCES missions(id)
);

-- Approvals table: tracks lead decisions
CREATE TABLE IF NOT EXISTS approvals (
  mission_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  decided_by TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
  feedback TEXT,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (mission_id, task_id, decided_at)
);
```

**Task IDs** are sequential integers scoped to a mission (1, 2, 3...). The primary key is `(mission_id, task_id)`.

**Dual-write rule**: MCP tools write to BOTH SQLite (status, assignment) and the filesystem (task markdown file frontmatter). SQLite is the authority for status transitions; the filesystem is the authority for content. If they diverge, SQLite wins for status.

**Lead-only enforcement**: The `missions.lead_agent_id` field identifies the lead. `approve_task` and `reject_task` verify `agent_id == lead_agent_id` within the transaction.

### Filesystem Status Transitions (Without MCP)

Some status transitions happen via direct filesystem writes, outside MCP:

| Transition | Who | How | Cascade? |
|---|---|---|---|
| `in_progress → blocked` | Assigned arm | Writes `status: blocked` to task file frontmatter + clears `blocked_by` | No |
| `blocked → in_progress` | Assigned arm | Writes `status: in_progress` to task file frontmatter (self-unblock) | No |

These transitions do NOT require MCP because:
- Only the assigned arm writes to its own task file (no concurrent access)
- They do not trigger auto-unblock cascades
- No lead-only authorization needed

**Convention**: Self-unblock (`blocked → in_progress`) NEVER triggers an auto-unblock cascade. Only task completion (via `complete_task` MCP) triggers the cascade, because it must atomically check multiple tasks.

**SQLite sync**: When a filesystem-only status change occurs, the arm's next `complete_task` call will reconcile. The MCP tool reads the task file's current status before validating the transition.

### Filesystem Operations (Free — No MCP)

| Operation | Agent Action |
|-----------|-------------|
| Create task | Captain writes `tasks/{id}-{slug}.md` |
| Discover tasks | Agent reads all `tasks/*.md` files |
| Register member | Spawn script writes `members/{agent_id}.md` |
| Send message | Agent writes `inbox/{recipient}/{ts}-{from}.md` |
| Read messages | Agent lists `inbox/{my_id}/`, reads files, moves to `_read/` |
| Broadcast | Agent writes to `inbox/_broadcast/` |
| Check mission status | Agent reads `mission.md` + `tasks/*.md` + `members/*.md` |
| Monitor arms | Captain reads `progress/` mtimes + `inbox/` counts + task statuses |
| Steer arm | Captain writes priority message to `inbox/{target}/` + updates task |
| Update progress | Agent appends to `progress/{agent_id}.md` |
| Read audit log | Agent reads `audit.jsonl` |
| Stop mission | Captain writes `mission.md` with `status: "stopped"` |
| Write knowledge | Agent writes `knowledge/{agent_id}.md` |
| Self-unblock | Agent writes task file `status: "in_progress"` (from blocked) |

### Runtime Adapter Interface

```typescript
interface RuntimeAdapter {
  name: string;
  spawn(config: SpawnConfig): Promise<void>;
  isAvailable(): boolean;
}

interface SpawnConfig {
  missionId: string;
  agentId: string;
  worktreePath: string;
  taskRef: string;
  agentPrompt: string;
  env: Record<string, string>;
}
```

Adding a new runtime = implementing `spawn()` and `isAvailable()`. The first adapter is Copilot CLI (refactored from existing `spawn-teammate.sh`). Claude Code and Codex CLI adapters follow.

Environment variables set by spawn:
```bash
MYCELIUM_AGENT_ID="arm-1"
MYCELIUM_MISSION_ID="mission-001"
MYCELIUM_PROJECT_ROOT="/Users/matantsach/projects/api-gateway"
```

### MCP Server Configuration

The current `createServer(dbPath)` factory changes to `createServer(basePath)` where `basePath` defaults to `~/.mycelium/`. The server discovers missions by scanning `basePath/missions/*/mission.md`.

```typescript
function createServer(basePath: string = path.join(os.homedir(), '.copilot-teams')): {
  server: Server;
  db: TeamDB;
}
```

The SQLite database lives at `basePath/teams.db`. One MCP server instance runs per agent session (captain or arm). All instances share the same SQLite file via WAL mode with `busy_timeout(5000)`.

### preToolUse Tool Name Mapping

The scope enforcer must know which tool names correspond to file mutations. This is runtime-specific:

| Runtime | File-mutation tools | Path extraction |
|---|---|---|
| Copilot CLI | `editFile`, `writeFile`, `insertContent`, `replaceContent` | `args.path` or `args.filePath` |
| Claude Code | `Edit`, `Write`, `NotebookEdit` | `args.file_path` |
| Codex CLI | `write_file`, `edit_file`, `apply_patch` | `args.path` |
| Shell tools | `Bash`, `shell`, `runCommand` | Best-effort regex on command string |

The mapping is configured per runtime adapter in `~/.mycelium/adapters/{runtime}.md` frontmatter. Shell command parsing is best-effort — the primary enforcement is on dedicated file-mutation tools.

### Broadcast Cursor Storage

Each agent's broadcast read state is stored at:
```
inbox/{agent_id}/_broadcast_cursor
```

This is a single-line text file containing a Unix timestamp. Read logic:
1. Read cursor timestamp (default 0 if file doesn't exist)
2. List files in `inbox/_broadcast/` with timestamp in filename > cursor
3. Process each message
4. Write new cursor = max timestamp of processed messages

## The Captain Layer

The captain lives in the human's main session. It is not code — it is prompt engineering + skills + judgment rules. This enables rapid evolution without code deploys.

### Task Triage (Judgment Engine)

The captain's key intelligence is knowing what kind of response each request needs:

| Signal | Captain Action |
|---|---|
| Human says "investigate bug X" | Invoke debugging skill, delegate to 1 arm (Focus Mode) |
| Human says "implement feature X" | Invoke brainstorming skill, collaborate on design, then decompose |
| Human says "refactor X to Y" | Decompose directly (pattern is clear), spawn arms |
| Human says "run tests and fix failures" | Focus Mode — 1 arm, fire-and-forget |
| Arm sends question about its own task | Captain resolves from task context + codebase |
| Arm sends question about another arm's work | Captain reads other arm's progress + output, resolves |
| Arm says "approach won't work, need arch change" | Captain escalates to human — strategic decision |
| Hook shows arm stale >5 min | Captain checks arm's progress, sends nudge or escalates |
| Hook shows all tasks complete | Captain generates retrospective, notifies human |
| Budget at 80% | Captain steers remaining arms to wrap up |

### Escalation Model (Intelligent Buffer)

The captain tries to resolve arm questions before escalating to human:

```
Arm hits a problem
    → Captain checks:
        1. Own knowledge (task context, codebase understanding)
        2. Other arms' outputs (cross-arm context within mission)
        3. Mycelium (Tier 2 mission knowledge + Tier 3 global)
    → If resolved → reply to arm's inbox
    → If not → prompt human with context + recommended action
```

The human experiences: "I gave a goal, kept working, occasionally the captain asked a strategic question, then I got the result."

### Captain Skills

| Skill | When Invoked |
|---|---|
| `team-coordinate` | Always loaded — teaches filesystem protocol |
| `team-focus` | Single-arm fire-and-forget tasks |
| `brainstorming` | Complex/exploratory tasks requiring human collaboration |
| `debugging` | "Investigate this bug" tasks |
| `team-review` | All tasks complete — review, retrospective, merge |

### Captain as Learner

Over time, the captain gets smarter through the mycelium:
- **Run 1**: Decomposes from scratch. Arms discover gotchas. Knowledge written to Tier 1.
- **Run 2**: Captain reads Tier 2 (promoted from run 1). Avoids known pitfalls in decomposition.
- **Run 10**: Tier 3 has accumulated patterns — "tasks touching auth always need scope for middleware too." Captain decomposes more accurately, arms hit fewer surprises.

## The Mycelium Layer (Cross-Session Knowledge)

### Three Tiers

| Tier | Location | Scope | Written by | Persists |
|---|---|---|---|---|
| 1 (Arm) | `missions/{id}/knowledge/arm-1.md` | One arm's discoveries | Arm during work | Mission lifetime |
| 2 (Mission) | `missions/{id}/knowledge/_shared.md` | Mission-wide knowledge | Captain at retrospective | Mission lifetime |
| 3 (Global) | `knowledge/_global.md` + `knowledge/repos/*.md` | Cross-mission patterns | Captain when patterns recur | Forever |

### Knowledge Flow

```
Arm discovers gotcha → Writes to Tier 1
                           │
Mission stop/retro → Captain promotes valuable entries to Tier 2
                           │
Pattern recurs across missions → Captain promotes to Tier 3
                           │
New session starts → sessionStart hook loads relevant Tier 2 + 3
```

### Relevance Filtering

The `sessionStart` hook filters knowledge by:
1. **File path overlap** — arm working on `src/payments/` sees knowledge tagged with payment-related paths
2. **Recency** — newer entries weighted higher
3. **Tier** — Tier 3 always loaded, Tier 2 loaded for same-repo missions, Tier 1 only if resuming a crashed arm

### Knowledge vs CLAUDE.md

CLAUDE.md tells agents the rules ("how to work here"). Mycelium tells agents the experience ("what we've learned working here"). They are complementary. CLAUDE.md is human-written and static. Mycelium is agent-written and accumulates.

## Hook System (6 Hooks)

All hooks read from `~/.mycelium/`. All use only Node.js `fs`. No native dependencies.

### Hook 1: sessionStart — Context Loader

Loads team context and knowledge so agents start informed.

| Session type | What gets loaded |
|---|---|
| Captain (main session) | All active missions summary, attention queue, global budget |
| Arm (spawned teammate) | Its mission, its task, relevant knowledge scoped to task scope |
| Resumed arm (after crash) | Same as arm + checkpoint from task file |

### Hook 2: preToolUse — Scope Enforcer

Enforces file-scope permissions per arm at the platform level.

1. Reads `MYCELIUM_AGENT_ID` env var to identify calling arm
2. If `toolName` is a file-mutation tool: extracts file path from args
3. Reads arm's claimed task file for `scope` (allowed file paths/globs)
4. If outside scope: returns `{"permissionDecision": "deny", "permissionDecisionReason": "..."}`
5. Captain sessions (no env var) are unrestricted

Best-effort guard rail, not security boundary. Prevents accidental scope violations.

### Hook 3: postToolUse — Passive Monitor (Chromatophores)

Surfaces actionable signals after every tool call.

For captain: `[octopus] mission-001: arm-3 stale (7m) | mission-002: arm-1 blocked`
For arms: `[octopus] 1 unread message in inbox`
Silent when nothing needs attention.

### Hook 4: agentStop — Arm Cleanup

Updates `members/{id}.md` status to `finished`. Appends `session_end` to `audit.jsonl`. Checks if all tasks complete — if so, notifies captain inbox.

### Hook 5: subagentStop — Same as Hook 4

For arms spawned as subagents rather than tmux panes.

### Hook 6: sessionEnd — Checkpoint

Writes final entry to `progress/{id}.md`. If task in_progress, writes checkpoint to task file (last_action, next_step). Flushes accumulated knowledge to `knowledge/{id}.md`. Enables crash recovery.

## Focus Mode (The 80% Case)

Scored highest across all personas (52.5/57.5). The gateway to adoption.

```
/focus run integration tests and fix failures
/focus investigate ADX logs for bug PROJ-1234
/focus add unit tests for src/payments/
```

Under the hood:
1. Captain creates minimal mission (1 MCP call for atomic ID)
2. Writes single task file with instruction as body
3. Captain infers scope from instruction (or asks if ambiguous)
4. Spawns one arm via runtime adapter
5. Immediately returns control to human
6. `postToolUse` hook shows progress: `[octopus] focus: "fix tests" — in progress`
7. On completion: `[octopus] focus: "fix tests" — done. 3 files changed.`
8. Human reviews at convenience

| | Focus Mode | Full Mission |
|---|---|---|
| Arms | 1 | 2-5 |
| Decomposition | None | Captain decomposes, validates DAG |
| Human involvement | Fire-and-forget | May brainstorm first |
| MCP calls | 2 total | 2 per arm + create |
| Frequency | Daily (5-10x/day) | Weekly (complex tasks) |

## Competitive Positioning

### The Moat (in order of defensibility)

1. **Cross-session knowledge (mycelium)**: Platform built-ins start from zero every session. We accumulate. After 10 runs, our agents know things about your codebase that a fresh /fleet session never will. This is earned lock-in through value.

2. **Open protocol**: Filesystem-based coordination that any CLI agent can speak. Platforms will always favor their own agents. We're the neutral layer.

3. **Captain intelligence**: The intelligent buffer that absorbs coordination complexity. Prompt engineering + skills evolves faster than platform code.

### Feature Comparison (Our Edge)

| Feature | Us | GitHub /fleet | Claude Teams | Overstory | Gastown |
|---|---|---|---|---|---|
| Task board + dependency DAG | ✓ | ✗ | ~ | ✗ | ~ |
| Cross-session knowledge | ✓ | ✗ | ✗ | ✗ | ~ |
| Intelligent buffer (captain) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Vendor-agnostic runtime | ✓ | ~ | ✗ | ✓ | ✗ |
| File-scope enforcement | ✓ | ✗ | ✗ | ~ | ✗ |
| Multi-repo missions | ✓ | ✗ | ✗ | ✗ | ✗ |
| Focus Mode (single-arm) | ✓ | ~ | ✗ | ✗ | ✗ |
| Crash recovery | ✓ | ✗ | ✗ | ~ | ✓ |
| Cost tracking / budget | ✓ | ~ | ✗ | ✓ | ✗ |
| Approval workflow | ✓ | ✗ | ✗ | ✗ | ✗ |

### Platform Risk Mitigation

GitHub /fleet reached GA Feb 25, 2026. Claude Code Agent Teams shipped Feb 2026. Window for differentiation is 6-12 months. Our defense: go deeper on what platform built-ins won't build — enterprise governance, cross-session learning, vendor-agnostic runtime.

## Distribution Model

Mycelium ships as a **plugin** for each supported runtime. One npm package, multiple plugin descriptors if runtime-specific wiring is needed.

| Runtime | Install command | Plugin descriptor |
|---|---|---|
| Copilot CLI | `copilot plugin install mycelium` | `plugin.json` |
| Claude Code | `claude plugin install mycelium` | `plugin.json` (same or runtime-specific) |
| Codex CLI | TBD (pending plugin support) | — |

The `plugin.json` declares MCP servers, hooks, skills, and agents. The runtime handles wiring. No manual setup commands needed.

If runtimes diverge in plugin format or hook conventions, we ship separate plugin descriptors (e.g., `plugin.copilot.json`, `plugin.claude.json`) from the same npm package. The core code (MCP server, filesystem protocol, adapters) is shared.

## Migration Path

Four phases, each independently shippable.

### Phase 1: Foundation (Global State + Focus Mode)

- Create `~/.mycelium/` global directory structure
- Implement `captain.md` and `mission.md` formats
- Implement Focus Mode skill (`/focus`)
- Ship 1 runtime adapter (Copilot CLI)
- Existing MCP tools continue working for full missions
- New `context-loader.ts` hook checks BOTH `~/.mycelium/missions/` (new missions) AND per-repo `.mycelium/teams.db` (legacy teams). Legacy support dropped in Phase 2.

**User sees**: `/focus` command works. Existing per-repo teams continue working. Everything else unchanged.

### Phase 2: Protocol Migration (Filesystem-First)

- Migrate task/member/message creation to filesystem writes
- Implement `preToolUse` scope enforcer hook
- Implement `sessionEnd` checkpoint hook (crash recovery)
- Implement `postToolUse` passive monitor reading filesystem
- Reduce MCP tools from 14 to 5
- Remove `node-sqlite3-wasm` dependency from hooks

**User sees**: Same functionality, fewer premium requests, scope enforcement, crash recovery.

### Phase 3: Captain Intelligence

- Implement captain agent prompt with judgment engine
- Add skill awareness (brainstorming, debugging, direct delegation)
- Implement intelligent buffer (resolve arm questions before escalating)
- Multi-mission management (attention queue, cross-mission awareness)
- Full mission workflow with decomposition, validation, spawn, monitor

**User sees**: The octopus brain. Natural language → decompose → spawn → monitor → resolve → report.

### Phase 4: Mycelium + Runtime Adapters

- Implement Tier 1 → 2 → 3 knowledge promotion
- `sessionStart` loads relevant knowledge into arm context
- Retrospective generation on mission stop
- Add Claude Code runtime adapter
- Add Codex CLI runtime adapter
- Template system for reusable mission patterns

**User sees**: Agents get smarter over time. Can mix CLI agents. Can replay patterns.

### Removal Schedule

| Tool/Component | Replaced By | Phase |
|---|---|---|
| `register_teammate` MCP | Filesystem write (member file) | 2 |
| `list_tasks` MCP | Filesystem read (task glob) | 2 |
| `send_message` MCP | Filesystem write (inbox file) | 2 |
| `get_messages` MCP | Filesystem read (inbox glob) | 2 |
| `broadcast` MCP | Filesystem write (broadcast dir) | 2 |
| `team_status` MCP | Filesystem reads | 2 |
| `monitor_teammates` MCP | `postToolUse` hook | 2 |
| `steer_teammate` MCP | Filesystem write (priority msg) | 2 |
| `get_audit_log` MCP | Filesystem read (audit.jsonl) | 2 |
| `create_task` MCP | Filesystem write (task file) | 2 |
| `update_task` MCP | `complete_task` MCP + filesystem | 2 |
| `reassign_task` MCP | Captain writes task file + inbox | 2 |
| `stop_team` MCP | Captain writes mission.md status | 2 |
| Per-repo `.mycelium/` | Global `~/.mycelium/` | 1 |
| `node-sqlite3-wasm` in hooks | Node.js `fs` only | 2 |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| File corruption from concurrent writes | Only assigned arm writes to a task file. Claims serialize access via SQLite. |
| Agent ignores filesystem conventions | `team-coordinate` skill teaches conventions. `preToolUse` hook enforces scope. |
| Captain resolves questions incorrectly | Captain explains its resolution to the arm. Arm can re-escalate. Human sees all in retrospective. |
| 4-agent saturation ceiling (research) | Focus Mode (1 arm) is the 80% case. Full missions default to max 4 arms. Config overridable. |
| Platform built-ins absorb value | Moat is cross-session knowledge + open protocol. Platform built-ins are stateless and vendor-locked. |
| Multi-repo knowledge leakage | Knowledge is scoped by repo path. Global tier contains only patterns, not secrets. |
| Cost runaway | Budget caps per mission + global. Hook alerts at 80%. Captain steers arms to wrap up. |
| Scope enforcer bypass via shell | Best-effort guard rail, not security boundary. Purpose is preventing accidental violations. |
| Audit log append race | JSONL single-line appends are atomic on local filesystems (POSIX < PIPE_BUF). |
| Migration breaks existing teams | Phase 1 is additive. Existing per-repo teams continue working. New missions use global state. |
| Unbounded agent spawning | Hard limits enforced: max depth 2 (captain → arm, no arm sub-spawns), max 5 concurrent arms per mission, max 8 arms globally. See Agent Guardrails below. |

### Agent Guardrails (Informed by OpenClaw)

OpenClaw's production experience with sub-agent coordination validates several practical limits that we adopt:

**Hard limits (enforced by `create_team` and runtime adapters):**
- **Max depth: 2** — Captain spawns arms. Arms do NOT spawn sub-agents. If an arm needs decomposition, it messages the captain who spawns additional arms. This prevents runaway recursion and keeps the captain as the single coordination authority.
- **Max fan-out: 5 per mission** — Aligns with research showing performance saturation at ~4 agents. Config override available up to 8 for power users.
- **Max global arms: 8** — Across all active missions. Budget and context window constraints make this a practical ceiling.

**"Default Serial, Explicit Parallel" principle:**
Arms work serially by default (one task at a time). Parallel execution only happens when the captain explicitly creates multiple arms with non-overlapping scope. This matches OpenClaw's finding that serial-by-default with explicit parallelism produces more reliable results than optimistic parallelism.

**ACP protocol awareness:**
The Agent Communication Protocol (ACP, March 2025) defines a standard for agent-to-agent communication. Our filesystem inbox protocol is compatible with ACP's message semantics (sender, recipient, priority, content). Phase 4 may expose an ACP-compatible interface for interop with external agent frameworks, but the core protocol remains filesystem-first.

**Governance as differentiator:**
OpenClaw and most competitors lack structured approval workflows and audit trails. Our `needs_review → approve/reject` cycle with lead-only enforcement and `audit.jsonl` is a genuine enterprise differentiator — not just a feature, but a trust-building mechanism that enables organizations to adopt autonomous agents incrementally.

## Testing Strategy

### Test Environment

Tests use a temporary base path (`$TMPDIR/mycelium-test-{random}/`) instead of `~/.mycelium/`. The `createServer(basePath)` factory accepts this override. Tests clean up the temp directory in `afterEach`.

### Test Patterns by Phase

**Phase 1**: Focus Mode skill tests + context-loader hook tests. Test that context-loader reads from both legacy per-repo path and new global path.

**Phase 2**: MCP tool tests via `InMemoryTransport` (same pattern, 5 tools instead of 14). DB tests validate dual-write (SQLite status matches filesystem frontmatter). Hook tests use `execSync` with `MYCELIUM_BASE_PATH` env override. Add filesystem race condition tests: two concurrent `complete_task` calls via separate clients sharing the same SQLite.

**Phase 3**: Captain judgment tests via skill invocation patterns. Verify correct skill is selected for each task type (investigation → debugging, complex → brainstorming, routine → direct delegation).

**Phase 4**: Knowledge promotion tests (Tier 1 → 2 → 3). Runtime adapter integration tests (mock spawn, verify env vars and directory creation).

### Removed Tests

Tests for removed MCP tools (9 of 14) are deleted in Phase 2. Replaced by filesystem operation tests where applicable.

## What Doesn't Change

- Task status state machine (pending → in_progress → completed/blocked/needs_review)
- Lead-only authorization for approve/reject
- Git worktree isolation per arm
- Progress file format and location
- Tmux spawning mechanism (wrapped in runtime adapter)
- The core value proposition: single interface where human talks to the captain

## File Changes Summary

| File | Change | Phase |
|---|---|---|
| `src/mcp-server/server.ts` | Update — register 5 tools instead of 14 | 2 |
| `src/mcp-server/db.ts` | Rewrite — slim to claims/approvals + filesystem writes | 2 |
| `src/mcp-server/tools/tasks.ts` | Rewrite — claim, complete, approve, reject only | 2 |
| `src/mcp-server/tools/team.ts` | Simplify — create_team creates directory structure | 2 |
| `src/mcp-server/tools/messaging.ts` | Remove — replaced by filesystem inbox | 2 |
| `src/mcp-server/tools/monitoring.ts` | Remove — replaced by hooks + filesystem | 2 |
| `src/hooks/context-loader.ts` | New — sessionStart hook | 1 |
| `src/hooks/scope-enforcer.ts` | New — preToolUse hook | 2 |
| `src/hooks/passive-monitor.ts` | Rewrite — postToolUse (filesystem-only) | 2 |
| `src/hooks/arm-cleanup.ts` | New — agentStop/subagentStop hook | 2 |
| `src/hooks/checkpoint.ts` | New — sessionEnd hook | 2 |
| `src/hooks/check-active-teams.ts` | Remove — merged into context-loader | 1 |
| `src/hooks/nudge-messages.ts` | Remove — replaced by passive-monitor | 2 |
| `src/adapters/types.ts` | New — RuntimeAdapter interface | 1 |
| `src/adapters/copilot-cli.ts` | New — Copilot CLI runtime adapter | 1 |
| `src/adapters/claude-code.ts` | New — Claude Code runtime adapter | 4 |
| `src/adapters/codex-cli.ts` | New — Codex CLI runtime adapter | 4 |
| `skills/team-coordinate/SKILL.md` | New — filesystem coordination conventions | 2 |
| `skills/team-focus/SKILL.md` | New — single-arm Focus Mode | 1 |
| `skills/team-review/SKILL.md` | New — retrospective + merge workflow | 3 |
| `agents/captain.agent.md` | New — captain agent prompt with judgment engine | 3 |
| `agents/teammate.agent.md` | Update — reduce MCP tools, add file read/write guidance | 2 |
| `scripts/spawn-teammate.sh` | Update — set env vars, write member file, create inbox | 1 |
| `plugin.json` | Update — all 6 hooks + slimmed MCP server | 2 |
| `dist/` | Rebuild after all changes | Each phase |
