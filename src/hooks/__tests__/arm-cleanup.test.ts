import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir } from "../../protocol/mission.js";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = "/Users/matantsach/mtsach/projects/mycelium/.worktrees/phase2";

function runHook(tmpBase: string, env: Record<string, string>): void {
  execSync(`npx tsx src/hooks/arm-cleanup.ts`, {
    encoding: "utf-8",
    cwd: CWD,
    env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase, ...env },
  });
}

function writeMemberFile(
  missionPath: string,
  agentId: string,
  data: Record<string, unknown>
): string {
  const filePath = join(missionPath, "members", `${agentId}.md`);
  const content = stringifyFrontmatter(data, "");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
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

describe("arm-cleanup hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-arm-cleanup-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
    missionPath = join(tmpBase, "missions", "m1");
    initMissionDir(missionPath);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("is silent when no env vars (not an arm session)", () => {
    // Should exit without error and without creating any files
    runHook(tmpBase, {});
    // No audit.jsonl should have been written
    expect(existsSync(join(missionPath, "audit.jsonl"))).toBe(false);
  });

  it("updates member file status from active to finished", () => {
    const memberFilePath = writeMemberFile(missionPath, "arm-1", {
      agent_id: "arm-1",
      role: "arm",
      status: "active",
    });

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const content = readFileSync(memberFilePath, "utf-8");
    expect(content).toContain("status: finished");
    expect(content).not.toMatch(/status:\s*active/);
  });

  it("appends session_end audit entry", () => {
    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const auditPath = join(missionPath, "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);

    const content = readFileSync(auditPath, "utf-8");
    const entry = JSON.parse(content.trim().split("\n").at(-1)!);
    expect(entry.agent).toBe("arm-1");
    expect(entry.action).toBe("session_end");
    expect(typeof entry.ts).toBe("number");
  });

  it("sends notification to lead inbox when all tasks are completed", () => {
    writeTaskFile(missionPath, { id: 1, status: "completed", assigned_to: "arm-1" }, "Task 1");
    writeTaskFile(missionPath, { id: 2, status: "completed", assigned_to: "arm-1" }, "Task 2");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const leadInbox = join(missionPath, "inbox", "lead");
    expect(existsSync(leadInbox)).toBe(true);

    const messages = readdirSync(leadInbox).filter((f) => f.endsWith(".md"));
    expect(messages.length).toBe(1);

    const msgContent = readFileSync(join(leadInbox, messages[0]!), "utf-8");
    expect(msgContent).toContain("from: arm-1");
    expect(msgContent).toContain("All tasks complete for mission m1");
  });

  it("does NOT send notification when some tasks are incomplete", () => {
    writeTaskFile(missionPath, { id: 1, status: "completed", assigned_to: "arm-1" }, "Task 1");
    writeTaskFile(missionPath, { id: 2, status: "in_progress", assigned_to: "arm-1" }, "Task 2");

    runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" });

    const leadInbox = join(missionPath, "inbox", "lead");
    if (existsSync(leadInbox)) {
      const messages = readdirSync(leadInbox).filter((f) => f.endsWith(".md"));
      expect(messages.length).toBe(0);
    }
    // If leadInbox doesn't exist, that's also fine (no notification sent)
  });
});
