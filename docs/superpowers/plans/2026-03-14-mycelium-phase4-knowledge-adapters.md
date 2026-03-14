# Phase 4: Mycelium Knowledge + Runtime Adapters — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement cross-session knowledge promotion (Tier 1→2→3), enhanced context loading, Claude Code + Codex CLI runtime adapters, and a reusable mission template system.

**Architecture:** Knowledge is filesystem-first — no new MCP tools or SQLite tables. Arms write Tier 1 knowledge entries to `missions/{id}/knowledge/{agent_id}.md`. Captain promotes valuable entries to Tier 2 (`_shared.md`) during retrospective and to Tier 3 (`knowledge/_global.md`, `knowledge/repos/{slug}.md`) when patterns recur across missions. The `sessionStart` context-loader hook loads relevant knowledge filtered by tier, scope, and recency. Runtime adapters implement the existing `RuntimeAdapter` interface. Templates are YAML+Markdown files in `~/.mycelium/templates/`.

**Tech Stack:** TypeScript (strict mode), Vitest, Node.js fs (hooks use regex parsing, protocol uses `yaml` package), Zod for validation.

**Design spec:** `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md` (lines 636-668, 822-831)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/protocol/knowledge.ts` | Knowledge read/write/promote protocol functions (Tier 1-3) |
| `src/protocol/__tests__/knowledge.test.ts` | Tests for knowledge protocol |
| `src/protocol/templates.ts` | Template write, read, list, and instantiate from stored patterns |
| `src/protocol/__tests__/templates.test.ts` | Tests for template protocol |
| `src/adapters/claude-code.ts` | Claude Code runtime adapter |
| `src/adapters/__tests__/claude-code.test.ts` | Tests for Claude Code adapter |
| `src/adapters/codex-cli.ts` | Codex CLI runtime adapter |
| `src/adapters/__tests__/codex-cli.test.ts` | Tests for Codex CLI adapter |
| `scripts/spawn-teammate-claude.sh` | Claude Code tmux + worktree spawner |
| `scripts/spawn-teammate-codex.sh` | Codex CLI tmux + worktree spawner |

### Modified Files
| File | Change |
|------|--------|
| `src/hooks/context-loader.ts` | Load Tier 3 knowledge, filter Tier 2 by task scope |
| `src/hooks/__tests__/context-loader.test.ts` | Tests for new knowledge loading behavior |
| `src/adapters/registry.ts` | Register claude-code and codex-cli adapters |
| `skills/team-review/SKILL.md` | Add Step 5: Tier 1→2 knowledge promotion |
| `skills/captain/SKILL.md` | Add knowledge reading during decomposition, Tier 2→3 promotion |
| `agents/teammate.agent.md` | Structured knowledge entry format guidance |

---

## Chunk 1: Knowledge Protocol Layer

### Task 1: Knowledge Protocol — Types and Write Functions

**Files:**
- Create: `src/protocol/knowledge.ts`
- Test: `src/protocol/__tests__/knowledge.test.ts`

Knowledge entries are `##`-headed sections in markdown files with YAML frontmatter. Each tier has its own path pattern:
- Tier 1: `missions/{id}/knowledge/{agent_id}.md`
- Tier 2: `missions/{id}/knowledge/_shared.md`
- Tier 3 global: `knowledge/_global.md`
- Tier 3 repo: `knowledge/repos/{slug}.md`

- [ ] **Step 1: Write failing tests for `writeKnowledgeEntry`**

```typescript
// src/protocol/__tests__/knowledge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeKnowledgeEntry,
  readKnowledgeEntries,
  knowledgePath,
} from "../knowledge.js";
import { parseFrontmatter } from "../frontmatter.js";

describe("knowledge protocol", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-knowledge-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("knowledgePath", () => {
    it("returns Tier 1 path for arm knowledge", () => {
      const p = knowledgePath(tmpDir, { tier: 1, missionId: "m1", agentId: "arm-1" });
      expect(p).toBe(join(tmpDir, "missions", "m1", "knowledge", "arm-1.md"));
    });

    it("returns Tier 2 path for shared knowledge", () => {
      const p = knowledgePath(tmpDir, { tier: 2, missionId: "m1" });
      expect(p).toBe(join(tmpDir, "missions", "m1", "knowledge", "_shared.md"));
    });

    it("returns Tier 3 global path", () => {
      const p = knowledgePath(tmpDir, { tier: 3 });
      expect(p).toBe(join(tmpDir, "knowledge", "_global.md"));
    });

    it("returns Tier 3 repo path", () => {
      const p = knowledgePath(tmpDir, { tier: 3, repo: "/Users/dev/my-project" });
      expect(p).toBe(join(tmpDir, "knowledge", "repos", "users-dev-my-project.md"));
    });
  });

  describe("writeKnowledgeEntry", () => {
    it("creates file with frontmatter on first write", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "_global.md");

      writeKnowledgeEntry(filePath, {
        heading: "SQLite Concurrency",
        content: "Always use BEGIN IMMEDIATE for write transactions.",
        tags: ["sqlite", "concurrency"],
      });

      expect(existsSync(filePath)).toBe(true);
      const { data, body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
      expect(data.type).toBe("knowledge");
      expect(data.updated_at).toBeTypeOf("number");
      expect(body).toContain("## SQLite Concurrency");
      expect(body).toContain("Always use BEGIN IMMEDIATE");
      expect(body).toContain("Tags: sqlite, concurrency");
    });

    it("appends to existing file without duplicating frontmatter", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "_global.md");

      writeKnowledgeEntry(filePath, {
        heading: "Entry One",
        content: "First discovery.",
      });
      writeKnowledgeEntry(filePath, {
        heading: "Entry Two",
        content: "Second discovery.",
      });

      const raw = readFileSync(filePath, "utf-8");
      const fmMatches = raw.match(/^---/gm);
      expect(fmMatches).toHaveLength(2); // opening + closing
      const { body } = parseFrontmatter(raw);
      expect(body).toContain("## Entry One");
      expect(body).toContain("## Entry Two");
    });

    it("writes entry without tags when none provided", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "arm-1.md");

      writeKnowledgeEntry(filePath, {
        heading: "No Tags Entry",
        content: "Some content.",
      });

      const { body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
      expect(body).toContain("## No Tags Entry");
      expect(body).not.toContain("Tags:");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: FAIL — module `../knowledge.js` does not exist

- [ ] **Step 3: Implement knowledge path helpers and writeKnowledgeEntry**

```typescript
// src/protocol/knowledge.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

export interface KnowledgeEntry {
  heading: string;
  content: string;
  tags?: string[];
}

export interface KnowledgePathOpts {
  tier: 1 | 2 | 3;
  missionId?: string;
  agentId?: string;
  repo?: string;
}

function slugifyRepo(repo: string): string {
  return repo
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

export function knowledgePath(basePath: string, opts: KnowledgePathOpts): string {
  if (opts.tier === 1) {
    if (!opts.missionId || !opts.agentId) throw new Error("Tier 1 requires missionId and agentId");
    return join(basePath, "missions", opts.missionId, "knowledge", `${opts.agentId}.md`);
  }
  if (opts.tier === 2) {
    if (!opts.missionId) throw new Error("Tier 2 requires missionId");
    return join(basePath, "missions", opts.missionId, "knowledge", "_shared.md");
  }
  // Tier 3
  if (opts.repo) {
    return join(basePath, "knowledge", "repos", `${slugifyRepo(opts.repo)}.md`);
  }
  return join(basePath, "knowledge", "_global.md");
}

export function writeKnowledgeEntry(filePath: string, entry: KnowledgeEntry): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const tagLine = entry.tags?.length ? `\nTags: ${entry.tags.join(", ")}\n` : "";
  const section = `\n## ${entry.heading}\n\n${entry.content}\n${tagLine}`;

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const { data, body } = parseFrontmatter(existing);
    data.updated_at = Date.now();
    const newBody = body + section;
    writeFileSync(filePath, stringifyFrontmatter(data, newBody), "utf-8");
  } else {
    const data: Record<string, unknown> = { type: "knowledge", updated_at: Date.now() };
    const body = section.trimStart();
    writeFileSync(filePath, stringifyFrontmatter(data, body), "utf-8");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/protocol/knowledge.ts src/protocol/__tests__/knowledge.test.ts
git commit -m "feat(knowledge): add knowledge path helpers and writeKnowledgeEntry"
```

---

### Task 2: Knowledge Protocol — Read and Promote Functions

**Files:**
- Modify: `src/protocol/knowledge.ts`
- Modify: `src/protocol/__tests__/knowledge.test.ts`

- [ ] **Step 1: Write failing tests for `readKnowledgeEntries`**

Add to the existing test file:

```typescript
describe("readKnowledgeEntries", () => {
  it("returns empty array for non-existent file", () => {
    const entries = readKnowledgeEntries(join(tmpDir, "nonexistent.md"));
    expect(entries).toEqual([]);
  });

  it("parses entries from knowledge file", () => {
    const kPath = join(tmpDir, "knowledge");
    mkdirSync(kPath, { recursive: true });
    const filePath = join(kPath, "_global.md");

    writeKnowledgeEntry(filePath, { heading: "Entry A", content: "Content A.", tags: ["tag-a"] });
    writeKnowledgeEntry(filePath, { heading: "Entry B", content: "Content B.\nMulti-line." });

    const entries = readKnowledgeEntries(filePath);
    expect(entries).toHaveLength(2);
    expect(entries[0].heading).toBe("Entry A");
    expect(entries[0].content).toContain("Content A.");
    expect(entries[0].tags).toEqual(["tag-a"]);
    expect(entries[1].heading).toBe("Entry B");
    expect(entries[1].content).toContain("Multi-line.");
    expect(entries[1].tags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: FAIL — `readKnowledgeEntries` not exported

- [ ] **Step 3: Implement `readKnowledgeEntries`**

Add to `src/protocol/knowledge.ts`:

```typescript
export function readKnowledgeEntries(filePath: string): KnowledgeEntry[] {
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf-8");
  const { body } = parseFrontmatter(raw);
  if (!body.trim()) return [];

  const sections = body.split(/^## /m).filter((s) => s.trim());
  return sections.map((section) => {
    const lines = section.split("\n");
    const heading = lines[0].trim();
    const rest = lines.slice(1).join("\n");

    // Extract tags line if present
    const tagMatch = rest.match(/^Tags:\s*(.+)$/m);
    const tags = tagMatch ? tagMatch[1].split(",").map((t) => t.trim()) : undefined;
    const content = rest
      .replace(/^Tags:\s*.+$/m, "")
      .trim();

    return { heading, content, ...(tags ? { tags } : {}) };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `promoteKnowledge`**

Add to test file:

Update the import block at the top of the test file to include new functions:

```typescript
import {
  writeKnowledgeEntry,
  readKnowledgeEntries,
  knowledgePath,
  promoteKnowledge,
  collectTier1Entries,
} from "../knowledge.js";
```

Also add to the existing imports:

```typescript
import { initMissionDir } from "../mission.js";
```

Then add test cases:

```typescript
describe("promoteKnowledge", () => {
  it("promotes Tier 1 entries to Tier 2 shared file", () => {
    const mPath = join(tmpDir, "missions", "m1");
    initMissionDir(mPath);

    // Write Tier 1 entries for two arms
    const arm1Path = join(mPath, "knowledge", "arm-1.md");
    writeKnowledgeEntry(arm1Path, { heading: "Gotcha A", content: "Detail A.", tags: ["src/auth/"] });
    const arm2Path = join(mPath, "knowledge", "arm-2.md");
    writeKnowledgeEntry(arm2Path, { heading: "Gotcha B", content: "Detail B." });

    // Promote specific entries to Tier 2
    promoteKnowledge(mPath, [
      { heading: "Gotcha A", content: "Detail A. (promoted)", tags: ["src/auth/"] },
    ]);

    const sharedPath = join(mPath, "knowledge", "_shared.md");
    expect(existsSync(sharedPath)).toBe(true);
    const entries = readKnowledgeEntries(sharedPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe("Gotcha A");
    expect(entries[0].content).toContain("promoted");
  });

  it("collects all Tier 1 entries from a mission", () => {
    const mPath = join(tmpDir, "missions", "m1");
    initMissionDir(mPath);

    writeKnowledgeEntry(join(mPath, "knowledge", "arm-1.md"), { heading: "A", content: "Detail A." });
    writeKnowledgeEntry(join(mPath, "knowledge", "arm-2.md"), { heading: "B", content: "Detail B." });

    const all = collectTier1Entries(mPath);
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.heading).sort()).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 7: Implement `promoteKnowledge` and `collectTier1Entries`**

Add to `src/protocol/knowledge.ts`:

Update the `import` at the top of `knowledge.ts` to include `readdirSync`:

```typescript
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "fs";
```

Then add the functions:

```typescript
export function collectTier1Entries(missionPath: string): KnowledgeEntry[] {
  const knowledgeDir = join(missionPath, "knowledge");
  if (!existsSync(knowledgeDir)) return [];

  const files = readdirSync(knowledgeDir).filter(
    (f) => f.endsWith(".md") && f !== "_shared.md"
  );

  const entries: KnowledgeEntry[] = [];
  for (const file of files) {
    entries.push(...readKnowledgeEntries(join(knowledgeDir, file)));
  }
  return entries;
}

export function promoteKnowledge(
  missionPath: string,
  entries: KnowledgeEntry[]
): void {
  const sharedPath = join(missionPath, "knowledge", "_shared.md");
  for (const entry of entries) {
    writeKnowledgeEntry(sharedPath, entry);
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/protocol/knowledge.ts src/protocol/__tests__/knowledge.test.ts
git commit -m "feat(knowledge): add readKnowledgeEntries, collectTier1Entries, promoteKnowledge"
```

---

### Task 3: Knowledge Protocol — Tier 3 Global/Repo Functions

**Files:**
- Modify: `src/protocol/knowledge.ts`
- Modify: `src/protocol/__tests__/knowledge.test.ts`

- [ ] **Step 1: Write failing tests for Tier 3 operations**

Add to test file:

```typescript
import { promoteToGlobal, promoteToRepo, loadRelevantKnowledge } from "../knowledge.js";
import { initBasePath } from "../dirs.js";

describe("Tier 3 operations", () => {
  it("promotes entries to global knowledge", () => {
    initBasePath(tmpDir);

    promoteToGlobal(tmpDir, {
      heading: "SQLite Pattern",
      content: "Use BEGIN IMMEDIATE.\nSource: missions m1, m3",
      tags: ["sqlite"],
    });

    const globalPath = join(tmpDir, "knowledge", "_global.md");
    const entries = readKnowledgeEntries(globalPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe("SQLite Pattern");
  });

  it("promotes entries to repo-specific knowledge", () => {
    initBasePath(tmpDir);

    promoteToRepo(tmpDir, "/Users/dev/my-project", {
      heading: "Build Convention",
      content: "Always run npm run build after changes.",
    });

    const repoPath = join(tmpDir, "knowledge", "repos", "users-dev-my-project.md");
    expect(existsSync(repoPath)).toBe(true);
    const entries = readKnowledgeEntries(repoPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].heading).toBe("Build Convention");
  });
});

describe("loadRelevantKnowledge", () => {
  it("loads Tier 3 global knowledge for any session", () => {
    initBasePath(tmpDir);
    promoteToGlobal(tmpDir, { heading: "Global Tip", content: "Important." });

    const result = loadRelevantKnowledge(tmpDir, {});
    expect(result).toHaveLength(1);
    expect(result[0].heading).toBe("Global Tip");
  });

  it("loads Tier 3 repo knowledge when repo is specified", () => {
    initBasePath(tmpDir);
    promoteToRepo(tmpDir, "/my/repo", { heading: "Repo Tip", content: "Specific." });

    const result = loadRelevantKnowledge(tmpDir, { repo: "/my/repo" });
    expect(result.some((e) => e.heading === "Repo Tip")).toBe(true);
  });

  it("loads Tier 2 shared knowledge for mission context", () => {
    initBasePath(tmpDir);
    const mPath = join(tmpDir, "missions", "m1");
    initMissionDir(mPath);
    writeKnowledgeEntry(join(mPath, "knowledge", "_shared.md"), {
      heading: "Mission Tip",
      content: "Useful.",
      tags: ["src/auth/"],
    });

    const result = loadRelevantKnowledge(tmpDir, { missionId: "m1" });
    expect(result.some((e) => e.heading === "Mission Tip")).toBe(true);
  });

  it("filters Tier 2 by task scope when scope provided", () => {
    initBasePath(tmpDir);
    const mPath = join(tmpDir, "missions", "m1");
    initMissionDir(mPath);
    writeKnowledgeEntry(join(mPath, "knowledge", "_shared.md"), {
      heading: "Auth Tip",
      content: "Auth detail.",
      tags: ["src/auth/"],
    });
    writeKnowledgeEntry(join(mPath, "knowledge", "_shared.md"), {
      heading: "Payment Tip",
      content: "Payment detail.",
      tags: ["src/payments/"],
    });

    const result = loadRelevantKnowledge(tmpDir, {
      missionId: "m1",
      taskScope: ["src/auth/**"],
    });
    expect(result.some((e) => e.heading === "Auth Tip")).toBe(true);
    expect(result.some((e) => e.heading === "Payment Tip")).toBe(false);
  });

  it("loads Tier 1 for own agent when agentId provided", () => {
    initBasePath(tmpDir);
    const mPath = join(tmpDir, "missions", "m1");
    initMissionDir(mPath);
    writeKnowledgeEntry(join(mPath, "knowledge", "arm-1.md"), {
      heading: "My Note",
      content: "Personal discovery.",
    });

    const result = loadRelevantKnowledge(tmpDir, {
      missionId: "m1",
      agentId: "arm-1",
    });
    expect(result.some((e) => e.heading === "My Note")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement Tier 3 and loadRelevantKnowledge**

Add to `src/protocol/knowledge.ts`:

```typescript
export function promoteToGlobal(basePath: string, entry: KnowledgeEntry): void {
  const globalPath = join(basePath, "knowledge", "_global.md");
  writeKnowledgeEntry(globalPath, entry);
}

export function promoteToRepo(basePath: string, repo: string, entry: KnowledgeEntry): void {
  const repoPath = knowledgePath(basePath, { tier: 3, repo });
  writeKnowledgeEntry(repoPath, entry);
}

function scopeOverlaps(entryTags: string[], taskScope: string[]): boolean {
  for (const tag of entryTags) {
    for (const scope of taskScope) {
      // Simple prefix matching: tag "src/auth/" overlaps scope "src/auth/**"
      const scopeBase = scope.replace(/\*+$/, "").replace(/\/$/, "");
      const tagBase = tag.replace(/\/$/, "");
      if (tagBase.startsWith(scopeBase) || scopeBase.startsWith(tagBase)) {
        return true;
      }
    }
  }
  return false;
}

export function loadRelevantKnowledge(
  basePath: string,
  opts: {
    missionId?: string;
    agentId?: string;
    taskScope?: string[];
    repo?: string;
  }
): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];

  // Tier 3 global — always loaded
  const globalPath = join(basePath, "knowledge", "_global.md");
  entries.push(...readKnowledgeEntries(globalPath));

  // Tier 3 repo — loaded when repo is specified
  if (opts.repo) {
    const repoPath = knowledgePath(basePath, { tier: 3, repo: opts.repo });
    entries.push(...readKnowledgeEntries(repoPath));
  }

  // Tier 2 shared — loaded when missionId is specified
  if (opts.missionId) {
    const missionPath = join(basePath, "missions", opts.missionId);
    const sharedEntries = readKnowledgeEntries(join(missionPath, "knowledge", "_shared.md"));

    if (opts.taskScope?.length) {
      // Filter by scope overlap — entries without tags are treated as universal
      // and always pass through (intentional: untagged entries are general knowledge)
      entries.push(...sharedEntries.filter((e) =>
        !e.tags?.length || scopeOverlaps(e.tags, opts.taskScope!)
      ));
    } else {
      entries.push(...sharedEntries);
    }
  }

  // Tier 1 own — loaded when both missionId and agentId are specified
  if (opts.missionId && opts.agentId) {
    const ownPath = join(basePath, "missions", opts.missionId, "knowledge", `${opts.agentId}.md`);
    entries.push(...readKnowledgeEntries(ownPath));
  }

  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: All tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/protocol/knowledge.ts src/protocol/__tests__/knowledge.test.ts
git commit -m "feat(knowledge): add Tier 3 promotion and loadRelevantKnowledge"
```

---

## Chunk 2: Context-Loader Knowledge Extension

### Task 4: Extend context-loader to load Tier 3 + scoped Tier 2

**Files:**
- Modify: `src/hooks/context-loader.ts`
- Modify: `src/hooks/__tests__/context-loader.test.ts`

The context-loader hook uses inline regex parsing (no `yaml` import). It must load:
1. **Tier 3 global** (`~/.mycelium/knowledge/_global.md`) — always, for all sessions
2. **Tier 3 repo** (`~/.mycelium/knowledge/repos/{slug}.md`) — when mission has a `repo` field
3. **Tier 2 filtered** — for arm sessions, filter `_shared.md` entries by task scope overlap
4. Keep existing Tier 1 + Tier 2 loading (lines 98-110) for arm sessions

- [ ] **Step 1: Write failing tests for Tier 3 global knowledge loading**

Add new test cases to the `describe("arm session context loading")` block:

```typescript
it("loads Tier 3 global knowledge in arm session", () => {
  const mPath = setupMission();
  const taskContent = stringifyFrontmatter(
    { id: 1, assigned_to: "arm-1", status: "in_progress" },
    "# Task\n\nDo work."
  );
  writeFileSync(join(mPath, "tasks", "001-task.md"), taskContent, "utf-8");

  // Write global knowledge
  const globalDir = join(tmpBase, "knowledge");
  mkdirSync(globalDir, { recursive: true });
  const globalContent = stringifyFrontmatter(
    { type: "knowledge", updated_at: Date.now() },
    "## SQLite Pattern\n\nAlways use BEGIN IMMEDIATE."
  );
  writeFileSync(join(globalDir, "_global.md"), globalContent, "utf-8");

  const output = runHook();
  expect(output).toContain("Global Knowledge");
  expect(output).toContain("SQLite Pattern");
  expect(output).toContain("BEGIN IMMEDIATE");
});
```

Also add a test for captain session loading Tier 3:

```typescript
// In the captain session describe block:
it("loads Tier 3 global knowledge in captain session", () => {
  const mPath = join(tmpBase, "missions", "m1");
  initMissionDir(mPath);
  writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Test goal");

  const globalDir = join(tmpBase, "knowledge");
  mkdirSync(globalDir, { recursive: true });
  const globalContent = stringifyFrontmatter(
    { type: "knowledge", updated_at: Date.now() },
    "## Global Tip\n\nSomething important."
  );
  writeFileSync(join(globalDir, "_global.md"), globalContent, "utf-8");

  const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
    encoding: "utf-8",
    cwd: process.cwd(),
    env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
  });
  expect(output).toContain("Global Knowledge");
  expect(output).toContain("Global Tip");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: FAIL — "Global Knowledge" not in output

- [ ] **Step 3: Add Tier 3 global knowledge loading to context-loader**

Add at the END of `src/hooks/context-loader.ts` (after both arm and captain branches, OUTSIDE the if/else):

```typescript
// Load Tier 3 global knowledge (all sessions)
const globalKnowledgePath = join(basePath, "knowledge", "_global.md");
if (existsSync(globalKnowledgePath)) {
  const content = readFileSync(globalKnowledgePath, "utf-8");
  const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (bodyMatch && bodyMatch[1].trim()) {
    console.log("\n--- Global Knowledge ---");
    console.log(bodyMatch[1].trim());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for Tier 3 repo knowledge**

```typescript
it("loads Tier 3 repo knowledge when mission has repo field", () => {
  const mPath = setupMission();
  // Rewrite mission file with repo field
  writeMissionFile(mPath, {
    id: "m1",
    status: "active",
    repo: "/my/project",
    created_at: Date.now(),
  }, "Build the feature");

  const taskContent = stringifyFrontmatter(
    { id: 1, assigned_to: "arm-1", status: "in_progress" },
    "# Task\n\nDo work."
  );
  writeFileSync(join(mPath, "tasks", "001-task.md"), taskContent, "utf-8");

  // Write repo knowledge
  const repoDir = join(tmpBase, "knowledge", "repos");
  mkdirSync(repoDir, { recursive: true });
  const repoContent = stringifyFrontmatter(
    { type: "knowledge", updated_at: Date.now() },
    "## Repo Tip\n\nAlways rebuild dist/."
  );
  writeFileSync(join(repoDir, "my-project.md"), repoContent, "utf-8");

  const output = runHook();
  expect(output).toContain("Repo Knowledge");
  expect(output).toContain("Repo Tip");
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: FAIL — "Repo Knowledge" not in output

- [ ] **Step 7: Implement Tier 3 repo knowledge loading**

In the ARM SESSION block of `src/hooks/context-loader.ts`, after the existing knowledge loading (around line 110), extract the repo from the mission file and load repo-specific knowledge:

```typescript
// Load Tier 3 repo knowledge (arm session)
const missionContent = readFileSync(join(mPath, "mission.md"), "utf-8");
const repoField = parseFmField(missionContent, "repo");
if (repoField) {
  // Slugify repo to find knowledge file
  const repoSlug = repoField
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
  // Try exact slug and also just the last segment
  const candidates = [
    join(basePath, "knowledge", "repos", `${repoSlug}.md`),
    join(basePath, "knowledge", "repos", `${repoField.split("/").filter(Boolean).pop()}.md`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf-8");
      const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      if (bodyMatch && bodyMatch[1].trim()) {
        console.log("\n--- Repo Knowledge ---");
        console.log(bodyMatch[1].trim());
      }
      break;
    }
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/context-loader.test.ts`
Expected: PASS

- [ ] **Step 9: Run full test suite**

Run: `npm test && npm run typecheck`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add src/hooks/context-loader.ts src/hooks/__tests__/context-loader.test.ts
git commit -m "feat(hooks): load Tier 3 global and repo knowledge in context-loader"
```

---

## Chunk 3: Runtime Adapters

### Task 5: Claude Code Runtime Adapter

**Files:**
- Create: `src/adapters/claude-code.ts`
- Create: `src/adapters/__tests__/claude-code.test.ts`
- Create: `scripts/spawn-teammate-claude.sh`
- Modify: `src/adapters/registry.ts`

- [ ] **Step 1: Write failing tests for Claude Code adapter**

```typescript
// src/adapters/__tests__/claude-code.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ClaudeCodeAdapter } from "../claude-code.js";

describe("ClaudeCodeAdapter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-claude-adapter-"));
    mkdirSync(join(tmpDir, "scripts"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'claude-code'", () => {
    const adapter = new ClaudeCodeAdapter(tmpDir);
    expect(adapter.name).toBe("claude-code");
  });

  it("reports unavailable when spawn script is missing", () => {
    const adapter = new ClaudeCodeAdapter(tmpDir);
    expect(adapter.isAvailable()).toBe(false);
  });

  it("reports available when spawn script exists", () => {
    const scriptPath = join(tmpDir, "scripts", "spawn-teammate-claude.sh");
    writeFileSync(scriptPath, "#!/bin/bash\necho test", "utf-8");
    chmodSync(scriptPath, "755");

    const adapter = new ClaudeCodeAdapter(tmpDir);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("throws when spawn script is missing on spawn", async () => {
    const adapter = new ClaudeCodeAdapter(tmpDir);
    await expect(
      adapter.spawn({
        missionId: "m1",
        agentId: "arm-1",
        worktreePath: "/tmp/wt",
        taskRef: "1",
        agentPrompt: "Do work",
        env: {},
      })
    ).rejects.toThrow("spawn-teammate-claude.sh not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/__tests__/claude-code.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Claude Code adapter**

```typescript
// src/adapters/claude-code.ts
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { RuntimeAdapter, SpawnConfig } from "./types.js";

export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly name = "claude-code";
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  isAvailable(): boolean {
    return existsSync(join(this.projectRoot, "scripts", "spawn-teammate-claude.sh"));
  }

  async spawn(config: SpawnConfig): Promise<void> {
    const scriptPath = join(this.projectRoot, "scripts", "spawn-teammate-claude.sh");
    if (!existsSync(scriptPath)) {
      throw new Error("spawn-teammate-claude.sh not found at " + scriptPath);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/__tests__/claude-code.test.ts`
Expected: PASS

- [ ] **Step 5: Create spawn-teammate-claude.sh**

```bash
#!/usr/bin/env bash
# Usage: spawn-teammate-claude.sh <mission_id> <agent_id> <task_ref> [model]
# Spawns a Claude Code teammate in a tmux pane with a git worktree for file isolation.

set -euo pipefail

MISSION_ID="$1"
AGENT_ID="$2"
TASK_REF="$3"
MODEL="${4:-${TEAMMATE_MODEL:-claude-sonnet-4-6}}"

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
  ADD_DIR_FLAG=""

  if is_git_repo; then
    WORKTREE_DIR=".mycelium-worktrees/${MISSION_ID}/${AGENT_ID}"
    BRANCH_NAME="mycelium/${MISSION_ID}/${AGENT_ID}"
    if [ ! -d "$WORKTREE_DIR" ]; then
      mkdir -p "$(dirname "$WORKTREE_DIR")"
      if git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" 2>/dev/null || \
         git worktree add "$WORKTREE_DIR" "$BRANCH_NAME" 2>/dev/null; then
        ADD_DIR_FLAG="--add-dir $(cd "$WORKTREE_DIR" && pwd)"
        WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
      else
        echo "WARNING: worktree creation failed — teammates will share the working directory" >&2
      fi
    else
      ADD_DIR_FLAG="--add-dir $(cd "$WORKTREE_DIR" && pwd)"
      WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
    fi
  fi

  PROMPT_FILE="$(mktemp)"
  printf '%s\n' "$PROMPT" > "$PROMPT_FILE"

  SHELL_CMD="${SHELL:-/bin/bash}"
  tmux split-window -h -c "$PROJECT_ROOT" \
    "$SHELL_CMD -lc 'export MYCELIUM_AGENT_ID=\"$AGENT_ID\" MYCELIUM_MISSION_ID=\"$MISSION_ID\" MYCELIUM_PROJECT_ROOT=\"$PROJECT_ROOT\"; trap \"rm -f $PROMPT_FILE\" EXIT; claude --model \"$MODEL\" --allowedTools \"mcp__mycelium*,Bash,Read,Write,Edit,Glob,Grep\" $ADD_DIR_FLAG -p \"\$(cat \"$PROMPT_FILE\")\"; echo \"[pane exited — press any key to close]\"; read -n1'"

  tmux select-layout tiled 2>/dev/null || true
  echo "WORK_DIR=$PROJECT_ROOT"
  echo "Spawned $AGENT_ID in tmux pane${WORKTREE_INFO} (model: $MODEL, runtime: claude-code)"
else
  echo "NOT_IN_TMUX"
fi
```

- [ ] **Step 6: Commit**

```bash
chmod +x scripts/spawn-teammate-claude.sh
git add src/adapters/claude-code.ts src/adapters/__tests__/claude-code.test.ts scripts/spawn-teammate-claude.sh
git commit -m "feat(adapters): add Claude Code runtime adapter"
```

---

### Task 6: Codex CLI Runtime Adapter

**Files:**
- Create: `src/adapters/codex-cli.ts`
- Create: `src/adapters/__tests__/codex-cli.test.ts`
- Create: `scripts/spawn-teammate-codex.sh`

- [ ] **Step 1: Write failing tests for Codex CLI adapter**

```typescript
// src/adapters/__tests__/codex-cli.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CodexCliAdapter } from "../codex-cli.js";

describe("CodexCliAdapter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-codex-adapter-"));
    mkdirSync(join(tmpDir, "scripts"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'codex-cli'", () => {
    const adapter = new CodexCliAdapter(tmpDir);
    expect(adapter.name).toBe("codex-cli");
  });

  it("reports unavailable when spawn script is missing", () => {
    const adapter = new CodexCliAdapter(tmpDir);
    expect(adapter.isAvailable()).toBe(false);
  });

  it("reports available when spawn script exists", () => {
    const scriptPath = join(tmpDir, "scripts", "spawn-teammate-codex.sh");
    writeFileSync(scriptPath, "#!/bin/bash\necho test", "utf-8");
    chmodSync(scriptPath, "755");

    const adapter = new CodexCliAdapter(tmpDir);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("throws when spawn script is missing on spawn", async () => {
    const adapter = new CodexCliAdapter(tmpDir);
    await expect(
      adapter.spawn({
        missionId: "m1",
        agentId: "arm-1",
        worktreePath: "/tmp/wt",
        taskRef: "1",
        agentPrompt: "Do work",
        env: {},
      })
    ).rejects.toThrow("spawn-teammate-codex.sh not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/__tests__/codex-cli.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Codex CLI adapter**

```typescript
// src/adapters/codex-cli.ts
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { RuntimeAdapter, SpawnConfig } from "./types.js";

export class CodexCliAdapter implements RuntimeAdapter {
  readonly name = "codex-cli";
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  isAvailable(): boolean {
    return existsSync(join(this.projectRoot, "scripts", "spawn-teammate-codex.sh"));
  }

  async spawn(config: SpawnConfig): Promise<void> {
    const scriptPath = join(this.projectRoot, "scripts", "spawn-teammate-codex.sh");
    if (!existsSync(scriptPath)) {
      throw new Error("spawn-teammate-codex.sh not found at " + scriptPath);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/__tests__/codex-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Create spawn-teammate-codex.sh**

```bash
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
```

- [ ] **Step 6: Commit**

```bash
chmod +x scripts/spawn-teammate-codex.sh
git add src/adapters/codex-cli.ts src/adapters/__tests__/codex-cli.test.ts scripts/spawn-teammate-codex.sh
git commit -m "feat(adapters): add Codex CLI runtime adapter"
```

---

### Task 7: Update Adapter Registry

**Files:**
- Modify: `src/adapters/registry.ts`

- [ ] **Step 1: Update registry to include new adapters**

```typescript
// src/adapters/registry.ts
import type { RuntimeAdapter } from "./types.js";
import { CopilotCliAdapter } from "./copilot-cli.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexCliAdapter } from "./codex-cli.js";

export function getAdapter(name: string, projectRoot: string): RuntimeAdapter {
  switch (name) {
    case "copilot-cli":
      return new CopilotCliAdapter(projectRoot);
    case "claude-code":
      return new ClaudeCodeAdapter(projectRoot);
    case "codex-cli":
      return new CodexCliAdapter(projectRoot);
    default:
      throw new Error(`Unknown runtime adapter: ${name}`);
  }
}
```

- [ ] **Step 2: Run full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/adapters/registry.ts
git commit -m "feat(adapters): register claude-code and codex-cli in adapter registry"
```

---

## Chunk 4: Template System

### Task 8: Template Protocol Layer

**Files:**
- Create: `src/protocol/templates.ts`
- Create: `src/protocol/__tests__/templates.test.ts`

Templates are YAML+Markdown files in `~/.mycelium/templates/`. Each template defines a reusable mission pattern with pre-configured task structures.

- [ ] **Step 1: Write failing tests for template operations**

```typescript
// src/protocol/__tests__/templates.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initBasePath } from "../dirs.js";
import {
  writeTemplate,
  readTemplate,
  listTemplates,
} from "../templates.js";

describe("template protocol", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-templates-test-"));
    initBasePath(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("writeTemplate", () => {
    it("writes a template file to the templates directory", () => {
      writeTemplate(tmpDir, "test-and-fix", {
        name: "test-and-fix",
        description: "Run tests, identify failures, fix them",
        tasks: [
          { title: "Run tests", scope: ["**/*.test.*"], description: "Run test suite and document failures." },
          { title: "Fix failures", scope: ["src/**"], blocked_by: [1], description: "Fix identified failures." },
        ],
      }, "A two-arm pattern for test-then-fix workflows.");

      const template = readTemplate(tmpDir, "test-and-fix");
      expect(template).toBeTruthy();
      expect(template!.data.name).toBe("test-and-fix");
      expect(template!.data.description).toBe("Run tests, identify failures, fix them");
      expect(template!.data.tasks).toHaveLength(2);
      expect(template!.body).toContain("two-arm pattern");
    });
  });

  describe("readTemplate", () => {
    it("returns null for non-existent template", () => {
      const result = readTemplate(tmpDir, "nonexistent");
      expect(result).toBeNull();
    });

    it("reads template data and body", () => {
      writeTemplate(tmpDir, "simple", {
        name: "simple",
        description: "A simple template",
        tasks: [{ title: "Do thing", scope: ["src/**"], description: "Do the thing." }],
      }, "Simple single-task template.");

      const template = readTemplate(tmpDir, "simple");
      expect(template).toBeTruthy();
      expect(template!.data.tasks).toHaveLength(1);
      expect((template!.data.tasks as Array<{ title: string }>)[0].title).toBe("Do thing");
    });
  });

  describe("listTemplates", () => {
    it("returns empty array when no templates exist", () => {
      const templates = listTemplates(tmpDir);
      expect(templates).toEqual([]);
    });

    it("lists all available templates", () => {
      writeTemplate(tmpDir, "template-a", {
        name: "template-a",
        description: "Template A",
        tasks: [],
      }, "");
      writeTemplate(tmpDir, "template-b", {
        name: "template-b",
        description: "Template B",
        tasks: [],
      }, "");

      const templates = listTemplates(tmpDir);
      expect(templates).toHaveLength(2);
      expect(templates.map((t) => t.name).sort()).toEqual(["template-a", "template-b"]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/protocol/__tests__/templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement template protocol**

```typescript
// src/protocol/templates.ts
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { FrontmatterResult } from "./frontmatter.js";

export interface TemplateSummary {
  name: string;
  description: string;
}

export interface TemplateTask {
  title: string;
  scope: string[];
  description: string;
  blocked_by?: number[];
}

export function writeTemplate(
  basePath: string,
  name: string,
  data: Record<string, unknown>,
  body: string
): void {
  const filePath = join(basePath, "templates", `${name}.md`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringifyFrontmatter(data, body), "utf-8");
}

export function readTemplate(
  basePath: string,
  name: string
): FrontmatterResult | null {
  const filePath = join(basePath, "templates", `${name}.md`);
  if (!existsSync(filePath)) return null;
  return parseFrontmatter(readFileSync(filePath, "utf-8"));
}

export function listTemplates(basePath: string): TemplateSummary[] {
  const templatesDir = join(basePath, "templates");
  if (!existsSync(templatesDir)) return [];

  const files = readdirSync(templatesDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = readFileSync(join(templatesDir, file), "utf-8");
    const { data } = parseFrontmatter(content);
    return {
      name: (data.name as string) ?? file.replace(/\.md$/, ""),
      description: (data.description as string) ?? "",
    };
  });
}

export function instantiateTemplate(
  basePath: string,
  templateName: string,
  overrides?: { goal?: string }
): { goal: string; tasks: TemplateTask[] } | null {
  const template = readTemplate(basePath, templateName);
  if (!template) return null;

  const tasks = (template.data.tasks as TemplateTask[]) ?? [];
  const goal = overrides?.goal
    ?? (template.data.description as string)
    ?? templateName;

  return { goal, tasks };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/protocol/__tests__/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `instantiateTemplate`**

Add to the test file:

```typescript
import {
  writeTemplate,
  readTemplate,
  listTemplates,
  instantiateTemplate,
} from "../templates.js";

describe("instantiateTemplate", () => {
  it("returns null for non-existent template", () => {
    const result = instantiateTemplate(tmpDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns goal and tasks from template", () => {
    writeTemplate(tmpDir, "test-fix", {
      name: "test-fix",
      description: "Run tests then fix",
      tasks: [
        { title: "Run tests", scope: ["**/*.test.*"], description: "Run suite." },
        { title: "Fix failures", scope: ["src/**"], blocked_by: [1], description: "Fix them." },
      ],
    }, "");

    const result = instantiateTemplate(tmpDir, "test-fix");
    expect(result).toBeTruthy();
    expect(result!.goal).toBe("Run tests then fix");
    expect(result!.tasks).toHaveLength(2);
    expect(result!.tasks[0].title).toBe("Run tests");
    expect(result!.tasks[1].blocked_by).toEqual([1]);
  });

  it("allows overriding the goal", () => {
    writeTemplate(tmpDir, "simple", {
      name: "simple",
      description: "Default goal",
      tasks: [{ title: "Do thing", scope: ["src/**"], description: "Do it." }],
    }, "");

    const result = instantiateTemplate(tmpDir, "simple", { goal: "Custom goal" });
    expect(result!.goal).toBe("Custom goal");
  });
});
```

- [ ] **Step 6: Run tests to verify they pass** (implementation already exists from Step 3)

Run: `npx vitest run src/protocol/__tests__/templates.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/protocol/templates.ts src/protocol/__tests__/templates.test.ts
git commit -m "feat(templates): add template write, read, list, and instantiate protocol"
```

---

## Chunk 5: Skill and Agent Prompt Updates

### Task 9: Update team-review skill with knowledge promotion

**Files:**
- Modify: `skills/team-review/SKILL.md`

- [ ] **Step 1: Add Step 5 — Knowledge Promotion (Tier 1→2)**

Replace the "What this skill does NOT do" section with a new Step 5. Update the file to add between Step 4 and the old "What this skill does NOT do":

```markdown
### Step 5: Promote knowledge (Tier 1 → 2)

After generating the retrospective, promote valuable Tier 1 knowledge entries to Tier 2:

1. **Read all arm knowledge files** in `~/.mycelium/missions/<mission_id>/knowledge/`. Each `{agent_id}.md` file contains entries the arm discovered during work.

2. **Evaluate each entry:** Is this knowledge valuable beyond this specific arm's task? Would other arms or future missions benefit from knowing this?

3. **Promote selected entries** by writing them to `~/.mycelium/missions/<mission_id>/knowledge/_shared.md` with frontmatter:
   ```markdown
   ---
   type: knowledge
   updated_at: <timestamp>
   ---

   ## <Heading>

   <Content — may be edited/consolidated from the original Tier 1 entry>
   Tags: <file paths or topic tags for scope filtering>
   ```

4. **Check for recurring patterns.** If a Tier 2 entry matches knowledge already seen in previous missions (check `~/.mycelium/knowledge/_global.md`), promote to Tier 3:
   - Write to `~/.mycelium/knowledge/_global.md` for universal patterns
   - Write to `~/.mycelium/knowledge/repos/<repo-slug>.md` for repo-specific patterns
   - Include `Source: missions <list of mission IDs>` in the entry content

### What this skill does NOT do

- **Automatic merging** — The human controls git operations
```

- [ ] **Step 2: Commit**

```bash
git add skills/team-review/SKILL.md
git commit -m "feat(skills): add knowledge promotion step to team-review"
```

---

### Task 10: Update captain skill with knowledge awareness

**Files:**
- Modify: `skills/captain/SKILL.md`

- [ ] **Step 1: Add knowledge loading to decomposition protocol**

After the "Decomposition Protocol" heading (line 27), add a step 0 before the existing steps:

```markdown
0. **Load knowledge.** Before decomposing, read available Tier 2 and Tier 3 knowledge:
   - `~/.mycelium/knowledge/_global.md` — Global patterns from previous missions
   - `~/.mycelium/knowledge/repos/<repo-slug>.md` — Repo-specific learnings
   - If resuming/extending a mission: `~/.mycelium/missions/<id>/knowledge/_shared.md`

   Use knowledge entries to inform decomposition: known gotchas → add context to relevant tasks, known patterns → better scope definitions, known file conventions → more accurate task descriptions.
```

- [ ] **Step 2: Add Tier 2→3 promotion guidance to monitoring**

Add to the end of the "Monitoring Behavior" section:

```markdown
- **Knowledge promotion (Tier 2→3):** When completing a mission via @team-review, review the Tier 2 `_shared.md` entries. If a pattern has appeared across 2+ missions, promote it to Tier 3:
  - Universal patterns → `~/.mycelium/knowledge/_global.md`
  - Repo-specific patterns → `~/.mycelium/knowledge/repos/<repo-slug>.md`
  - Include `Source: missions <list>` for traceability
```

- [ ] **Step 3: Commit**

```bash
git add skills/captain/SKILL.md
git commit -m "feat(skills): add knowledge awareness to captain decomposition"
```

---

### Task 11: Update teammate agent prompt

**Files:**
- Modify: `agents/teammate.agent.md`

- [ ] **Step 1: Add structured knowledge entry format**

In the "Filesystem Protocol" section (line 28), update the Knowledge bullet with more specific guidance:

Replace:
```
- **Knowledge:** Write gotchas, tips, and key decisions to `knowledge/{your-agent-id}.md` as you discover them
```

With:
```
- **Knowledge:** Write discoveries to `knowledge/{your-agent-id}.md` using `## Heading` sections. Include `Tags: <relevant file paths>` after each entry so the captain can filter by scope when promoting. Example:
  ```
  ## Stripe SDK v4 changed webhook signatures
  Use Stripe.webhooks.constructEvent instead of raw HMAC verification.
  Tags: src/payments/, src/webhooks/
  ```
```

- [ ] **Step 2: Commit**

```bash
git add agents/teammate.agent.md
git commit -m "feat(agent): add structured knowledge entry format to teammate prompt"
```

---

## Chunk 6: Integration, Build, and Documentation

### Task 12: Final integration — typecheck, test, build

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Clean build to `dist/`

- [ ] **Step 4: Commit dist if changed**

```bash
git add dist/
git commit -m "chore: rebuild dist for Phase 4"
```

---

### Task 13: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Add Phase 4 plan reference to the header section:
```
**Phase 4 plan:** `docs/superpowers/plans/2026-03-14-mycelium-phase4-knowledge-adapters.md`
```

Update the Protocol Layer section to include `knowledge.ts` and `templates.ts`:
```
- `knowledge.ts` — `writeKnowledgeEntry`, `readKnowledgeEntries`, `knowledgePath`, `collectTier1Entries`, `promoteKnowledge`, `promoteToGlobal`, `promoteToRepo`, `loadRelevantKnowledge`
- `templates.ts` — `writeTemplate`, `readTemplate`, `listTemplates`, `instantiateTemplate`
```

Update the Adapters section:
```
- `claude-code.ts` — Claude Code adapter (wraps `spawn-teammate-claude.sh`)
- `codex-cli.ts` — Codex CLI adapter (wraps `spawn-teammate-codex.sh`)
```

Update the Roadmap to mark Phase 4 as shipped:
```
- **Phase 4** (shipped): Mycelium knowledge — 3-tier knowledge promotion, enhanced context loading, Claude Code + Codex CLI adapters, mission templates
```

- [ ] **Step 2: Update README.md**

Update the roadmap section to mark Phase 4 as shipped.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update documentation for Phase 4"
```

---

### Task 14: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 0.7.0**

Update `"version": "0.6.0"` to `"version": "0.7.0"` in `package.json`.

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.7.0 for Phase 4"
```
