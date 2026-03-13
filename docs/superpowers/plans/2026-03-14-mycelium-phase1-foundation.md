# Mycelium Phase 1: Foundation — Global State + Focus Mode

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core protocol layer (`~/.mycelium/`), MCP server with 5 atomic tools, Copilot CLI runtime adapter, context-loader hook, and Focus Mode skill — a clean implementation of the Mycelium protocol from scratch.

**Architecture:** Filesystem-first coordination. All state lives under `~/.mycelium/`. Only 5 operations needing atomicity go through MCP (SQLite). Everything else is markdown files with YAML frontmatter read/written directly by agents. The MCP server does dual-write: SQLite for atomic status + filesystem for content.

**Tech Stack:** TypeScript (strict), vitest, `yaml` (pure JS YAML parser), `node-sqlite3-wasm`, `zod`, `@modelcontextprotocol/sdk`, esbuild

**Spec:** `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md`

---

## File Structure

```
src/protocol/
├── frontmatter.ts          # Parse/write markdown+YAML frontmatter
├── dirs.ts                 # Initialize ~/.mycelium/ structure, resolve paths
├── mission.ts              # Read/write mission.md, task files, member files
└── __tests__/
    ├── frontmatter.test.ts
    ├── dirs.test.ts
    └── mission.test.ts

src/mcp-server/
├── index.ts                # Entry point — resolves basePath, starts server
├── server.ts               # createServer(basePath) factory
├── db.ts                   # TeamDB — slim SQLite for atomic operations only
├── types.ts                # Interfaces + Zod schemas
├── tools/
│   ├── team.ts             # create_team (creates mission dir + SQLite)
│   └── tasks.ts            # claim_task, complete_task, approve_task, reject_task
└── __tests__/
    ├── db.test.ts
    ├── tools-team.test.ts
    └── tools-tasks.test.ts

src/adapters/
├── types.ts                # RuntimeAdapter + SpawnConfig interfaces
├── copilot-cli.ts          # Copilot CLI adapter (wraps spawn-teammate.sh)
├── registry.ts             # getAdapter(name) factory
└── __tests__/
    └── copilot-cli.test.ts

src/hooks/
├── context-loader.ts       # sessionStart — loads active missions
├── nudge-messages.ts       # postToolUse — surfaces unread messages
└── __tests__/
    └── context-loader.test.ts

skills/
└── team-focus/
    └── SKILL.md            # Focus Mode skill prompt

scripts/
└── spawn-teammate.sh       # Git worktree + tmux spawner

agents/
├── captain.agent.md        # Placeholder — full implementation Phase 3
└── teammate.agent.md       # Arm agent prompt
```

---

## Chunk 1: Protocol Layer

### Task 1: Frontmatter Parser

**Files:**
- Create: `src/protocol/frontmatter.ts`
- Test: `src/protocol/__tests__/frontmatter.test.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/matantsach/mtsach/projects/mycelium && npm install
```

- [ ] **Step 2: Write failing tests for frontmatter parsing**

```typescript
// src/protocol/__tests__/frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses markdown with YAML frontmatter", () => {
    const input = `---
id: mission-001
status: active
created_at: 1741000000
---

# My Mission

Some body content.`;

    const result = parseFrontmatter(input);
    expect(result.data).toEqual({
      id: "mission-001",
      status: "active",
      created_at: 1741000000,
    });
    expect(result.body).toBe("# My Mission\n\nSome body content.");
  });

  it("parses nested objects in frontmatter", () => {
    const input = `---
id: mission-001
config:
  review_required: true
  max_arms: 4
  budget: 80
---

Body.`;

    const result = parseFrontmatter(input);
    expect(result.data.config).toEqual({
      review_required: true,
      max_arms: 4,
      budget: 80,
    });
  });

  it("parses arrays in frontmatter", () => {
    const input = `---
blocked_by:
  - 1
  - 2
scope:
  - src/routes/**
  - tests/**
---

Body.`;

    const result = parseFrontmatter(input);
    expect(result.data.blocked_by).toEqual([1, 2]);
    expect(result.data.scope).toEqual(["src/routes/**", "tests/**"]);
  });

  it("returns empty data for content without frontmatter", () => {
    const result = parseFrontmatter("Just plain text.");
    expect(result.data).toEqual({});
    expect(result.body).toBe("Just plain text.");
  });

  it("handles empty body", () => {
    const input = `---
id: test
---`;

    const result = parseFrontmatter(input);
    expect(result.data).toEqual({ id: "test" });
    expect(result.body).toBe("");
  });
});

describe("stringifyFrontmatter", () => {
  it("creates markdown with YAML frontmatter", () => {
    const result = stringifyFrontmatter(
      { id: "mission-001", status: "active" },
      "# My Mission\n\nBody."
    );
    const parsed = parseFrontmatter(result);
    expect(parsed.data).toEqual({ id: "mission-001", status: "active" });
    expect(parsed.body).toBe("# My Mission\n\nBody.");
  });

  it("round-trips nested objects", () => {
    const data = {
      id: "m1",
      config: { review_required: true, max_arms: 4 },
    };
    const body = "Content.";
    const result = parseFrontmatter(stringifyFrontmatter(data, body));
    expect(result.data).toEqual(data);
    expect(result.body).toBe(body);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/protocol/__tests__/frontmatter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement frontmatter parser**

```typescript
// src/protocol/frontmatter.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }
  const data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = match[2].trim();
  return { data, body };
}

export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string
): string {
  const yaml = stringifyYaml(data).trim();
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `---\n${yaml}\n---\n`;
  }
  return `---\n${yaml}\n---\n\n${trimmedBody}\n`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/protocol/__tests__/frontmatter.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/protocol/frontmatter.ts src/protocol/__tests__/frontmatter.test.ts
git commit -m "feat: add YAML frontmatter parser for mycelium protocol files"
```

---

### Task 2: Directory Structure + Path Resolver

**Files:**
- Create: `src/protocol/dirs.ts`
- Test: `src/protocol/__tests__/dirs.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/protocol/__tests__/dirs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initBasePath,
  resolveMissionPath,
  DEFAULT_BASE_PATH,
} from "../dirs.js";

describe("dirs", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("DEFAULT_BASE_PATH points to ~/.mycelium", () => {
    expect(DEFAULT_BASE_PATH).toContain(".mycelium");
  });

  it("initBasePath creates the full directory structure", () => {
    initBasePath(tmpBase);
    expect(existsSync(join(tmpBase, "missions"))).toBe(true);
    expect(existsSync(join(tmpBase, "knowledge"))).toBe(true);
    expect(existsSync(join(tmpBase, "knowledge", "repos"))).toBe(true);
    expect(existsSync(join(tmpBase, "templates"))).toBe(true);
    expect(existsSync(join(tmpBase, "adapters"))).toBe(true);
  });

  it("initBasePath is idempotent", () => {
    initBasePath(tmpBase);
    initBasePath(tmpBase);
    expect(existsSync(join(tmpBase, "missions"))).toBe(true);
  });

  it("resolveMissionPath returns correct path", () => {
    const result = resolveMissionPath(tmpBase, "mission-001");
    expect(result).toBe(join(tmpBase, "missions", "mission-001"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/protocol/__tests__/dirs.test.ts
```

- [ ] **Step 3: Implement dirs module**

```typescript
// src/protocol/dirs.ts
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const DEFAULT_BASE_PATH = join(homedir(), ".mycelium");

const BASE_DIRS = [
  "missions",
  "knowledge",
  "knowledge/repos",
  "templates",
  "adapters",
];

export function initBasePath(basePath: string): void {
  for (const dir of BASE_DIRS) {
    mkdirSync(join(basePath, dir), { recursive: true });
  }
}

export function resolveMissionPath(
  basePath: string,
  missionId: string
): string {
  return join(basePath, "missions", missionId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/protocol/__tests__/dirs.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/protocol/dirs.ts src/protocol/__tests__/dirs.test.ts
git commit -m "feat: add mycelium directory structure initializer"
```

---

### Task 3: Mission File Writers

**Files:**
- Create: `src/protocol/mission.ts`
- Test: `src/protocol/__tests__/mission.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/protocol/__tests__/mission.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initMissionDir,
  writeMissionFile,
  readMissionFile,
  writeTaskFile,
  readTaskFile,
  writeMemberFile,
  listMissions,
} from "../mission.js";

describe("mission files", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    missionPath = join(tmpBase, "missions", "test-mission");
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe("initMissionDir", () => {
    it("creates all mission subdirectories", () => {
      initMissionDir(missionPath);
      for (const sub of [
        "tasks",
        "members",
        "inbox",
        "progress",
        "knowledge",
      ]) {
        expect(existsSync(join(missionPath, sub))).toBe(true);
      }
    });
  });

  describe("writeMissionFile / readMissionFile", () => {
    it("writes and reads mission.md with frontmatter", () => {
      initMissionDir(missionPath);
      writeMissionFile(missionPath, {
        id: "test-mission",
        status: "active",
        repo: "/path/to/repo",
        config: {
          review_required: true,
          max_arms: 4,
          budget: 80,
          runtime: "copilot-cli",
        },
        created_at: 1741000000,
      }, "Implement payment processing");

      const mission = readMissionFile(missionPath);
      expect(mission.data.id).toBe("test-mission");
      expect(mission.data.status).toBe("active");
      expect(mission.data.repo).toBe("/path/to/repo");
      expect(
        (mission.data.config as Record<string, unknown>).max_arms
      ).toBe(4);
      expect(mission.body).toContain("Implement payment processing");
    });
  });

  describe("writeTaskFile / readTaskFile", () => {
    it("writes and reads a task file with proper naming", () => {
      initMissionDir(missionPath);
      const taskData = {
        id: 1,
        status: "pending" as const,
        assigned_to: null,
        blocked_by: [],
        scope: ["src/routes/payments.ts", "tests/payments/**"],
        prior_tasks: [],
        created_at: 1741000000,
      };
      writeTaskFile(
        missionPath,
        taskData,
        "Add payment routing",
        "Implement /payments route."
      );

      const filePath = join(
        missionPath,
        "tasks",
        "001-add-payment-routing.md"
      );
      expect(existsSync(filePath)).toBe(true);

      const task = readTaskFile(filePath);
      expect(task.data.id).toBe(1);
      expect(task.data.status).toBe("pending");
      expect(task.data.scope).toEqual([
        "src/routes/payments.ts",
        "tests/payments/**",
      ]);
      expect(task.body).toContain("Add payment routing");
      expect(task.body).toContain("Implement /payments route.");
    });
  });

  describe("writeMemberFile", () => {
    it("writes member file to members/ directory", () => {
      initMissionDir(missionPath);
      writeMemberFile(missionPath, {
        agent_id: "arm-1",
        team_id: "test-mission",
        role: "teammate",
        status: "active",
        runtime: "copilot-cli",
        worktree: "/path/to/worktree",
        registered_at: 1741000002,
      });

      const filePath = join(missionPath, "members", "arm-1.md");
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("agent_id: arm-1");
      expect(content).toContain("role: teammate");
    });
  });

  describe("listMissions", () => {
    it("lists all missions with parsed frontmatter", () => {
      mkdirSync(join(tmpBase, "missions"), { recursive: true });
      const m1 = join(tmpBase, "missions", "m1");
      const m2 = join(tmpBase, "missions", "m2");
      initMissionDir(m1);
      initMissionDir(m2);
      writeMissionFile(m1, {
        id: "m1",
        status: "active",
        created_at: 1741000000,
      }, "Mission 1");
      writeMissionFile(m2, {
        id: "m2",
        status: "completed",
        created_at: 1741000001,
      }, "Mission 2");

      const missions = listMissions(tmpBase);
      expect(missions).toHaveLength(2);
      expect(missions.map((m) => m.data.id).sort()).toEqual(["m1", "m2"]);
    });

    it("returns empty array when no missions exist", () => {
      mkdirSync(join(tmpBase, "missions"), { recursive: true });
      expect(listMissions(tmpBase)).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/protocol/__tests__/mission.test.ts
```

- [ ] **Step 3: Implement mission module**

```typescript
// src/protocol/mission.ts
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "./frontmatter.js";
import type { FrontmatterResult } from "./frontmatter.js";

const MISSION_SUBDIRS = [
  "tasks",
  "members",
  "inbox",
  "inbox/_broadcast",
  "progress",
  "knowledge",
];

export function initMissionDir(missionPath: string): void {
  for (const sub of MISSION_SUBDIRS) {
    mkdirSync(join(missionPath, sub), { recursive: true });
  }
}

export function writeMissionFile(
  missionPath: string,
  data: Record<string, unknown>,
  goal: string
): void {
  const content = stringifyFrontmatter(data, `# ${goal}`);
  writeFileSync(join(missionPath, "mission.md"), content, "utf-8");
}

export function readMissionFile(missionPath: string): FrontmatterResult {
  const content = readFileSync(join(missionPath, "mission.md"), "utf-8");
  return parseFrontmatter(content);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function writeTaskFile(
  missionPath: string,
  data: Record<string, unknown>,
  title: string,
  description: string
): void {
  const id = data.id as number;
  const slug = slugify(title);
  const filename = `${String(id).padStart(3, "0")}-${slug}.md`;
  const body = `# ${title}\n\n${description}\n\n## Context\n<!-- Additional context for the arm -->\n\n## Output\n<!-- filled by teammate on completion -->\n\n### Files Changed\n### Tests Added\n### Decisions Made\n### Open Questions\n\n## Checkpoint\n<!-- written by sessionEnd hook on crash/timeout -->`;
  const content = stringifyFrontmatter(data, body);
  writeFileSync(join(missionPath, "tasks", filename), content, "utf-8");
}

export function readTaskFile(filePath: string): FrontmatterResult {
  return parseFrontmatter(readFileSync(filePath, "utf-8"));
}

export function writeMemberFile(
  missionPath: string,
  data: Record<string, unknown>
): void {
  const agentId = data.agent_id as string;
  const content = stringifyFrontmatter(data, "");
  writeFileSync(
    join(missionPath, "members", `${agentId}.md`),
    content,
    "utf-8"
  );
}

export function listMissions(basePath: string): FrontmatterResult[] {
  const missionsDir = join(basePath, "missions");
  if (!existsSync(missionsDir)) return [];

  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const missions: FrontmatterResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (existsSync(missionFile)) {
      missions.push(readMissionFile(join(missionsDir, entry.name)));
    }
  }
  return missions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/protocol/__tests__/mission.test.ts
```

- [ ] **Step 5: Run all protocol tests**

```bash
npx vitest run src/protocol/
```

- [ ] **Step 6: Commit**

```bash
git add src/protocol/mission.ts src/protocol/__tests__/mission.test.ts
git commit -m "feat: add mission/task/member file readers and writers"
```

---

## Chunk 2: MCP Server + Adapters

### Task 4: Types + SQLite Schema

**Files:**
- Create: `src/mcp-server/types.ts`
- Create: `src/mcp-server/db.ts`
- Test: `src/mcp-server/__tests__/db.test.ts`

The SQLite schema is minimal — only what's needed for atomic operations. Missions, tasks (status + assignment), and approvals.

- [ ] **Step 1: Write types**

```typescript
// src/mcp-server/types.ts
import { z } from "zod";

export const agentIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(50);

export type MissionStatus = "active" | "completed" | "stopped";
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "needs_review";
export type MemberRole = "lead" | "teammate";
export type MemberStatus = "active" | "idle" | "finished";

export interface Mission {
  id: string;
  status: MissionStatus;
  lead_agent_id: string;
  created_at: number;
}

export interface Task {
  mission_id: string;
  task_id: number;
  status: TaskStatus;
  assigned_to: string | null;
  blocked_by: number[];
  claimed_at: number | null;
  completed_at: number | null;
}

export interface Approval {
  mission_id: string;
  task_id: number;
  decided_by: string;
  decision: "approved" | "rejected";
  feedback: string | null;
  decided_at: number;
}
```

- [ ] **Step 2: Write failing DB tests**

```typescript
// src/mcp-server/__tests__/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TeamDB } from "../db.js";

describe("TeamDB", () => {
  let tmpDir: string;
  let db: TeamDB;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-db-test-"));
    db = new TeamDB(join(tmpDir, "teams.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("missions", () => {
    it("creates a mission with generated ID", () => {
      const mission = db.createMission("lead");
      expect(mission.id).toBeTruthy();
      expect(mission.status).toBe("active");
      expect(mission.lead_agent_id).toBe("lead");
    });

    it("gets an active mission", () => {
      const created = db.createMission("lead");
      const fetched = db.getActiveMission(created.id);
      expect(fetched.id).toBe(created.id);
    });

    it("throws for non-existent mission", () => {
      expect(() => db.getActiveMission("nope")).toThrow("not found");
    });
  });

  describe("tasks", () => {
    it("inserts a task row", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      const task = db.getTask(m.id, 1);
      expect(task).toBeDefined();
      expect(task!.status).toBe("pending");
    });

    it("claims a pending task atomically", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      const task = db.claimTask(m.id, 1, "arm-1");
      expect(task.status).toBe("in_progress");
      expect(task.assigned_to).toBe("arm-1");
    });

    it("prevents double-claim", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      expect(() => db.claimTask(m.id, 1, "arm-2")).toThrow();
    });

    it("blocks claim when blockers are not completed", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.insertTask(m.id, 2, [1]);
      expect(() => db.claimTask(m.id, 2, "arm-1")).toThrow("blocked");
    });

    it("completes a task and triggers auto-unblock", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.insertTask(m.id, 2, [1]);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1");

      const t2 = db.getTask(m.id, 2);
      expect(t2!.status).toBe("pending"); // auto-unblocked
    });
  });

  describe("approvals", () => {
    it("approve_task transitions needs_review to completed", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true); // review_required
      const task = db.getTask(m.id, 1);
      expect(task!.status).toBe("needs_review");

      db.approveTask(m.id, 1, "lead");
      const approved = db.getTask(m.id, 1);
      expect(approved!.status).toBe("completed");
    });

    it("reject_task transitions needs_review to in_progress", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true);

      db.rejectTask(m.id, 1, "lead", "Needs more tests");
      const rejected = db.getTask(m.id, 1);
      expect(rejected!.status).toBe("in_progress");
    });

    it("enforces lead-only for approve", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true);

      expect(() => db.approveTask(m.id, 1, "arm-2")).toThrow("lead");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/mcp-server/__tests__/db.test.ts
```

- [ ] **Step 4: Implement TeamDB**

```typescript
// src/mcp-server/db.ts
import { Database } from "node-sqlite3-wasm";
import { randomUUID } from "crypto";
import type { Mission, Task } from "./types.js";

export class TeamDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','stopped')),
        lead_agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
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
      CREATE TABLE IF NOT EXISTS approvals (
        mission_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        decided_by TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
        feedback TEXT,
        decided_at INTEGER NOT NULL,
        PRIMARY KEY (mission_id, task_id, decided_at)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Missions ---

  createMission(leadAgentId: string): Mission {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();
    this.db.run(
      "INSERT INTO missions (id, status, lead_agent_id, created_at) VALUES (?, 'active', ?, ?)",
      [id, leadAgentId, now]
    );
    return { id, status: "active", lead_agent_id: leadAgentId, created_at: now };
  }

  getActiveMission(id: string): Mission {
    const row = this.db.get("SELECT * FROM missions WHERE id = ?", [id]) as Mission | undefined;
    if (!row) throw new Error(`Mission '${id}' not found`);
    if (row.status !== "active") throw new Error(`Mission '${id}' is not active (status: ${row.status})`);
    return row;
  }

  // --- Tasks ---

  insertTask(missionId: string, taskId: number, blockedBy: number[]): void {
    const status = blockedBy.length > 0 ? "blocked" : "pending";
    this.db.run(
      "INSERT INTO tasks (mission_id, task_id, status, blocked_by) VALUES (?, ?, ?, ?)",
      [missionId, taskId, status, JSON.stringify(blockedBy)]
    );
  }

  getTask(missionId: string, taskId: number): Task | undefined {
    const row = this.db.get(
      "SELECT * FROM tasks WHERE mission_id = ? AND task_id = ?",
      [missionId, taskId]
    ) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      ...row,
      blocked_by: JSON.parse((row.blocked_by as string) || "[]"),
    } as Task;
  }

  claimTask(missionId: string, taskId: number, agentId: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(missionId, taskId);
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

  completeTask(missionId: string, taskId: number, agentId: string, reviewRequired?: boolean): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "in_progress") throw new Error(`Task ${taskId} is ${task.status}, cannot complete`);
      if (task.assigned_to !== agentId) throw new Error(`Task ${taskId} is assigned to ${task.assigned_to}, not ${agentId}`);

      const newStatus = reviewRequired ? "needs_review" : "completed";
      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = ?, completed_at = ? WHERE mission_id = ? AND task_id = ?",
        [newStatus, now, missionId, taskId]
      );

      // Auto-unblock cascade (only on completed, not needs_review)
      if (newStatus === "completed") {
        this.autoUnblock(missionId, taskId);
      }

      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private autoUnblock(missionId: string, completedTaskId: number): void {
    const allTasks = this.db.all(
      "SELECT * FROM tasks WHERE mission_id = ? AND status = 'blocked'",
      [missionId]
    ) as Array<Record<string, unknown>>;

    for (const row of allTasks) {
      const blockedBy: number[] = JSON.parse((row.blocked_by as string) || "[]");
      if (!blockedBy.includes(completedTaskId)) continue;

      // Check if ALL blockers are completed
      const allResolved = blockedBy.every((bid) => {
        if (bid === completedTaskId) return true;
        const b = this.getTask(missionId, bid);
        return b && b.status === "completed";
      });

      if (allResolved) {
        this.db.run(
          "UPDATE tasks SET status = 'pending' WHERE mission_id = ? AND task_id = ?",
          [missionId, row.task_id]
        );
      }
    }
  }

  approveTask(missionId: string, taskId: number, agentId: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const mission = this.getActiveMission(missionId);
      if (mission.lead_agent_id !== agentId) {
        throw new Error(`Only the lead (${mission.lead_agent_id}) can approve tasks`);
      }
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "needs_review") throw new Error(`Task ${taskId} is ${task.status}, cannot approve`);

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'completed', completed_at = ? WHERE mission_id = ? AND task_id = ?",
        [now, missionId, taskId]
      );
      this.db.run(
        "INSERT INTO approvals (mission_id, task_id, decided_by, decision, decided_at) VALUES (?, ?, ?, 'approved', ?)",
        [missionId, taskId, agentId, now]
      );
      this.autoUnblock(missionId, taskId);
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  rejectTask(missionId: string, taskId: number, agentId: string, feedback: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const mission = this.getActiveMission(missionId);
      if (mission.lead_agent_id !== agentId) {
        throw new Error(`Only the lead (${mission.lead_agent_id}) can reject tasks`);
      }
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "needs_review") throw new Error(`Task ${taskId} is ${task.status}, cannot reject`);

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'in_progress', completed_at = NULL WHERE mission_id = ? AND task_id = ?",
        [missionId, taskId]
      );
      this.db.run(
        "INSERT INTO approvals (mission_id, task_id, decided_by, decision, feedback, decided_at) VALUES (?, ?, ?, 'rejected', ?, ?)",
        [missionId, taskId, agentId, feedback, now]
      );
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/mcp-server/__tests__/db.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/types.ts src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: add TeamDB with missions, tasks, and approval tables"
```

---

### Task 5: MCP Server + Tools

**Files:**
- Create: `src/mcp-server/server.ts`
- Create: `src/mcp-server/index.ts`
- Create: `src/mcp-server/tools/team.ts`
- Create: `src/mcp-server/tools/tasks.ts`
- Test: `src/mcp-server/__tests__/tools-team.test.ts`
- Test: `src/mcp-server/__tests__/tools-tasks.test.ts`

- [ ] **Step 1: Write server factory**

```typescript
// src/mcp-server/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTaskTools } from "./tools/tasks.js";

export function createServer(basePath: string): { server: McpServer; db: TeamDB } {
  const { join } = require("path");
  const server = new McpServer({ name: "mycelium", version: "0.5.0" });
  const db = new TeamDB(join(basePath, "teams.db"));
  registerTeamTools(server, db, basePath);
  registerTaskTools(server, db);
  return { server, db };
}
```

- [ ] **Step 2: Write create_team tool with dual-write**

```typescript
// src/mcp-server/tools/team.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import type { TeamDB } from "../db.js";
import { initBasePath } from "../../protocol/dirs.js";
import {
  initMissionDir,
  writeMissionFile,
  writeMemberFile,
} from "../../protocol/mission.js";

export function registerTeamTools(
  server: McpServer,
  db: TeamDB,
  basePath: string
): void {
  server.tool(
    "create_team",
    "Create a new mission and register caller as lead",
    {
      goal: z.string(),
      config: z.record(z.string(), z.unknown()).optional(),
      repo: z.string().optional(),
    },
    async ({ goal, config, repo }) => {
      try {
        const mission = db.createMission("lead");

        // Write filesystem representation
        initBasePath(basePath);
        const missionPath = join(basePath, "missions", mission.id);
        initMissionDir(missionPath);
        writeMissionFile(
          missionPath,
          {
            id: mission.id,
            status: "active",
            repo: repo ?? null,
            config: config ?? null,
            created_at: mission.created_at,
          },
          goal
        );
        writeMemberFile(missionPath, {
          agent_id: "lead",
          team_id: mission.id,
          role: "lead",
          status: "active",
          registered_at: mission.created_at,
        });

        return {
          content: [
            { type: "text", text: JSON.stringify({ ...mission, goal }) },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: e.message }],
          isError: true,
        };
      }
    }
  );
}
```

- [ ] **Step 3: Write task tools (claim, complete, approve, reject)**

```typescript
// src/mcp-server/tools/tasks.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";

export function registerTaskTools(
  server: McpServer,
  db: TeamDB
): void {
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
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
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
    async ({ mission_id, task_id, agent_id, review_required }) => {
      try {
        const task = db.completeTask(mission_id, task_id, agent_id, review_required);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
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
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
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
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );
}
```

- [ ] **Step 4: Write MCP entry point**

```typescript
// src/mcp-server/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
mkdirSync(basePath, { recursive: true });

const { server, db } = createServer(basePath);

function shutdown() { try { db.close(); } catch {} process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { try { db.close(); } catch {} });

const transport = new StdioServerTransport();
server.connect(transport).then(() => console.error("mycelium MCP server running"));
```

- [ ] **Step 5: Write tool tests**

```typescript
// src/mcp-server/__tests__/tools-team.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "../server.js";
import { parseFrontmatter } from "../../protocol/frontmatter.js";

describe("team tools", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => void;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    const { server, db } = createServer(tmpDir);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    cleanup = () => db.close();
  });

  afterEach(() => {
    cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create_team returns mission with ID", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Test mission" },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.id).toBeTruthy();
    expect(data.status).toBe("active");
    expect(data.goal).toBe("Test mission");
  });

  it("create_team writes mission directory", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "FS test" },
    });
    const data = JSON.parse((result.content as any)[0].text);
    const missionPath = join(tmpDir, "missions", data.id);

    expect(existsSync(join(missionPath, "mission.md"))).toBe(true);
    expect(existsSync(join(missionPath, "tasks"))).toBe(true);
    expect(existsSync(join(missionPath, "members", "lead.md"))).toBe(true);

    const mission = parseFrontmatter(
      readFileSync(join(missionPath, "mission.md"), "utf-8")
    );
    expect(mission.data.id).toBe(data.id);
    expect(mission.body).toContain("FS test");
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run src/mcp-server/
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/mcp-server/
git commit -m "feat: add MCP server with 5 atomic tools and dual-write"
```

---

### Task 6: RuntimeAdapter + Copilot CLI Adapter

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/copilot-cli.ts`
- Create: `src/adapters/registry.ts`
- Test: `src/adapters/__tests__/copilot-cli.test.ts`

- [ ] **Step 1: Write adapter interfaces**

```typescript
// src/adapters/types.ts
export interface SpawnConfig {
  missionId: string;
  agentId: string;
  worktreePath: string;
  taskRef: string;
  agentPrompt: string;
  env: Record<string, string>;
}

export interface RuntimeAdapter {
  name: string;
  spawn(config: SpawnConfig): Promise<void>;
  isAvailable(): boolean;
}
```

- [ ] **Step 2: Write adapter tests**

```typescript
// src/adapters/__tests__/copilot-cli.test.ts
import { describe, it, expect } from "vitest";
import { CopilotCliAdapter } from "../copilot-cli.js";
import { getAdapter } from "../registry.js";

describe("CopilotCliAdapter", () => {
  it("has name 'copilot-cli'", () => {
    const adapter = new CopilotCliAdapter("/path/to/project");
    expect(adapter.name).toBe("copilot-cli");
  });

  it("isAvailable returns boolean", () => {
    const adapter = new CopilotCliAdapter(process.cwd());
    expect(typeof adapter.isAvailable()).toBe("boolean");
  });
});

describe("getAdapter", () => {
  it("returns CopilotCliAdapter for 'copilot-cli'", () => {
    const adapter = getAdapter("copilot-cli", "/path");
    expect(adapter.name).toBe("copilot-cli");
  });

  it("throws for unknown adapter", () => {
    expect(() => getAdapter("unknown", "/path")).toThrow(
      "Unknown runtime adapter"
    );
  });
});
```

- [ ] **Step 3: Implement adapter + registry**

```typescript
// src/adapters/copilot-cli.ts
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { RuntimeAdapter, SpawnConfig } from "./types.js";

export class CopilotCliAdapter implements RuntimeAdapter {
  readonly name = "copilot-cli";
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  isAvailable(): boolean {
    return existsSync(join(this.projectRoot, "scripts", "spawn-teammate.sh"));
  }

  async spawn(config: SpawnConfig): Promise<void> {
    const scriptPath = join(this.projectRoot, "scripts", "spawn-teammate.sh");
    if (!existsSync(scriptPath)) {
      throw new Error("spawn-teammate.sh not found at " + scriptPath);
    }

    const env = {
      ...process.env,
      MYCELIUM_AGENT_ID: config.agentId,
      MYCELIUM_MISSION_ID: config.missionId,
      MYCELIUM_PROJECT_ROOT: this.projectRoot,
      ...config.env,
    };

    const result = execSync(
      `bash "${scriptPath}" "${config.missionId}" "${config.agentId}" "${config.taskRef}"`,
      { cwd: this.projectRoot, env, encoding: "utf-8", timeout: 10000 }
    );

    if (result.includes("NOT_IN_TMUX")) {
      throw new Error("tmux not available — cannot spawn teammate");
    }
  }
}
```

```typescript
// src/adapters/registry.ts
import type { RuntimeAdapter } from "./types.js";
import { CopilotCliAdapter } from "./copilot-cli.js";

export function getAdapter(name: string, projectRoot: string): RuntimeAdapter {
  switch (name) {
    case "copilot-cli":
      return new CopilotCliAdapter(projectRoot);
    default:
      throw new Error(`Unknown runtime adapter: ${name}`);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/adapters/
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/
git commit -m "feat: add RuntimeAdapter interface and Copilot CLI adapter"
```

---

## Chunk 3: Hooks, Skill, Wiring

### Task 7: Context Loader Hook

**Files:**
- Create: `src/hooks/context-loader.ts`
- Test: `src/hooks/__tests__/context-loader.test.ts`

Reads `~/.mycelium/missions/` and lists active missions on session start.

- [ ] **Step 1: Write failing tests**

```typescript
// src/hooks/__tests__/context-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir, writeMissionFile } from "../../protocol/mission.js";

describe("context-loader hook", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("shows active missions from filesystem", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "active",
      created_at: Date.now(),
    }, "Test mission goal");

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output).toContain("m1");
    expect(output).toContain("Test mission goal");
  });

  it("skips completed missions", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "completed",
      created_at: Date.now(),
    }, "Done mission");

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });

  it("is silent when no missions exist", () => {
    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/hooks/__tests__/context-loader.test.ts
```

- [ ] **Step 3: Implement context-loader**

```typescript
// src/hooks/context-loader.ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const missionsDir = join(basePath, "missions");

if (existsSync(missionsDir)) {
  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const active: Array<{ id: string; goal: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (!existsSync(missionFile)) continue;

    const content = readFileSync(missionFile, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) continue;

    // Simple line-by-line parse — avoids yaml dependency in hook bundle
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/hooks/__tests__/context-loader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/context-loader.ts src/hooks/__tests__/context-loader.test.ts
git commit -m "feat: add context-loader sessionStart hook"
```

---

### Task 8: Nudge Messages Hook (Placeholder)

**Files:**
- Create: `src/hooks/nudge-messages.ts`

A minimal placeholder that reads unread message counts from the filesystem inbox. Full implementation in Phase 2.

- [ ] **Step 1: Write placeholder**

```typescript
// src/hooks/nudge-messages.ts
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (agentId && missionId) {
  const inboxDir = join(basePath, "missions", missionId, "inbox", agentId);
  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor"
    );
    if (files.length > 0) {
      console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/nudge-messages.ts
git commit -m "feat: add nudge-messages postToolUse hook placeholder"
```

---

### Task 9: Focus Mode Skill + Spawn Script + Final Wiring

**Files:**
- Create: `skills/team-focus/SKILL.md`
- Create: `scripts/spawn-teammate.sh`
- Create: `agents/teammate.agent.md`

- [ ] **Step 1: Write Focus Mode skill**

Write `skills/team-focus/SKILL.md` with the complete Focus Mode workflow (create mission, create task, spawn arm, return control). See spec section "Focus Mode (The 80% Case)".

- [ ] **Step 2: Write spawn-teammate.sh**

Adapt from the existing script in copilot-agent-teams. Key changes:
- Set `MYCELIUM_AGENT_ID`, `MYCELIUM_MISSION_ID`, `MYCELIUM_PROJECT_ROOT` env vars
- Write member file to `~/.mycelium/missions/{id}/members/{agent_id}.md`
- Create inbox directory at `~/.mycelium/missions/{id}/inbox/{agent_id}/`

- [ ] **Step 3: Write teammate agent prompt**

Write `agents/teammate.agent.md` with instructions for arms: claim task via MCP, do work, complete task via MCP, write progress, write knowledge.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit everything**

```bash
git add skills/ scripts/ agents/ esbuild.config.mjs hooks.json plugin.json .mcp.json dist/
git commit -m "feat: add Focus Mode skill, spawn script, and teammate agent"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `npm test` — all tests pass
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run build` — builds successfully
- [ ] `create_team` MCP call creates SQLite entry + `~/.mycelium/missions/{id}/` directory
- [ ] Context-loader shows active missions from `~/.mycelium/`
- [ ] `skills/team-focus/SKILL.md` exists and is referenced by `plugin.json`
- [ ] `spawn-teammate.sh` sets `MYCELIUM_AGENT_ID`, `MYCELIUM_MISSION_ID`, `MYCELIUM_PROJECT_ROOT`
- [ ] `dist/` is rebuilt and committed
