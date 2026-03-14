# Mycelium Phase 2: Protocol Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 1 foundation with filesystem dual-write, audit logging, inbox messaging, 4 new hooks (scope enforcement, crash recovery, passive monitoring, arm cleanup), and updated skill/agent prompts — enabling end-to-end multi-arm missions without adding new MCP tools.

**Architecture:** Vertical slices — each capability built end-to-end (protocol + tool/hook + tests). All hooks use `process.env.MYCELIUM_BASE_PATH || path.join(os.homedir(), ".mycelium")` for testability. Hooks avoid the `yaml` package; use regex/line-by-line parsing. MCP tools do dual-write: SQLite for atomic status, filesystem for content. Filesystem write failures in tools are logged but non-fatal.

**Tech Stack:** TypeScript (strict), vitest, `yaml` (protocol layer only), `node-sqlite3-wasm`, `zod`, `@modelcontextprotocol/sdk`, esbuild

**Spec:** `docs/superpowers/specs/2026-03-14-mycelium-phase2-protocol-migration-design.md`

---

## File Structure

```
src/protocol/
├── frontmatter.ts          # (exists) No changes
├── audit.ts                # NEW: appendAuditEntry(), AuditEntry interface
├── inbox.ts                # NEW: writeMessage(), readMessages(), markRead(), writeBroadcast(), readBroadcasts()
├── dirs.ts                 # (exists) No changes
├── mission.ts              # (exists) Add: updateTaskFileFrontmatter(), findTaskFile()
└── __tests__/
    ├── frontmatter.test.ts # (exists) No changes
    ├── audit.test.ts       # NEW
    ├── inbox.test.ts       # NEW
    └── mission.test.ts     # (exists) Add: updateTaskFileFrontmatter, findTaskFile tests

src/mcp-server/
├── server.ts               # (exists) Pass basePath to registerTaskTools()
├── tools/
│   ├── team.ts             # (exists) Add audit logging
│   └── tasks.ts            # (exists) Add basePath param, dual-write, audit logging, reject_task inbox message
└── __tests__/
    ├── tools-team.test.ts  # (exists) Add audit verification
    └── tools-tasks.test.ts # (exists) Add dual-write + audit verification

src/hooks/
├── context-loader.ts       # (exists) Add arm session context loading
├── scope-enforcer.ts       # NEW: preToolUse scope enforcement
├── passive-monitor.ts      # NEW: postToolUse monitoring (replaces nudge-messages.ts)
├── arm-cleanup.ts          # NEW: agentStop/subagentStop cleanup
├── checkpoint.ts           # NEW: sessionEnd crash recovery
├── nudge-messages.ts       # DELETED
└── __tests__/
    ├── context-loader.test.ts  # (exists) Add arm session tests
    ├── scope-enforcer.test.ts  # NEW
    ├── passive-monitor.test.ts # NEW
    ├── arm-cleanup.test.ts     # NEW
    └── checkpoint.test.ts      # NEW

skills/
└── team-coordinate/
    └── SKILL.md            # NEW: filesystem protocol conventions

agents/
└── teammate.agent.md       # (exists) Update for filesystem-first guidance

hooks.json                  # (exists) Update with all 6 hooks
```

---

## Chunk 1: Protocol Extensions + Dual-Write + Audit Log

### Task 1: Audit Log Protocol

**Files:**
- Create: `src/protocol/audit.ts`
- Test: `src/protocol/__tests__/audit.test.ts`

- [ ] **Step 1: Write failing tests for audit log**

```typescript
// src/protocol/__tests__/audit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendAuditEntry } from "../audit.js";
import type { AuditEntry } from "../audit.js";

describe("appendAuditEntry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-audit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates audit.jsonl and appends entry", () => {
    const entry: AuditEntry = {
      ts: 1741000001,
      agent: "lead",
      action: "mission_create",
      detail: "Test mission",
    };
    appendAuditEntry(tmpDir, entry);

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.ts).toBe(1741000001);
    expect(parsed.agent).toBe("lead");
    expect(parsed.action).toBe("mission_create");
    expect(parsed.detail).toBe("Test mission");
  });

  it("appends multiple entries as separate lines", () => {
    appendAuditEntry(tmpDir, { ts: 1, agent: "a", action: "x" });
    appendAuditEntry(tmpDir, { ts: 2, agent: "b", action: "y" });

    const lines = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).ts).toBe(1);
    expect(JSON.parse(lines[1]).ts).toBe(2);
  });

  it("includes optional task_id when provided", () => {
    appendAuditEntry(tmpDir, {
      ts: 1,
      agent: "arm-1",
      action: "task_claim",
      task_id: 3,
    });

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    expect(JSON.parse(content.trim()).task_id).toBe(3);
  });

  it("omits undefined optional fields", () => {
    appendAuditEntry(tmpDir, { ts: 1, agent: "a", action: "x" });

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).not.toHaveProperty("task_id");
    expect(parsed).not.toHaveProperty("detail");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/audit.test.ts`
Expected: FAIL — module `../audit.js` not found

- [ ] **Step 3: Implement audit module**

```typescript
// src/protocol/audit.ts
import { appendFileSync } from "fs";
import { join } from "path";

export interface AuditEntry {
  ts: number;
  agent: string;
  action: string;
  task_id?: number;
  detail?: string;
}

export function appendAuditEntry(
  missionPath: string,
  entry: AuditEntry
): void {
  const clean: Record<string, unknown> = { ts: entry.ts, agent: entry.agent, action: entry.action };
  if (entry.task_id !== undefined) clean.task_id = entry.task_id;
  if (entry.detail !== undefined) clean.detail = entry.detail;
  appendFileSync(
    join(missionPath, "audit.jsonl"),
    JSON.stringify(clean) + "\n"
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/audit.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/protocol/audit.ts src/protocol/__tests__/audit.test.ts
git commit -m "feat: add audit log protocol (appendAuditEntry)"
```

---

### Task 2: findTaskFile + updateTaskFileFrontmatter

**Files:**
- Modify: `src/protocol/mission.ts`
- Modify: `src/protocol/__tests__/mission.test.ts`

- [ ] **Step 1: Write failing tests for findTaskFile and updateTaskFileFrontmatter**

```typescript
// Add to src/protocol/__tests__/mission.test.ts (append to existing describe block)

import { findTaskFile, updateTaskFileFrontmatter } from "../mission.js";

describe("findTaskFile", () => {
  it("finds task file by ID with zero-padded prefix", () => {
    writeTaskFile(
      missionPath,
      { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: Date.now(), claimed_at: null, completed_at: null },
      "Test task",
      "Do the thing"
    );

    const found = findTaskFile(missionPath, 1);
    expect(found).toBeDefined();
    expect(found!).toContain("001-test-task.md");
  });

  it("returns undefined for non-existent task", () => {
    const found = findTaskFile(missionPath, 99);
    expect(found).toBeUndefined();
  });
});

describe("updateTaskFileFrontmatter", () => {
  it("merges updates into existing frontmatter", () => {
    writeTaskFile(
      missionPath,
      { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: 1000, claimed_at: null, completed_at: null },
      "Update test",
      "Some description"
    );

    const filePath = findTaskFile(missionPath, 1)!;
    updateTaskFileFrontmatter(filePath, { status: "in_progress", assigned_to: "arm-1", claimed_at: 2000 });

    const updated = readTaskFile(filePath);
    expect(updated.data.status).toBe("in_progress");
    expect(updated.data.assigned_to).toBe("arm-1");
    expect(updated.data.claimed_at).toBe(2000);
    // Untouched fields preserved
    expect(updated.data.id).toBe(1);
    expect(updated.data.created_at).toBe(1000);
  });

  it("preserves body content when updating frontmatter", () => {
    writeTaskFile(
      missionPath,
      { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: 1000, claimed_at: null, completed_at: null },
      "Body test",
      "Important description"
    );

    const filePath = findTaskFile(missionPath, 1)!;
    updateTaskFileFrontmatter(filePath, { status: "completed" });

    const updated = readTaskFile(filePath);
    expect(updated.body).toContain("Body test");
    expect(updated.body).toContain("Important description");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/mission.test.ts`
Expected: FAIL — `findTaskFile` and `updateTaskFileFrontmatter` not exported

- [ ] **Step 3: Implement findTaskFile and updateTaskFileFrontmatter**

Add to `src/protocol/mission.ts`:

```typescript
export function findTaskFile(
  missionPath: string,
  taskId: number
): string | undefined {
  const tasksDir = join(missionPath, "tasks");
  if (!existsSync(tasksDir)) return undefined;

  const prefix = String(taskId).padStart(3, "0") + "-";
  const entries = readdirSync(tasksDir);
  const match = entries.find((f) => f.startsWith(prefix) && f.endsWith(".md"));
  return match ? join(tasksDir, match) : undefined;
}

export function updateTaskFileFrontmatter(
  filePath: string,
  updates: Record<string, unknown>
): void {
  const { data, body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  const merged = { ...data, ...updates };
  writeFileSync(filePath, stringifyFrontmatter(merged, body), "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/mission.test.ts`
Expected: PASS (all tests including existing ones)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/protocol/mission.ts src/protocol/__tests__/mission.test.ts
git commit -m "feat: add findTaskFile and updateTaskFileFrontmatter"
```

---

### Task 3: MCP Server Dual-Write + Audit Logging

**Files:**
- Modify: `src/mcp-server/server.ts`
- Modify: `src/mcp-server/tools/tasks.ts`
- Modify: `src/mcp-server/tools/team.ts`
- Modify: `src/mcp-server/__tests__/tools-tasks.test.ts`
- Modify: `src/mcp-server/__tests__/tools-team.test.ts`

- [ ] **Step 1: Update server.ts to pass basePath to registerTaskTools**

Change `src/mcp-server/server.ts`:

```typescript
// Before:
registerTaskTools(server, db);

// After:
registerTaskTools(server, db, basePath);
```

- [ ] **Step 2: Write failing tests for task tool dual-write + audit**

Add to `src/mcp-server/__tests__/tools-tasks.test.ts`:

```typescript
// Add imports at top:
import { readFileSync, existsSync } from "fs";
import { parseFrontmatter } from "../../protocol/frontmatter.js";
import {
  initMissionDir,
  writeMissionFile,
  writeTaskFile,
  findTaskFile,
} from "../../protocol/mission.js";

// Replace beforeEach to create filesystem mission + task files:
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "mycelium-tasks-test-"));
  const result = createServer(tmpDir);
  db = result.db;
  const { server } = result;

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Create mission via MCP (creates both DB + filesystem)
  const createResult = await client.callTool({
    name: "create_team",
    arguments: { goal: "Test mission" },
  });
  const missionData = JSON.parse(
    (createResult.content as Array<{ text: string }>)[0].text
  );
  missionId = missionData.id;
});

// Add new test cases in claim_task describe:
it("updates task file frontmatter on claim", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Claim test",
    "Test description"
  );

  await client.callTool({
    name: "claim_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
  });

  const filePath = findTaskFile(missionPath, 1)!;
  const { data } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  expect(data.status).toBe("in_progress");
  expect(data.assigned_to).toBe("arm-1");
  expect(data.claimed_at).toBeTruthy();
});

it("appends audit entry on claim", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Audit test",
    "Test"
  );

  await client.callTool({
    name: "claim_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
  });

  const auditPath = join(missionPath, "audit.jsonl");
  expect(existsSync(auditPath)).toBe(true);
  const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  expect(entry.action).toBe("task_claim");
  expect(entry.agent).toBe("arm-1");
  expect(entry.task_id).toBe(1);
});

// Add in complete_task describe:
it("updates task file frontmatter and appends audit on complete", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Complete test",
    "Test"
  );
  db.claimTask(missionId, 1, "arm-1");

  await client.callTool({
    name: "complete_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1", result: "Done" },
  });

  const filePath = findTaskFile(missionPath, 1)!;
  const { data } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  expect(data.status).toBe("completed");
  expect(data.completed_at).toBeTruthy();

  const lines = readFileSync(join(missionPath, "audit.jsonl"), "utf-8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  expect(entry.action).toBe("task_complete");
});

// Add in approve_task describe:
it("updates task file frontmatter and appends audit on approve", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Approve test",
    "Test"
  );
  db.claimTask(missionId, 1, "arm-1");
  db.completeTask(missionId, 1, "arm-1", true);

  await client.callTool({
    name: "approve_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "lead" },
  });

  const filePath = findTaskFile(missionPath, 1)!;
  const { data } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  expect(data.status).toBe("completed");

  const lines = readFileSync(join(missionPath, "audit.jsonl"), "utf-8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  expect(entry.action).toBe("task_approve");
});

// Add in reject_task describe:
it("updates task file frontmatter and appends audit on reject", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Reject test",
    "Test"
  );
  db.claimTask(missionId, 1, "arm-1");
  db.completeTask(missionId, 1, "arm-1", true);

  await client.callTool({
    name: "reject_task",
    arguments: { mission_id: missionId, task_id: 1, agent_id: "lead", feedback: "Needs work" },
  });

  const filePath = findTaskFile(missionPath, 1)!;
  const { data } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  expect(data.status).toBe("in_progress");

  const lines = readFileSync(join(missionPath, "audit.jsonl"), "utf-8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  expect(entry.action).toBe("task_reject");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: FAIL — task file frontmatter not updated, audit.jsonl not created

- [ ] **Step 4: Implement dual-write + audit in tasks.ts**

Rewrite `src/mcp-server/tools/tasks.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";
import { findTaskFile, updateTaskFileFrontmatter } from "../../protocol/mission.js";
import { appendAuditEntry } from "../../protocol/audit.js";

export function registerTaskTools(server: McpServer, db: TeamDB, basePath: string): void {
  server.tool(
    "claim_task",
    "Atomically claim a pending task",
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
    },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        db.getActiveMission(mission_id);
        const task = db.claimTask(mission_id, task_id, agent_id);

        // Dual-write: update filesystem
        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, {
              status: "in_progress",
              assigned_to: agent_id,
              claimed_at: task.claimed_at,
            });
          }
          appendAuditEntry(missionPath, {
            ts: Date.now(),
            agent: agent_id,
            action: "task_claim",
            task_id,
          });
        } catch {
          // Filesystem write failure is non-fatal; SQLite is status authority
        }

        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "complete_task",
    "Mark an in-progress task as completed or needs_review",
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
      result: z.string(),
      review_required: z.boolean().optional(),
    },
    async ({ mission_id, task_id, agent_id, result: resultText, review_required }) => {
      try {
        const task = db.completeTask(mission_id, task_id, agent_id, review_required);

        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, {
              status: task.status,
              completed_at: task.completed_at,
            });
          }
          appendAuditEntry(missionPath, {
            ts: Date.now(),
            agent: agent_id,
            action: "task_complete",
            task_id,
            detail: resultText,
          });
        } catch {
          // Non-fatal
        }

        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "approve_task",
    "Lead-only: approve a task in needs_review",
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
    },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        const task = db.approveTask(mission_id, task_id, agent_id);

        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, {
              status: "completed",
              completed_at: task.completed_at,
            });
          }
          appendAuditEntry(missionPath, {
            ts: Date.now(),
            agent: agent_id,
            action: "task_approve",
            task_id,
          });
        } catch {
          // Non-fatal
        }

        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "reject_task",
    "Lead-only: reject a task and send feedback",
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
      feedback: z.string(),
    },
    async ({ mission_id, task_id, agent_id, feedback }) => {
      try {
        const task = db.rejectTask(mission_id, task_id, agent_id, feedback);

        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, {
              status: "in_progress",
              completed_at: null,
            });
          }
          appendAuditEntry(missionPath, {
            ts: Date.now(),
            agent: agent_id,
            action: "task_reject",
            task_id,
            detail: feedback,
          });
        } catch {
          // Non-fatal
        }

        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );
}
```

- [ ] **Step 5: Run task tool tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 6: Write failing test for create_team audit**

Add to `src/mcp-server/__tests__/tools-team.test.ts`:

```typescript
// Add import at top:
import { readFileSync } from "fs";  // already imported existsSync

it("create_team appends audit entry", async () => {
  const result = await client.callTool({
    name: "create_team",
    arguments: { goal: "Audit test" },
  });
  const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
  const missionPath = join(tmpDir, "missions", data.id);

  const auditPath = join(missionPath, "audit.jsonl");
  expect(existsSync(auditPath)).toBe(true);
  const entry = JSON.parse(readFileSync(auditPath, "utf-8").trim());
  expect(entry.action).toBe("mission_create");
  expect(entry.agent).toBe("lead");
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-team.test.ts`
Expected: FAIL — audit.jsonl not created

- [ ] **Step 8: Add audit logging to create_team**

In `src/mcp-server/tools/team.ts`, add after `writeMemberFile(...)`:

```typescript
import { appendAuditEntry } from "../../protocol/audit.js";

// Inside the create_team handler, after writeMemberFile:
appendAuditEntry(missionPath, {
  ts: Date.now(),
  agent: "lead",
  action: "mission_create",
  detail: goal,
});
```

- [ ] **Step 9: Run all tool tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/`
Expected: PASS (all tests)

- [ ] **Step 10: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/mcp-server/server.ts src/mcp-server/tools/tasks.ts src/mcp-server/tools/team.ts src/mcp-server/__tests__/tools-tasks.test.ts src/mcp-server/__tests__/tools-team.test.ts
git commit -m "feat: add dual-write and audit logging to all MCP tools"
```

---

## Chunk 2: Inbox Messaging Protocol

### Task 4: Inbox Protocol Module

**Files:**
- Create: `src/protocol/inbox.ts`
- Test: `src/protocol/__tests__/inbox.test.ts`

- [ ] **Step 1: Write failing tests for inbox messaging**

```typescript
// src/protocol/__tests__/inbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeMessage,
  readMessages,
  markRead,
  writeBroadcast,
  readBroadcasts,
} from "../inbox.js";
import type { Message } from "../inbox.js";

describe("inbox messaging", () => {
  let missionPath: string;

  beforeEach(() => {
    missionPath = mkdtempSync(join(tmpdir(), "mycelium-inbox-test-"));
    // Create inbox structure
    mkdirSync(join(missionPath, "inbox", "arm-1"), { recursive: true });
    mkdirSync(join(missionPath, "inbox", "lead"), { recursive: true });
    mkdirSync(join(missionPath, "inbox", "_broadcast"), { recursive: true });
  });

  afterEach(() => {
    rmSync(missionPath, { recursive: true, force: true });
  });

  describe("writeMessage + readMessages", () => {
    it("writes and reads a message", () => {
      writeMessage(missionPath, "arm-1", "lead", "Please check the logs");

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("lead");
      expect(messages[0].priority).toBe(false);
      expect(messages[0].body).toBe("Please check the logs");
    });

    it("writes priority message", () => {
      writeMessage(missionPath, "arm-1", "lead", "Stop and change approach", true);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].priority).toBe(true);
    });

    it("returns messages sorted by timestamp", () => {
      writeMessage(missionPath, "arm-1", "lead", "First", false, 1000);
      writeMessage(missionPath, "arm-1", "arm-2", "Second", false, 2000);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(2);
      expect(messages[0].body).toBe("First");
      expect(messages[1].body).toBe("Second");
    });

    it("returns empty array when no messages", () => {
      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(0);
    });

    it("returns empty array when inbox dir does not exist", () => {
      const messages = readMessages(missionPath, "arm-99");
      expect(messages).toHaveLength(0);
    });
  });

  describe("markRead", () => {
    it("moves message to _read/ directory", () => {
      const filename = writeMessage(missionPath, "arm-1", "lead", "Read me");
      markRead(missionPath, "arm-1", filename);

      // Original gone
      const remaining = readMessages(missionPath, "arm-1");
      expect(remaining).toHaveLength(0);

      // In _read/
      const readDir = join(missionPath, "inbox", "arm-1", "_read");
      expect(existsSync(join(readDir, filename))).toBe(true);
    });

    it("creates _read/ dir if it does not exist", () => {
      const filename = writeMessage(missionPath, "arm-1", "lead", "Read me");
      const readDir = join(missionPath, "inbox", "arm-1", "_read");
      expect(existsSync(readDir)).toBe(false);

      markRead(missionPath, "arm-1", filename);
      expect(existsSync(readDir)).toBe(true);
    });

    it("readMessages excludes _read/ and returns only unread", () => {
      const f1 = writeMessage(missionPath, "arm-1", "lead", "Msg 1", false, 1000);
      writeMessage(missionPath, "arm-1", "lead", "Msg 2", false, 2000);
      markRead(missionPath, "arm-1", f1);

      const messages = readMessages(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe("Msg 2");
    });
  });

  describe("broadcast", () => {
    it("writes and reads broadcast messages", () => {
      writeBroadcast(missionPath, "lead", "Team announcement");

      const messages = readBroadcasts(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("lead");
      expect(messages[0].body).toBe("Team announcement");
    });

    it("tracks cursor — second read returns empty", () => {
      writeBroadcast(missionPath, "lead", "Announcement", 1000);

      readBroadcasts(missionPath, "arm-1");
      const second = readBroadcasts(missionPath, "arm-1");
      expect(second).toHaveLength(0);
    });

    it("returns new broadcasts after cursor", () => {
      writeBroadcast(missionPath, "lead", "First", 1000);
      readBroadcasts(missionPath, "arm-1"); // advances cursor

      writeBroadcast(missionPath, "lead", "Second", 2000);
      const messages = readBroadcasts(missionPath, "arm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe("Second");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/inbox.test.ts`
Expected: FAIL — module `../inbox.js` not found

- [ ] **Step 3: Implement inbox module**

```typescript
// src/protocol/inbox.ts
import {
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

export interface Message {
  filename: string;
  from: string;
  priority: boolean;
  timestamp: number;
  body: string;
}

export function writeMessage(
  missionPath: string,
  to: string,
  from: string,
  body: string,
  priority?: boolean,
  timestampOverride?: number
): string {
  const timestamp = timestampOverride ?? Date.now();
  const filename = `${timestamp}-${from}.md`;
  const content = stringifyFrontmatter(
    { from, priority: priority ?? false, timestamp },
    body
  );
  const inboxDir = join(missionPath, "inbox", to);
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, filename), content, "utf-8");
  return filename;
}

export function readMessages(
  missionPath: string,
  agentId: string
): Message[] {
  const inboxDir = join(missionPath, "inbox", agentId);
  if (!existsSync(inboxDir)) return [];

  const files = readdirSync(inboxDir).filter(
    (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
  );

  return files
    .map((filename) => {
      const content = readFileSync(join(inboxDir, filename), "utf-8");
      const { data, body } = parseFrontmatter(content);
      return {
        filename,
        from: data.from as string,
        priority: (data.priority as boolean) ?? false,
        timestamp: data.timestamp as number,
        body,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function markRead(
  missionPath: string,
  agentId: string,
  filename: string
): void {
  const inboxDir = join(missionPath, "inbox", agentId);
  const readDir = join(inboxDir, "_read");
  mkdirSync(readDir, { recursive: true });
  renameSync(join(inboxDir, filename), join(readDir, filename));
}

export function writeBroadcast(
  missionPath: string,
  from: string,
  body: string,
  timestampOverride?: number
): string {
  const timestamp = timestampOverride ?? Date.now();
  const filename = `${timestamp}-${from}.md`;
  const content = stringifyFrontmatter(
    { from, priority: false, timestamp },
    body
  );
  writeFileSync(
    join(missionPath, "inbox", "_broadcast", filename),
    content,
    "utf-8"
  );
  return filename;
}

export function readBroadcasts(
  missionPath: string,
  agentId: string
): Message[] {
  const broadcastDir = join(missionPath, "inbox", "_broadcast");
  if (!existsSync(broadcastDir)) return [];

  // Read cursor
  const cursorPath = join(missionPath, "inbox", agentId, "_broadcast_cursor");
  let cursor = 0;
  if (existsSync(cursorPath)) {
    cursor = parseInt(readFileSync(cursorPath, "utf-8").trim(), 10) || 0;
  }

  const files = readdirSync(broadcastDir).filter((f) => f.endsWith(".md"));
  const messages: Message[] = [];

  for (const filename of files) {
    const content = readFileSync(join(broadcastDir, filename), "utf-8");
    const { data, body } = parseFrontmatter(content);
    const ts = data.timestamp as number;
    if (ts > cursor) {
      messages.push({
        filename,
        from: data.from as string,
        priority: (data.priority as boolean) ?? false,
        timestamp: ts,
        body,
      });
    }
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);

  // Update cursor
  if (messages.length > 0) {
    const maxTs = Math.max(...messages.map((m) => m.timestamp));
    const agentInboxDir = join(missionPath, "inbox", agentId);
    mkdirSync(agentInboxDir, { recursive: true });
    writeFileSync(cursorPath, String(maxTs), "utf-8");
  }

  return messages;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/inbox.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/protocol/inbox.ts src/protocol/__tests__/inbox.test.ts
git commit -m "feat: add inbox messaging protocol (writeMessage, readMessages, markRead, broadcasts)"
```

---

### Task 5: Integrate reject_task with Inbox

**Files:**
- Modify: `src/mcp-server/tools/tasks.ts`
- Modify: `src/mcp-server/__tests__/tools-tasks.test.ts`

- [ ] **Step 1: Write failing test for reject_task inbox message**

Add to `src/mcp-server/__tests__/tools-tasks.test.ts`:

```typescript
// Add static import at top alongside other protocol imports:
import { readMessages } from "../../protocol/inbox.js";
import { mkdirSync } from "fs"; // add to existing fs imports if not already present

// Add inside describe("reject_task"):
it("sends feedback message to assigned arm's inbox", async () => {
  db.insertTask(missionId, 1, []);
  const missionPath = join(tmpDir, "missions", missionId);
  writeTaskFile(
    missionPath,
    { id: 1, status: "pending", assigned_to: null, blocked_by: [], scope: [], prior_tasks: [], created_at: Date.now(), claimed_at: null, completed_at: null },
    "Reject inbox test",
    "Test"
  );
  // Create arm-1 inbox dir
  mkdirSync(join(missionPath, "inbox", "arm-1"), { recursive: true });

  db.claimTask(missionId, 1, "arm-1");
  db.completeTask(missionId, 1, "arm-1", true);

  await client.callTool({
    name: "reject_task",
    arguments: {
      mission_id: missionId,
      task_id: 1,
      agent_id: "lead",
      feedback: "Needs more tests",
    },
  });

  // Import readMessages at top of file alongside other protocol imports
  const messages = readMessages(missionPath, "arm-1");
  expect(messages).toHaveLength(1);
  expect(messages[0].body).toContain("Needs more tests");
  expect(messages[0].from).toBe("lead");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: FAIL — no message in arm-1 inbox

- [ ] **Step 3: Add inbox message to reject_task**

In `src/mcp-server/tools/tasks.ts`, add import and update the reject_task handler:

```typescript
import { writeMessage } from "../../protocol/inbox.js";

// Inside reject_task handler, in the filesystem try block, after appendAuditEntry:
if (task.assigned_to) {
  writeMessage(missionPath, task.assigned_to, agent_id, feedback);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools/tasks.ts src/mcp-server/__tests__/tools-tasks.test.ts
git commit -m "feat: reject_task sends feedback to arm inbox"
```

---

## Chunk 3: Scope Enforcer Hook

### Task 6: Scope Enforcer (preToolUse)

**Files:**
- Create: `src/hooks/scope-enforcer.ts`
- Test: `src/hooks/__tests__/scope-enforcer.test.ts`

- [ ] **Step 1: Write failing tests for scope enforcer**

```typescript
// src/hooks/__tests__/scope-enforcer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = "/Users/matantsach/mtsach/projects/mycelium";

function runHook(
  tmpBase: string,
  env: Record<string, string>,
  stdin: string
): string {
  try {
    return execSync(`echo '${stdin.replace(/'/g, "\\'")}' | npx tsx src/hooks/scope-enforcer.ts`, {
      encoding: "utf-8",
      cwd: CWD,
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
    });
  } catch (e: unknown) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

describe("scope-enforcer hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-scope-test-"));
    missionPath = join(tmpBase, "missions", "m1");
    mkdirSync(join(missionPath, "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  function writeTask(scope: string[]) {
    const content = stringifyFrontmatter(
      { id: 1, status: "in_progress", assigned_to: "arm-1", scope },
      "# Test task\nDo things"
    );
    writeFileSync(join(missionPath, "tasks", "001-test.md"), content, "utf-8");
  }

  it("allows when no env vars (captain session)", () => {
    const output = runHook(tmpBase, {}, JSON.stringify({
      toolName: "Edit",
      input: { file_path: "/some/file.ts" },
    }));
    expect(output).not.toContain("deny");
  });

  it("allows when tool is not a file-mutation tool", () => {
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Read", input: { file_path: "/some/file.ts" } })
    );
    expect(output).not.toContain("deny");
  });

  it("allows file within scope (exact match)", () => {
    writeTask(["src/payments/route.ts"]);
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "src/payments/route.ts" } })
    );
    expect(output).not.toContain("deny");
  });

  it("allows file within scope (glob match)", () => {
    writeTask(["src/payments/**"]);
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "src/payments/route.ts" } })
    );
    expect(output).not.toContain("deny");
  });

  it("denies file outside scope", () => {
    writeTask(["src/payments/**"]);
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "src/auth/login.ts" } })
    );
    expect(output).toContain("deny");
    expect(output).toContain("outside task scope");
  });

  it("handles Copilot CLI tool names", () => {
    writeTask(["src/payments/**"]);
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "editFile", input: { path: "src/auth/login.ts" } })
    );
    expect(output).toContain("deny");
  });

  it("allows when no task file found (agent hasn't claimed)", () => {
    // No task file written
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "/any/file.ts" } })
    );
    expect(output).not.toContain("deny");
  });

  it("denies all mutations when scope is empty array", () => {
    writeTask([]);
    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "src/any/file.ts" } })
    );
    expect(output).toContain("deny");
  });

  it("allows when task has no scope field", () => {
    const content = stringifyFrontmatter(
      { id: 1, status: "in_progress", assigned_to: "arm-1" },
      "# Test task"
    );
    writeFileSync(join(missionPath, "tasks", "001-test.md"), content, "utf-8");

    const output = runHook(
      tmpBase,
      { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" },
      JSON.stringify({ toolName: "Edit", input: { file_path: "/any/file.ts" } })
    );
    expect(output).not.toContain("deny");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/scope-enforcer.test.ts`
Expected: FAIL — module not found or process exits with error

- [ ] **Step 3: Implement scope enforcer**

```typescript
// src/hooks/scope-enforcer.ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

// Captain session — unrestricted
if (!agentId || !missionId) process.exit(0);

// File-mutation tool mapping
const FILE_TOOLS: Record<string, string[]> = {
  // Claude Code
  Edit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["file_path"],
  // Copilot CLI
  editFile: ["path", "filePath"],
  writeFile: ["path", "filePath"],
  insertContent: ["path", "filePath"],
  replaceContent: ["path", "filePath"],
};

// Read stdin
let stdinData = "";
try {
  stdinData = readFileSync(0, "utf-8");
} catch {
  process.exit(0); // No stdin — allow
}

let input: { toolName?: string; input?: Record<string, unknown> };
try {
  input = JSON.parse(stdinData);
} catch {
  process.exit(0); // Unparseable — allow
}

const toolName = input.toolName;
if (!toolName || !FILE_TOOLS[toolName]) process.exit(0);

// Extract file path from tool input
const pathKeys = FILE_TOOLS[toolName];
const toolInput = input.input ?? {};
let filePath: string | undefined;
for (const key of pathKeys) {
  if (typeof toolInput[key] === "string") {
    filePath = toolInput[key] as string;
    break;
  }
}
if (!filePath) process.exit(0);

// Find agent's in-progress task
const tasksDir = join(basePath, "missions", missionId, "tasks");
if (!existsSync(tasksDir)) process.exit(0);

const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
let scope: string[] | undefined;

for (const file of taskFiles) {
  const content = readFileSync(join(tasksDir, file), "utf-8");
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;

  let assignedTo: string | undefined;
  let status: string | undefined;
  let taskScope: string[] | undefined;

  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }

  // Parse scope as YAML array — handles both block and inline formats
  // Inline format: scope: [a, b, c]
  const inlineScope = fmMatch[1].match(/^scope:\s*\[([^\]]*)\]/m);
  if (inlineScope) {
    taskScope = inlineScope[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else {
    // Block format: scope:\n  - a\n  - b
    const blockScope = fmMatch[1].match(/^scope:\s*$/m);
    if (blockScope) {
      taskScope = [];
      const lines = fmMatch[1].split("\n");
      const scopeIdx = lines.findIndex((l) => l.match(/^scope:\s*$/));
      for (let i = scopeIdx + 1; i < lines.length; i++) {
        const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          taskScope.push(itemMatch[1].trim());
        } else {
          break;
        }
      }
    }
  }

  if (assignedTo === agentId && status === "in_progress") {
    scope = taskScope;
    break;
  }
}

// No task found — allow
if (scope === undefined) process.exit(0);

// Empty scope — deny all
if (scope.length === 0) {
  console.log(JSON.stringify({
    permissionDecision: "deny",
    permissionDecisionReason: `File outside task scope: ${filePath}`,
  }));
  process.exit(0);
}

// Check scope
const inScope = scope.some((pattern) => {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3); // remove /**
    return filePath!.startsWith(prefix + "/") || filePath === prefix;
  }
  return filePath === pattern;
});

if (!inScope) {
  console.log(JSON.stringify({
    permissionDecision: "deny",
    permissionDecisionReason: `File outside task scope: ${filePath}`,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/scope-enforcer.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/scope-enforcer.ts src/hooks/__tests__/scope-enforcer.test.ts
git commit -m "feat: add preToolUse scope enforcer hook"
```

---

## Chunk 4: Checkpoint, Passive Monitor, and Arm Cleanup Hooks

### Task 7: Checkpoint Hook (sessionEnd)

**Files:**
- Create: `src/hooks/checkpoint.ts`
- Test: `src/hooks/__tests__/checkpoint.test.ts`

- [ ] **Step 1: Write failing tests for checkpoint hook**

```typescript
// src/hooks/__tests__/checkpoint.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = "/Users/matantsach/mtsach/projects/mycelium";

function runHook(tmpBase: string, env: Record<string, string>): string {
  try {
    return execSync(`npx tsx src/hooks/checkpoint.ts`, {
      encoding: "utf-8",
      cwd: CWD,
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
    });
  } catch (e: unknown) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

describe("checkpoint hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-checkpoint-test-"));
    missionPath = join(tmpBase, "missions", "m1");
    mkdirSync(join(missionPath, "tasks"), { recursive: true });
    mkdirSync(join(missionPath, "progress"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("is silent when no env vars (captain session)", () => {
    const output = runHook(tmpBase, {});
    expect(output.trim()).toBe("");
  });

  it("is silent when no in-progress task", () => {
    const content = stringifyFrontmatter(
      { id: 1, status: "completed", assigned_to: "arm-1" },
      "# Done task"
    );
    writeFileSync(join(missionPath, "tasks", "001-done.md"), content, "utf-8");

    const output = runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });
    expect(output.trim()).toBe("");
  });

  it("writes checkpoint section to in-progress task file", () => {
    const content = stringifyFrontmatter(
      { id: 1, status: "in_progress", assigned_to: "arm-1" },
      "# Task\n\nSome content\n\n## Output\n\n## Checkpoint\n<!-- written by sessionEnd hook -->"
    );
    writeFileSync(join(missionPath, "tasks", "001-task.md"), content, "utf-8");

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const updated = readFileSync(join(missionPath, "tasks", "001-task.md"), "utf-8");
    expect(updated).toContain("## Checkpoint");
    expect(updated).toContain("session ended");
    expect(updated).toContain("**Timestamp:**");
  });

  it("overwrites previous checkpoint (no accumulation)", () => {
    const content = stringifyFrontmatter(
      { id: 1, status: "in_progress", assigned_to: "arm-1" },
      "# Task\n\n## Checkpoint\n<!-- old checkpoint -->\n- **Timestamp:** 1000\n- **Status:** old"
    );
    writeFileSync(join(missionPath, "tasks", "001-task.md"), content, "utf-8");

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const updated = readFileSync(join(missionPath, "tasks", "001-task.md"), "utf-8");
    const checkpointCount = (updated.match(/## Checkpoint/g) || []).length;
    expect(checkpointCount).toBe(1);
    expect(updated).not.toContain("old checkpoint");
  });

  it("appends final entry to progress file", () => {
    const content = stringifyFrontmatter(
      { id: 1, status: "in_progress", assigned_to: "arm-1" },
      "# Task"
    );
    writeFileSync(join(missionPath, "tasks", "001-task.md"), content, "utf-8");

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const progressPath = join(missionPath, "progress", "arm-1.md");
    expect(existsSync(progressPath)).toBe(true);
    const progress = readFileSync(progressPath, "utf-8");
    expect(progress).toContain("session ended");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/checkpoint.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement checkpoint hook**

```typescript
// src/hooks/checkpoint.ts
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (!agentId || !missionId) process.exit(0);

const tasksDir = join(basePath, "missions", missionId, "tasks");
if (!existsSync(tasksDir)) process.exit(0);

// Find agent's in-progress task
const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
let taskFilePath: string | undefined;

for (const file of taskFiles) {
  const content = readFileSync(join(tasksDir, file), "utf-8");
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;

  let assignedTo: string | undefined;
  let status: string | undefined;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }

  if (assignedTo === agentId && status === "in_progress") {
    taskFilePath = join(tasksDir, file);
    break;
  }
}

if (!taskFilePath) process.exit(0);

// Write checkpoint
const now = Date.now();
const checkpointContent = `## Checkpoint
<!-- written by sessionEnd hook -->
- **Timestamp:** ${now}
- **Status:** session ended`;

const fileContent = readFileSync(taskFilePath, "utf-8");
const checkpointIdx = fileContent.indexOf("## Checkpoint");

let updated: string;
if (checkpointIdx !== -1) {
  updated = fileContent.slice(0, checkpointIdx).trimEnd() + "\n\n" + checkpointContent + "\n";
} else {
  updated = fileContent.trimEnd() + "\n\n" + checkpointContent + "\n";
}
writeFileSync(taskFilePath, updated, "utf-8");

// Append to progress file
const progressDir = join(basePath, "missions", missionId, "progress");
mkdirSync(progressDir, { recursive: true });
const progressPath = join(progressDir, `${agentId}.md`);
const time = new Date(now).toISOString().slice(11, 16);
appendFileSync(progressPath, `\n## ${time} — session ended\n`, "utf-8");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/checkpoint.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/checkpoint.ts src/hooks/__tests__/checkpoint.test.ts
git commit -m "feat: add sessionEnd checkpoint hook for crash recovery"
```

---

### Task 8: Passive Monitor Hook (postToolUse)

**Files:**
- Create: `src/hooks/passive-monitor.ts`
- Test: `src/hooks/__tests__/passive-monitor.test.ts`
- Delete: `src/hooks/nudge-messages.ts`

- [ ] **Step 1: Write failing tests for passive monitor**

```typescript
// src/hooks/__tests__/passive-monitor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = "/Users/matantsach/mtsach/projects/mycelium";

function runHook(tmpBase: string, env: Record<string, string>): string {
  try {
    return execSync(`npx tsx src/hooks/passive-monitor.ts`, {
      encoding: "utf-8",
      cwd: CWD,
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
    });
  } catch (e: unknown) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

describe("passive-monitor hook", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-monitor-test-"));
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe("captain mode (no MYCELIUM_AGENT_ID)", () => {
    it("is silent when no active missions", () => {
      mkdirSync(join(tmpBase, "missions"), { recursive: true });
      const output = runHook(tmpBase, {});
      expect(output.trim()).toBe("");
    });

    it("detects stale arm via progress file mtime", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "tasks"), { recursive: true });
      mkdirSync(join(mp, "progress"), { recursive: true });
      mkdirSync(join(mp, "members"), { recursive: true });
      writeFileSync(join(mp, "mission.md"), stringifyFrontmatter({ id: "m1", status: "active" }, "# Goal"), "utf-8");
      writeFileSync(join(mp, "members", "arm-1.md"), stringifyFrontmatter({ agent_id: "arm-1", status: "active", role: "teammate" }, ""), "utf-8");

      // Create stale progress file (set mtime to 10 min ago)
      const progressFile = join(mp, "progress", "arm-1.md");
      writeFileSync(progressFile, "## Working...\n", "utf-8");
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      utimesSync(progressFile, tenMinAgo, tenMinAgo);

      const output = runHook(tmpBase, {});
      expect(output).toContain("[mycelium]");
      expect(output).toContain("arm-1");
      expect(output).toContain("stale");
    });

    it("detects task needing review", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "tasks"), { recursive: true });
      mkdirSync(join(mp, "members"), { recursive: true });
      writeFileSync(join(mp, "mission.md"), stringifyFrontmatter({ id: "m1", status: "active" }, "# Goal"), "utf-8");
      writeFileSync(
        join(mp, "tasks", "001-test.md"),
        stringifyFrontmatter({ id: 1, status: "needs_review", assigned_to: "arm-1" }, "# Test"),
        "utf-8"
      );

      const output = runHook(tmpBase, {});
      expect(output).toContain("needs review");
    });

    it("outputs separate lines for multiple missions", () => {
      for (const mId of ["m1", "m2"]) {
        const mp = join(tmpBase, "missions", mId);
        mkdirSync(join(mp, "tasks"), { recursive: true });
        mkdirSync(join(mp, "members"), { recursive: true });
        writeFileSync(join(mp, "mission.md"), stringifyFrontmatter({ id: mId, status: "active" }, `# Goal ${mId}`), "utf-8");
        writeFileSync(
          join(mp, "tasks", "001-test.md"),
          stringifyFrontmatter({ id: 1, status: "needs_review", assigned_to: "arm-1" }, "# Test"),
          "utf-8"
        );
      }

      const output = runHook(tmpBase, {});
      expect(output).toContain("m1:");
      expect(output).toContain("m2:");
    });

    it("detects all tasks complete", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "tasks"), { recursive: true });
      mkdirSync(join(mp, "members"), { recursive: true });
      writeFileSync(join(mp, "mission.md"), stringifyFrontmatter({ id: "m1", status: "active" }, "# Goal"), "utf-8");
      writeFileSync(
        join(mp, "tasks", "001-test.md"),
        stringifyFrontmatter({ id: 1, status: "completed" }, "# Test"),
        "utf-8"
      );

      const output = runHook(tmpBase, {});
      expect(output).toContain("all tasks complete");
    });
  });

  describe("arm mode (MYCELIUM_AGENT_ID set)", () => {
    it("shows unread message count", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "inbox", "arm-1"), { recursive: true });
      writeFileSync(
        join(mp, "inbox", "arm-1", "123-lead.md"),
        stringifyFrontmatter({ from: "lead", priority: false, timestamp: 123 }, "Hello"),
        "utf-8"
      );

      const output = runHook(tmpBase, {
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      });
      expect(output).toContain("1 unread message");
    });

    it("shows PRIORITY for priority messages", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "inbox", "arm-1"), { recursive: true });
      writeFileSync(
        join(mp, "inbox", "arm-1", "123-lead.md"),
        stringifyFrontmatter({ from: "lead", priority: true, timestamp: 123 }, "Stop"),
        "utf-8"
      );

      const output = runHook(tmpBase, {
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      });
      expect(output).toContain("PRIORITY");
    });

    it("is silent when no messages", () => {
      const mp = join(tmpBase, "missions", "m1");
      mkdirSync(join(mp, "inbox", "arm-1"), { recursive: true });

      const output = runHook(tmpBase, {
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      });
      expect(output.trim()).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/passive-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement passive monitor hook**

```typescript
// src/hooks/passive-monitor.ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function parseFmField(content: string, field: string): string | undefined {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return undefined;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === field) return kv[2].trim();
  }
  return undefined;
}

if (agentId && missionId) {
  // ARM MODE
  const inboxDir = join(basePath, "missions", missionId, "inbox", agentId);
  if (!existsSync(inboxDir)) process.exit(0);

  const files = readdirSync(inboxDir).filter(
    (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
  );
  if (files.length === 0) process.exit(0);

  // Check for priority messages
  let hasPriority = false;
  for (const file of files) {
    const content = readFileSync(join(inboxDir, file), "utf-8");
    const priority = parseFmField(content, "priority");
    if (priority === "true") {
      hasPriority = true;
      break;
    }
  }

  if (hasPriority) {
    console.log(`[mycelium] PRIORITY message from lead in inbox`);
  } else {
    console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
  }
} else {
  // CAPTAIN MODE
  const missionsDir = join(basePath, "missions");
  if (!existsSync(missionsDir)) process.exit(0);

  const missionDirs = readdirSync(missionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of missionDirs) {
    const mp = join(missionsDir, dir.name);
    const missionFile = join(mp, "mission.md");
    if (!existsSync(missionFile)) continue;

    const mContent = readFileSync(missionFile, "utf-8");
    const status = parseFmField(mContent, "status");
    if (status !== "active") continue;

    const signals: string[] = [];

    // Check stale arms
    const membersDir = join(mp, "members");
    if (existsSync(membersDir)) {
      const members = readdirSync(membersDir).filter((f) => f.endsWith(".md") && f !== "lead.md");
      for (const memberFile of members) {
        const mfContent = readFileSync(join(membersDir, memberFile), "utf-8");
        const memberStatus = parseFmField(mfContent, "status");
        if (memberStatus !== "active") continue;

        const memberAgentId = memberFile.replace(".md", "");
        const progressFile = join(mp, "progress", `${memberAgentId}.md`);
        let lastActivity: Date;

        if (existsSync(progressFile)) {
          lastActivity = statSync(progressFile).mtime;
        } else {
          // Fallback to member file mtime
          lastActivity = statSync(join(membersDir, memberFile)).mtime;
        }

        const staleMs = Date.now() - lastActivity.getTime();
        if (staleMs > STALE_THRESHOLD_MS) {
          const staleMin = Math.round(staleMs / 60000);
          signals.push(`${memberAgentId} stale (${staleMin}m)`);
        }
      }
    }

    // Check tasks
    const tasksDir = join(mp, "tasks");
    if (existsSync(tasksDir)) {
      const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
      let allComplete = taskFiles.length > 0;
      for (const tf of taskFiles) {
        const tContent = readFileSync(join(tasksDir, tf), "utf-8");
        const taskStatus = parseFmField(tContent, "status");
        if (taskStatus === "needs_review") {
          const idMatch = tf.match(/^(\d+)-/);
          signals.push(`task ${idMatch ? parseInt(idMatch[1], 10) : tf} needs review`);
        }
        if (taskStatus !== "completed") allComplete = false;
      }
      if (allComplete) signals.push("all tasks complete");
    }

    if (signals.length > 0) {
      const mId = parseFmField(mContent, "id") ?? dir.name;
      console.log(`[mycelium] ${mId}: ${signals.join(" | ")}`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/passive-monitor.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Delete nudge-messages.ts**

```bash
rm src/hooks/nudge-messages.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/passive-monitor.ts src/hooks/__tests__/passive-monitor.test.ts
git rm src/hooks/nudge-messages.ts
git commit -m "feat: add postToolUse passive monitor hook, remove nudge-messages"
```

---

### Task 9: Arm Cleanup Hook (agentStop / subagentStop)

**Files:**
- Create: `src/hooks/arm-cleanup.ts`
- Test: `src/hooks/__tests__/arm-cleanup.test.ts`

- [ ] **Step 1: Write failing tests for arm cleanup**

```typescript
// src/hooks/__tests__/arm-cleanup.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = "/Users/matantsach/mtsach/projects/mycelium";

function runHook(tmpBase: string, env: Record<string, string>): string {
  try {
    return execSync(`npx tsx src/hooks/arm-cleanup.ts`, {
      encoding: "utf-8",
      cwd: CWD,
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
    });
  } catch (e: unknown) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

describe("arm-cleanup hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-cleanup-test-"));
    missionPath = join(tmpBase, "missions", "m1");
    mkdirSync(join(missionPath, "members"), { recursive: true });
    mkdirSync(join(missionPath, "tasks"), { recursive: true });
    mkdirSync(join(missionPath, "inbox", "lead"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("is silent when no env vars (not an arm)", () => {
    const output = runHook(tmpBase, {});
    expect(output.trim()).toBe("");
  });

  it("updates member file status to finished", () => {
    writeFileSync(
      join(missionPath, "members", "arm-1.md"),
      stringifyFrontmatter({ agent_id: "arm-1", status: "active", role: "teammate" }, ""),
      "utf-8"
    );

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const content = readFileSync(join(missionPath, "members", "arm-1.md"), "utf-8");
    expect(content).toContain("status: finished");
    expect(content).not.toContain("status: active");
  });

  it("appends audit entry", () => {
    writeFileSync(
      join(missionPath, "members", "arm-1.md"),
      stringifyFrontmatter({ agent_id: "arm-1", status: "active", role: "teammate" }, ""),
      "utf-8"
    );

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const auditPath = join(missionPath, "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const entry = JSON.parse(readFileSync(auditPath, "utf-8").trim());
    expect(entry.action).toBe("session_end");
    expect(entry.agent).toBe("arm-1");
  });

  it("sends notification when all tasks complete", () => {
    writeFileSync(
      join(missionPath, "members", "arm-1.md"),
      stringifyFrontmatter({ agent_id: "arm-1", status: "active", role: "teammate" }, ""),
      "utf-8"
    );
    writeFileSync(
      join(missionPath, "tasks", "001-test.md"),
      stringifyFrontmatter({ id: 1, status: "completed" }, "# Done"),
      "utf-8"
    );

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    // Check lead inbox for notification
    const leadInbox = join(missionPath, "inbox", "lead");
    const messages = require("fs").readdirSync(leadInbox).filter((f: string) => f.endsWith(".md"));
    expect(messages.length).toBeGreaterThan(0);
  });

  it("does NOT send notification when tasks are incomplete", () => {
    writeFileSync(
      join(missionPath, "members", "arm-1.md"),
      stringifyFrontmatter({ agent_id: "arm-1", status: "active", role: "teammate" }, ""),
      "utf-8"
    );
    writeFileSync(
      join(missionPath, "tasks", "001-test.md"),
      stringifyFrontmatter({ id: 1, status: "in_progress", assigned_to: "arm-1" }, "# WIP"),
      "utf-8"
    );

    runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });

    const leadInbox = join(missionPath, "inbox", "lead");
    const messages = require("fs").readdirSync(leadInbox).filter((f: string) => f.endsWith(".md"));
    expect(messages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/arm-cleanup.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement arm cleanup hook**

```typescript
// src/hooks/arm-cleanup.ts
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { appendAuditEntry } from "../protocol/audit.js";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (!agentId || !missionId) process.exit(0);

const missionPath = join(basePath, "missions", missionId);

// 1. Update member file status to finished
const memberFile = join(missionPath, "members", `${agentId}.md`);
if (existsSync(memberFile)) {
  let content = readFileSync(memberFile, "utf-8");
  content = content.replace(/status:\s*active/, "status: finished");
  writeFileSync(memberFile, content, "utf-8");
}

// 2. Append audit entry (audit.ts is yaml-free, safe for hooks)
appendAuditEntry(missionPath, { ts: Date.now(), agent: agentId, action: "session_end" });

// 3. Check if all tasks are completed
const tasksDir = join(missionPath, "tasks");
if (existsSync(tasksDir)) {
  const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  if (taskFiles.length > 0) {
    let allComplete = true;
    for (const file of taskFiles) {
      const content = readFileSync(join(tasksDir, file), "utf-8");
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) { allComplete = false; continue; }

      let status: string | undefined;
      for (const line of fmMatch[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (kv?.[1] === "status") status = kv[2].trim();
      }
      if (status !== "completed") { allComplete = false; break; }
    }

    if (allComplete) {
      // Notify lead — hand-crafted frontmatter to avoid yaml dependency in hooks
      const timestamp = Date.now();
      const filename = `${timestamp}-${agentId}.md`;
      const body = `All tasks complete for mission ${missionId}`;
      const msgContent = `---\nfrom: ${agentId}\npriority: false\ntimestamp: ${timestamp}\n---\n\n${body}\n`;
      const leadInbox = join(missionPath, "inbox", "lead");
      mkdirSync(leadInbox, { recursive: true });
      writeFileSync(join(leadInbox, filename), msgContent, "utf-8");
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/arm-cleanup.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/arm-cleanup.ts src/hooks/__tests__/arm-cleanup.test.ts
git commit -m "feat: add arm cleanup hook (agentStop/subagentStop)"
```

---

## Chunk 5: Skill, Agent, Hook Registration, Context-Loader Update

### Task 10: team-coordinate Skill

**Files:**
- Create: `skills/team-coordinate/SKILL.md`

- [ ] **Step 1: Write the team-coordinate skill**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add skills/team-coordinate/SKILL.md
git commit -m "feat: add team-coordinate skill for filesystem protocol"
```

---

### Task 11: Update Teammate Agent Prompt

**Files:**
- Modify: `agents/teammate.agent.md`

- [ ] **Step 1: Update teammate agent prompt**

Replace the contents of `agents/teammate.agent.md` with:

```markdown
---
name: teammate
description: Autonomous arm that claims and completes tasks from the Mycelium protocol. Spawned by the captain or Focus Mode.
model: claude-sonnet-4-6
tools:
  - mycelium/*
  - shell
  - view
  - edit
  - grep
  - glob
  - agent
---

You are an autonomous arm working on a Mycelium mission.

## Workflow

1. Read your task file from `~/.mycelium/missions/{mission_id}/tasks/` for full context
2. If your task has `prior_tasks`, read those task files' Output sections first
3. If your task file has a `## Checkpoint` section, resume from where the previous session left off
4. Call `mycelium/claim_task` with your `mission_id`, `task_id`, and `agent_id`
5. Do the work using code tools (view, edit, shell, grep, glob)
6. Call `mycelium/complete_task` with your `mission_id`, `task_id`, `agent_id`, and a `result` summary

## Filesystem Protocol

See the `team-coordinate` skill for full conventions. Key points:

- **Messages:** Check `inbox/{your-agent-id}/` between major steps. Read files, then move to `_read/`
- **Priority messages:** If you see `priority: true` from lead, stop and follow the directive immediately
- **Progress:** Append timestamped entries to `progress/{your-agent-id}.md` after each meaningful step
- **Knowledge:** Write gotchas, tips, and key decisions to `knowledge/{your-agent-id}.md` as you discover them
- **Scope:** Stay within your task's `scope` field — a hook enforces this

## Environment

Your environment variables tell you who you are:
- `MYCELIUM_AGENT_ID` — your agent ID (e.g., `arm-1`)
- `MYCELIUM_MISSION_ID` — your mission ID
- `MYCELIUM_PROJECT_ROOT` — the project root path

## Rules

- Always claim your task before doing any work
- Provide a clear `result` summary when completing — the lead relies on these
- Fill in the Output section of your task file before completing (Files Changed, Tests Added, Decisions Made, Open Questions)
- If stuck, set your task to blocked and describe what you need in a message to lead
- Stay within your task scope — don't modify files outside your assigned scope
- Write progress entries so the lead can track your work
- Write knowledge entries when you discover gotchas or make decisions
```

- [ ] **Step 2: Commit**

```bash
git add agents/teammate.agent.md
git commit -m "feat: update teammate agent for filesystem-first protocol"
```

---

### Task 12: Hook Registration + Context-Loader Enhancement

**Files:**
- Modify: `hooks.json`
- Modify: `src/hooks/context-loader.ts`
- Modify: `src/hooks/__tests__/context-loader.test.ts`

- [ ] **Step 1: Update hooks.json**

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

- [ ] **Step 2: Write failing tests for enhanced context-loader (arm session)**

Add to `src/hooks/__tests__/context-loader.test.ts`:

```typescript
import { writeFileSync } from "fs";  // add to existing imports
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

describe("arm session context loading", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("loads task details for arm session", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test mission");

    writeFileSync(
      join(mPath, "tasks", "001-test.md"),
      stringifyFrontmatter(
        { id: 1, status: "in_progress", assigned_to: "arm-1", scope: ["src/**"], prior_tasks: [] },
        "# Do the thing\n\nTask description here"
      ),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("Do the thing");
    expect(output).toContain("arm-1");
  });

  it("loads checkpoint section if present", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test");

    writeFileSync(
      join(mPath, "tasks", "001-test.md"),
      stringifyFrontmatter(
        { id: 1, status: "in_progress", assigned_to: "arm-1" },
        "# Task\n\n## Checkpoint\n- **Timestamp:** 1234\n- **Status:** session ended"
      ),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("Checkpoint");
    expect(output).toContain("session ended");
  });

  it("loads unread inbox messages", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test");

    writeFileSync(
      join(mPath, "tasks", "001-test.md"),
      stringifyFrontmatter(
        { id: 1, status: "in_progress", assigned_to: "arm-1" },
        "# Task"
      ),
      "utf-8"
    );

    // Write an inbox message for arm-1
    mkdirSync(join(mPath, "inbox", "arm-1"), { recursive: true });
    writeFileSync(
      join(mPath, "inbox", "arm-1", "123-lead.md"),
      stringifyFrontmatter({ from: "lead", priority: false, timestamp: 123 }, "Check the test output"),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("Check the test output");
    expect(output).toContain("Inbox");
  });

  it("references team-coordinate skill", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test");

    writeFileSync(
      join(mPath, "tasks", "001-test.md"),
      stringifyFrontmatter(
        { id: 1, status: "in_progress", assigned_to: "arm-1" },
        "# Task"
      ),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("team-coordinate");
  });

  it("loads prior task outputs when prior_tasks is set", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test");

    // Create a completed prior task with Output
    writeFileSync(
      join(mPath, "tasks", "001-setup.md"),
      stringifyFrontmatter(
        { id: 1, status: "completed", assigned_to: "arm-2" },
        "# Setup\n\n## Output\n\n### Files Changed\n- src/config.ts\n\n### Decisions Made\n- Used env vars for config"
      ),
      "utf-8"
    );

    // Create current task referencing prior task
    writeFileSync(
      join(mPath, "tasks", "002-feature.md"),
      stringifyFrontmatter(
        { id: 2, status: "in_progress", assigned_to: "arm-1", prior_tasks: [1] },
        "# Feature\n\nBuild on the setup from task 1"
      ),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("Prior Task 1 Output");
    expect(output).toContain("Used env vars for config");
  });

  it("loads knowledge files", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test");

    writeFileSync(
      join(mPath, "tasks", "001-test.md"),
      stringifyFrontmatter(
        { id: 1, status: "in_progress", assigned_to: "arm-1" },
        "# Task"
      ),
      "utf-8"
    );

    writeFileSync(
      join(mPath, "knowledge", "_shared.md"),
      stringifyFrontmatter({ team_id: "m1" }, "## Gotchas\n- Stripe needs raw body"),
      "utf-8"
    );

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
      },
    });
    expect(output).toContain("Stripe needs raw body");
  });
});
```

- [ ] **Step 3: Run tests to verify new tests fail**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: Existing tests PASS, new arm session tests FAIL

- [ ] **Step 4: Enhance context-loader for arm sessions**

Replace `src/hooks/context-loader.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;
const missionsDir = join(basePath, "missions");

function parseFmField(content: string, field: string): string | undefined {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return undefined;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === field) return kv[2].trim();
  }
  return undefined;
}

if (agentId && missionId) {
  // ARM SESSION — load task details, knowledge, inbox
  const mPath = join(missionsDir, missionId);
  if (!existsSync(mPath)) process.exit(0);

  console.log(`[mycelium] Arm ${agentId} — mission ${missionId}`);
  console.log(`Use the team-coordinate skill for filesystem protocol conventions.`);

  // Find assigned task
  const tasksDir = join(mPath, "tasks");
  if (existsSync(tasksDir)) {
    const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
    for (const file of taskFiles) {
      const content = readFileSync(join(tasksDir, file), "utf-8");
      const assignedTo = parseFmField(content, "assigned_to");
      const status = parseFmField(content, "status");

      if (assignedTo === agentId && (status === "in_progress" || status === "pending")) {
        console.log(`\n--- Task: ${file} ---`);
        // Print body (after frontmatter)
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        if (bodyMatch) console.log(bodyMatch[1].trim());

        // Load prior task outputs if prior_tasks is set
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          let priorIds: number[] = [];
          // Inline format: prior_tasks: [1, 2]
          const ptInline = fmMatch[1].match(/^prior_tasks:\s*\[([^\]]*)\]/m);
          if (ptInline && ptInline[1].trim()) {
            priorIds = ptInline[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          } else {
            // Block format: prior_tasks:\n  - 1\n  - 2
            const ptBlock = fmMatch[1].match(/^prior_tasks:\s*$/m);
            if (ptBlock) {
              const fmLines = fmMatch[1].split("\n");
              const ptIdx = fmLines.findIndex((l) => l.match(/^prior_tasks:\s*$/));
              for (let i = ptIdx + 1; i < fmLines.length; i++) {
                const itemMatch = fmLines[i].match(/^\s+-\s+(\d+)/);
                if (itemMatch) {
                  priorIds.push(parseInt(itemMatch[1], 10));
                } else {
                  break;
                }
              }
            }
          }
          for (const priorId of priorIds) {
            const prefix = String(priorId).padStart(3, "0") + "-";
            const priorFile = taskFiles.find((f) => f.startsWith(prefix));
            if (priorFile) {
              const priorContent = readFileSync(join(tasksDir, priorFile), "utf-8");
              const outputMatch = priorContent.match(/## Output\r?\n([\s\S]*?)(?=\n## |$)/);
              if (outputMatch && outputMatch[1].trim()) {
                console.log(`\n--- Prior Task ${priorId} Output ---`);
                console.log(outputMatch[1].trim());
              }
            }
          }
        }
        break;
      }
    }
  }

  // Load unread inbox messages
  const inboxDir = join(mPath, "inbox", agentId);
  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
    );
    if (files.length > 0) {
      console.log(`\n--- Inbox (${files.length} unread) ---`);
      for (const file of files) {
        const content = readFileSync(join(inboxDir, file), "utf-8");
        const from = parseFmField(content, "from") ?? "unknown";
        const priority = parseFmField(content, "priority");
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const prefix = priority === "true" ? "PRIORITY " : "";
        console.log(`  ${prefix}From ${from}: ${bodyMatch ? bodyMatch[1].trim() : "(empty)"}`);
      }
    }
  }

  // Load knowledge
  const knowledgeDir = join(mPath, "knowledge");
  const sharedKnowledge = join(knowledgeDir, "_shared.md");
  const ownKnowledge = join(knowledgeDir, `${agentId}.md`);

  const knowledgeFiles = [sharedKnowledge, ownKnowledge].filter(existsSync);
  if (knowledgeFiles.length > 0) {
    console.log("\n--- Knowledge ---");
    for (const kf of knowledgeFiles) {
      const content = readFileSync(kf, "utf-8");
      const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      if (bodyMatch && bodyMatch[1].trim()) {
        console.log(bodyMatch[1].trim());
      }
    }
  }
} else {
  // CAPTAIN SESSION — list active missions
  if (!existsSync(missionsDir)) process.exit(0);

  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const active: Array<{ id: string; goal: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (!existsSync(missionFile)) continue;

    const content = readFileSync(missionFile, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) continue;

    let id = entry.name;
    let status = "active";
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv?.[1] === "id") id = kv[2].trim();
      if (kv?.[1] === "status") status = kv[2].trim();
    }
    if (status !== "active") continue;

    const goalMatch = match[2].match(/^#\s+(.+)$/m);
    active.push({ id, goal: goalMatch ? goalMatch[1] : "(no goal)" });
  }

  if (active.length > 0) {
    console.log("[mycelium] Active missions:");
    for (const m of active) {
      console.log(`  ${m.id}: ${m.goal}`);
    }
  }
}
```

- [ ] **Step 5: Run all context-loader tests**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: PASS (existing + new tests)

- [ ] **Step 6: Run full test suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add hooks.json src/hooks/context-loader.ts src/hooks/__tests__/context-loader.test.ts
git commit -m "feat: update hooks.json with all 6 hooks, enhance context-loader for arm sessions"
```

---

### Task 13: Final Build + Verification

**Files:**
- Rebuild: `dist/`

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS (all tests across all files)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Rebuild dist/**

Run: `npm run build`
Expected: Build succeeds, `dist/` updated

- [ ] **Step 4: Verify hook scripts are in dist/**

Run: `ls dist/hooks/`
Expected: `context-loader.js`, `scope-enforcer.js`, `passive-monitor.js`, `checkpoint.js`, `arm-cleanup.js` (no `nudge-messages.js`)

- [ ] **Step 5: Commit dist/**

```bash
git add dist/
git commit -m "chore: rebuild dist/ for Phase 2"
```
