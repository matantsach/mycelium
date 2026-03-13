# Design: Mycelium Phase 2 — Protocol Migration (Filesystem-First)

**Date**: 2026-03-14
**Status**: Approved
**Parent spec**: `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md`
**Phase 1 plan**: `docs/superpowers/plans/2026-03-14-mycelium-phase1-foundation.md`

## Goal

Extend the Phase 1 foundation with filesystem-first coordination: full dual-write in MCP tools, audit logging, inbox messaging, 4 new hooks (scope enforcement, crash recovery, passive monitoring, arm cleanup), and updated skill/agent prompts. After Phase 2, multi-arm missions work end-to-end with scope enforcement, crash recovery, and passive monitoring — all without adding new MCP tools.

## Implementation Strategy: Vertical Slices

Each capability is built end-to-end as a self-contained slice, independently testable and shippable.

| Slice | Capability | New/Changed Files |
|-------|-----------|-------------------|
| 1 | Dual-write + audit log | `protocol/mission.ts`, `protocol/audit.ts`, `mcp-server/tools/tasks.ts`, `mcp-server/tools/team.ts` |
| 2 | Scope enforcer hook | `hooks/scope-enforcer.ts` |
| 3 | Inbox messaging protocol | `protocol/inbox.ts`, `mcp-server/tools/tasks.ts` (reject_task) |
| 4 | Checkpoint hook | `hooks/checkpoint.ts` |
| 5 | Passive monitor hook | `hooks/passive-monitor.ts` (replaces nudge-messages.ts) |
| 6 | Arm cleanup hook | `hooks/arm-cleanup.ts` |
| 7 | Skill + agent + hook registration | `skills/team-coordinate/SKILL.md`, `agents/teammate.agent.md`, `hooks.json`, `hooks/context-loader.ts` |

---

## Slice 1: Dual-Write + Audit Log

### Problem

The 4 task MCP tools (`claim_task`, `complete_task`, `approve_task`, `reject_task`) currently only update SQLite. Per the design spec's dual-write rule, they must also update the task markdown file's frontmatter and append audit log entries.

### Protocol Additions

**`src/protocol/mission.ts` — new function:**

```typescript
function updateTaskFileFrontmatter(filePath: string, updates: Record<string, unknown>): void
```

Reads the task file, merges `updates` into existing frontmatter (overwriting matching keys), writes back. Uses `parseFrontmatter` / `stringifyFrontmatter`.

**`src/protocol/mission.ts` — new function:**

```typescript
function findTaskFile(missionPath: string, taskId: number): string | undefined
```

Globs `tasks/{padded-id}-*.md` (e.g., `tasks/001-*.md`) and returns the matching path. Used by all 4 task tools to locate the file for dual-write.

**`src/protocol/audit.ts` (new file):**

```typescript
function appendAuditEntry(missionPath: string, entry: AuditEntry): void

interface AuditEntry {
  ts: number;
  agent: string;
  action: string;
  task_id?: number;
  detail?: string;
}
```

Appends a single JSON line to `{missionPath}/audit.jsonl` using `fs.appendFileSync`. Single-line appends with `O_APPEND` are effectively atomic on local filesystems for writes within a single filesystem block.

### Tool Changes

All 4 task tool handlers receive `basePath` (passed through from `registerTaskTools` signature change). After a successful SQLite mutation:

1. Call `findTaskFile()` to locate the task markdown file
2. Call `updateTaskFileFrontmatter()` to sync status, assigned_to, claimed_at, completed_at
3. Call `appendAuditEntry()` with the appropriate action

`create_team` also gets audit logging (`mission_create` action). It already does filesystem dual-write.

**Audit actions:**

| Tool | Action |
|------|--------|
| `create_team` | `mission_create` |
| `claim_task` | `task_claim` |
| `complete_task` | `task_complete` |
| `approve_task` | `task_approve` |
| `reject_task` | `task_reject` |

### Testing

- Unit tests for `updateTaskFileFrontmatter`: verify frontmatter fields are merged, body is preserved
- Unit tests for `findTaskFile`: verify glob matching with padded IDs
- Unit tests for `appendAuditEntry`: verify JSONL format, append semantics
- Integration tests: call MCP tool, verify both SQLite and filesystem are updated, audit entry exists

---

## Slice 2: Scope Enforcer Hook (preToolUse)

### File

`src/hooks/scope-enforcer.ts`

### Behavior

1. Reads `MYCELIUM_AGENT_ID` and `MYCELIUM_MISSION_ID` env vars
2. If no env vars -> captain session -> exit silently (unrestricted)
3. Reads hook input from stdin (JSON with `toolName` and `input` fields)
4. If `toolName` is not a file-mutation tool -> exit silently (allow)
5. Extracts file path from tool input args
6. Finds the agent's in-progress task file: scans `tasks/*.md` for `assigned_to: {agentId}` and `status: in_progress`
7. Reads `scope` field from task frontmatter (array of file paths/globs)
8. If file path matches any scope entry -> exit silently (allow)
9. If outside scope -> prints `{"permissionDecision": "deny", "permissionDecisionReason": "File outside task scope: {path}"}`

### Runtime Tool Mapping (Hardcoded)

```
Copilot CLI: editFile, writeFile, insertContent, replaceContent -> args.path || args.filePath
Claude Code: Edit, Write, NotebookEdit -> args.file_path
```

Additional runtimes will be added in Phase 4 when their adapters ship. This avoids premature config file abstraction for 2 known runtimes.

### Scope Matching

Supports two patterns:
- **Exact path match**: `src/payments/route.ts` matches only that file
- **Glob prefix with `**`**: `src/payments/**` matches any file under `src/payments/`

Uses string comparison and `startsWith` — no external glob library needed for these two patterns.

### Edge Cases

- No task file found for agent (hasn't claimed yet): allow all operations
- No `scope` field in task frontmatter: allow all operations
- Empty scope array: deny all file mutations (task has no file scope defined)
- Hook is a guard rail, not a security boundary

### No Dependencies

Uses simple regex/line-by-line frontmatter parsing. No `yaml` package. Consistent with other hooks.

### Testing

- Tests with mock stdin providing tool name + args
- Tests for each runtime's tool names
- Tests for scope matching (exact, glob, outside scope)
- Tests for captain session bypass (no env vars)
- Tests for missing task file / missing scope field

---

## Slice 3: Inbox Messaging Protocol

### File

`src/protocol/inbox.ts` (new)

### Functions

```typescript
function writeMessage(
  missionPath: string,
  to: string,
  from: string,
  body: string,
  priority?: boolean
): string  // returns filename

function readMessages(
  missionPath: string,
  agentId: string
): Message[]  // sorted by timestamp ascending

function markRead(
  missionPath: string,
  agentId: string,
  filename: string
): void  // moves to _read/ dir

function writeBroadcast(
  missionPath: string,
  from: string,
  body: string
): string  // returns filename

function readBroadcasts(
  missionPath: string,
  agentId: string
): Message[]  // returns unread broadcasts, updates cursor

interface Message {
  filename: string;
  from: string;
  priority: boolean;
  timestamp: number;
  body: string;
}
```

### File Format

`inbox/{to}/{timestamp}-{from}.md`:

```markdown
---
from: arm-1
priority: false
timestamp: 1741000001
---

Should the auth middleware use JWT or session tokens?
```

### Timestamp

Unix epoch milliseconds (`Date.now()`). Used as filename prefix for natural sort ordering. Ensures unique filenames when combined with sender ID.

### Read Convention

`markRead()` moves the file to `inbox/{agentId}/_read/`. Creates the `_read/` directory if it doesn't exist. Unread count = file count in directory excluding `_read/` dir and `_broadcast_cursor` file.

### Broadcast Convention

`writeBroadcast()` writes to `inbox/_broadcast/{timestamp}-{from}.md`.

`readBroadcasts()`:
1. Reads `inbox/{agentId}/_broadcast_cursor` (single-line text file, Unix timestamp; default 0 if absent)
2. Lists `inbox/_broadcast/` files with timestamp prefix > cursor
3. Parses and returns messages
4. Writes new cursor = max timestamp of processed messages

### Integration with reject_task

The `reject_task` MCP tool handler calls `writeMessage()` after the SQLite transaction succeeds, sending feedback to the assigned arm's inbox. This is the only MCP tool that writes a message — all other messaging is direct filesystem writes by agents.

### Testing

- Unit tests for write/read/markRead cycle
- Unit tests for broadcast write/read/cursor tracking
- Test that readMessages excludes `_read/` and `_broadcast_cursor`
- Test sort order by timestamp
- Integration test: reject_task sends message to arm inbox

---

## Slice 4: Checkpoint Hook (sessionEnd) — Crash Recovery

### File

`src/hooks/checkpoint.ts`

### Trigger

`sessionEnd` event — fires when an agent session ends (normal exit, crash, or timeout).

### Behavior

1. Reads `MYCELIUM_AGENT_ID` and `MYCELIUM_MISSION_ID` env vars
2. If no env vars -> captain session -> exit silently
3. Finds the agent's in-progress task file (scans `tasks/*.md` for `assigned_to: {agentId}` and `status: in_progress`)
4. If no in-progress task found -> exit silently (agent may have completed)
5. Writes/overwrites the `## Checkpoint` section at the bottom of the task file
6. Appends final timestamped entry to `progress/{agentId}.md`
7. If `knowledge/{agentId}.md` doesn't exist and agent has knowledge to flush, creates it

### Checkpoint Content

```markdown
## Checkpoint
<!-- written by sessionEnd hook -->
- **Timestamp:** 1741000500
- **Status:** session ended
```

The checkpoint is intentionally minimal — just a timestamp and marker. The task file's existing Output section (partially filled by the arm during work) provides the actual context for recovery.

### Checkpoint Write Strategy

The hook reads the task file, finds the `## Checkpoint` marker, and replaces everything from that marker to EOF. If no marker exists, appends the section. This ensures repeated crashes don't accumulate stale checkpoints.

### Recovery Flow

When the captain re-spawns an arm for the same task:
1. `context-loader` (sessionStart) detects the Checkpoint section in the task file
2. Includes it in the arm's startup context
3. The arm's agent prompt (teammate.agent.md) instructs: "If you see a Checkpoint section, resume from there"

### What It Does NOT Do

- Does not change task status — task stays `in_progress` in both SQLite and filesystem
- Does not re-assign the task — captain handles re-spawn decisions
- Does not write knowledge files proactively — only if the arm has accumulated knowledge (Phase 4 expands this)

### Testing

- Test checkpoint written to correct location in task file
- Test checkpoint overwrites previous checkpoint (no accumulation)
- Test no-op when no env vars (captain session)
- Test no-op when no in-progress task
- Test progress file gets final entry

---

## Slice 5: Passive Monitor Hook (postToolUse)

### File

`src/hooks/passive-monitor.ts` (replaces `src/hooks/nudge-messages.ts`)

### Trigger

`postToolUse` — fires after every tool call.

### Two Modes

**Captain session** (no `MYCELIUM_AGENT_ID` env var):

Scans all active missions under `~/.mycelium/missions/` and surfaces actionable signals:

| Signal | Detection | Output |
|--------|-----------|--------|
| Stale arm | `progress/{agentId}.md` mtime > 5 min | `arm-3 stale (7m)` |
| Task needs review | `tasks/*.md` with `status: needs_review` | `task 2 needs review` |
| All tasks complete | Every `tasks/*.md` has `status: completed` | `all tasks complete` |

Output format: `[mycelium] mission-001: arm-3 stale (7m) | task 2 needs review`

Multiple signals per mission are joined with ` | `. Multiple missions each get their own line.

**Arm session** (`MYCELIUM_AGENT_ID` set):

| Signal | Detection | Output |
|--------|-----------|--------|
| Priority message | Unread file in inbox with `priority: true` in frontmatter | `PRIORITY message from lead in inbox` |
| Unread messages | File count in `inbox/{agentId}/` excluding `_read/` and `_broadcast_cursor` | `2 unread message(s) in inbox` |

Priority messages get a stronger signal prefix: `[mycelium] PRIORITY message from lead in inbox`

**Silent when nothing needs attention.** No output = no distraction.

### Performance

The hook runs after every tool call, so speed is critical:
- Captain mode: `fs.statSync` on progress files (no reads), `fs.readdirSync` on inbox dirs (no reads), regex on task file frontmatter (small reads). Target: <100ms.
- Arm mode: `fs.readdirSync` + selective `fs.readFileSync` only for priority check on unread files. Target: <50ms.

### Deletion

`src/hooks/nudge-messages.ts` is deleted. This hook is a strict superset.

### Testing

- Captain mode: test stale arm detection (mock mtime), needs_review detection, all-complete detection
- Arm mode: test unread count, priority message detection
- Test silent output when nothing needs attention
- Test multi-mission output formatting

---

## Slice 6: Arm Cleanup Hook (agentStop / subagentStop)

### File

`src/hooks/arm-cleanup.ts`

### Triggers

Both `agentStop` and `subagentStop` events — covers arms spawned as tmux panes or as subagents.

### Behavior

1. Reads `MYCELIUM_AGENT_ID` and `MYCELIUM_MISSION_ID` env vars
2. If no env vars -> not an arm -> exit silently
3. Updates `members/{agentId}.md`: sets `status: finished` in frontmatter
4. Appends `session_end` entry to `audit.jsonl`
5. Scans all `tasks/*.md` frontmatter for status
6. If every task has `status: completed` -> writes message to lead's inbox: "All tasks complete for mission {missionId}"

### Relationship to Checkpoint Hook

| Hook | Event | Concern |
|------|-------|---------|
| `checkpoint.ts` | `sessionEnd` | Task-level: checkpoint in task file, progress update |
| `arm-cleanup.ts` | `agentStop` / `subagentStop` | Member-level: member status, audit, completion check |

They are complementary — different events, different concerns. Both fire on session end but handle orthogonal state.

### Member File Update

Uses simple regex replace on the `status: active` line in frontmatter -> `status: finished`. No `yaml` dependency.

### All-Tasks-Complete Check

Reads each `tasks/*.md`, extracts `status:` via regex from frontmatter. If every task has `status: completed`, triggers inbox notification to lead. This is best-effort — the captain verifies independently via the passive monitor hook.

### Testing

- Test member file status updated to finished
- Test audit entry appended
- Test all-tasks-complete notification sent to lead inbox
- Test no-op when not an arm session
- Test partial completion (some tasks not done) — no notification

---

## Slice 7: Skill + Agent Prompt Updates + Hook Registration

### team-coordinate Skill

**File:** `skills/team-coordinate/SKILL.md`

Teaches agents the filesystem protocol. Loaded for all arm sessions. Content:

- **Discovering tasks:** Read `tasks/*.md` files in your mission directory
- **Sending messages:** Write `inbox/{recipient}/{timestamp}-{agentId}.md` with frontmatter
- **Reading messages:** List `inbox/{agentId}/`, read files, move to `_read/`
- **Updating progress:** Append timestamped lines to `progress/{agentId}.md`
- **Writing knowledge:** Append to `knowledge/{agentId}.md` — gotchas, tips, decisions
- **Self-unblock:** Write `status: in_progress` to own task file frontmatter
- **Reading other arms' output:** Read completed task files' Output sections for context
- **MCP vs filesystem:** Only `claim_task` and `complete_task` require MCP calls. Everything else is filesystem.
- **Priority messages:** If you see `priority: true` in an inbox message from lead, stop current approach and follow the directive

### Teammate Agent Prompt Update

**File:** `agents/teammate.agent.md`

Changes:
- Remove any references to MCP tools for messaging, monitoring, status queries
- Add filesystem operation guidance (reference team-coordinate skill)
- Add crash recovery: "If your task file has a ## Checkpoint section, resume from where the previous session left off"
- Add priority message handling: "Check your inbox between major steps. Priority messages from lead override your current approach"
- Add knowledge writing: "Write gotchas, tips, and key decisions to your knowledge file as you discover them"

### Hook Registration

**File:** `hooks.json`

```json
{
  "hooks": [
    {
      "event": "sessionStart",
      "command": "node dist/hooks/context-loader.js",
      "timeout": 5000
    },
    {
      "event": "preToolUse",
      "command": "node dist/hooks/scope-enforcer.js",
      "timeout": 3000
    },
    {
      "event": "postToolUse",
      "command": "node dist/hooks/passive-monitor.js",
      "timeout": 3000
    },
    {
      "event": "sessionEnd",
      "command": "node dist/hooks/checkpoint.js",
      "timeout": 5000
    },
    {
      "event": "agentStop",
      "command": "node dist/hooks/arm-cleanup.js",
      "timeout": 5000
    },
    {
      "event": "subagentStop",
      "command": "node dist/hooks/arm-cleanup.js",
      "timeout": 5000
    }
  ]
}
```

### Context-Loader Enhancement

**File:** `src/hooks/context-loader.ts`

Current behavior: lists active missions with ID and goal.

Enhanced behavior for arm sessions (`MYCELIUM_AGENT_ID` + `MYCELIUM_MISSION_ID` set):
- Load full task file content (including prior task outputs referenced in `prior_tasks`)
- Load unread inbox messages
- Load relevant knowledge (own Tier 1 file + mission Tier 2 `_shared.md`)
- Load checkpoint section if present (crash recovery)
- Reference team-coordinate skill

Captain session behavior unchanged (list active missions).

### Deletions

- `src/hooks/nudge-messages.ts` — replaced by `passive-monitor.ts`

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/protocol/mission.ts` | Add `updateTaskFileFrontmatter()`, `findTaskFile()` |
| `src/protocol/audit.ts` | New — `appendAuditEntry()`, `AuditEntry` interface |
| `src/protocol/inbox.ts` | New — `writeMessage()`, `readMessages()`, `markRead()`, `writeBroadcast()`, `readBroadcasts()` |
| `src/mcp-server/server.ts` | Pass `basePath` to `registerTaskTools()` |
| `src/mcp-server/tools/tasks.ts` | Add dual-write + audit logging to all 4 tools |
| `src/mcp-server/tools/team.ts` | Add audit logging to `create_team` |
| `src/hooks/scope-enforcer.ts` | New — preToolUse scope enforcement |
| `src/hooks/passive-monitor.ts` | New — postToolUse monitoring (replaces nudge-messages) |
| `src/hooks/arm-cleanup.ts` | New — agentStop/subagentStop cleanup |
| `src/hooks/checkpoint.ts` | New — sessionEnd crash recovery |
| `src/hooks/context-loader.ts` | Enhanced — richer arm session context |
| `src/hooks/nudge-messages.ts` | Deleted — replaced by passive-monitor |
| `skills/team-coordinate/SKILL.md` | New — filesystem protocol conventions |
| `agents/teammate.agent.md` | Updated — filesystem-first guidance |
| `hooks.json` | Updated — all 6 hooks registered |
| `dist/` | Rebuilt |

## Testing Strategy

All tests follow existing patterns: unit tests adjacent to source in `__tests__/` directories.

**Protocol tests** (`src/protocol/__tests__/`):
- `audit.test.ts`: JSONL format, append semantics
- `inbox.test.ts`: write/read/markRead cycle, broadcasts, cursor tracking
- `mission.test.ts`: extended with `updateTaskFileFrontmatter`, `findTaskFile` tests

**Hook tests** (`src/hooks/__tests__/`):
- `scope-enforcer.test.ts`: mock stdin, all runtime tool names, scope matching, captain bypass
- `passive-monitor.test.ts`: captain mode signals, arm mode inbox, silent when nothing
- `arm-cleanup.test.ts`: member update, audit, all-complete notification
- `checkpoint.test.ts`: checkpoint write/overwrite, no-op cases, progress update

**MCP tool tests** (`src/mcp-server/__tests__/`):
- Extended `tools-tasks.test.ts`: verify filesystem + audit after each tool call
- Extended `tools-team.test.ts`: verify audit entry after create_team

All hook tests use `execSync("npx tsx src/hooks/...")` with `MYCELIUM_BASE_PATH` env override and temp directories, consistent with existing `context-loader.test.ts`.

## What Does NOT Change

- MCP tool set (still 5 tools: create_team, claim_task, complete_task, approve_task, reject_task)
- SQLite schema (missions, tasks, approvals tables)
- Task status state machine
- Lead-only authorization for approve/reject
- Protocol layer fundamentals (frontmatter.ts, dirs.ts)
- Git worktree isolation per arm
- Spawn script mechanism
