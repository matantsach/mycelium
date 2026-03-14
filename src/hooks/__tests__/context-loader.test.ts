import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir, writeMissionFile } from "../../protocol/mission.js";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

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
      cwd: process.cwd(),
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
      cwd: process.cwd(),
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });

  it("is silent when no missions exist", () => {
    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });

  it("loads captain.md attention queue in captain mode", () => {
    // Create an active mission (required for captain output)
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "active",
      created_at: Date.now(),
    }, "Test mission goal");

    // Write captain.md at the base path with attention queue content
    const captainContent = stringifyFrontmatter(
      { type: "captain_state", updated_at: Date.now() },
      "## Attention Queue\n\n- arm-1 stale: no update in 2h"
    );
    writeFileSync(join(tmpBase, "captain.md"), captainContent, "utf-8");

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output).toContain("Attention Queue");
    expect(output).toContain("arm-1 stale");
  });

  it("is silent about captain.md when file does not exist", () => {
    // Create an active mission
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "active",
      created_at: Date.now(),
    }, "Test mission goal");

    // Do NOT write captain.md
    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output).toContain("m1");
    expect(output).not.toContain("Attention Queue");
  });
});

describe("arm session context loading", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  function runHook(extraEnv: Record<string, string> = {}): string {
    return execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        MYCELIUM_BASE_PATH: tmpBase,
        MYCELIUM_AGENT_ID: "arm-1",
        MYCELIUM_MISSION_ID: "m1",
        ...extraEnv,
      },
    });
  }

  function setupMission(): string {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Build the feature");
    return mPath;
  }

  it("loads task details for arm session", () => {
    const mPath = setupMission();
    const taskContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "in_progress", prior_tasks: [] },
      "# Implement login\n\nBuild a login form with email and password fields.\n\n## Output\n<!-- filled by arm -->"
    );
    writeFileSync(join(mPath, "tasks", "001-implement-login.md"), taskContent, "utf-8");

    const output = runHook();
    expect(output).toContain("Arm arm-1");
    expect(output).toContain("mission m1");
    expect(output).toContain("001-implement-login.md");
    expect(output).toContain("Implement login");
    expect(output).toContain("Build a login form");
  });

  it("loads checkpoint section if present", { timeout: 15000 }, () => {
    const mPath = setupMission();
    const taskContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "in_progress" },
      "# My Task\n\nDo something.\n\n## Output\n\n## Checkpoint\nLast checkpoint: wrote 3 files"
    );
    writeFileSync(join(mPath, "tasks", "001-my-task.md"), taskContent, "utf-8");

    const output = runHook();
    expect(output).toContain("Checkpoint");
    expect(output).toContain("wrote 3 files");
  });

  it("loads unread inbox messages", () => {
    const mPath = setupMission();
    // Create a task so arm session doesn't bail early
    const taskContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "pending" },
      "# Task\n\nDo work."
    );
    writeFileSync(join(mPath, "tasks", "001-task.md"), taskContent, "utf-8");

    // Create an inbox message
    const inboxDir = join(mPath, "inbox", "arm-1");
    mkdirSync(inboxDir, { recursive: true });
    const msgContent = stringifyFrontmatter(
      { from: "captain-1", priority: "false" },
      "Please update me on your progress."
    );
    writeFileSync(join(inboxDir, "001-msg.md"), msgContent, "utf-8");

    const output = runHook();
    expect(output).toContain("Inbox");
    expect(output).toContain("unread");
    expect(output).toContain("captain-1");
    expect(output).toContain("Please update me on your progress.");
  });

  it("references team-coordinate skill", () => {
    const mPath = setupMission();
    const taskContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "in_progress" },
      "# Task\n\nDo work."
    );
    writeFileSync(join(mPath, "tasks", "001-task.md"), taskContent, "utf-8");

    const output = runHook();
    expect(output).toContain("team-coordinate");
  });

  it("loads prior task outputs when prior_tasks is set", () => {
    const mPath = setupMission();

    // Write prior task (task 1) with output
    const priorContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "completed" },
      "# Prior Task\n\nDid some work.\n\n## Output\nI completed the schema migration successfully.\n\n## Checkpoint"
    );
    writeFileSync(join(mPath, "tasks", "001-prior-task.md"), priorContent, "utf-8");

    // Write current task (task 2) with prior_tasks referencing task 1
    const currentContent = stringifyFrontmatter(
      { id: 2, assigned_to: "arm-1", status: "in_progress", prior_tasks: [1] },
      "# Current Task\n\nBuild on prior work.\n\n## Output"
    );
    writeFileSync(join(mPath, "tasks", "002-current-task.md"), currentContent, "utf-8");

    const output = runHook();
    expect(output).toContain("Prior Task 1 Output");
    expect(output).toContain("schema migration successfully");
  });

  it("loads knowledge files", () => {
    const mPath = setupMission();
    const taskContent = stringifyFrontmatter(
      { id: 1, assigned_to: "arm-1", status: "in_progress" },
      "# Task\n\nDo work."
    );
    writeFileSync(join(mPath, "tasks", "001-task.md"), taskContent, "utf-8");

    // Write shared knowledge
    const knowledgeContent = stringifyFrontmatter(
      { type: "shared" },
      "Gotcha: always use BEGIN IMMEDIATE for SQLite transactions."
    );
    writeFileSync(join(mPath, "knowledge", "_shared.md"), knowledgeContent, "utf-8");

    const output = runHook();
    expect(output).toContain("Knowledge");
    expect(output).toContain("BEGIN IMMEDIATE");
  });
});
