import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initMissionDir,
  writeMissionFile,
  writeMemberFile,
  writeTaskFile,
} from "../../protocol/mission.js";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const HOOK = "src/hooks/passive-monitor.ts";
const CWD = "/Users/matantsach/mtsach/projects/mycelium/.worktrees/phase2";

function runHook(
  tmpBase: string,
  env: Record<string, string | undefined> = {}
): string {
  return execSync(`npx tsx ${HOOK}`, {
    encoding: "utf-8",
    cwd: CWD,
    env: {
      ...process.env,
      MYCELIUM_BASE_PATH: tmpBase,
      MYCELIUM_AGENT_ID: undefined,
      MYCELIUM_MISSION_ID: undefined,
      ...env,
    },
  });
}

describe("passive-monitor hook — captain mode", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-pm-captain-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("is silent when no active missions exist", () => {
    const output = runHook(tmpBase);
    expect(output.trim()).toBe("");
  });

  it("detects stale arm via progress file mtime", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Goal");

    // Create a member
    writeMemberFile(mPath, { agent_id: "arm-1", role: "worker" });

    // Create a progress file with mtime 10 minutes ago
    const progressFile = join(mPath, "progress", "arm-1.md");
    writeFileSync(progressFile, stringifyFrontmatter({ agent_id: "arm-1" }, ""));
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(progressFile, tenMinAgo, tenMinAgo);

    const output = runHook(tmpBase);
    expect(output).toContain("m1");
    expect(output).toContain("stale arm: arm-1");
  });

  it("detects task needing review", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Goal");

    writeTaskFile(
      mPath,
      { id: 1, status: "needs_review", assigned_to: "arm-1" },
      "Task One",
      "Do something"
    );

    const output = runHook(tmpBase);
    expect(output).toContain("m1");
    expect(output).toContain("task needs review");
  });

  it("outputs separate lines for multiple missions with signals", () => {
    for (const mId of ["m1", "m2"]) {
      const mPath = join(tmpBase, "missions", mId);
      initMissionDir(mPath);
      writeMissionFile(
        mPath,
        { id: mId, status: "active", created_at: Date.now() },
        `Goal ${mId}`
      );
      writeTaskFile(
        mPath,
        { id: 1, status: "needs_review", assigned_to: "arm-1" },
        "Task",
        "desc"
      );
    }

    const output = runHook(tmpBase);
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("m1"))).toBe(true);
    expect(lines.some((l) => l.includes("m2"))).toBe(true);
    expect(lines.every((l) => l.includes("task needs review"))).toBe(true);
  });

  it("detects all tasks complete", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, { id: "m1", status: "active", created_at: Date.now() }, "Goal");

    writeTaskFile(
      mPath,
      { id: 1, status: "completed", assigned_to: "arm-1" },
      "Task One",
      "Done"
    );
    writeTaskFile(
      mPath,
      { id: 2, status: "completed", assigned_to: "arm-2" },
      "Task Two",
      "Also done"
    );

    const output = runHook(tmpBase);
    expect(output).toContain("m1");
    expect(output).toContain("all tasks complete");
  });
});

describe("passive-monitor hook — arm mode", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-pm-arm-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("shows unread message count", () => {
    const inboxDir = join(tmpBase, "missions", "m1", "inbox", "arm-1");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(
      join(inboxDir, "msg-001.md"),
      stringifyFrontmatter({ from: "captain", priority: false }, "Hello")
    );
    writeFileSync(
      join(inboxDir, "msg-002.md"),
      stringifyFrontmatter({ from: "captain", priority: false }, "Another")
    );

    const output = runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });
    expect(output).toContain("2 unread message(s) in inbox");
  });

  it("shows PRIORITY for priority messages", () => {
    const inboxDir = join(tmpBase, "missions", "m1", "inbox", "arm-1");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(
      join(inboxDir, "msg-urgent.md"),
      stringifyFrontmatter({ from: "captain", priority: true }, "STOP NOW")
    );

    const output = runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });
    expect(output).toContain("PRIORITY message from lead in inbox");
  });

  it("is silent when no messages", () => {
    const inboxDir = join(tmpBase, "missions", "m1", "inbox", "arm-1");
    mkdirSync(inboxDir, { recursive: true });

    const output = runHook(tmpBase, {
      MYCELIUM_AGENT_ID: "arm-1",
      MYCELIUM_MISSION_ID: "m1",
    });
    expect(output.trim()).toBe("");
  });
});
