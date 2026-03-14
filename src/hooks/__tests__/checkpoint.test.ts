import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir } from "../../protocol/mission.js";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = process.cwd();

function runHook(tmpBase: string, env: Record<string, string>): void {
  execSync(`npx tsx src/hooks/checkpoint.ts`, {
    encoding: "utf-8",
    cwd: CWD,
    env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
  });
}

function writeTaskFile(
  missionPath: string,
  data: Record<string, unknown>,
  title: string
): string {
  const id = data.id as number;
  const filename = `${String(id).padStart(3, "0")}-task.md`;
  const filePath = join(missionPath, "tasks", filename);
  const content = stringifyFrontmatter(data, `# ${title}`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("checkpoint hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-checkpoint-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
    missionPath = join(tmpBase, "missions", "m1");
    initMissionDir(missionPath);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("is silent when no env vars (captain session)", () => {
    // No MYCELIUM_AGENT_ID or MYCELIUM_MISSION_ID — should exit silently
    runHook(tmpBase, {});
    // If we get here without error, the hook exited cleanly
  });

  it("is silent when no in-progress task found", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "pending",
    }, "Task 1");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });
    // No checkpoint should be written anywhere
    const progressPath = join(missionPath, "progress", "arm-1.md");
    expect(existsSync(progressPath)).toBe(false);
  });

  it("writes checkpoint section to in-progress task file", () => {
    const taskPath = writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
    }, "Task 1");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const content = readFileSync(taskPath, "utf-8");
    expect(content).toContain("## Checkpoint");
    expect(content).toContain("<!-- written by sessionEnd hook -->");
    expect(content).toContain("**Timestamp:**");
    expect(content).toContain("**Status:** session ended");
  });

  it("overwrites previous checkpoint (no accumulation)", () => {
    const taskPath = writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
    }, "Task 1");

    // Run hook twice
    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });
    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const content = readFileSync(taskPath, "utf-8");
    // Should only have one ## Checkpoint section
    const checkpointMatches = content.match(/## Checkpoint/g);
    expect(checkpointMatches).not.toBeNull();
    expect(checkpointMatches!.length).toBe(1);
  });

  it("appends final entry to progress file", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
    }, "Task 1");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const progressPath = join(missionPath, "progress", "arm-1.md");
    expect(existsSync(progressPath)).toBe(true);

    const progressContent = readFileSync(progressPath, "utf-8");
    expect(progressContent).toContain("session ended");
  });

  it("appends multiple entries to progress file on repeated runs", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
    }, "Task 1");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });
    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const progressPath = join(missionPath, "progress", "arm-1.md");
    const progressContent = readFileSync(progressPath, "utf-8");
    const sessionEndedMatches = progressContent.match(/session ended/g);
    expect(sessionEndedMatches).not.toBeNull();
    expect(sessionEndedMatches!.length).toBe(2);
  });

  it("is silent when tasks directory does not exist", () => {
    // Mission exists but has no tasks dir; shouldn't error
    rmSync(join(missionPath, "tasks"), { recursive: true, force: true });

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });
    // No checkpoint written — just exits silently
    const progressPath = join(missionPath, "progress", "arm-1.md");
    expect(existsSync(progressPath)).toBe(false);
  });
});
