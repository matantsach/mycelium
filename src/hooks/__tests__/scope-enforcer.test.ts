import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir } from "../../protocol/mission.js";
import { stringifyFrontmatter } from "../../protocol/frontmatter.js";

const CWD = process.cwd();

function runHook(tmpBase: string, env: Record<string, string>, stdin: string): string {
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

function writeTaskFile(
  missionPath: string,
  data: Record<string, unknown>,
  title: string
): void {
  const id = data.id as number;
  const filename = `${String(id).padStart(3, "0")}-task.md`;
  const content = stringifyFrontmatter(data, `# ${title}`);
  writeFileSync(join(missionPath, "tasks", filename), content, "utf-8");
}

describe("scope-enforcer hook", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-scope-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
    missionPath = join(tmpBase, "missions", "m1");
    initMissionDir(missionPath);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("captain session bypass (no env vars)", () => {
    const stdin = JSON.stringify({ toolName: "Edit", input: { file_path: "src/file.ts" } });
    const output = runHook(tmpBase, {}, stdin);
    expect(output.trim()).toBe("");
  });

  it("non-file-mutation tool allowed", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: ["src/file.ts"],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "ReadFile", input: { file_path: "src/other.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    expect(output.trim()).toBe("");
  });

  it("file within scope (exact match)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: ["src/file.ts"],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "Edit", input: { file_path: "src/file.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    expect(output.trim()).toBe("");
  });

  it("file within scope (glob match)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: ["src/payments/**"],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "Write", input: { file_path: "src/payments/route.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    expect(output.trim()).toBe("");
  });

  it("file outside scope (denied)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: ["src/payments/**"],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "Edit", input: { file_path: "src/auth/login.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    const parsed = JSON.parse(output.trim()) as { permissionDecision: string; permissionDecisionReason: string };
    expect(parsed.permissionDecision).toBe("deny");
    expect(parsed.permissionDecisionReason).toContain("src/auth/login.ts");
  });

  it("Copilot CLI tool names (editFile)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: ["src/payments/**"],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "editFile", input: { path: "src/auth/login.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    const parsed = JSON.parse(output.trim()) as { permissionDecision: string; permissionDecisionReason: string };
    expect(parsed.permissionDecision).toBe("deny");
    expect(parsed.permissionDecisionReason).toContain("src/auth/login.ts");
  });

  it("no task file found (allow)", () => {
    // No task files written
    const stdin = JSON.stringify({ toolName: "Edit", input: { file_path: "src/anything.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    expect(output.trim()).toBe("");
  });

  it("no scope field (allow)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "Edit", input: { file_path: "src/anything.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    expect(output.trim()).toBe("");
  });

  it("empty scope array (deny all)", () => {
    writeTaskFile(missionPath, {
      id: 1,
      assigned_to: "arm-1",
      status: "in_progress",
      scope: [],
    }, "Task 1");

    const stdin = JSON.stringify({ toolName: "Write", input: { file_path: "src/anything.ts" } });
    const output = runHook(tmpBase, { MYCELIUM_AGENT_ID: "arm-1", MYCELIUM_MISSION_ID: "m1" }, stdin);
    const parsed = JSON.parse(output.trim()) as { permissionDecision: string; permissionDecisionReason: string };
    expect(parsed.permissionDecision).toBe("deny");
    expect(parsed.permissionDecisionReason).toContain("src/anything.ts");
  });
});
